import React, { useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { request } from '@/request';
import { LEAD_STAGES } from '@/config/leadStages';
import LeadOwnerModal from '@/pages/Leads/LeadOwnerModal';
import {
  Ic, chMeta, nf, fmtDay, initials, maskPhone, waLink, lastActivityText, STAGE_TONE, stageLabel, quality,
  Skel, EmptyState, ErrorState, apiDelete,
} from './shared';

// All Leads tab (design artboard "2 · All Leads") + the bulk actions.

export function SourceCell({ r }) {
  const m = chMeta(r.channel);
  const viaForm = r.landingPage && !['Capture Form'].includes(r.channel);
  return (
    <>
      <span className="ch2-src"><span style={{ color: m.brand, display: 'inline-flex' }}><Ic n={m.icon} s={15} /></span>{m.short === 'Other' || m.short === 'Unknown' ? r.source || m.short : m.short}</span>
      {r.campaign ? <span className="sub">{r.campaign}</span> : viaForm ? <span className="sub">via Capture Form link</span> : null}
    </>
  );
}

export function StageCell({ r }) {
  return (
    <>
      <span className={`ch2-b ${STAGE_TONE[r.stage] || 'gy'}`}>{stageLabel(r.stage)}</span>
      {r.subStatus && <span className="sub">{r.subStatus}</span>}
    </>
  );
}

function Menu({ items, label = 'More actions', up }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span className="ch2-menu" ref={ref}>
      <button type="button" className="ch2-ib" aria-label={label} title="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Ic n="more" /></button>
      {open && (
        <span className={`ch2-menu-pop${up ? ' up' : ''}`} role="menu">
          {items.filter(Boolean).map(([l, fn, danger]) => (
            <button key={l} type="button" role="menuitem" className={danger ? 'd' : ''} onClick={() => { setOpen(false); fn(); }}>{l}</button>
          ))}
        </span>
      )}
    </span>
  );
}
export { Menu };

// Stages a bulk change can set without per-lead details (callback time / meeting time).
const BULK_STAGES = LEAD_STAGES.filter((s) => !s.requiresCallBack);

export function ChangeStageModal({ ids, onClose, onDone }) {
  const [stage, setStage] = useState('');
  const [sub, setSub] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cfg = BULK_STAGES.find((s) => s.stage === stage);
  const subs = cfg ? cfg.subStatuses.filter((x) => !(cfg.meetingSubStatuses || []).includes(x)) : [];
  const apply = async () => {
    setBusy(true);
    setErr('');
    let ok = 0;
    let lastErr = '';
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request.update({ entity: 'lead', id, jsonData: { stage, subStatus: sub }, notify: false });
      if (r?.success) ok += 1;
      else lastErr = r?.message || 'Could not change the stage.';
    }
    setBusy(false);
    if (ok) message.success(`Stage changed for ${ok} lead${ok === 1 ? '' : 's'}.`);
    if (ok < ids.length) setErr(`${ids.length - ok} not changed: ${lastErr}`);
    else onDone();
  };
  return (
    <>
      <div className="ch2-ov" onClick={onClose} aria-hidden="true" />
      <div className="ch2-modal" role="dialog" aria-modal="true" aria-label="Change stage">
        <h3>Change stage <button type="button" className="ch2-x" aria-label="Close" onClick={onClose}><Ic n="x" /></button></h3>
        <p className="mut" style={{ margin: 0 }}>{ids.length} lead{ids.length === 1 ? '' : 's'} selected. Stages that need a callback or meeting time are changed one lead at a time from the lead itself.</p>
        <div className="grid">
          <label className="ch2-fld">Stage
            <select className="ch2-in" value={stage} onChange={(e) => { setStage(e.target.value); const c = BULK_STAGES.find((s) => s.stage === e.target.value); setSub(c ? c.subStatuses.filter((x) => !(c.meetingSubStatuses || []).includes(x))[0] || '' : ''); }}>
              <option value="">Choose a stage</option>
              {BULK_STAGES.map((s) => <option key={s.stage} value={s.stage}>{s.stage}</option>)}
            </select>
          </label>
          <label className="ch2-fld">Sub-status
            <select className="ch2-in" value={sub} onChange={(e) => setSub(e.target.value)} disabled={!subs.length}>
              {subs.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {err && <div className="ch2-err" role="alert">{err}</div>}
        <div className="foot">
          <button type="button" className="ch2-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ch2-btn p" disabled={!stage || !sub || busy} onClick={apply}>{busy ? 'Changing…' : 'Change stage'}</button>
        </div>
      </div>
    </>
  );
}

export function ConfirmDelete({ count, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="ch2-ov" onClick={onClose} aria-hidden="true" />
      <div className="ch2-modal" role="alertdialog" aria-modal="true" aria-label="Delete leads">
        <h3>Delete {count} lead{count === 1 ? '' : 's'}? <button type="button" className="ch2-x" aria-label="Close" onClick={onClose}><Ic n="x" /></button></h3>
        <p className="mut" style={{ margin: 0 }}>They leave every list, board and dialer queue. Call history stays.</p>
        <div className="foot">
          <button type="button" className="ch2-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ch2-btn p" style={{ background: '#B42318', borderColor: '#B42318' }} disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
    </>
  );
}

export async function deleteLeads(ids) {
  let ok = 0;
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const r = await apiDelete(`lead/delete/${id}`);
    if (r?.success) ok += 1;
  }
  if (ok) message.success(`${ok} lead${ok === 1 ? '' : 's'} deleted.`);
  if (ok < ids.length) message.error(`${ids.length - ok} could not be deleted.`);
  return ok;
}

const SORT_COLS = { name: 'name', source: 'source', stage: 'stage', owner: 'owner' };

export default function AllLeads({ list, page, setPage, items, setItems, sort, setSort, onRetry, onClear, onView, onCall, dialing, isManager, users, onChanged, onExport, filtersActive }) {
  const [sel, setSel] = useState(new Set());
  const [modal, setModal] = useState(null); // owner | stage | delete
  const rows = list.rows || [];
  useEffect(() => setSel(new Set()), [list.rows]);
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r._id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...sel];
  const from = list.count ? (page - 1) * items + 1 : 0;
  const to = Math.min(list.count, page * items);
  const pages = list.pages || 1;
  const pageBtns = [];
  const push = (p) => pageBtns.push(p);
  if (pages <= 7) for (let i = 1; i <= pages; i++) push(i);
  else {
    push(1);
    if (page > 3) push('…a');
    for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i++) push(i);
    if (page < pages - 2) push('…b');
    push(pages);
  }
  const sortHead = (col, label) => {
    const k = SORT_COLS[col];
    const on = sort === k || (col === 'came' && (sort === 'newest' || sort === 'oldest'));
    const arrow = col === 'came' ? (sort === 'oldest' ? '↑' : sort === 'newest' ? '↓' : '↕') : on ? '↓' : '↕';
    return (
      <button type="button" className={`ch2-sort${on ? ' on' : ''}`} aria-label={`Sort by ${label}`} onClick={() => setSort(col === 'came' ? (sort === 'newest' ? 'oldest' : 'newest') : k)}>
        {label} {arrow}
      </button>
    );
  };
  const rowMenu = (r) => [
    ['View details', () => onView(r)],
    isManager && ['Assign owner', () => { setSel(new Set([r._id])); setModal('owner'); }],
    isManager && ['Change stage', () => { setSel(new Set([r._id])); setModal('stage'); }],
    isManager && ['Delete lead', () => { setSel(new Set([r._id])); setModal('delete'); }, true],
  ];
  const done = () => { setModal(null); setSel(new Set()); onChanged(); };

  return (
    <>
      {isManager && sel.size > 0 && (
        <div className="ch2-bulk" role="region" aria-label="Bulk actions">
          <b>{sel.size} lead{sel.size === 1 ? '' : 's'} selected</b>
          <button type="button" className="ch2-btn sm" onClick={() => setModal('owner')}><Ic n="userPlus" s={15} />Assign owner</button>
          <button type="button" className="ch2-btn sm" onClick={() => setModal('stage')}>Change stage</button>
          <button type="button" className="ch2-btn sm" onClick={() => onExport(ids)}>Export</button>
          <button type="button" className="ch2-btn sm del" onClick={() => setModal('delete')}>Delete</button>
          <button type="button" className="ch2-btn sm clr" onClick={() => setSel(new Set())}>Clear selection</button>
        </div>
      )}

      {list.error ? (
        <ErrorState onRetry={onRetry} />
      ) : list.loading && !rows.length ? (
        <Skel h={520} />
      ) : !rows.length ? (
        <EmptyState onClear={filtersActive ? onClear : undefined} text={filtersActive ? 'Try changing your filters or date range.' : 'No leads came in during this date range.'} />
      ) : (
        <section className="ch2-tablecard" aria-busy={list.loading}>
          <div className="ch2-tw ch2-leads-wrap">
            <table className="ch2-leads">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 36 }}>{isManager && <input type="checkbox" aria-label="Select all on this page" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r._id)))} />}</th>
                  <th scope="col">{sortHead('name', 'Lead')}</th>
                  <th scope="col">{sortHead('source', 'Source')}</th>
                  <th scope="col">{sortHead('stage', 'Stage')}</th>
                  <th scope="col">Quality</th>
                  <th scope="col">{sortHead('owner', 'Sales user')}</th>
                  <th scope="col">{sortHead('came', 'Came in')}</th>
                  <th scope="col">Last activity</th>
                  <th scope="col"><span className="sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [ql, qt] = quality(r);
                  const wa = waLink(r.phone);
                  return (
                    <tr key={r._id} className={sel.has(r._id) ? 'on' : ''}>
                      <td>{isManager && <input type="checkbox" checked={sel.has(r._id)} aria-label={`Select ${r.name || 'lead'}`} onChange={() => toggle(r._id)} />}</td>
                      <td>
                        <div className="ch2-who">
                          <span className="ch2-av">{initials(r.name)}</span>
                          <div style={{ minWidth: 0 }}>
                            <button type="button" className="ch2-namebtn" onClick={() => onView(r)}><b>{r.name || 'No name'}</b></button>
                            <span>{maskPhone(r.phone)}{r.email ? ` · ${r.email}` : ''}</span>
                          </div>
                        </div>
                      </td>
                      <td><SourceCell r={r} /></td>
                      <td><StageCell r={r} /></td>
                      <td><span className={`ch2-b ${qt}`}>{ql}</span></td>
                      <td className="nw">{r.assignedUserName || <span className="mut">Unassigned</span>}</td>
                      <td className="nw">{fmtDay(r.cameIn)}</td>
                      <td className="nw"><span className="mut">{lastActivityText(r.lastActivity)}</span></td>
                      <td>
                        <div className="ch2-acts">
                          <button type="button" className="ch2-ib" aria-label={`View ${r.name || 'lead'}`} title="View" onClick={() => onView(r)}><Ic n="eye" /></button>
                          <button type="button" className="ch2-ib" aria-label={`Call ${r.name || 'lead'}`} title="Call" disabled={!r.phone || dialing === r._id} onClick={() => onCall(r)}><Ic n="phone" /></button>
                          <a className="ch2-ib" aria-label={`WhatsApp ${r.name || 'lead'}`} title="WhatsApp" style={{ color: '#128C7E', pointerEvents: wa ? undefined : 'none', opacity: wa ? 1 : 0.45 }} href={wa || undefined} target="_blank" rel="noopener noreferrer"><Ic n="chat" /></a>
                          <Menu items={rowMenu(r)} label={`More actions for ${r.name || 'lead'}`} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="ch2-mcards">
            {rows.map((r) => {
              const [ql, qt] = quality(r);
              const wa = waLink(r.phone);
              return (
                <div className="ch2-mlead" key={r._id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div><b>{r.name || 'No name'}</b><div className="mut" style={{ fontSize: 12 }}>{maskPhone(r.phone)} · {chMeta(r.channel).short}</div></div>
                    <span className="mut" style={{ fontSize: 12 }}>{fmtDay(r.cameIn).replace(/ \d{4}$/, '')}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <span className={`ch2-b ${STAGE_TONE[r.stage] || 'gy'}`}>{stageLabel(r.stage)}{r.subStatus ? ` · ${r.subStatus}` : ''}</span>
                    <span className={`ch2-b ${qt}`}>{ql === 'Still being worked' ? 'Being worked' : ql}</span>
                  </div>
                  <div className="mut" style={{ fontSize: 12.5 }}>Owner: {r.assignedUserName || 'Unassigned'}</div>
                  <div className="row3">
                    <button type="button" className="ch2-btn" onClick={() => onView(r)}>View</button>
                    <button type="button" className="ch2-btn" disabled={!r.phone} onClick={() => onCall(r)}>Call</button>
                    <a className="ch2-btn" style={{ color: '#0B6B5E' }} href={wa || undefined} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                  </div>
                </div>
              );
            })}
          </div>

          <footer className="ch2-pager">
            <span className="mut" style={{ fontSize: 13 }}>Showing {nf(from)}–{nf(to)} of {nf(list.count)} leads</span>
            <span className="ch2-sel sm">
              <select aria-label="Rows per page" value={items} onChange={(e) => { setItems(Number(e.target.value)); setPage(1); }}>
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>Rows per page: {n}</option>)}
              </select>
            </span>
            <nav aria-label="Pages" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="ch2-pg" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
              {pageBtns.map((p) =>
                typeof p === 'string' ? <span key={p} className="mut">…</span> : (
                  <button key={p} type="button" className={`ch2-pg${p === page ? ' on' : ''}`} aria-current={p === page ? 'page' : undefined} onClick={() => setPage(p)}>{p}</button>
                )
              )}
              <button type="button" className="ch2-pg" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
            </nav>
          </footer>
        </section>
      )}

      {modal === 'owner' && (
        <LeadOwnerModal open onClose={() => setModal(null)} onDone={done} admins={users} selectedIds={ids} viewCount={0} />
      )}
      {modal === 'stage' && <ChangeStageModal ids={ids} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'delete' && <ConfirmDelete count={ids.length} onClose={() => setModal(null)} onConfirm={async () => { await deleteLeads(ids); done(); }} />}
    </>
  );
}
