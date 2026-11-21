import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import { message } from 'antd';
import { request } from '@/request';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { DEPARTMENT_ROLES } from '@/config/roles';
import { dialContact } from '@/pages/Calling/shared';
import { Ic, BLANK, FilterBar, useDebounced, queryOf, rangeOf, presetLabel, nf, apiDownload, FULL_ACCESS } from './shared';
import Overview from './Overview';
import AllLeads from './AllLeads';
import Sources from './Sources';
import FormBuilder from './FormBuilder';
import LeadDrawer from './LeadDrawer';
import './captureHub.css';

// Marketing › Capture Form — every lead source, the capture form and lead
// quality in one tab (design canvas "Marketing › Leads": Overview · All Leads
// · Sources & Capture · Form Builder, lead drawer, phone layout).
//
// Data: GET /api/lead/insights (+ /list, /export, /note) and
// GET|PUT /api/lead/capture-form. One filter set drives every number on
// Overview and the All Leads table, so they always agree.

const TABS = [
  ['overview', 'Overview', 'bars'],
  ['leads', 'All Leads', 'list'],
  ['sources', 'Sources & Capture', 'layers'],
  ['form', 'Form Builder', 'form'],
];
const TAB_KEY = 'ch2.tab';
const ADD_SOURCES = [['Website', 'Website (Capture Form)'], ['LinkedIn', 'LinkedIn'], ['YouTube', 'YouTube'], ['Facebook Ads', 'Facebook'], ['Instagram', 'Instagram'], ['Google Ads', 'Google Ads'], ['WhatsApp', 'WhatsApp'], ['Referral', 'Referral'], ['Walk-in', 'Walk-in'], ['Manual', 'Other']];

function AddLeadModal({ onClose, onDone }) {
  const [v, setV] = useState({ name: '', phone: '', email: '', city: '', source: 'Website', position: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dup, setDup] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = async (allowDuplicate = false) => {
    setErr('');
    if (!v.name.trim()) return setErr('Enter the lead’s name.');
    if (v.phone.replace(/\D/g, '').length < 10) return setErr('Enter a 10-digit mobile number.');
    setBusy(true);
    const r = await request.post({ entity: 'lead/create', jsonData: { ...v, allowDuplicate } });
    setBusy(false);
    if (r?.success) {
      message.success('Lead added.');
      onDone();
    } else if (r?.duplicate) setDup(r.duplicate);
    else setErr(r?.message || 'Could not add the lead.');
  };
  return (
    <>
      <div className="ch2-ov" onClick={onClose} aria-hidden="true" />
      <form className="ch2-modal" role="dialog" aria-modal="true" aria-label="Add lead" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        <h3>Add lead <button type="button" className="ch2-x" aria-label="Close" onClick={onClose}><Ic n="x" /></button></h3>
        <div className="grid">
          <label className="ch2-fld">Full name *<input className="ch2-in" value={v.name} onChange={set('name')} autoFocus maxLength={120} /></label>
          <label className="ch2-fld">Phone number *<input className="ch2-in" type="tel" inputMode="numeric" value={v.phone} onChange={set('phone')} placeholder="98765 43210" maxLength={16} /></label>
          <label className="ch2-fld">Email address<input className="ch2-in" type="email" value={v.email} onChange={set('email')} placeholder="name@example.com" /></label>
          <label className="ch2-fld">City<input className="ch2-in" value={v.city} onChange={set('city')} /></label>
          <label className="ch2-fld">Source
            <select className="ch2-in" value={v.source} onChange={set('source')}>{ADD_SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className="ch2-fld">Internship / interest<input className="ch2-in" value={v.position} onChange={set('position')} /></label>
        </div>
        {err && <div className="ch2-err" role="alert">{err}</div>}
        {dup && (
          <div className="ch2-note" role="alert">
            <b>This number is already a lead:</b> {dup.name} · {dup.stage}{dup.assignedUserName ? ` · ${dup.assignedUserName}` : ''}.
            <div style={{ marginTop: 8 }}><button type="button" className="ch2-btn sm" disabled={busy} onClick={() => submit(true)}>Add anyway</button></div>
          </div>
        )}
        <div className="foot">
          <button type="button" className="ch2-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ch2-btn p" disabled={busy}>{busy ? 'Adding…' : 'Add lead'}</button>
        </div>
      </form>
    </>
  );
}

export default function CaptureHub() {
  const admin = useSelector(selectCurrentAdmin);
  const isManager = FULL_ACCESS.includes(admin?.role);
  const [tab, setTabState] = useState(() => {
    try { return TABS.some((t) => t[0] === localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'overview'; } catch { return 'overview'; }
  });
  const setTab = (t) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ } };
  const [f, setF] = useState(BLANK);
  const [draftQ, setDraftQ] = useState('');
  const q = useDebounced(draftQ, 400);
  useEffect(() => setF((o) => (o.q === q ? o : { ...o, q })), [q]);
  const [bucket, setBucket] = useState('day');
  const [ins, setIns] = useState({ data: null, loading: true, error: false });
  const [list, setList] = useState({ rows: [], count: 0, pages: 1, loading: true, error: false });
  const [page, setPage] = useState(1);
  const [items, setItems] = useState(20);
  const [users, setUsers] = useState([]);
  const [view, setView] = useState(null);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const [dialing, setDialing] = useState('');
  const [source, setSource] = useState('Capture Form');
  const [actionsEl, setActionsEl] = useState(null);

  const fKey = JSON.stringify({ ...f, sort: undefined });
  useEffect(() => setPage(1), [fKey, f.sort]);
  // a long range defaults to weekly / monthly points, like the backend
  useEffect(() => {
    const [a, b] = rangeOf(f);
    const days = b.diff(a, 'day');
    setBucket(days <= 62 ? 'day' : days <= 200 ? 'week' : 'month');
  }, [f.preset, f.from, f.to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isManager) return;
    request.list({ entity: 'admin', options: { items: 500 } }).then((r) => {
      const all = r?.success ? r.result || [] : [];
      setUsers(all.filter((a) => a.enabled !== false && DEPARTMENT_ROLES.Sales.includes(a.role)).sort((a, b) => String(a.name).localeCompare(String(b.name))));
    });
  }, [isManager]);

  const loadInsights = useCallback(() => {
    setIns((o) => ({ ...o, loading: true, error: false }));
    request.get({ entity: `lead/insights?${queryOf(f, { bucket })}` }).then((r) => {
      setIns(r?.success ? { data: r.result, loading: false, error: false } : (o) => ({ data: o.data, loading: false, error: true }));
    });
  }, [fKey, bucket, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadInsights, [loadInsights]);

  const loadList = useCallback(() => {
    setList((o) => ({ ...o, loading: true, error: false }));
    request.get({ entity: `lead/insights/list?${queryOf(f, { page, items, sort: f.sort })}` }).then((r) => {
      if (r?.success) setList({ rows: r.result || [], count: r.pagination?.count || 0, pages: r.pagination?.pages || 1, loading: false, error: false });
      else setList((o) => ({ ...o, loading: false, error: true }));
    });
  }, [fKey, f.sort, page, items, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'leads') loadList(); }, [tab, loadList]);

  const refresh = () => setTick((t) => t + 1);
  const filtersActive = !!(f.q || f.channel || f.stage || f.quality || f.assignedUser || f.preset !== '30d');
  const clear = () => { setDraftQ(''); setF((o) => ({ ...BLANK, sort: o.sort })); };

  const call = async (r) => {
    setDialing(r._id);
    const res = await dialContact({ phone: r.phone, contactName: r.name, callLead: r._id });
    setDialing('');
    if (res.ok) message.success(res.message || `Calling ${r.name || r.phone}…`);
    else message.error(res.message || 'Could not start the call.');
  };
  const exportCsv = async (ids) => {
    try {
      await apiDownload(`lead/insights/export?${queryOf(f, { sort: f.sort, ...(ids?.length ? { ids: ids.join(',') } : {}) })}`, `leads-${dayjs().format('YYYY-MM-DD')}.csv`);
    } catch {
      message.error('Could not export the leads.');
    }
  };

  const range = ins.data?.range;
  const rangeText = presetLabel(f).replace(/^Last/, 'last').replace(/^This/, 'this').replace(/^Today$/, 'today').replace(/^Yesterday$/, 'yesterday');
  const fmtR = (a, b) => (a && b ? `${dayjs(a).format('D MMM')} – ${dayjs(b).format('D MMM YYYY')}` : '');
  const total = ins.data?.totals?.total;
  const goLeads = (patch) => { setF((o) => ({ ...o, ...patch })); setTab('leads'); };
  const goSource = (ch) => { if (ch) setSource(ch); setTab('sources'); };
  const showFilters = tab === 'overview' || tab === 'leads';
  // Sources reloads its "Leads from …" list only when the date range / owner changes
  const sourceFilters = useMemo(() => ({ ...BLANK, preset: f.preset, from: f.from, to: f.to, assignedUser: f.assignedUser }), [f.preset, f.from, f.to, f.assignedUser]);

  return (
    <div className="ch2">
      <header className="ch2-head">
        <div className="ch2-title">
          <span className="ch2-logo"><Ic n="users" s={24} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="ch2-crumb">Marketing › Capture Form</div>
            <h1>Leads</h1>
            <p>Every lead source, the capture form and lead quality in one place — {total == null ? '…' : <b>{nf(total)} leads</b>} came in · {rangeText}</p>
          </div>
        </div>
        <div className="ch2-actions" ref={tab === 'form' ? setActionsEl : undefined}>
          {tab !== 'form' && (
            <>
              {isManager && tab !== 'sources' && <button type="button" className="ch2-btn" onClick={() => exportCsv()}><Ic n="download" />Export</button>}
              <button type="button" className="ch2-btn p" aria-label="Add lead" onClick={() => setAdding(true)}><Ic n="plus" w={2.4} />Add lead</button>
            </>
          )}
        </div>
      </header>

      <nav aria-label="Leads views" className="ch2-tabs" role="tablist">
        {TABS.map(([k, l, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ch2-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            <Ic n={icon} />{l}{k === 'leads' && total != null && <span className="ch2-cnt">{nf(total)}</span>}
          </button>
        ))}
      </nav>

      {showFilters && (
        <FilterBar
          f={f}
          setF={setF}
          draftQ={draftQ}
          setDraftQ={setDraftQ}
          users={users}
          isManager={isManager}
          showQuality={tab === 'leads'}
          showSort={tab === 'leads'}
          note={tab === 'overview' ? 'Every number below and the All Leads table use these same filters' : null}
        />
      )}

      {tab === 'overview' && (
        <Overview
          data={ins.data}
          loading={ins.loading}
          error={ins.error}
          onRetry={loadInsights}
          bucket={bucket}
          onBucket={setBucket}
          rangeText={fmtR(range?.from, range?.to)}
          prevText={fmtR(range?.prevFrom, range?.prevTo)}
          onFilterUser={(id) => setF((o) => ({ ...o, assignedUser: o.assignedUser === id ? '' : id }))}
          onGoLeads={goLeads}
          onGoSource={goSource}
          onClear={clear}
          filtersActive={filtersActive}
        />
      )}
      {tab === 'leads' && (
        <AllLeads
          list={list}
          page={page}
          setPage={setPage}
          items={items}
          setItems={setItems}
          sort={f.sort}
          setSort={(s) => setF((o) => ({ ...o, sort: s }))}
          onRetry={loadList}
          onClear={clear}
          onView={setView}
          onCall={call}
          dialing={dialing}
          isManager={isManager}
          users={users}
          onChanged={refresh}
          onExport={exportCsv}
          filtersActive={filtersActive}
        />
      )}
      {tab === 'sources' && (
        <Sources
          insights={ins.data}
          filters={sourceFilters}
          rangeText={rangeText}
          selected={source}
          setSelected={setSource}
          onOpenLeads={(ch) => goLeads({ channel: ch })}
          onView={setView}
          isManager={isManager}
        />
      )}
      {tab === 'form' && <FormBuilder isManager={isManager} actionsEl={actionsEl} />}

      {view && <LeadDrawer row={view} onClose={() => setView(null)} onCall={call} dialing={dialing} isManager={isManager} users={users} onChanged={refresh} />}
      {adding && <AddLeadModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

