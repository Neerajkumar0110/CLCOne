import React, { lazy, useEffect, useState } from 'react';
import { Alert, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { PMPage, PMTabs, Legacy, Loading, useLoad, useTab, res, fmtDay, fmtDayTime, errText, BatchSelect } from './shared';

const AssessmentDashboard = lazy(() => import('../AssessmentDashboard'));

// P4 — assessments & results for one of my batches: tests list | attempts
// table (attempt n/max, score, draft result, proctor signals, next eligible)
// with "verify before publish" sign-off and the draft XLSX. Analytics (the
// old Assessment dashboard) stays on its own tab.

const RESULT = {
  QUALIFIED: ['hai', 'Qualified'],
  NOT_PASSED: ['red', 'Not passed'],
  TECHNICAL_REVIEW: ['adh', 'Technical review'],
  IN_PROGRESS: ['naya', 'In progress'],
  NOT_STARTED: ['gray', 'Not started'],
};
const SIG = { TAB_SWITCH: 'tab switch', WINDOW_BLUR: 'window blur', FULLSCREEN_EXIT: 'fullscreen exit', CAMERA_OFF: 'camera off', MIC_OFF: 'mic off', SCREEN_SHARE_STOPPED: 'screen share stopped', DEVTOOLS_OPEN: 'devtools' };
const sigText = (r) => (r.signals || []).map((s) => `${s.n} ${SIG[s.type] || s.type.toLowerCase()}${s.n > 1 ? 'es' : ''}`).join(' · ');
const needsVerify = (t) => t.attempted > 0 && (!t.verified || new Date(t.verified.at) < new Date(t.lastActivity));

function Board() {
  const navigate = useNavigate();
  const [batch, setBatch] = useState('');
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState('');
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.pmAssess(batch ? { batch } : {})), [batch]);
  const tests = (data && data.tests) || [];
  useEffect(() => {
    if (tests.length && !tests.some((t) => t.testType === sel)) setSel((tests.find(needsVerify) || tests[0]).testType);
  }, [tests, sel]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} />;
  const t = tests.find((x) => x.testType === sel);
  const s = data.settings || {};

  const verify = async () => {
    setBusy('verify');
    try {
      const r = await lmsApi.pmAssessVerify({ batch: data.batch, testType: t.testType, counts: { attempted: t.attempted, qualified: t.qualified, technical: t.technical } });
      if (r && r.success === false) throw new Error(r.message);
      message.success('Report verified — your name and time are on it.');
      reload();
    } catch (e) {
      message.error(errText(e, 'Could not verify.'));
    } finally {
      setBusy('');
    }
  };
  const download = async () => {
    setBusy('xlsx');
    try {
      await lmsApi.opsDownload('/lms/teacher/pm/assess/export', { batch: data.batch, testType: t.testType }, `${data.batch}-${t.testType}-draft.xlsx`);
    } catch (e) {
      message.error('Download failed.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 14, flex: 1, minHeight: 0 }}>
      <section className="ld-card pm-scroll" style={{ gap: 8 }} aria-label="Assessments">
        <div className="ld-hd"><b style={{ fontSize: 14 }}>Assessments · {data.batch || '—'}</b></div>
        <BatchSelect batches={data.batches} value={data.batch} onChange={(b) => { setSel(''); setBatch(b); }} />
        {tests.length === 0 && <div className="ld-empty">No test attempt in this batch yet.</div>}
        {tests.map((x) => (
          <button key={x.testType} type="button" className={`pm-a${x.testType === sel ? ' on' : ''}`} onClick={() => setSel(x.testType)}>
            <b>{x.label}</b>
            {needsVerify(x) ? <span style={{ color: '#9a3412', fontWeight: 600 }}>{x.attempted} attempted · report to verify</span> : <span className="ld-muted">{x.attempted} attempted · verified {fmtDay(x.verified.at)}</span>}
          </button>
        ))}
        <button type="button" className="ld-link" style={{ fontSize: 13, marginTop: 'auto' }} onClick={() => navigate('/teacher/question-bank')}>Question bank{data.questionBank != null ? ` (${data.questionBank} questions)` : ''} →</button>
      </section>

      {t ? (
        <section className="ld-card pm-scroll" aria-label="Attempts">
          <div className="ld-hd">
            <b>{t.label} · {data.batch}</b>
            {needsVerify(t) ? <span className="ld-chip adh">Draft · verify before publish</span> : <span className="ld-chip hai">Verified by {t.verified.byName}</span>}
          </div>
          <div className="pm-g5" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
            <div className="ld-kv"><span className="ld-muted">Pass mark</span><b style={{ fontSize: 15 }}>{s.qualifyPct}%</b></div>
            <div className="ld-kv"><span className="ld-muted">Attempts · cooldown</span><b style={{ fontSize: 15 }}>{s.maxAttempts} · {s.cooldownDays} din</b></div>
            <div className="ld-kv"><span className="ld-muted">Attempted</span><b style={{ fontSize: 15 }}>{t.attempted} / {t.roster}</b></div>
            <div className="ld-kv"><span className="ld-muted">Qualified (draft)</span><b style={{ fontSize: 15, color: '#166534' }}>{t.qualified}</b></div>
            <div className="ld-kv"><span className="ld-muted">Technical review</span><b style={{ fontSize: 15, color: t.technical ? '#9a3412' : undefined }}>{t.technical}</b></div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="ld-table">
              <thead><tr><th>Learner</th><th>Attempt</th><th>Score</th><th>Draft result</th><th>Proctor signals</th><th>Next eligible</th><th /></tr></thead>
              <tbody>
                {t.rows.map((r) => {
                  const [cls, label] = RESULT[r.result] || ['gray', r.result];
                  const sg = sigText(r);
                  return (
                    <tr key={r.email}>
                      <td><b>{r.name}</b></td>
                      <td>{r.attempts ? `${r.attempts} / ${s.maxAttempts}` : '—'}</td>
                      <td>{r.score != null ? `${r.score}${r.total ? `/${r.total}` : ''}` : '—'}</td>
                      <td><span className={`ld-chip ${cls}`}>{label}</span></td>
                      <td style={{ color: (r.signals || []).some((x) => x.n >= 3) ? '#9a3412' : undefined }} className={sg ? '' : 'ld-muted'}>{sg || (r.attempts ? 'none' : '—')}</td>
                      <td>{r.result === 'QUALIFIED' ? '—' : r.result === 'TECHNICAL_REVIEW' ? 'pending' : r.nextEligible ? fmtDay(r.nextEligible) : r.attempts >= s.maxAttempts ? 'no attempts left' : '—'}</td>
                      <td>
                        {(sg || r.result === 'TECHNICAL_REVIEW') && (
                          <button type="button" className="ld-btn2 sm" onClick={() => navigate(`/teacher/attempts?search=${encodeURIComponent(r.email)}`)}>
                            {r.result === 'TECHNICAL_REVIEW' ? 'Review evidence' : 'Review signals'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ld-soft">A tab switch is only a <b>review signal</b>, not proof of misconduct. Changing marks / attempts needs a reason — old attempt history is never overwritten.</div>
          <div className="ld-hd" style={{ marginTop: 'auto', flexWrap: 'wrap' }}>
            <span className="ld-muted" style={{ fontSize: 13 }}>
              {needsVerify(t) ? 'Draft report built from the criteria · the responsible person verifies before publishing' : `Verified ${fmtDayTime(t.verified.at)} by ${t.verified.byName}`}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ld-btn2" disabled={busy === 'xlsx'} onClick={download}>Download draft (XLSX)</button>
              <button type="button" className="ld-btn" disabled={!needsVerify(t) || busy === 'verify'} onClick={verify}>{needsVerify(t) ? 'Verify report' : 'Verified ✓'}</button>
            </div>
          </div>
        </section>
      ) : (
        <section className="ld-card"><div className="ld-empty">Pick a test.</div></section>
      )}
    </div>
  );
}

export default function PMAssess() {
  const [tab, setTab] = useTab('results');
  return (
    <PMPage title="Assessments & results" right={<PMTabs tabs={[['results', 'Results & verify'], ['analytics', 'Analytics']]} value={tab} onChange={setTab} />}>
      {tab === 'results' ? <Board /> : <Legacy><AssessmentDashboard /></Legacy>}
    </PMPage>
  );
}
