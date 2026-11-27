import React, { useState } from 'react';
import { Modal, message, Button, Input } from 'antd';
import {
  FolderOpenOutlined, SearchOutlined, UploadOutlined, CloudServerOutlined, DatabaseOutlined, DashboardOutlined,
  FileProtectOutlined, TeamOutlined, TrophyOutlined, MessageOutlined, ProjectOutlined, CustomerServiceOutlined, MailOutlined,
  SafetyCertificateOutlined, PaperClipOutlined, SafetyOutlined, FileTextOutlined, HistoryOutlined, LinkOutlined, CloseOutlined,
} from '@ant-design/icons';
import { request } from '@/request';
import { BASE_URL } from '@/config/serverApiConfig';
import lmsApi from '../api';
import { useLoad, Loading, fmtDate, fmtTime } from './shared';
import './mgmt.css';
import './evidence.css';

// Design A10 · Central evidence repository — one list over the records that
// already prove each decision (acceptances, corrections, attempts, uploads,
// tickets, emails, certificates, security signals).
// 2026-11-27 redesign: gradient hero with learner search, system-health strip,
// type pills with icons, evidence rows → detail modal.
const TYPE_LOOK = {
  Policy: [FileProtectOutlined, 'g1'],
  Attendance: [TeamOutlined, 'g3'],
  Assessment: [TrophyOutlined, 'g4'],
  Feedback: [MessageOutlined, 'g5'],
  Project: [ProjectOutlined, 'g2'],
  Ticket: [CustomerServiceOutlined, 'g6'],
  Communication: [MailOutlined, 'g5'],
  Certificate: [SafetyCertificateOutlined, 'g3'],
  Upload: [PaperClipOutlined, 'g2'],
  Security: [SafetyOutlined, 'g6'],
};
const lookOf = (t) => TYPE_LOOK[t] || [FileTextOutlined, 'g1'];
const OPS = [
  ['backup', 'Daily backup', 'all 7 DBs + uploads', CloudServerOutlined, 2],
  ['restoreDrill', 'Restore drill', 'scratch DB', DatabaseOutlined, 8],
  ['loadTest', 'Load test', 'capacity check', DashboardOutlined, 35],
];

export default function Evidence() {
  const [type, setType] = useState('All');
  const [sel, setSel] = useState(null);
  // one learner's evidence, tickets and reports together (report #30)
  const [qIn, setQIn] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [runs, setRuns] = useState(null);
  const [up, setUp] = useState({ title: '', learner: '', note: '', url: '', name: '', busy: false });
  const { data, loading, err, reload } = useLoad(() => lmsApi.opsEvidence(type, q || undefined), [type, q]);
  const pickFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setUp((u) => ({ ...u, busy: true }));
    const r = await request.post({ entity: 'lms/admin/ops/evidence/upload', jsonData: fd });
    setUp((u) => ({ ...u, busy: false, ...(r && r.success ? { url: r.result.url, name: r.result.name, title: u.title || r.result.name } : {}) }));
  };
  const saveUpload = async () => {
    if (!up.url) return message.warning('Pick the file first.');
    const r = await lmsApi.opsEvidenceAdd({ title: up.title, learner: up.learner, note: up.note, url: up.url, name: up.name });
    if (r && r.success) {
      message.success('Evidence saved.');
      setAdding(false);
      setUp({ title: '', learner: '', note: '', url: '', name: '', busy: false });
      if (reload) reload();
    }
    return null;
  };
  // spec §18 / §20: backup, restore drill, load test — written by deploy/vps scripts
  const ops = useLoad(() => lmsApi.smOpsStatus().catch(() => null), []);
  const rows = (data && data.rows) || [];
  const cur = rows.find((r) => r.id === sel) || null;
  const find = () => setQ(qIn.trim());

  return (
    <div className="mg ev">
      <div className="mg-hero ev-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><FolderOpenOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Central evidence repository · spec §11.1</span>
            <h1>Proof of every decision, in one place</h1>
            <p>Policy acceptances, attendance corrections, attempts, tickets, emails, certificates and uploads — each with version, source, access scope and retention class.</p>
          </div>
        </div>
        <div className="ev-search">
          <Input allowClear prefix={<SearchOutlined />} placeholder="Learner name or email…" value={qIn} onChange={(e) => { setQIn(e.target.value); if (!e.target.value) setQ(''); }} onPressEnter={find} aria-label="Filter by learner" />
          <Button onClick={find}>Find</Button>
          <Button type="primary" icon={<UploadOutlined />} className="ev-up" onClick={() => setAdding(true)}>Upload evidence</Button>
        </div>
      </div>

      {q && (
        <div className="ev-focus">
          <SearchOutlined /> <span>Everything for <b>“{q}”</b> — policy, attendance, tests, feedback, projects, tickets, emails, certificates and uploads.</span>
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => { setQ(''); setQIn(''); }}>Clear</Button>
        </div>
      )}

      {ops.data && (
        <div className="ev-ops">
          {OPS.map(([k, label, sub, Ic, maxDays]) => {
            const v = ops.data[k];
            const stale = v && v.at && Date.now() - new Date(v.at) > maxDays * 86400000;
            const state = !v ? 'none' : !v.ok ? 'bad' : stale ? 'mid' : 'ok';
            return (
              <div className={`ev-op ${state}`} key={k}>
                <span className="ev-op-ic"><Ic /></span>
                <div className="ev-op-t">
                  <div className="ev-op-hd"><b>{label}</b><span className={`mg-pill ${state}`}>{state === 'none' ? 'Not set up' : state === 'bad' ? 'Failed' : state === 'mid' ? 'Stale' : 'OK'}</span></div>
                  <small>{sub}</small>
                  {v ? (
                    <span className="ev-op-s">{fmtDate(v.at)} {fmtTime(v.at)}{v.summary ? ` · ${v.summary}` : ''}</span>
                  ) : (
                    <span className="ev-op-s">No report yet — set up the cron jobs (deploy/vps/install-ops-crons.sh)</span>
                  )}
                  {v && v.runs && v.runs.length > 1 && <button type="button" className="ev-op-h" onClick={() => setRuns({ label, runs: v.runs })}><HistoryOutlined /> Run history ({v.runs.length})</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ev-types">
        {((data && data.types) || ['All']).map((t) => {
          const [Ic] = t === 'All' ? [FolderOpenOutlined] : lookOf(t);
          return (
            <button key={t} type="button" className={`ev-type${t === type ? ' on' : ''}`} onClick={() => { setType(t); setSel(null); }}><Ic /> {t}</button>
          );
        })}
      </div>

      <Loading loading={loading} err={err} data={data}>
        <section className="mg-card ev-list">
          <div className="mg-hd">
            <span className="mg-hd-ic g2"><FileTextOutlined /></span>
            <div><b>{type === 'All' ? 'All evidence' : type} · {rows.length}</b><small>Click a record to see everything it proves</small></div>
          </div>
          <div className="mg-tbl">
            <div className="mg-tr ev-tr mg-th"><span>Evidence</span><span>Learner</span><span>Linked to</span><span>Ver</span><span>Source</span><span>Time</span><span>Scope · retention</span></div>
            {rows.length === 0 && <div className="mg-empty">No evidence of this type yet.</div>}
            {rows.map((r) => {
              const [Ic, g] = lookOf(r.type);
              return (
                <div className="mg-tr ev-tr" key={r.id} role="button" tabIndex={0} onClick={() => setSel(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(r.id); }}>
                  <span className="ev-id"><i className={g}><Ic /></i><span><b>{r.type}</b><code>{r.id}</code></span></span>
                  <span className="mg-obj" title={r.who}>{r.who || '—'}</span>
                  <span title={r.obj}>{r.obj || '—'}</span>
                  <span><span className="ev-ver">v{r.v || 1}</span></span>
                  <span className="mg-rsn">{r.src}</span>
                  <span className="mg-time">{fmtDate(r.t)}</span>
                  <span className="ev-scope"><span>{r.scope}</span><small>{r.ret}</small></span>
                </div>
              );
            })}
          </div>
        </section>
      </Loading>

      <Modal open={!!cur} onCancel={() => setSel(null)} footer={null} width={620} centered destroyOnClose rootClassName="mg-modal">
        {cur && (() => {
          const [Ic, g] = lookOf(cur.type);
          return (
            <div className="mg-m">
              <div className="mg-m-head ev-m-head">
                <div className="ev-m-top"><span className={`ev-m-ic ${g}`}><Ic /></span><span className="mg-act">{cur.type}</span><code className="ev-m-id">{cur.id}</code></div>
                <h3>{cur.obj || cur.type}</h3>
                <span>{cur.who ? <>Learner <b>{cur.who}</b> · </> : null}{fmtDate(cur.t)} {fmtTime(cur.t)}</span>
              </div>
              <div className="mg-m-body">
                {cur.url && <a className="ev-doc" href={`${BASE_URL}${cur.url}`} target="_blank" rel="noreferrer"><LinkOutlined /> Open the document</a>}
                <div className="ev-kv">
                  {[['Learner', cur.who], ['Linked to', cur.obj], ...(cur.detail || []), ['Version', `v${cur.v || 1}`], ['Source', cur.src], ['Access scope', cur.scope], ['Retention', cur.ret]].map(([k, v]) => (
                    <div key={k}><small>{k}</small><b>{v && /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? `${fmtDate(v)} ${fmtTime(v)}` : String(v == null || v === '' ? '—' : v)}</b></div>
                  ))}
                </div>
                <div className="mg-m-id">Learners see only their own, PMs only assigned learners, security events only authorised roles</div>
              </div>
              <div className="mg-m-foot"><Button type="primary" onClick={() => setSel(null)}>Close</Button></div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!runs} onCancel={() => setRuns(null)} footer={null} width={560} centered destroyOnClose rootClassName="mg-modal">
        {runs && (
          <div className="mg-m">
            <div className="mg-m-head ev-m-head"><span className="mg-act">Run history</span><h3>{runs.label}</h3><span>{runs.runs.length} runs</span></div>
            <div className="mg-m-body">
              {runs.runs.map((x, i) => (
                <div key={i} className={`ev-run ${x.ok ? 'ok' : 'bad'}`}><span className={`mg-pill ${x.ok ? 'ok' : 'bad'}`}>{x.ok ? 'OK' : 'Failed'}</span><b>{fmtDate(x.at)} {fmtTime(x.at)}</b><span>{x.summary}</span></div>
              ))}
            </div>
            <div className="mg-m-foot"><Button type="primary" onClick={() => setRuns(null)}>Close</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={adding} onCancel={() => setAdding(false)} footer={null} width={560} centered destroyOnClose rootClassName="mg-modal">
        <div className="mg-m">
          <div className="mg-m-head ev-m-head"><span className="mg-act">New evidence</span><h3>Upload evidence</h3><span>PDF, Word, image, Excel / CSV or text · kept with its source and time</span></div>
          <div className="mg-m-body">
            <label className={`ev-drop${up.name ? ' has' : ''}`}>
              <UploadOutlined />
              <b>{up.busy ? 'Uploading…' : up.name ? up.name : 'Choose a file'}</b>
              <small>{up.name ? 'Click to replace' : 'PDF, Word, image, Excel/CSV, text'}</small>
              <input type="file" hidden accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.csv,.txt" onChange={pickFile} />
            </label>
            <label className="ao-label">Title<input className="ao-inp full" value={up.title} onChange={(e) => setUp({ ...up, title: e.target.value })} /></label>
            <label className="ao-label">Learner (optional)<input className="ao-inp full" value={up.learner} onChange={(e) => setUp({ ...up, learner: e.target.value })} /></label>
            <label className="ao-label">Note<textarea className="ao-inp full" style={{ height: 80 }} value={up.note} onChange={(e) => setUp({ ...up, note: e.target.value })} /></label>
          </div>
          <div className="mg-m-foot" style={{ gap: 8 }}>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="primary" disabled={!up.url || up.busy} onClick={saveUpload}>Save evidence</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
