import React, { lazy, useRef, useState } from 'react';
import { Alert, Progress, message } from 'antd';
import lmsApi from '../api';
import { PMPage, PMTabs, Legacy, Loading, useLoad, useTab, res, fmtDay, BatchSelect } from './shared';

const CurriculumTracker = lazy(() => import('../Curriculum'));

// P6 — curriculum tracker & study material: planned vs delivered table
// (status = the topic actually delivered — full / carry-over / different
// topic, from the PM's delivery record) | upload material for a session and
// the batch's materials. The full tracker stays on its own tab; the Study
// Material page is unchanged in the sidebar.

const STATE = {
  DELIVERED: ['hai', 'Delivered'],
  CARRY_OVER: ['adh', 'Carry-over'],
  DIFFERENT_TOPIC: ['adh', 'Different topic'],
  SKIPPED: ['gray', 'Skipped'],
  PENDING: ['gray', 'Planned'],
};
const MAX_MB = 50;

function recCell(r) {
  if (!r.recording) return <span className="ld-muted">{r.state === 'DELIVERED' ? '—' : ''}</span>;
  const { enabled, status, classStatus } = r.recording;
  if (['live', 'starting'].includes(classStatus)) return <span className="ld-muted">after class</span>;
  if (!enabled) return <span className="rec-off">Recording was off</span>;
  if (status === 'AVAILABLE') return <span className="rec-ready">Ready</span>;
  if (status === 'FAILED') return <span className="rec-off">Source unavailable</span>;
  if (status === 'PROCESSING' || classStatus === 'recording_processing') return <span>Processing</span>;
  return <span className="ld-muted">{status ? status.toLowerCase() : '—'}</span>;
}

function Board() {
  const [batch, setBatch] = useState('');
  const [all, setAll] = useState(false);
  const [session, setSession] = useState('');
  const [files, setFiles] = useState([]);
  const [over, setOver] = useState(false);
  const [pct, setPct] = useState(null);
  const input = useRef(null);
  const { data, loading, error } = useLoad(async () => res(await lmsApi.pmCurriculum(batch ? { batch } : {})), [batch]);
  const mats = useLoad(async () => res(await lmsApi.materials()) || [], []);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!data.batch) return <section className="ld-card"><div className="ld-empty">No batch is assigned to you yet.</div></section>;
  const rows = data.rows || [];
  const lastDone = rows.reduce((m, r, i) => (r.state !== 'PENDING' ? i : m), -1);
  const shown = all ? rows : rows.slice(Math.max(0, lastDone - 6), lastDone + 4);
  const course = (data.batches.find((b) => b.name === data.batch) || {}).course;
  const sessionOpts = rows.slice(Math.max(0, lastDone - 2), lastDone + 8);
  const pick = session || (rows[lastDone + 1] && rows[lastDone + 1].sessionId) || (rows[lastDone] && rows[lastDone].sessionId) || '';
  const picked = rows.find((r) => r.sessionId === pick);
  const myMats = (mats.data || [])
    .filter((m) => m.batch === data.batch || (!m.batch && m.courseTitle === course))
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

  const choose = (list) => {
    const arr = Array.from(list || []);
    const big = arr.find((f) => f.size > MAX_MB * 1048576);
    if (big) return message.error(`${big.name} is larger than ${MAX_MB} MB.`);
    const dup = arr.find((f) => myMats.some((m) => m.originalName === f.name && m.sizeBytes === f.size));
    if (dup) message.warning(`${dup.name} is already uploaded (same name + size) — it will still be uploaded as a new version.`);
    setFiles(arr);
  };
  const upload = async () => {
    if (!files.length) return message.warning('Pick a file.');
    setPct(0);
    let okCount = 0;
    for (let i = 0; i < files.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await lmsApi.uploadMaterial({ batch: data.batch, subject: picked ? `${picked.code} · ${picked.title}` : '' }, files[i], (p) => setPct(Math.round((i * 100 + p) / files.length)));
      if (r && r.success !== false) okCount += 1;
      else message.error((r && r.message) || `${files[i].name} upload failed.`);
    }
    setPct(null);
    if (okCount) message.success(`${okCount} file${okCount > 1 ? 's' : ''} uploaded for ${data.batch}.`);
    setFiles([]);
    mats.reload();
  };

  return (
    <>
      <div className="ld-muted" style={{ fontSize: 14, marginTop: -8 }}>
        {data.batch} · {data.delivered} of {data.total} planned sessions · status = the topic actually delivered, not the calendar date
      </div>
      <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card pm-scroll" aria-label="Planned vs delivered">
          <div className="ld-hd">
            <b>Planned vs delivered</b>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <BatchSelect batches={data.batches} value={data.batch} onChange={(b) => { setSession(''); setBatch(b); }} />
              <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => setAll(!all)}>{all ? 'Recent only' : `All ${rows.length}`}</button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="ld-table">
              <thead><tr><th>#</th><th>Date</th><th>Planned topic</th><th>Delivered topic</th><th>Status</th><th>Recording</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const [cls, label] = STATE[r.state] || ['gray', r.state];
                  return (
                    <tr key={r.sessionId}>
                      <td>{r.code}</td>
                      <td>{r.date ? fmtDay(r.date) : '—'}</td>
                      <td>{r.title}</td>
                      <td className={r.deliveredTopic ? '' : 'ld-muted'}>{r.deliveredTopic || (r.state === 'PENDING' ? '' : '—')}</td>
                      <td><span className={`ld-chip ${cls}`}>{label}</span>{r.auto && r.state === 'DELIVERED' && <span className="ld-muted" style={{ fontSize: 11 }}> auto</span>}</td>
                      <td>{recCell(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>"auto" = marked from the class calendar · the PM's delivery record (Live class → What was taught today) overrides it</div>
        </section>

        <section className="ld-card" aria-label="Upload study material">
          <div className="ld-hd"><b>Upload study material</b></div>
          <div
            className={`pm-drop${over ? ' over' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => input.current && input.current.click()}
            onKeyDown={(e) => e.key === 'Enter' && input.current && input.current.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files); }}
          >
            <b>{files.length ? files.map((f) => f.name).join(', ') : 'Drop PDF / PPT / notebook'}</b>
            <span className="ld-muted">max {MAX_MB} MB · duplicate check (same name + size)</span>
          </div>
          <input ref={input} type="file" multiple hidden aria-label="Choose files" onChange={(e) => choose(e.target.files)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <select className="ld-inp" aria-label="Session" value={pick} onChange={(e) => setSession(e.target.value)}>
              {sessionOpts.map((r) => <option key={r.sessionId} value={r.sessionId}>{r.code} · {r.title}</option>)}
            </select>
            <select className="ld-inp" aria-label="Batch" value={data.batch} disabled><option>{data.batch} only</option></select>
          </div>
          {pct != null && <Progress percent={pct} size="small" />}
          <button type="button" className="ld-btn" disabled={!files.length || pct != null} onClick={upload}>Upload &amp; map to session</button>
          <div className="ld-hd" style={{ marginTop: 4 }}><b>Materials · {data.batch}</b><span className="ld-muted" style={{ fontSize: 12 }}>{myMats.length} files</span></div>
          <div className="pm-scroll" style={{ maxHeight: 320 }}>
            {myMats.length === 0 && <div className="ld-empty">No material for this batch yet.</div>}
            {myMats.slice(0, 30).map((m) => (
              <div className="pm-mat" key={m.id}>
                <span><a href={m.fileUrl} target="_blank" rel="noreferrer"><b>{m.originalName || m.title}</b></a> <span className="ld-muted">{m.curriculum && m.curriculum.label ? `${m.curriculum.label} · ` : ''}{fmtDay(m.uploadedAt)}{m.batch ? '' : ' · whole internship'}</span></span>
                <span className="ld-chip hai">Published</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

export default function PMCurriculum() {
  const [tab, setTab] = useTab('board');
  return (
    <PMPage title="Curriculum tracker & study material" right={<PMTabs tabs={[['board', 'Planned vs delivered'], ['tracker', 'Full tracker']]} value={tab} onChange={setTab} />}>
      {tab === 'board' ? <Board /> : <Legacy><CurriculumTracker /></Legacy>}
    </PMPage>
  );
}
