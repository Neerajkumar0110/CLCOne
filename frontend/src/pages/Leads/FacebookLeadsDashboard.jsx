import React, { useEffect, useMemo, useState } from "react";
import { ReloadOutlined, FacebookFilled, InstagramFilled, WarningFilled, CheckCircleFilled, MessageOutlined } from "@ant-design/icons";
import { request } from "@/request";
import { getSocket } from "@/socket";
import { stageColor } from "@/config/leadStages";
import HubModal from "@/components/HubModal";
import LeadFullDetailModal from "@/components/LeadFullDetail";

// Capture Form › Facebook Ads, top of the page: which campaigns run, how many
// leads each brings, Facebook vs Instagram, and where those leads stand in the
// CRM — read-only (backend facebookController/liveCampaigns.js).

const RANGES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["this_month", "This month"],
  ["last_month", "Last month"],
  ["maximum", "All time"],
];
const FB = "#1877F2";
const IG = "#E1306C";
const STATUS = {
  ACTIVE: ["Active", "hub-badge-green"],
  PAUSED: ["Paused", "hub-badge-gray"],
  CAMPAIGN_PAUSED: ["Paused", "hub-badge-gray"],
  ARCHIVED: ["Archived", "hub-badge-gray"],
  WITH_ISSUES: ["Issues", "hub-badge-red"],
  IN_PROCESS: ["In review", "hub-badge-yellow"],
};
const OBJECTIVE = {
  OUTCOME_LEADS: "Leads",
  LEAD_GENERATION: "Leads",
  OUTCOME_ENGAGEMENT: "Engagement",
  MESSAGES: "Messages",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_SALES: "Sales",
};

function SplitBar({ fb, ig, other = 0, label }) {
  const total = fb + ig + other;
  const pct = (n) => (total ? (n / total) * 100 : 0);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, fontWeight: 600, color: "var(--hub-muted)", marginBottom: 5 }}>
        <span>{label}</span>
        <span>{total.toLocaleString("en-IN")} total</span>
      </div>
      <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "var(--hub-border)" }}>
        {fb > 0 && <div title={`Facebook: ${fb}`} style={{ width: `${pct(fb)}%`, background: FB }} />}
        {ig > 0 && <div title={`Instagram: ${ig}`} style={{ width: `${pct(ig)}%`, background: `linear-gradient(90deg, #F58529, ${IG}, #833AB4)` }} />}
        {other > 0 && <div title={`Other: ${other}`} style={{ width: `${pct(other)}%`, background: "#94a3b8" }} />}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 12, marginTop: 6, flexWrap: "wrap" }}>
        <span style={{ color: FB, fontWeight: 700 }}><FacebookFilled /> Facebook {fb.toLocaleString("en-IN")} <span style={{ color: "var(--hub-muted)", fontWeight: 500 }}>({Math.round(pct(fb))}%)</span></span>
        <span style={{ color: IG, fontWeight: 700 }}><InstagramFilled /> Instagram {ig.toLocaleString("en-IN")} <span style={{ color: "var(--hub-muted)", fontWeight: 500 }}>({Math.round(pct(ig))}%)</span></span>
        {other > 0 && <span style={{ color: "var(--hub-muted)", fontWeight: 700 }}>Other {other}</span>}
      </div>
    </div>
  );
}

// One campaign in full (click a campaign row / its Facebook-Instagram numbers / a stage chip):
// numbers, Facebook vs Instagram, its ads, and every lead of it in the CRM.
function CampaignDetail({ campaign, range, initial, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [platform, setPlatform] = useState(initial.platform || "all");
  const [stage, setStage] = useState(initial.stage || "");
  const [q, setQ] = useState("");
  const [viewLead, setViewLead] = useState(null);

  useEffect(() => {
    let gone = false;
    request.get({ entity: `facebook/live-campaigns/${campaign.id}?range=${range}` }).then((r) => {
      if (gone) return;
      if (r?.success) setData(r.result);
      else setError(r?.message || "Could not load the campaign.");
    });
    return () => {
      gone = true;
    };
  }, [campaign.id, range]);

  const money = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const int = (v) => Number(v || 0).toLocaleString("en-IN");
  const leads = data?.leads || [];
  const counts = leads.reduce((a, l) => ((a[l.platform] = (a[l.platform] || 0) + 1), a), {});
  const stageList = [...new Set(leads.map((l) => l.stage))];
  const needle = q.trim().toLowerCase();
  const shown = leads.filter(
    (l) =>
      (platform === "all" || l.platform === platform) &&
      (!stage || l.stage === stage) &&
      (!needle || `${l.name} ${l.phone} ${l.email || ""} ${l.owner}`.toLowerCase().includes(needle))
  );
  const PIcon = ({ p }) =>
    p === "facebook" ? <FacebookFilled style={{ color: FB }} /> : p === "instagram" ? <InstagramFilled style={{ color: IG }} /> : <span style={{ color: "var(--hub-muted)" }}>•</span>;
  const chip = (key, label, n, color) => (
    <button
      key={key}
      type="button"
      className="hub-btn"
      onClick={() => setPlatform(key)}
      style={platform === key ? { background: color || "var(--hub-blue)", color: "#fff", borderColor: color || "var(--hub-blue)" } : undefined}
    >
      {label} <b style={{ marginLeft: 4 }}>{n}</b>
    </button>
  );
  const ss = campaign.spendSplit || {};
  const ms = campaign.metaSplit || {};

  return (
    <HubModal
      open
      onClose={onClose}
      title={campaign.name}
      subtitle={`${(STATUS[campaign.status] || [campaign.status || ""])[0]} · ${OBJECTIVE[campaign.objective] || campaign.objective || ""}`}
      width={1180}
      footer={<button type="button" className="hub-btn hub-btn-primary" onClick={onClose}>Close</button>}
    >
      <div className="hub-stack" style={{ gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
          {[
            ["Spend", money(campaign.spend), "#dc2626"],
            ["Impressions", int(campaign.impressions), "#7c3aed"],
            ["Clicks", int(campaign.clicks), "#2563eb"],
            ["Leads (Meta)", int(campaign.metaLeads), "#16a34a"],
            ["Cost / lead", campaign.metaLeads ? money(campaign.cpl) : "—", "#d97706"],
            ["In CRM", int(campaign.crmLeads), "#0891b2"],
          ].map(([label, value, color]) => (
            <div key={label} style={{ padding: "9px 12px", borderRadius: 12, border: "1px solid var(--hub-border)", background: "var(--hub-bg-soft)", borderLeft: `3px solid ${color}` }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{value}</div>
              <div style={{ fontSize: 11, color: "var(--hub-muted)", fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18, padding: 14, borderRadius: 12, border: "1px solid var(--hub-border)" }}>
          <SplitBar label="Leads by platform (Meta)" fb={ms.facebook || 0} ig={ms.instagram || 0} other={(ms.messenger || 0) + (ms.whatsapp || 0) + (ms.other || 0)} />
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--hub-muted)", marginBottom: 6 }}>Spend by platform</div>
            <div style={{ display: "flex", gap: 14, fontSize: 12.5, flexWrap: "wrap" }}>
              <span style={{ color: FB, fontWeight: 700 }}><FacebookFilled /> {money(ss.facebook)}</span>
              <span style={{ color: IG, fontWeight: 700 }}><InstagramFilled /> {money(ss.instagram)}</span>
              {(ss.messenger || 0) + (ss.whatsapp || 0) + (ss.other || 0) > 0 && (
                <span style={{ color: "var(--hub-muted)", fontWeight: 700 }}>Other {money((ss.messenger || 0) + (ss.whatsapp || 0) + (ss.other || 0))}</span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 6 }}>
              Cost / lead — Facebook {ms.facebook ? money(ss.facebook / ms.facebook) : "—"} · Instagram {ms.instagram ? money(ss.instagram / ms.instagram) : "—"}
            </div>
          </div>
        </div>

        {error && <div style={{ color: "#b91c1c", fontSize: 12.5 }}>{error}</div>}
        {!data && !error && <div className="hub-empty">Loading the campaign…</div>}

        {data && data.ads.length > 0 && (
          <div>
            <b style={{ fontSize: 13.5 }}>Ads</b>
            <div className="hub-table-wrapper" style={{ marginTop: 8 }}>
              <table className="hub-table">
                <thead>
                  <tr>
                    <th>Ad set / ad</th>
                    <th style={{ textAlign: "right" }}>Spend</th>
                    <th style={{ textAlign: "right" }}>Clicks</th>
                    <th style={{ textAlign: "right" }}>CTR</th>
                    <th style={{ textAlign: "right" }}>Leads</th>
                    <th>Facebook / Instagram</th>
                    <th style={{ textAlign: "right" }}>Cost / lead</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ads.map((a) => (
                    <tr key={a.adId}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{a.adName}</div>
                        <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>{a.adsetName}</div>
                      </td>
                      <td style={{ textAlign: "right" }}>{money(a.spend)}</td>
                      <td style={{ textAlign: "right" }}>{int(a.clicks)}</td>
                      <td style={{ textAlign: "right" }}>{a.ctr.toFixed(2)}%</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{int(a.leads)}</td>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        <span style={{ color: FB, fontWeight: 700 }}><FacebookFilled /> {int(a.split.facebook)}</span>
                        <span style={{ color: IG, fontWeight: 700, marginLeft: 10 }}><InstagramFilled /> {int(a.split.instagram)}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>{a.leads ? money(a.cpl) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {data?.metaError && <div style={{ color: "#b45309", fontSize: 12 }}>Meta: {data.metaError}</div>}

        {data && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              <b style={{ fontSize: 13.5 }}>
                Leads in the CRM ({shown.length}
                {shown.length !== leads.length ? ` of ${leads.length}` : ""})
              </b>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {chip("all", "All", leads.length)}
                {chip("facebook", <><FacebookFilled /> Facebook</>, counts.facebook || 0, FB)}
                {chip("instagram", <><InstagramFilled /> Instagram</>, counts.instagram || 0, IG)}
                {counts.unknown ? chip("unknown", "Unknown", counts.unknown, "#64748b") : null}
                <select className="hub-select" style={{ width: "auto" }} value={stage} onChange={(e) => setStage(e.target.value)}>
                  <option value="">All stages</option>
                  {stageList.map((s) => (
                    <option key={s} value={s}>{s} ({leads.filter((l) => l.stage === s).length})</option>
                  ))}
                </select>
                <input className="hub-input" style={{ width: 180 }} placeholder="Search name / phone" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="hub-table-wrapper" style={{ maxHeight: 420, overflowY: "auto" }}>
              <table className="hub-table">
                <thead>
                  <tr><th></th><th>Name</th><th>Phone</th><th>Came in</th><th>Ad</th><th>Stage</th><th>Owner</th></tr>
                </thead>
                <tbody>
                  {!shown.length && <tr><td colSpan={7}><div className="hub-empty">No leads match.</div></td></tr>}
                  {shown.map((l) => (
                    <tr key={l._id} style={{ cursor: "pointer" }} title="Open full lead details" onClick={() => setViewLead(l)}>
                      <td><PIcon p={l.platform} /></td>
                      <td style={{ fontWeight: 600 }}>{l.name}</td>
                      <td>{l.phone || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{l.at ? new Date(l.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"}</td>
                      <td style={{ fontSize: 12 }}>
                        {l.ad || "—"}
                        <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>{l.adset}</div>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 999, border: `1px solid ${stageColor(l.stage)}55`, background: `${stageColor(l.stage)}18` }}>{l.stage}</span>
                        {l.subStatus && <div style={{ fontSize: 11, color: "var(--hub-muted)", marginTop: 2 }}>{l.subStatus}</div>}
                      </td>
                      <td>{l.owner || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {viewLead && <LeadFullDetailModal lead={viewLead} onClose={() => setViewLead(null)} />}
    </HubModal>
  );
}

export default function FacebookLeadsDashboard({ connected }) {
  const [range, setRange] = useState("30d");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(null); // { campaign, platform?, stage? } → CampaignDetail

  const load = async (r = range) => {
    setLoading(true);
    setError("");
    const res = await request.get({ entity: `facebook/live-campaigns?range=${r}` });
    if (res?.success) setData(res.result);
    else setError(res?.message || "Could not load the Facebook campaigns.");
    setLoading(false);
  };

  useEffect(() => {
    if (connected) load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, range]);

  // "Connect chats": the same Facebook OAuth popup, asking also for the chat
  // permissions (backend connect.js ?chats=1) so Messenger / Instagram ad
  // chats come into the CRM as leads (jobs/facebookChatPoller.js).
  const [chatMsg, setChatMsg] = useState("");
  const [feed, setFeed] = useState([]); // live chat / lead events (socket)
  const loadRef = React.useRef(load);
  loadRef.current = load;

  // Real time: the backend pushes "lead:chat" / "lead:new" the moment a chat
  // or form lead lands (socket.js emitLeadEvent) — show it and refresh the
  // numbers right away (debounced), no polling from the browser.
  useEffect(() => {
    if (!connected) return undefined;
    const s = getSocket();
    if (!s) return undefined;
    let timer = null;
    const onEvent = (kind) => (p) => {
      setFeed((f) => [{ ...p, ev: kind, key: `${p.id}-${Date.now()}` }, ...f].slice(0, 8));
      clearTimeout(timer);
      timer = setTimeout(() => loadRef.current(), 1500);
    };
    const onChat = onEvent("chat");
    const onNew = onEvent("form");
    s.on("lead:chat", onChat);
    s.on("lead:new", onNew);
    return () => {
      clearTimeout(timer);
      s.off("lead:chat", onChat);
      s.off("lead:new", onNew);
    };
  }, [connected]);

  // Facebook's popup tells us the real result (callback.js postMessage).
  // Closing the popup is NOT success — Meta may have shown an error there.
  const oauthResult = React.useRef(null);
  useEffect(() => {
    const h = (e) => {
      const t = String(e?.data?.type || "");
      if (t === "fb-oauth-success" || t === "fb-oauth-error") oauthResult.current = e.data;
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, []);

  const connectChats = async () => {
    setChatMsg("");
    oauthResult.current = null;
    const popup = window.open("", "fb-oauth", "width=620,height=720"); // before the await — avoids the popup blocker
    const res = await request.get({ entity: "facebook/connect?chats=1" });
    if (!res?.success) {
      popup?.close();
      setChatMsg(res?.message || "Could not start the Facebook connection.");
      return;
    }
    const win = popup || window.open(res.result.url, "fb-oauth", "width=620,height=720");
    if (popup) popup.location.href = res.result.url;
    setChatMsg("Waiting for Facebook… finish the steps in the popup and press Continue.");
    if (win) {
      const t = setInterval(async () => {
        if (!win.closed) return;
        clearInterval(t);
        const r = oauthResult.current;
        if (r && r.type === "fb-oauth-error") {
          setChatMsg(`Facebook did not connect: ${r.message || "unknown error"}`);
          return;
        }
        setChatMsg("Checking the connection…");
        // give the chat poller one tick (20 s) to try the new permission
        setTimeout(async () => {
          const fresh = await request.get({ entity: `facebook/live-campaigns?range=${range}` });
          if (fresh?.success) setData(fresh.result);
          const err = fresh?.result?.chatSync?.messengerError;
          if (!r && err) setChatMsg("Facebook was closed before the connection finished (or showed an error) — nothing changed. Click Connect chats again and press Continue; if Facebook shows an error, send a screenshot.");
          else if (err) setChatMsg(`Connected, but Meta still refuses Messenger: ${err}`);
          else setChatMsg("Connected — new chats now arrive live.");
        }, 25000);
      }, 800);
    }
  };

  const money = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const int = (v) => Number(v || 0).toLocaleString("en-IN");
  const rows = useMemo(() => (data ? data.campaigns.filter((c) => showAll || c.active || c.hasActivity) : []), [data, showAll]);

  if (!connected) {
    return (
      <div className="hub-card">
        <div className="hub-card-header"><h3><FacebookFilled style={{ color: FB }} /> Facebook &amp; Instagram leads</h3></div>
        <div className="hub-empty">Connect a Facebook account below to see your running campaigns and where the leads come from.</div>
      </div>
    );
  }

  const t = data?.totals;
  const h = data?.health;
  const fmtDay = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

  return (
    <div className="hub-card">
      <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3>
          <FacebookFilled style={{ color: FB }} /> <InstagramFilled style={{ color: IG }} /> Facebook &amp; Instagram leads
          {data?.account && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--hub-muted)", marginLeft: 8 }}>{data.account.name}</span>}
        </h3>
        <button type="button" className="hub-btn" onClick={() => load()} disabled={loading}>
          <ReloadOutlined spin={loading} /> Refresh
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {RANGES.map(([k, label]) => (
          <button key={k} type="button" className="hub-btn" onClick={() => setRange(k)}
            style={range === k ? { background: "var(--hub-blue)", color: "#fff", borderColor: "var(--hub-blue)" } : undefined}>
            {label}
          </button>
        ))}
        {data && <span style={{ alignSelf: "center", fontSize: 11.5, color: "var(--hub-muted)", marginLeft: 6 }}>{data.since ? `${data.since} → ${data.until}` : "All time"}</span>}
      </div>

      {error && <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(220,38,38,.07)", border: "1px solid rgba(220,38,38,.3)", color: "#b91c1c", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      {data?.metaError && <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(217,119,6,.08)", border: "1px solid rgba(217,119,6,.35)", color: "#b45309", fontSize: 12.5, marginBottom: 12 }}>Meta: {data.metaError} — showing only the leads already in the CRM.</div>}
      {loading && !data && <div className="hub-empty">Loading campaigns from Meta…</div>}

      {h && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, marginBottom: 14, fontSize: 12.5,
          background: h.missing ? "rgba(220,38,38,.07)" : h.recentMetaLeads === 0 && t && t.active ? "rgba(217,119,6,.08)" : "rgba(22,163,74,.07)",
          border: `1px solid ${h.missing ? "rgba(220,38,38,.3)" : h.recentMetaLeads === 0 && t && t.active ? "rgba(217,119,6,.35)" : "rgba(22,163,74,.3)"}`,
        }}>
          {h.missing ? <WarningFilled style={{ color: "#dc2626" }} /> : h.recentMetaLeads === 0 && t && t.active ? <WarningFilled style={{ color: "#d97706" }} /> : <CheckCircleFilled style={{ color: "#16a34a" }} />}
          <span>
            {h.missing
              ? <>Meta gave <b>{h.recentMetaLeads}</b> leads in the last 3 days but only <b>{h.recentCrmLeads}</b> reached the CRM — check the Facebook connection.</>
              : h.recentMetaLeads === 0 && t && t.active && h.leadFormActive === 0 && h.chatActive > 0
              ? <>No lead-form campaign is running — the <b>{h.chatActive}</b> active campaign{h.chatActive === 1 ? " is a chat (Messages) campaign" : "s are chat (Messages) campaigns"}. Their chats reach the CRM as <b>chat leads</b> (below), not as form leads.</>
              : h.recentMetaLeads === 0 && t && t.active
              ? <>No new leads from Meta in the last 3 days although <b>{t.active}</b> campaign{t.active === 1 ? " is" : "s are"} active — the ads may need attention.</>
              : <>Leads are reaching the CRM ({h.recentCrmLeads} in the last 3 days).</>}
            <span style={{ color: "var(--hub-muted)" }}> · Last Facebook lead in CRM: {fmtDay(h.lastCrmLeadAt)}</span>
          </span>
        </div>
      )}

      {t && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
            {[
              ["Leads (Meta)", int(t.metaLeads), "#7c3aed"],
              ["Leads in CRM", int(t.crmLeads), "#2563eb"],
              ["Spend", money(t.spend), "#dc2626"],
              ["Cost / lead", t.metaLeads ? money(t.cpl) : "—", "#d97706"],
              ["Active campaigns", `${t.active} / ${t.campaigns}`, "#16a34a"],
              ["Chats started", int(t.chats), "#0891b2"],
            ].map(([label, value, color]) => (
              <div key={label} style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid var(--hub-border)", background: "var(--hub-bg-soft)", borderLeft: `3px solid ${color}` }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--hub-text)" }}>{value}</div>
                <div style={{ fontSize: 11, color: "var(--hub-muted)", fontWeight: 600 }}>{label}</div>
              </div>
            ))}
          </div>

          {data?.chatLeads && data?.chatSync && (
            <div style={{ marginBottom: 16, padding: 14, borderRadius: 12, border: "1px solid var(--hub-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <b style={{ fontSize: 13.5 }}><MessageOutlined /> Ad chats → CRM leads</b>
                <span style={{ fontSize: 11.5, color: "var(--hub-muted)" }}>Every chat becomes a lead — with or without a name or phone</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                {[
                  ["Messenger", data.chatLeads.messenger, "#0084FF", data.chatSync.messengerError, data.chatSync.messengerAt],
                  ["Instagram DM", data.chatLeads.instagram, IG, data.chatSync.instagramError, data.chatSync.instagramAt],
                  ["WhatsApp", data.chatLeads.whatsapp, "#25D366", data.chatSync.whatsappReady ? null : "WhatsApp (DeroPo) token is not set on the server.", null],
                ].map(([label, n, color, err, at]) => (
                  <div key={label} style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid var(--hub-border)", background: "var(--hub-bg-soft)", borderLeft: `3px solid ${color}` }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "var(--hub-text)" }}>{int(n)}</div>
                    <div style={{ fontSize: 11, color: "var(--hub-muted)", fontWeight: 600 }}>{label} chats in CRM</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: err ? "#b45309" : "#15803d" }}>
                      {err ? (/permission|#200|#230/i.test(err) ? "Not connected — chat permission missing" : err) : at ? `Live · checked ${fmtDay(at)}` : "Ready"}
                    </div>
                  </div>
                ))}
                <div style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid var(--hub-border)", background: "var(--hub-bg-soft)", borderLeft: "3px solid #64748b" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--hub-text)" }}>{int(data.chatLeads.withPhone)} / {int(data.chatLeads.total)}</div>
                  <div style={{ fontSize: 11, color: "var(--hub-muted)", fontWeight: 600 }}>Chat leads with a phone (go to the dialer)</div>
                </div>
              </div>
              {(data.chatSync.messengerError || data.chatSync.instagramError) && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10, fontSize: 12.5 }}>
                  <span>Messenger / Instagram chats need one extra Facebook permission. Click once and press <b>Continue</b> on Facebook.</span>
                  <button type="button" className="hub-btn" onClick={connectChats} style={{ background: "#0084FF", color: "#fff", borderColor: "#0084FF" }}>
                    <MessageOutlined /> Connect chats
                  </button>
                </div>
              )}
              {chatMsg && <div style={{ marginTop: 8, fontSize: 12, color: "var(--hub-muted)" }}>{chatMsg}</div>}
              {feed.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--hub-border)", paddingTop: 8 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "#15803d", marginBottom: 6 }}>● Live</div>
                  {feed.map((f) => (
                    <div key={f.key} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5, padding: "3px 0" }}>
                      <span style={{ color: "var(--hub-muted)", minWidth: 62 }}>{new Date(f.at || Date.now()).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
                      <b>{f.name}</b>
                      <span style={{ color: "var(--hub-muted)" }}>· {f.ev === "form" ? "Facebook form" : f.source} · {f.kind === "created" || f.ev === "form" ? "new lead" : "new message"}{f.hasPhone ? " · has phone" : ""}</span>
                      {f.text && <span style={{ color: "var(--hub-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>“{f.text}”</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginBottom: 16, padding: 14, borderRadius: 12, border: "1px solid var(--hub-border)" }}>
            <SplitBar label="Leads by platform (Meta)" fb={t.metaSplit.facebook || 0} ig={t.metaSplit.instagram || 0} other={(t.metaSplit.messenger || 0) + (t.metaSplit.whatsapp || 0) + (t.metaSplit.other || 0)} />
            <SplitBar label="Leads in the CRM by platform" fb={t.crmSplit.facebook || 0} ig={t.crmSplit.instagram || 0} other={(t.crmSplit.other || 0) + (t.crmSplit.unknown || 0) + (t.crmSplit.messenger || 0)} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <b style={{ fontSize: 13.5 }}>Campaigns</b>
            <label style={{ fontSize: 12, color: "var(--hub-muted)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show paused campaigns with no activity too ({data.campaigns.length} in all)
            </label>
          </div>
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Spend</th>
                  <th style={{ textAlign: "right" }}>Clicks</th>
                  <th style={{ textAlign: "right" }}>Leads (Meta)</th>
                  <th>Facebook / Instagram</th>
                  <th style={{ textAlign: "right" }}>Cost / lead</th>
                  <th style={{ textAlign: "right" }}>In CRM</th>
                  <th>In the pipeline</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length && <tr><td colSpan={9}><div className="hub-empty">No campaign activity in this period.</div></td></tr>}
                {rows.map((c) => {
                  const st = STATUS[c.status] || [c.status ? c.status.toLowerCase().replace(/_/g, " ") : "—", "hub-badge-gray"];
                  const stages = Object.entries(c.stages || {}).sort((a, b) => b[1] - a[1]);
                  return (
                    <tr key={c.id} style={{ cursor: "pointer" }} title="Click for everything about this campaign" onClick={() => setOpen({ campaign: c })}>
                      <td style={{ maxWidth: 260 }}>
                        <div style={{ fontWeight: 650, wordBreak: "break-word" }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>
                          {OBJECTIVE[c.objective] || (c.objective ? c.objective.toLowerCase().replace(/^outcome_/, "").replace(/_/g, " ") : "")}
                          {c.dailyBudget ? ` · ${money(c.dailyBudget)}/day` : c.lifetimeBudget ? ` · ${money(c.lifetimeBudget)} lifetime` : ""}
                          {c.chats ? <> · <MessageOutlined /> {int(c.chats)} chats</> : null}
                        </div>
                      </td>
                      <td><span className={`hub-badge ${st[1]}`}>{st[0]}</span></td>
                      <td style={{ textAlign: "right" }}>{money(c.spend)}</td>
                      <td style={{ textAlign: "right" }}>{int(c.clicks)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{int(c.metaLeads)}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                        {c.metaLeads ? (
                          <>
                            <span role="button" title="Facebook leads of this campaign" onClick={(e) => { e.stopPropagation(); setOpen({ campaign: c, platform: "facebook" }); }} style={{ color: FB, fontWeight: 700, cursor: "pointer" }}><FacebookFilled /> {int(c.metaSplit.facebook)}</span>{"  "}
                            <span role="button" title="Instagram leads of this campaign" onClick={(e) => { e.stopPropagation(); setOpen({ campaign: c, platform: "instagram" }); }} style={{ color: IG, fontWeight: 700, marginLeft: 8, cursor: "pointer" }}><InstagramFilled /> {int(c.metaSplit.instagram)}</span>
                          </>
                        ) : <span style={{ color: "var(--hub-muted)" }}>—</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>{c.metaLeads ? money(c.cpl) : "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--hub-blue)" }}>{int(c.crmLeads)}</td>
                      <td style={{ minWidth: 180 }}>
                        {stages.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {stages.slice(0, 4).map(([s, n]) => (
                              <span key={s} title={`${s} — click to see these leads`} onClick={(e) => { e.stopPropagation(); setOpen({ campaign: c, stage: s }); }} style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 999, border: `1px solid ${stageColor(s)}55`, background: `${stageColor(s)}18`, color: "var(--hub-text)" }}>
                                {n} {s.replace(/ Leads$/, "")}
                              </span>
                            ))}
                            {stages.length > 4 && <span style={{ fontSize: 11, color: "var(--hub-muted)" }}>+{stages.length - 4}</span>}
                          </div>
                        ) : <span style={{ color: "var(--hub-muted)", fontSize: 12 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "var(--hub-muted)", marginTop: 8 }}>
            "Leads (Meta)" is what Facebook reports for the campaign; "In CRM" is how many of them reached this CRM. Updated {new Date(data.fetchedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}.
          </div>
        </>
      )}
      {open && <CampaignDetail campaign={open.campaign} range={range} initial={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
