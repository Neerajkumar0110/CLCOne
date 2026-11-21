import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { QRCode, message } from 'antd';
import { request } from '@/request';
import { Ic, chMeta, nf, ChannelIcon, formLink, embedCode, copyText, queryOf, fmtDay, maskPhone, Skel } from './shared';
import { SourceCell, StageCell } from './AllLeads';

// Sources & Capture tab (design artboard "3 · Sources & Capture").

const AdConnection = lazy(() => import('@/pages/Leads/CaptureForm'));

const CHANNELS = [
  { key: 'Capture Form', name: 'Website · Capture Form', sub: 'Landing page + embed code', utm: 'Website', ad: null },
  { key: 'Meta (Facebook / Instagram)', name: 'Meta Ads', sub: 'Facebook + Instagram lead forms', utm: 'Facebook', ad: 'Facebook Ads', conn: 'facebook' },
  { key: 'Google', name: 'Google Ads', sub: 'Lead form extensions', utm: 'Google Ads', ad: 'Google Ads', conn: 'google' },
  { key: 'LinkedIn', name: 'LinkedIn', sub: 'LinkedIn Ads + LinkedIn link', utm: 'LinkedIn', ad: 'LinkedIn Ads', conn: 'linkedin' },
  { key: 'YouTube', name: 'YouTube', sub: 'Video links + YouTube ads', utm: 'YouTube', ad: null },
  { key: 'WhatsApp', name: 'WhatsApp', sub: 'Ad chats that became leads', utm: 'WhatsApp', ad: null },
];

// Where a channel's link goes, step 3 of "Get leads from …".
const WHERE = {
  'Capture Form': ['Your website: the embed code on the right', 'Bio links, email signatures and newsletters', 'Print: download the QR code for posters and brochures'],
  'Meta (Facebook / Instagram)': ['Facebook / Instagram ad → website URL', 'Instagram bio link and story link sticker', 'Facebook page button: “Contact us”'],
  Google: ['Google ad → final URL', 'Google Business Profile → website link', 'Performance Max / Display ads → landing page'],
  LinkedIn: ['LinkedIn post and article links', 'LinkedIn ad → destination URL', 'Company page button and featured section'],
  YouTube: ['Video description and pinned comment', 'YouTube ad (run in Google Ads) → final URL', 'Shorts: the link sticker / channel links'],
  WhatsApp: ['WhatsApp status and broadcast messages', 'WhatsApp Business catalogue and profile link', 'Click-to-WhatsApp ads keep coming in on their own'],
};
const SOURCES = ['YouTube', 'LinkedIn', 'Facebook', 'Instagram', 'Google Ads', 'WhatsApp', 'Website'];
const READY = [['LinkedIn', '#0A66C2'], ['YouTube', '#E10000'], ['Facebook', '#1877F2'], ['Instagram', '#C13584']];

function useConnections() {
  const [st, setSt] = useState({});
  useEffect(() => {
    let alive = true;
    ['facebook', 'google', 'linkedin'].forEach((k) =>
      request.get({ entity: `${k}/connection` }).then((r) => alive && setSt((o) => ({ ...o, [k]: r?.success ? !!r.result?.connected : false })))
    );
    return () => { alive = false; };
  }, []);
  return st;
}

function statusOf(c, stats, conns) {
  const n = stats?.total || 0;
  if (c.key === 'Capture Form') return ['Live', 'live'];
  if (c.conn) {
    if (conns[c.conn] == null) return ['Checking…', 'idle'];
    return conns[c.conn] ? ['Connected', 'live'] : n ? ['Link only', 'idle'] : ['Not connected', 'idle'];
  }
  if (c.key === 'WhatsApp') return n ? ['Live', 'live'] : ['No leads yet', 'idle'];
  return n ? ['Live', 'live'] : ['Not started', 'ask'];
}

function Copy({ text, label = 'Copy', done = 'Copied', className = 'ch2-btn sm', children }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => { const r = await copyText(text); if (r) { setOk(true); setTimeout(() => setOk(false), 1600); } else message.error('Could not copy — select the text and copy it.'); }}>
      {children}{ok ? done : label}
    </button>
  );
}

export default function Sources({ insights, filters, rangeText, selected, setSelected, onOpenLeads, onView, isManager }) {
  const conns = useConnections();
  const sel = CHANNELS.find((c) => c.key === selected) || CHANNELS[0];
  const [campaign, setCampaign] = useState('');
  const [src, setSrc] = useState(sel.utm);
  const [leads, setLeads] = useState({ rows: [], count: 0, loading: true });
  const qrRef = useRef(null);
  useEffect(() => { setSrc(sel.utm); setCampaign(''); }, [sel.key, sel.utm]);
  const stat = (k) => insights?.bySource?.find((s) => s.channel === k);
  const link = formLink(src, campaign.trim().replace(/\s+/g, '-'));

  useEffect(() => {
    let alive = true;
    setLeads((o) => ({ ...o, loading: true }));
    request.get({ entity: `lead/insights/list?${queryOf({ ...filters, channel: sel.key, q: '', stage: '', quality: '' }, { items: 5, sort: 'newest' })}` }).then((r) => {
      if (alive) setLeads({ rows: r?.success ? r.result : [], count: r?.pagination?.count || 0, loading: false });
    });
    return () => { alive = false; };
  }, [sel.key, filters]);

  const downloadQr = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `capture-form-${(src || 'link').toLowerCase().replace(/\W+/g, '-')}${campaign ? `-${campaign.toLowerCase().replace(/\W+/g, '-')}` : ''}.png`;
    a.click();
  };
  const sm = chMeta(sel.key);
  const selName = sel.key === 'Capture Form' ? 'your website' : sel.name.replace(/ Ads$/, '');

  return (
    <>
      <section className="ch2-card" style={{ padding: '18px 20px' }}>
        <div className="ch2-flow">
          <span className="lab">HOW LEADS FLOW</span>
          {[['Capture Form', '#0284C7'], ['Meta', '#1877F2'], ['Google', '#EA4335'], ['LinkedIn', '#0A66C2'], ['YouTube', '#E10000'], ['WhatsApp', '#128C7E'], ['Import / Calls', '#64748B']].map(([l, c]) => (
            <span className="ch2-pill" key={l}><span style={{ color: c }}>■</span>{l}</span>
          ))}
          <span className="ch2-arrow">→</span>
          <span className="ch2-pill acc">Lead Management</span>
          <span className="ch2-arrow">→</span>
          <span className="ch2-pill">Sales team</span>
          <span className="ch2-arrow">→</span>
          <span className="ch2-pill ok">Enrolled</span>
        </div>
      </section>

      <div className="ch2-chans" role="group" aria-label="Lead sources">
        {CHANNELS.map((c) => {
          const s = stat(c.key);
          const [st, tone] = statusOf(c, s, conns);
          return (
            <button key={c.key} type="button" className={`ch2-chn${c.key === sel.key ? ' on' : ''}`} aria-pressed={c.key === sel.key} onClick={() => setSelected(c.key)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                <ChannelIcon name={c.key} />
                <span className={`ch2-st ${tone}`}>{st}</span>
              </div>
              <div><b>{c.name}</b><div className="mut" style={{ fontSize: 12.5 }}>{c.sub}</div></div>
              <div style={{ display: 'flex', gap: 18 }}>
                <div><div className="num">{insights ? nf(s?.total || 0) : '…'}</div><div className="mut" style={{ fontSize: 11.5 }}>leads · {rangeText}</div></div>
                <div><div className="num">{s?.total ? `${s.qualityPct}%` : '—'}</div><div className="mut" style={{ fontSize: 11.5 }}>qualified</div></div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="ch2-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))' }}>
        <section className="ch2-card">
          <div className="ch2-ch">
            <div>
              <h3><ChannelIcon name={sel.key} size={34} icon={18} radius={10} />Get leads from {selName}</h3>
              <p>{sel.ad ? `Share the capture form's ${sel.utm} link — connecting ${sel.name} below is optional` : sel.key === 'WhatsApp' ? 'WhatsApp ad chats become leads on their own; the link brings in more' : `No account to connect: use the capture form's ${sel.key === 'Capture Form' ? 'website' : sel.utm} link`}</p>
            </div>
          </div>
          <div className="ch2-steps">
            <div>
              <span className="ch2-step">1</span>
              <div>
                <b>Name the campaign (optional)</b>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <label className="ch2-fld">Campaign name<input className="ch2-in" placeholder="e.g. ai-course-shorts-nov" value={campaign} maxLength={80} onChange={(e) => setCampaign(e.target.value)} /></label>
                  <label className="ch2-fld">Source
                    <select className="ch2-in" value={src} onChange={(e) => setSrc(e.target.value)}>
                      {[...new Set([sel.utm, ...SOURCES])].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            </div>
            <div>
              <span className="ch2-step">2</span>
              <div>
                <b>Copy your {src} link</b>
                <div className="ch2-code">{link}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <Copy text={link} className="ch2-btn p" label="Copy link" done="Link copied"><Ic n="copy" /></Copy>
                  <a className="ch2-btn" href={link} target="_blank" rel="noopener noreferrer"><Ic n="ext" />Open the page</a>
                  <button type="button" className="ch2-btn" onClick={downloadQr}><Ic n="qr" />Download QR code</button>
                </div>
                <div ref={qrRef} style={{ position: 'absolute', left: -9999, top: 0 }} aria-hidden="true">
                  <QRCode value={link} size={512} type="canvas" bordered={false} bgColor="#FFFFFF" />
                </div>
              </div>
            </div>
            <div>
              <span className="ch2-step">3</span>
              <div>
                <b>Put it where {sel.key === 'Capture Form' ? 'people' : 'viewers'} click</b>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--c-text-2)', fontSize: 13.5, lineHeight: 1.8 }}>
                  {(WHERE[sel.key] || []).map((w) => <li key={w}>{w}</li>)}
                </ul>
                <p className="mut" style={{ fontSize: 12.5, margin: 0 }}>Every form sent from this link arrives in Lead Management with Source = {src}{campaign ? ` and the campaign “${campaign.trim().replace(/\s+/g, '-')}”` : ' and the campaign above'}.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="ch2-card">
          <div className="ch2-ch">
            <div><h3>Embed the form on a website</h3><p>Paste once; leads arrive tagged with the page they came from</p></div>
            <Copy text={embedCode('Website')} label="Copy code" />
          </div>
          <div className="ch2-code">{embedCode('Website')}</div>
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <b style={{ fontSize: 14 }}>Ready links for each channel</b>
            <div className="ch2-ready">
              {READY.map(([s, c]) => {
                const l = formLink(s);
                return (
                  <React.Fragment key={s}>
                    <span style={{ color: c, fontWeight: 700 }}>{s}</span>
                    <span className="u" title={l}>…/lead-form/website?utm_source={s}</span>
                    <Copy text={l} />
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          <div className="ch2-note" style={{ marginTop: 18 }}>
            <b>Ad-account connections are optional.</b> Connect Meta, Google or LinkedIn Ads only to pull their in-platform lead forms automatically. The links above work without any connection.
          </div>
        </section>
      </div>

      {sel.ad && isManager && (
        <section className="ch2-card">
          <div className="ch2-ch">
            <div><h3><ChannelIcon name={sel.key} size={34} icon={18} radius={10} />{sel.name} account</h3><p>Connect the ad account to pull its lead forms in automatically, and set up campaigns</p></div>
            <span className={`ch2-st ${conns[sel.conn] ? 'live' : 'idle'}`}>{conns[sel.conn] == null ? 'Checking…' : conns[sel.conn] ? 'Connected' : 'Not connected'}</span>
          </div>
          <div className="ch2-adconn">
            <Suspense fallback={<Skel h={160} />}>
              <AdConnection key={sel.ad} embedded initialPlatform={sel.ad} />
            </Suspense>
          </div>
        </section>
      )}

      <section className="ch2-card">
        <div className="ch2-ch">
          <div><h3>Leads from {sm.short}</h3><p>{rangeText[0].toUpperCase() + rangeText.slice(1)} · the same rows as All Leads with Source = {sm.short}</p></div>
          <button type="button" className="ch2-linkbtn" onClick={() => onOpenLeads(sel.key)}>Open in All Leads →</button>
        </div>
        {leads.loading && !leads.rows.length ? (
          <Skel h={160} />
        ) : leads.rows.length ? (
          <>
            <div className="ch2-tw">
              <table style={{ minWidth: 720 }}>
                <thead><tr><th scope="col">Lead</th><th scope="col">Source</th><th scope="col">Stage</th><th scope="col">Sales user</th><th scope="col">Came in</th></tr></thead>
                <tbody>
                  {leads.rows.map((r) => (
                    <tr key={r._id} className="ch2-click" onClick={() => onView(r)}>
                      <td><button type="button" className="ch2-namebtn" onClick={(e) => { e.stopPropagation(); onView(r); }}>{r.name || 'No name'}</button><span className="sub">{maskPhone(r.phone)}</span></td>
                      <td><SourceCell r={r} /></td>
                      <td><StageCell r={r} /></td>
                      <td>{r.assignedUserName || <span className="mut">Unassigned</span>}</td>
                      <td>{fmtDay(r.cameIn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leads.count > leads.rows.length && <p className="mut" style={{ fontSize: 12.5, margin: '10px 0 0' }}>Latest 5 of {nf(leads.count)} — open All Leads for the rest.</p>}
          </>
        ) : (
          <div className="ch2-state inline">
            <ChannelIcon name={sel.key} />
            <b>No {sm.short} leads yet</b>
            <span className="mut">Share the {src} link from step 2 — the first lead shows here and in Overview within a minute.</span>
            <Copy text={link} className="ch2-btn p" label={`Copy ${src} link`} done="Link copied" />
          </div>
        )}
      </section>
    </>
  );
}
