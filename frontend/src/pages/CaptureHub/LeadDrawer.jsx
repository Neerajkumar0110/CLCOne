import React, { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { request } from '@/request';
import LeadOwnerModal from '@/pages/Leads/LeadOwnerModal';
import LeadFullDetailModal from '@/components/LeadFullDetail';
import { Ic, chMeta, initials, fmtWhen, maskPhone, waLink, STAGE_TONE, stageLabel, quality } from './shared';
import { Menu, ChangeStageModal, ConfirmDelete, deleteLeads } from './AllLeads';

// Lead details drawer (design artboard "5 · Lead details drawer"). Data from
// GET /api/lead/full-detail (lead + calls + callbacks); notes via
// POST /api/lead/insights/note.

const talk = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
const TONE = {
  created: ['#E6F6FD', '#0284C7'], call: ['#EEF3FF', '#2563EB'], miss: ['#EEF2F6', '#64748B'], stage: ['#E7F6EF', '#0B7A55'],
  bad: ['#FDECEC', '#B42318'], cb: ['#FEF0E6', '#B54708'], note: ['#F0EEFC', '#5B47D1'],
};

function timelineOf(row, d) {
  const lead = d?.lead || {};
  const ev = [];
  const created = lead.facebookCreatedAt || lead.created || row.cameIn;
  const src = chMeta(row.channel).short;
  ev.push({ at: created, kind: 'created', title: 'Lead created', text: `${row.landingPage || lead.attribution?.landingPage ? `From the ${src} link` : `Source: ${lead.source || src}`}${lead.attribution?.utmCampaign ? ` · ${lead.attribution.utmCampaign}` : ''} · ${fmtWhen(created)}` });
  (d?.calls || []).forEach((c) => {
    const spoke = c.answered;
    ev.push({
      at: c.at,
      kind: spoke ? 'call' : 'miss',
      title: `${c.direction === 'Inbound' ? 'Called in' : 'Called'} · ${spoke ? `connected ${talk(c.talkSeconds || 0)}` : String(c.status || 'not connected').toLowerCase()}`,
      text: [c.agentName, c.response, c.recordingUrl ? 'recording available' : '', fmtWhen(c.at)].filter(Boolean).join(' · '),
      rec: c.recordingUrl,
    });
  });
  (lead.stageHistory || []).forEach((h) => {
    const bad = ['Not Interested Leads', 'Invalid Leads'].includes(h.toStage);
    ev.push({ at: h.at, kind: bad ? 'bad' : 'stage', title: `Response: ${stageLabel(h.toStage)}${h.toSubStatus ? ` — ${h.toSubStatus}` : ''}`, text: [h.changedByName, h.remarks, fmtWhen(h.at)].filter(Boolean).join(' · ') });
  });
  (lead.notesLog || []).forEach((n) => ev.push({ at: n.at, kind: 'note', title: 'Note added', text: `${n.byName || ''} · ${fmtWhen(n.at)}` }));
  (d?.callbacks || []).forEach((c) => ev.push({ at: c.scheduledAt, kind: 'cb', title: 'Callback scheduled', text: `${fmtWhen(c.scheduledAt)}${c.assignedAgentName ? ` · auto-dialler will ring ${c.assignedAgentName}` : ''}` }));
  return ev.filter((e) => e.at).sort((a, b) => new Date(a.at) - new Date(b.at));
}

export default function LeadDrawer({ row, onClose, onCall, dialing, isManager, users, onChanged }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const closeRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(false);
    request.get({ entity: `lead/full-detail?id=${row._id}` }).then((r) => {
      if (r?.success) setD(r.result);
      else setErr(true);
      setLoading(false);
    });
  }, [row._id]);
  useEffect(load, [load]);
  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e) => e.key === 'Escape' && !modal && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, modal]);

  const lead = { ...row, ...(d?.lead || {}) };
  const [ql, qt] = quality(row);
  const m = chMeta(row.channel);
  const wa = waLink(lead.phone);
  const ev = d ? timelineOf(row, d) : [];
  const shown = showAll ? ev : ev.slice(-8);
  const notes = [...(lead.notesLog || [])].reverse();

  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    const r = await request.post({ entity: 'lead/insights/note', jsonData: { id: row._id, text: note.trim() } });
    setSaving(false);
    if (r?.success) {
      setNote('');
      setD((o) => (o ? { ...o, lead: { ...o.lead, notesLog: r.result } } : o));
      message.success('Note added.');
    } else message.error(r?.message || 'Could not add the note.');
  };
  const done = () => { setModal(null); load(); onChanged(); };

  return (
    <>
      <div className="ch2-ov" onClick={onClose} aria-hidden="true" />
      <aside className="ch2-drawer" role="dialog" aria-modal="true" aria-label={`Lead details: ${lead.name || 'lead'}`}>
        <header>
          <span className="ch2-dav">{initials(lead.name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{lead.name || 'No name'}</h2>
            <div className="mut" style={{ fontSize: 13, marginTop: 3 }}>{[maskPhone(lead.phone), lead.email, lead.city].filter(Boolean).join(' · ')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              <span className={`ch2-b ${STAGE_TONE[lead.stage] || 'gy'}`}>{stageLabel(lead.stage)}</span>
              <span className={`ch2-b ${qt}`}>{ql}</span>
              <span className="ch2-b" style={{ background: m.tint, color: m.brand }}>{m.short === 'Other' ? lead.source || 'Other' : m.short}</span>
            </div>
          </div>
          <button type="button" ref={closeRef} className="ch2-x" aria-label="Close lead details" onClick={onClose}><Ic n="x" /></button>
        </header>

        <div className="ch2-dbody">
          {err && (
            <div className="ch2-state err" role="alert" style={{ padding: 20 }}>
              <b>Could not load this lead.</b>
              <button type="button" className="ch2-btn p" onClick={load}>Retry</button>
            </div>
          )}
          <section className="ch2-dsec">
            <h4>LEAD INFORMATION</h4>
            <div className="ch2-kvs">
              <span>Source</span><span><b>{m.short === 'Other' || m.short === 'Unknown' ? lead.source || m.short : m.short}</b>{lead.attribution?.landingPage || row.landingPage ? ' · via Capture Form link' : lead.source && m.short !== lead.source ? ` · ${lead.source}` : ''}</span>
              <span>Campaign</span><span>{lead.attribution?.utmCampaign || row.campaign || '—'}</span>
              <span>Interest</span><span>{lead.position || lead.programInterest || '—'}</span>
              <span>Stage</span><span>{lead.stage || '—'}{lead.subStatus ? ` · ${lead.subStatus}` : ''}</span>
              <span>Came in</span><span>{fmtWhen(row.cameIn)}</span>
              {(lead.formAnswers || []).map((a) => (
                <React.Fragment key={a.key}><span>{a.label}</span><span>{a.value}</span></React.Fragment>
              ))}
              {lead.message && <><span>Message</span><span>{lead.message}</span></>}
            </div>
          </section>

          <section className="ch2-dsec">
            <h4>ASSIGNMENT</h4>
            <div className="ch2-kvs">
              <span>Sales user</span>
              <span><b>{lead.assignedUserName || 'Unassigned'}</b>{isManager && <> · <button type="button" className="ch2-linkbtn" style={{ padding: 0 }} onClick={() => setModal('owner')}>Change</button></>}</span>
              <span>Team</span><span>{lead.team || '—'}</span>
              <span>Created by</span><span>{lead.attribution?.landingPage ? 'Capture Form (website)' : lead.createdByName || lead.source || '—'}</span>
            </div>
          </section>

          <section className="ch2-dsec">
            <h4>TIMELINE</h4>
            {loading && !d ? (
              <div className="ch2-skel" style={{ height: 120 }} />
            ) : (
              <>
                {ev.length > shown.length && <button type="button" className="ch2-linkbtn" style={{ marginBottom: 8, padding: 0 }} onClick={() => setShowAll(true)}>Show {ev.length - shown.length} earlier</button>}
                <div className="ch2-tl">
                  {shown.map((e, i) => {
                    const [bg, fg] = TONE[e.kind];
                    return (
                      <React.Fragment key={`${e.kind}-${e.at}-${i}`}>
                        <div className="rail"><span className="tdot" style={{ background: bg, color: fg }}>●</span>{i < shown.length - 1 && <span className="line" />}</div>
                        <div className="tbody">
                          <b>{e.title}</b>
                          <div className="mut">{e.text}</div>
                          {e.rec && <audio controls preload="none" src={e.rec} style={{ width: '100%', height: 32, marginTop: 6 }} />}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <section className="ch2-dsec">
            <h4>NOTES</h4>
            {lead.remarks && <p style={{ margin: '0 0 10px', fontSize: 13.5 }}>{lead.remarks}</p>}
            {notes.map((n, i) => (
              <p key={i} style={{ margin: '0 0 10px', fontSize: 13.5 }}>{n.text}<span className="mut" style={{ display: 'block', fontSize: 12 }}>{n.byName} · {fmtWhen(n.at)}</span></p>
            ))}
            {!lead.remarks && !notes.length && <p className="mut" style={{ margin: '0 0 10px', fontSize: 13.5 }}>No notes yet.</p>}
            <label className="ch2-fld">Add a note
              <textarea className="ch2-in" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="ch2-btn sm p" disabled={!note.trim() || saving} onClick={addNote}>{saving ? 'Saving…' : 'Save note'}</button>
            </div>
          </section>
        </div>

        <footer>
          <button type="button" className="ch2-btn p" disabled={!lead.phone || dialing === row._id} onClick={() => onCall(row)}>{dialing === row._id ? 'Calling…' : 'Call'}</button>
          <a className="ch2-btn wa" href={wa || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!wa}>WhatsApp</a>
          <button type="button" className="ch2-btn" onClick={() => setModal('full')}>Edit</button>
          <span style={{ display: 'flex' }}>
            <MoreBtn
              items={[
                ['Open full details', () => setModal('full')],
                isManager && ['Assign owner', () => setModal('owner')],
                isManager && ['Change stage', () => setModal('stage')],
                isManager && ['Delete lead', () => setModal('delete'), true],
              ]}
            />
          </span>
        </footer>
      </aside>

      {modal === 'owner' && <LeadOwnerModal open onClose={() => setModal(null)} onDone={done} admins={users} selectedIds={[]} single={{ _id: row._id }} viewCount={0} />}
      {modal === 'stage' && <ChangeStageModal ids={[row._id]} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'delete' && <ConfirmDelete count={1} onClose={() => setModal(null)} onConfirm={async () => { await deleteLeads([row._id]); setModal(null); onChanged(); onClose(); }} />}
      {modal === 'full' && <LeadFullDetailModal lead={d?.lead || row} onClose={() => { setModal(null); load(); onChanged(); }} />}
    </>
  );
}

// "More ▾" as a full-width footer button that opens the same menu as a row's ⋮.
function MoreBtn({ items }) {
  return (
    <span style={{ position: 'relative', flex: 1, display: 'flex' }} className="ch2-more">
      <Menu items={items} label="More lead actions" up />
      <style>{'.ch2-more .ch2-menu{flex:1;display:flex}.ch2-more .ch2-menu>.ch2-ib{flex:1;width:auto;height:44px;border-radius:11px;font:600 13.5px Inter,sans-serif;color:var(--c-text);gap:6px}.ch2-more .ch2-menu>.ch2-ib svg{display:none}.ch2-more .ch2-menu>.ch2-ib::after{content:"More ▾"}'}</style>
    </span>
  );
}
