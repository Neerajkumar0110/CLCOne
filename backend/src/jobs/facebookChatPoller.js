const mongoose = require('mongoose');

// Pulls ad chats — Messenger and Instagram DM conversations on each
// connected Page — into the CRM as leads (services/marketing/chatLeads.js).
// Meta's Messages campaigns ("Messaging conversations started" in Ads
// Manager) never create lead-form leads, so jobs/facebookLeadPoller.js can't
// see them; this is the path that does.
//
// Needs the Page token to carry pages_messaging (Messenger) and
// instagram_manage_messages (Instagram). Until the account is reconnected
// with "Connect chats" (facebookController/connect.js ?chats=1) Meta refuses
// with #200 / #230 — that message is kept on the connection
// (chatsPollError / chatsIgPollError) so the dashboard can say why.
//
// Each tick, per Page and platform: walk conversations newest-first and stop
// at the watermark (chatsPolledAt − overlap). First run: every conversation
// Meta still returns (capped by MAX_PAGES), so old chats come in too.
// Real time comes from the webhook (facebookController/webhook.js, field
// "messages"); this poll is the safety net and the backfill — 20 s, and an
// incremental tick reads one page of conversations at most.
const POLL_INTERVAL_MS = Number(process.env.FACEBOOK_CHAT_POLL_INTERVAL_MS) || 20 * 1000;
const OVERLAP_MS = 15 * 60 * 1000;
const PAGE_SIZE = 50;
const MAX_PAGES = Number(process.env.FACEBOOK_CHAT_BACKFILL_PAGES) || 40; // ≤ 2,000 chats on the first run

let running = false;

// The Page's linked Instagram business account: { id } or { err }.
async function igAccount(graph, conn, token) {
  try {
    const r = await graph.graphRequest(`/${conn.pageId}`, { params: { fields: 'instagram_business_account', access_token: token } });
    const id = r.instagram_business_account && r.instagram_business_account.id;
    return id ? { id } : { err: 'No Instagram account is linked to this Facebook Page (or instagram_basic is not granted yet).' };
  } catch (e) {
    return { err: e.message };
  }
}

async function pollPlatform({ graph, conn, token, platform, since, ownIds }) {
  const { upsertChatLead } = require('../services/marketing/chatLeads');
  let after;
  let created = 0;
  let seen = 0;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const json = await graph.graphRequest(`/${conn.pageId}/conversations`, {
      params: {
        platform,
        fields: 'id,updated_time,participants,messages.limit(25){message,from,created_time}',
        limit: PAGE_SIZE,
        access_token: token,
        ...(after ? { after } : {}),
      },
    });
    const rows = json.data || [];
    let reachedOld = false;
    for (const c of rows) {
      const updated = new Date(c.updated_time);
      if (since && updated < since) {
        reachedOld = true;
        break;
      }
      seen += 1;
      const people = (c.participants && c.participants.data) || [];
      const msgs = ((c.messages && c.messages.data) || []).slice().sort((a, b) => new Date(a.created_time) - new Date(b.created_time));
      // The customer is whoever isn't the Page / its Instagram account — from
      // the participants, else from who wrote the messages. Never fall back
      // to the Page itself (that made a lead called "Career Lab Consulting").
      const isOwn = (p) => !p || !p.id || ownIds.has(String(p.id)) || (conn.pageName && p.name === conn.pageName);
      const customer = people.find((p) => !isOwn(p)) || (msgs.find((m) => !isOwn(m.from)) || {}).from;
      if (!customer || !customer.id) continue;
      const theirs = msgs.filter((m) => m.from && String(m.from.id) === String(customer.id));
      // Only the customer's own words — our auto-replies are not their message.
      const last = theirs[theirs.length - 1];
      const r = await upsertChatLead({
        channel: platform === 'instagram' ? 'instagram' : 'messenger',
        // keyed by the customer's page-scoped id (PSID / IGSID) — the same id
        // the real-time webhook gets as sender.id, so both paths hit one lead
        conversationId: customer.id,
        name: customer.name || customer.username,
        text: last && last.message,
        texts: theirs.map((m) => m.message).filter(Boolean),
        at: (last && last.created_time) || c.updated_time,
        startedAt: msgs[0] && msgs[0].created_time,
        pageId: conn.pageId,
        adAccountId: conn.adAccountId,
      });
      if (r.created) created += 1;
    }
    after = json.paging && json.paging.next && json.paging.cursors && json.paging.cursors.after;
    if (reachedOld || !after) break;
  }
  return { created, seen };
}

async function pollConnection(conn) {
  const graph = require('../utils/metaGraphClient');
  const { decryptedPageToken } = require('../controllers/appControllers/marketing/facebookController/_helpers');
  const token = decryptedPageToken(conn);
  if (!token || !conn.pageId) return null;

  const tickStart = new Date();
  const ownIds = new Set([String(conn.pageId)]);
  const igInfo = await igAccount(graph, conn, token);
  const ig = igInfo.id;
  if (ig) {
    ownIds.add(String(ig));
    conn.instagramAccountId = String(ig); // lets the Instagram webhook find this connection
  }

  const out = { messenger: null, instagram: null };
  for (const platform of ['messenger', 'instagram']) {
    const errField = platform === 'instagram' ? 'chatsIgPollError' : 'chatsPollError';
    // Separate watermark per platform, moved only after a successful read —
    // so the first good run after "Connect chats" still backfills everything.
    const markField = platform === 'instagram' ? 'chatsIgPolledAt' : 'chatsPolledAt';
    const since = conn[markField] ? new Date(conn[markField].getTime() - OVERLAP_MS) : null;
    if (platform === 'instagram' && !ig) {
      conn[errField] = igInfo.err;
      continue;
    }
    try {
      out[platform] = await pollPlatform({ graph, conn, token, platform, since, ownIds });
      conn[errField] = undefined;
      conn[markField] = tickStart;
    } catch (e) {
      if (conn[errField] !== e.message) console.error(`[facebookChatPoller] ${conn.pageName || conn.pageId} ${platform}:`, e.message);
      conn[errField] = e.message;
    }
  }
  await conn.save();
  return out;
}

async function pollOnce() {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const FacebookConnection = mongoose.model('FacebookConnection');
    const conns = await FacebookConnection.find({ removed: false, status: 'connected', pageId: { $nin: [null, ''] } }).exec();
    for (const conn of conns) {
      try {
        const r = await pollConnection(conn);
        const n = r ? ((r.messenger && r.messenger.created) || 0) + ((r.instagram && r.instagram.created) || 0) : 0;
        if (n) console.log(`[facebookChatPoller] ${conn.pageName || conn.pageId}: ${n} new chat lead(s)`);
      } catch (err) {
        console.error(`[facebookChatPoller] ${conn.pageName || conn.pageId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[facebookChatPoller] tick failed:', err.message);
  } finally {
    running = false;
  }
}

function startFacebookChatPoller() {
  setTimeout(pollOnce, 45 * 1000);
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

module.exports = startFacebookChatPoller;
module.exports.pollOnce = pollOnce;
module.exports.pollConnection = pollConnection;
