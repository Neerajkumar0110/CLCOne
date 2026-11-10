import React, { useEffect, useState } from 'react';
import lmsApi from '../api';
import { useLoad, act, Head, Loading, fmtTime } from './shared';

// Design A11 · Readiness, assessment & attendance rules. Values shown are the
// ones the engine enforces right now (LmsSetting 'assessments' + 'live').
// Edits become a proposal; nothing changes until a different manager approves.
function Field({ label, code, children }) {
  return (
    <div className="ao-f">
      <span>{label}{code && <><br /><code>{code}</code></>}</span>
      {children}
    </div>
  );
}

export default function AssessRules() {
  const { data, loading, err, setData } = useLoad(() => lmsApi.opsRules());
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!data) return;
    const src = data.proposal || {};
    setV({
      assessment: { ...{ passMark: data.current.assessment.passMark, attempts: data.current.assessment.attempts, cooldownDays: data.current.assessment.cooldownDays }, ...(src.assessment || {}) },
      attendance: { ...{ graceMin: data.current.attendance.graceMin, presentPct: data.current.attendance.presentPct }, ...(src.attendance || {}) },
    });
  }, [data]);
  const set = (g, k) => (e) => setV({ ...v, [g]: { ...v[g], [k]: e.target.value } });
  const changed = data && v && (['passMark', 'attempts', 'cooldownDays'].some((k) => Number(v.assessment[k]) !== data.current.assessment[k]) || ['graceMin', 'presentPct'].some((k) => Number(v.attendance[k]) !== data.current.attendance[k]));
  const propose = async () => {
    const values = { assessment: Object.fromEntries(Object.entries(v.assessment).map(([k, x]) => [k, Number(x)])), attendance: Object.fromEntries(Object.entries(v.attendance).map(([k, x]) => [k, Number(x)])) };
    const r = await act(lmsApi.opsRulesPropose(values), 'Sent to Management for approval');
    if (r) setData(r);
  };
  const approve = async () => {
    const r = await act(lmsApi.opsRulesApprove(), 'Approved — new rules enforced');
    if (r) setData(r);
  };
  const discard = async () => {
    const r = await act(lmsApi.opsRulesDiscard(), 'Proposal discarded');
    if (r) setData(r);
  };

  const proposed = data && data.proposal;
  return (
    <>
      <Head
        title="Readiness, assessment & attendance rules"
        sub="Spec §6.2, §5.4, §7.3 · proposed values are not enforced until management approves them"
        right={
          data && (
            <>
              <span className={`ao-chip ${proposed ? 'adh' : 'hai'}`}>{proposed ? `Proposed by ${data.proposedByName} · not enforced` : `Approved · v${data.version} enforced`}</span>
              {proposed ? (
                <>
                  {data.canApprove && <button type="button" className="ao-btn" onClick={approve}>Approve (Management)</button>}
                  <button type="button" className="ao-btn2" onClick={discard}>Discard</button>
                </>
              ) : (
                <button type="button" className="ao-btn" disabled={!changed} onClick={propose}>Propose change</button>
              )}
            </>
          )
        }
      />
      <Loading loading={loading} err={err} data={data}>
        {data && v && (
          <div className="ao-grid-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div className="ao-card">
              <div className="ao-hd"><b>Readiness test · D-02</b><span className="ao-chip gray">Same engine</span></div>
              <Field label="Pass threshold" code="Readiness_Pass_Percentage"><input className="ao-inp full" readOnly value={`${data.current.readiness.passPct}%`} /></Field>
              <Field label="Attempts" code="Maximum_Attempts"><input className="ao-inp full" readOnly value={data.current.readiness.attempts} /></Field>
              <Field label="Cooldown" code="Retake_Cooldown_Days"><input className="ao-inp full" readOnly value={`${data.current.readiness.cooldownDays} days`} /></Field>
              <Field label="Access gate" code="Readiness_Status = Passed"><select className="ao-inp full" disabled><option>Not enforced (D-02 pending)</option></select></Field>
              <div className="ao-muted" style={{ fontSize: 12 }}>The BASIC readiness test uses the same pass %, attempts and cooldown as the assessment rules — change them there.</div>
            </div>
            <div className="ao-card">
              <div className="ao-hd"><b>Assessment rules · D-03</b><span className="ao-chip hai">Engine live</span></div>
              <Field label="Total marks"><input className="ao-inp full" readOnly value={data.current.assessment.totalMarks} /></Field>
              <Field label="Pass mark (out of 50)"><input className="ao-inp full" type="number" min={1} max={50} disabled={!!proposed} value={v.assessment.passMark} onChange={set('assessment', 'passMark')} /></Field>
              <Field label="Attempts"><input className="ao-inp full" type="number" min={1} max={10} disabled={!!proposed} value={v.assessment.attempts} onChange={set('assessment', 'attempts')} /></Field>
              <Field label="Interval between attempts (days)"><input className="ao-inp full" type="number" min={0} max={60} disabled={!!proposed} value={v.assessment.cooldownDays} onChange={set('assessment', 'cooldownDays')} /></Field>
              <div className="ao-muted" style={{ fontSize: 12 }}>Pass mark is stored as a % ({Math.round((Number(v.assessment.passMark) / 50) * 100)}%) and applies to every test type.</div>
            </div>
            <div className="ao-card">
              <div className="ao-hd"><b>Attendance rules · D-01</b><span className="ao-chip hai">Calc live</span></div>
              <Field label="Joining grace (min)"><input className="ao-inp full" type="number" min={0} max={60} disabled={!!proposed} value={v.attendance.graceMin} onChange={set('attendance', 'graceMin')} /></Field>
              <Field label="Present if attended ≥ (%)"><input className="ao-inp full" type="number" min={1} max={100} disabled={!!proposed} value={v.attendance.presentPct} onChange={set('attendance', 'presentPct')} /></Field>
              <Field label="Overall threshold"><input className="ao-inp full" readOnly value={`${data.current.attendance.overallPct}% (eligibility rule)`} /></Field>
              <Field label="Dropped in denominator?"><select className="ao-inp full" disabled><option>Excluded</option></select></Field>
              <Field label="Cancelled sessions"><select className="ao-inp full" disabled><option>Excluded</option></select></Field>
              <div className="ao-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Change = new rule version · {data.proposedAt ? `proposed ${fmtTime(data.proposedAt)}` : 'old results stay on their old version'}</div>
            </div>
          </div>
        )}
      </Loading>
    </>
  );
}
