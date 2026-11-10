import React, { useState } from 'react';
import { Alert, Input, Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { SMPage, useLoad, Loading, res, fmtDay, errText } from './shared';

// S5 — certificate management: 7 stats, catalogue (internships + external
// providers), approval queue from the eligibility engine with the pre-issue
// name check, "Approve & issue" through the existing issue endpoint, and
// revoke (admin only, record kept). Rule editing stays on Certificates.

const STATE = { PENDING: ['naya', 'Approval pending'], CORRECTION: ['adh', 'Correction requested'], EVIDENCE_MISSING: ['adh', 'Evidence missing'] };

export default function SMCertificates() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [issuedNow, setIssuedNow] = useState({});
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smCertificates()), []);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const s = data.stats;
  const issue = async (q) => {
    setBusy(q.email);
    try {
      const r = await lmsApi.issueCertificate({ course: q.courseId, studentEmail: q.email });
      if (r && r.success === false) throw new Error(r.message);
      setIssuedNow({ ...issuedNow, [q.email]: true });
      message.success(`Issued to ${q.name} — PDF + email.`);
      reload();
    } catch (e) {
      message.error(errText(e, 'Could not issue.'));
    } finally {
      setBusy('');
    }
  };
  const revoke = (c) => {
    let reason = '';
    Modal.confirm({
      title: `Revoke ${c.certificateId}?`,
      content: <Input.TextArea rows={3} placeholder="Reason (required)" onChange={(e) => { reason = e.target.value; }} />,
      okText: 'Revoke',
      okButtonProps: { danger: true },
      onOk: async () => {
        const r = await lmsApi.smCertificateRevoke(c.id, reason).catch((e) => ({ success: false, message: errText(e, 'Failed.') }));
        if (r && r.success === false) {
          message.error(r.message);
          throw new Error(r.message);
        }
        message.success('Revoked — old record stays in audit.');
        reload();
      },
    });
  };
  const sendBack = (q) => navigate('/support-mgr/learners', { state: { search: q.email } });

  return (
    <SMPage title="Certificate management" sub="Catalogue → eligibility → pre-issue check → approval → issue → verify → correct / revoke">
      <div className="sm-g7" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 }}>
        <div className="sm-st"><b>{s.eligibleNotIssued}</b><span>Eligible, not issued</span></div>
        <div className="sm-st"><b style={{ color: '#9a3412' }}>{s.evidenceMissing}</b><span>Evidence missing</span></div>
        <div className="sm-st"><b>{s.pending}</b><span>Approval pending</span></div>
        <div className="sm-st"><b style={{ color: '#166534' }}>{s.issued}</b><span>Issued</span></div>
        <div className="sm-st"><b>{s.draft}</b><span>Draft (not sent)</span></div>
        <div className="sm-st"><b>{s.correction}</b><span>Correction requested</span></div>
        <div className="sm-st"><b>{s.revoked}</b><span>Revoked</span></div>
      </div>

      <section className="ld-card" aria-label="Catalogue">
        <div className="ld-hd"><b style={{ fontSize: 15 }}>Catalogue</b><button type="button" className="ld-btn2 sm" onClick={() => navigate('/lms/certificates')}>Rules &amp; templates →</button></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="ld-table">
            <thead><tr><th>Type</th><th>Issuer</th><th>Rule set</th><th>Status</th></tr></thead>
            <tbody>
              {data.catalogue.map((c) => (
                <tr key={c.type}>
                  <td><b>{c.type}</b></td>
                  <td>{c.issuer}</td>
                  <td>{c.rule}</td>
                  <td><span className={`ld-chip ${c.status === 'ACTIVE' ? 'hai' : c.status === 'EXTERNAL' ? 'naya' : 'gray'}`}>{c.status === 'EXTERNAL' ? 'Record + verify' : c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ld-card" style={{ flex: 1 }} aria-label="Approval queue">
        <div className="ld-hd"><b style={{ fontSize: 15 }}>Approval queue</b><span className="ld-muted" style={{ fontSize: 12 }}>System sirf checklist banata hai · issue staff karta hai</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="ld-table">
            <thead><tr><th>Learner</th><th>Certificate</th><th>Pre-issue check</th><th>Evidence</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.queue.length === 0 && <tr><td colSpan={6} className="ld-muted">Queue khaali hai.</td></tr>}
              {data.queue.map((q) => {
                const [cls, label] = issuedNow[q.email] ? ['hai', 'Issued'] : STATE[q.state] || ['gray', q.state];
                return (
                  <tr key={`${q.email}|${q.courseId}`}>
                    <td><b>{q.name}</b><br /><span className="ld-muted">{q.batch}</span></td>
                    <td>{q.course.replace(/^InternX-AI — /, '')}</td>
                    <td style={{ color: q.state === 'CORRECTION' ? '#9a3412' : undefined }}>{q.check}</td>
                    <td className="ld-muted">{q.evidence}{q.state === 'EVIDENCE_MISSING' && q.missing ? <><br /><span style={{ color: '#9a3412' }}>missing: {[].concat(q.missing).join(', ')}</span></> : ''}</td>
                    <td><span className={`ld-chip ${cls}`}>{label}</span></td>
                    <td>
                      {q.state === 'PENDING' && !issuedNow[q.email] && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="ld-btn sm" disabled={busy === q.email} onClick={() => issue(q)}>{busy === q.email ? 'Issuing…' : 'Approve & issue'}</button>
                          <button type="button" className="ld-btn2 sm" onClick={() => sendBack(q)}>Send back</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.issued.length > 0 && (
          <>
            <div className="ld-hd" style={{ marginTop: 6 }}><b style={{ fontSize: 14 }}>Recently issued</b></div>
            <table className="ld-table">
              <tbody>
                {data.issued.slice(0, 8).map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.student}</b></td>
                    <td>{c.certificateId}</td>
                    <td>{fmtDay(c.issuedOn)}</td>
                    <td><span className={`ld-chip ${c.status === 'Revoked' ? 'red' : 'hai'}`}>{c.status}</span></td>
                    <td>{c.status !== 'Revoked' && <button type="button" className="ld-btn2 sm" onClick={() => revoke(c)}>Revoke…</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Issue = unique ID + PDF + email · same learner + internship par dobara issue nahi hota · revoke par purana record audit mein rehta hai</div>
      </section>
    </SMPage>
  );
}
