import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import api from './api';
import Learner360Report from './Learner360Report';
import { C, TONE, Chip, Btn, Av, Bar, Card, Row, Col, KPI, Table, Tabs, Gauge, Check, Lbl, Screen, Loading, ErrorBox, useData } from './ui';

// Figma 1C "My learners & mentor remarks" (Mentor / Teacher). A manager
// opening it picks a batch. "Open 360°" shows that learner's full 1A report.

const LV_COLOR = { ok: C.ok, wa: C.wa, er: C.er, mut: C.fa };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
const TONES = [
  ['positive', 'Positive', 'ok', 'check'],
  ['action', 'Action needed', 'wa', 'alert'],
  ['neutral', 'Neutral', 'mut', null],
];

export default function MentorLearners() {
  const [batch, setBatch] = useState('');
  const { data, error, loading, reload } = useData(() => api.mentorLearners(batch || undefined), [batch]);
  const [tab, setTab] = useState('all');
  const [sel, setSel] = useState(null);
  const [open360, setOpen360] = useState(null);
  const [remarks, setRemarks] = useState([]);
  const [tone, setTone] = useState('positive');
  const [text, setText] = useState('');
  const [show, setShow] = useState(true);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (data && data.rows && data.rows.length && !sel) setSel(data.rows[0]);
    if (data && data.needBatch && !batch && data.batches.length) setBatch(data.batches[0]);
  }, [data, sel, batch]);
  useEffect(() => {
    if (!sel) return;
    api.remarks(sel.id).then((r) => setRemarks(r.success ? r.result : []));
  }, [sel]);

  if (open360)
    return (
      <div>
        <div className="g-root" style={{ minHeight: 0 }}>
          <div style={{ padding: '12px 28px 0' }}>
            <Btn k="g" sm i="chevr" onClick={() => setOpen360(null)} style={{ transform: 'none' }}>
              Back to my learners
            </Btn>
          </div>
        </div>
        <Learner360Report learnerId={open360} crumbBase="LMS / My Learners" />
      </div>
    );
  if (loading && !data) return <Loading text="Calculating your learners' 360° scores…" />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;
  const k = data.kpis || {};
  const rows = (data.rows || []).filter((r) =>
    tab === 'all' ? true : tab === 'attention' ? (r.total != null && r.level.key === 'needs') || (r.engagement.level && r.engagement.level.key === 'low') : r.level.key === 'job'
  );

  const post = async () => {
    if (!sel || text.trim().length < 3) return message.error('Write the remark first.');
    setBusy(true);
    const r = await api.addRemark(sel.id, { tone, text, showOnReport: show, notify });
    setBusy(false);
    if (r.success) {
      message.success('Remark posted');
      setText('');
      setRemarks([r.result, ...remarks]);
      reload();
    } else message.error(r.message);
  };
  const allPdfs = async () => {
    if (!data.mentorPdf) return message.error('Mentor PDF downloads are turned off by the admin.');
    setPdfBusy(true);
    for (const r of data.rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.pdf(r.id, `${r.name} - 360 report.pdf`);
      } catch (e) {
        message.error(`PDF failed for ${r.name}`);
      }
    }
    setPdfBusy(false);
  };

  return (
    <Screen
      crumb="LMS / My Learners"
      title="My Learners · 360° overview"
      actions={
        <>
          {data.batches.length > 1 && (
            <div className="g-input" style={{ width: 'auto', padding: '7px 10px' }}>
              <select value={batch} onChange={(e) => { setBatch(e.target.value); setSel(null); }} aria-label="Batch">
                <option value="">{data.needBatch ? 'Pick a batch' : 'All my batches'}</option>
                {data.batches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Btn k="s" i="download" onClick={allPdfs} disabled={pdfBusy || !data.rows.length}>
            {pdfBusy ? 'Downloading…' : 'Download all PDFs'}
          </Btn>
        </>
      }
    >
      <Row className="g-rs">
        <KPI i="users" label="Assigned learners" val={k.assigned ?? '—'} sub={(k.batches || []).join(' + ') || '—'} tone="ind" style={{ flex: 1 }} />
        <KPI i="target" label="Avg hire-readiness" val={k.avg ?? '—'} sub={k.batchAvg != null ? `Batch avg ${k.batchAvg}` : 'Across your batches'} tone="pri" bar={k.avg || 0} style={{ flex: 1 }} />
        <KPI i="checkc" label="Job Ready" val={k.jobReady ?? '—'} sub={`${k.nearJob || 0} more within 3 pts`} tone="ok" style={{ flex: 1 }} />
        <KPI i="alert" label="Need attention" val={k.attention ?? '—'} sub="Readiness < 60 or inactive" tone="er" style={{ flex: 1 }} />
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card
          title="Assigned learners"
          i="users"
          style={{ flex: 1 }}
          right={
            <Tabs
              items={[
                ['all', 'All'],
                ['attention', 'Needs attention'],
                ['job', 'Job Ready'],
              ]}
              act={tab}
              onChange={setTab}
            />
          }
        >
          <Table
            cols={[
              ['Learner', 'f'],
              ['Readiness', 130],
              ['Level', 124],
              ['Engagement', 100],
              ['Projects', 70],
              ['Last remark', 86],
            ]}
            hl={rows.map((r, i) => (sel && r.id === sel.id ? i : -1)).filter((i) => i >= 0)}
            onRow={(i) => setSel(rows[i])}
            rows={rows.map((r) => [
              <>
                <Av name={r.name} col={C.ind} s={26} />
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{r.name}</span>
              </>,
              <>
                <b style={{ fontSize: 13, width: 24 }}>{r.total == null ? '—' : Math.round(r.total)}</b>
                <Bar pct={r.total || 0} col={TONE[r.level.tone][1]} w={70} />
              </>,
              <Chip tone={r.level.tone} dot>
                {r.level.key === 'needs' ? 'Needs Work' : r.level.label}
              </Chip>,
              <Chip tone={r.engagement.level.tone} s={10.5}>
                {r.engagement.level.short || '—'}
              </Chip>,
              `${r.projects.reviewed} / ${r.projects.total}`,
              day(r.lastRemark),
            ])}
            empty={data.needBatch && !batch ? 'Pick a batch.' : 'No learners here.'}
          />
        </Card>

        {sel && (
          <Card
            title={sel.name}
            i="user"
            tone="ind"
            sub={[sel.learnerId, sel.level.label, sel.rank ? `rank #${sel.rank}` : null].filter(Boolean).join(' · ')}
            style={{ width: 400, flexShrink: 0 }}
            right={
              <Btn k="s" sm i="target" onClick={() => setOpen360(sel.id)}>
                Open 360°
              </Btn>
            }
          >
            <Row g={14} className="g-ac">
              <Gauge v={sel.total || 0} txt={sel.total == null ? '—' : Math.round(sel.total)} s={120} c={LV_COLOR[sel.level.tone]} l="readiness" />
              <Col g={6} style={{ flex: 1 }}>
                {[
                  ['Attendance', sel.scores.attendance, C.pri],
                  ['Assessment', sel.scores.assessment, C.pu],
                  ['Coding', sel.scores.coding, C.ind],
                  ['Project', sel.scores.project, C.ok],
                ].map(([l, v, col]) => (
                  <Row key={l} g={8} className="g-ac">
                    <span style={{ fontSize: 11.5, color: C.mut, width: 72 }}>{l}</span>
                    <Bar pct={v || 0} col={col} w={90} />
                    <b style={{ fontSize: 11.5 }}>{v == null ? '—' : v}</b>
                  </Row>
                ))}
              </Col>
            </Row>
            <Lbl>Write a remark</Lbl>
            <Row g={6} className="g-wrap">
              {TONES.map(([key, l, t, ic]) => (
                <button key={key} type="button" onClick={() => setTone(key)} aria-pressed={tone === key} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}>
                  <Chip tone={tone === key ? t : 'mut'} i={tone === key ? ic : null}>
                    {l}
                  </Chip>
                </button>
              ))}
            </Row>
            <textarea className="g-input" rows={4} style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Strong project work. Before placement mocks, complete the AI Agents module labs…" aria-label="Remark" />
            <Check label="Show on learner report & PDF" on={show} onChange={setShow} s={12.5} />
            <Check label="Notify learner by email & in-app" on={notify} onChange={setNotify} s={12.5} />
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="g" onClick={() => setText('')}>
                Cancel
              </Btn>
              <Btn k="i" i="send" onClick={post} disabled={busy}>
                Post remark
              </Btn>
            </Row>
            <Lbl>History</Lbl>
            {remarks.length === 0 && <span className="g-s12 g-fa">No remarks yet.</span>}
            {remarks.map((m) => (
              <Row key={m.id} g={8} className="g-ac" style={{ padding: '6px 0', borderBottom: `1px solid ${C.bg2}` }}>
                <Chip tone={m.tone === 'positive' ? 'ok' : m.tone === 'action' ? 'wa' : 'mut'} s={10}>
                  {day(m.at)}
                </Chip>
                <span style={{ fontSize: 12, color: C.sub, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.text}>
                  {m.text}
                </span>
              </Row>
            ))}
          </Card>
        )}
      </Row>
    </Screen>
  );
}
