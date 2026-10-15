import React, { useEffect, useState } from 'react';
import { Image } from 'antd';
import HubModal from '@/components/HubModal';
import { request } from '@/request';
import { BASE_URL } from '@/config/serverApiConfig';
import '@/pages/Leads/TeamActivity.css';

// LMS → Candidates → click a row. Everything about one candidate from
// GET /api/lms/students/:id/detail: joining timeline, KYC (with the
// uploaded documents), fee plan + installments, the batch and when they got
// it (plus every batch change), attendance, certificates, status changes and
// their login account.

const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);
function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
}
function fmtDateTime(v) {
  return v
    ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : '—';
}
function fmtTime(v) {
  return v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
}
const TONE_BADGE = { green: 'hub-badge-green', red: 'hub-badge-red', yellow: 'hub-badge-yellow', gray: 'hub-badge-gray' };
function daysAgo(v) {
  if (!v) return '';
  const d = Math.floor((Date.now() - new Date(v).getTime()) / 86400000);
  return d <= 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`;
}
const PAY_BADGE = { paid: 'hub-badge-green', created: 'hub-badge-yellow', expired: 'hub-badge-gray', cancelled: 'hub-badge-gray', failed: 'hub-badge-red' };
const PAY_LABEL = { paid: 'Paid', created: 'Pending', expired: 'Expired', cancelled: 'Cancelled', failed: 'Failed' };

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="ta-kpi" style={{ '--ta-accent': accent }}>
      <div className="ta-kpi-label">{label}</div>
      <div className="ta-kpi-value" style={{ fontSize: 18 }}>{value}</div>
      {sub && <div className="ta-kpi-sub">{sub}</div>}
    </div>
  );
}

function Section({ title, children, right }) {
  return (
    <div style={{ border: '1px solid var(--hub-border)', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div className="ta-section-title">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Facts({ rows }) {
  return (
    <dl className="ta-facts">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v == null || v === '' ? '—' : v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Doc({ label, path }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ width: 120, height: 84, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--hub-border)', display: 'grid', placeItems: 'center', background: 'var(--hub-surface-2, #f8fafc)' }}>
        {path ? (
          <Image src={`${BASE_URL}${path}`} width={120} height={84} style={{ objectFit: 'cover' }} />
        ) : (
          <span className="ta-sub">Not uploaded</span>
        )}
      </div>
      <div className="ta-sub" style={{ marginTop: 4 }}>{label}</div>
    </div>
  );
}

// Pass studentId (roster row) or email (e.g. from User Management, which
// only knows the login account).
export default function CandidateDetailModal({ open, studentId, email, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || (!studentId && !email)) return;
    setD(null);
    setError(null);
    const entity = studentId
      ? `lms/students/${studentId}/detail`
      : `lms/students/detail-by-email?email=${encodeURIComponent(email)}`;
    request.get({ entity }).then((r) => {
      if (r?.success) setD(r.result);
      else setError(r?.message || 'Could not load this candidate.');
    });
  }, [open, studentId, email]);

  const s = d?.student;
  const ps = d?.paymentSummary;
  const kyc = d?.kyc;

  return (
    <HubModal open={open} onClose={onClose} title="Candidate details" width={1040}>
      {!d && !error && <div className="hub-empty">Loading…</div>}
      {error && <div className="hub-empty">{error}</div>}
      {d && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div className="ta-avatar" style={{ width: 56, height: 56, fontSize: 19, background: '#2563eb' }}>
              {String(s.name || '?').split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="ta-name" style={{ fontSize: 18 }}>{s.name}</div>
              <div className="ta-sub" style={{ fontSize: 12.5 }}>
                {s.email}{s.phone ? ` · ${s.phone}` : ''}{s.enrollmentId ? ` · ID ${s.enrollmentId}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                <span className="hub-badge hub-badge-blue">{s.course || 'No internship'}</span>
                <span className={`hub-badge ${s.status === 'Active' ? 'hub-badge-green' : 'hub-badge-gray'}`}>{s.status}</span>
                <span className={`hub-badge ${s.feeStatus === 'Paid' ? 'hub-badge-green' : s.feeStatus === 'Partial' ? 'hub-badge-yellow' : 'hub-badge-gray'}`}>
                  Fee: {s.feeStatus}
                </span>
                <span className={`hub-badge ${kyc ? 'hub-badge-green' : 'hub-badge-yellow'}`}>{kyc ? 'KYC done' : 'KYC pending'}</span>
                {d.account?.financeHold && <span className="hub-badge hub-badge-red">Finance hold</span>}
                {d.account?.rosterHold && <span className="hub-badge hub-badge-red">Access on hold</span>}
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="ta-kpis" style={{ marginBottom: 0 }}>
            <Kpi label="Joined" value={fmtDate(d.joining.enrolledOn || d.joining.recordCreated)} sub={daysAgo(d.joining.enrolledOn || d.joining.recordCreated)} accent="#2563eb" />
            <Kpi
              label="Batch given"
              value={d.batchAssigned ? fmtDate(d.batchAssigned.at) : 'Not assigned'}
              sub={d.batchAssigned ? `${s.batch}${d.batchAssigned.approx ? ' · approx.' : ''}` : 'no batch yet'}
              accent="#7c3aed"
            />
            <Kpi
              label="Fees paid"
              value={inr(ps.paidTotal || s.feePaid)}
              sub={`of ${inr(ps.planTotal || s.feeGrandTotal)}${ps.installmentCount ? ` · ${ps.paidCount}/${ps.installmentCount} installments` : ''}`}
              accent="#16a34a"
            />
            <Kpi label="Attendance" value={d.attendance.pct == null ? '—' : `${d.attendance.pct}%`} sub={`${d.attendance.total} class(es) marked`} accent="#ea580c" />
            <Kpi label="Progress" value={`${s.progress || 0}%`} sub={`avg score ${s.avgScore || 0}`} accent="#0891b2" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
            <Section title="Joining">
              <Facts
                rows={[
                  ['Enrolled on', fmtDateTime(d.joining.enrolledOn)],
                  ['First payment', fmtDateTime(d.joining.firstPaymentAt)],
                  ['KYC submitted', fmtDateTime(d.joining.kycSubmittedAt)],
                  ['Login created', fmtDateTime(d.joining.accountCreated)],
                  ['Record added', fmtDateTime(d.joining.recordCreated)],
                  ['Source', s.source],
                  ['Counselor', s.counselor],
                  ['City', s.city],
                  ['Alt. phone', s.altPhone],
                  ['Guardian', [s.guardianName, s.guardianPhone].filter(Boolean).join(' · ')],
                ]}
              />
            </Section>

            <Section title="Batch">
              {d.batch ? (
                <Facts
                  rows={[
                    ['Batch', d.batch.name],
                    [
                      'Batch given on',
                      d.batchAssigned ? (
                        <span>
                          {fmtDateTime(d.batchAssigned.at)}
                          {d.batchAssigned.approx && (
                            <span className="ta-sub" style={{ display: 'block' }}>approx. — {d.batchAssigned.basis}</span>
                          )}
                        </span>
                      ) : null,
                    ],
                    ['Status', d.batch.status],
                    ['Trainer', Array.isArray(d.batch.trainer) ? d.batch.trainer.join(', ') : d.batch.trainer],
                    ['Coordinator', d.batch.coordinator],
                    ['Starts / ends', `${fmtDate(d.batch.startDate)} → ${fmtDate(d.batch.endDate)}`],
                    ['Class time', [d.batch.classDays, d.batch.classTime && `${d.batch.classTime}${d.batch.endTime ? `–${d.batch.endTime}` : ''}`].filter(Boolean).join(' · ') || d.batch.schedule],
                    ['Mode', d.batch.mode],
                    ['Seats', d.batch.seats ? `${d.batch.enrolled}/${d.batch.seats}` : d.batch.enrolled],
                  ]}
                />
              ) : (
                <div className="ta-sub">{s.batch ? `Batch "${s.batch}" not found.` : 'No batch assigned yet.'}</div>
              )}
              {d.batchHistory.length > 0 && (
                <>
                  <div className="ta-section-title" style={{ marginTop: 12 }}>Batch changes</div>
                  <table className="ta-week">
                    <tbody>
                      {[...d.batchHistory].reverse().map((h, i) => (
                        <tr key={i}>
                          <td>{fmtDateTime(h.at)}</td>
                          <td style={{ textAlign: 'left' }}>
                            {h.from || '—'} → <b>{h.to || 'removed'}</b>
                            {h.by ? <span className="ta-sub"> · by {h.by}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Section>
          </div>

          <Section title="KYC" right={kyc && <span className="ta-sub">submitted {fmtDateTime(kyc.created)}</span>}>
            {kyc ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                <Facts
                  rows={[
                    ['Name', kyc.name],
                    ["Father's name", kyc.fatherName],
                    ["Mother's name", kyc.motherName],
                    ['Address', kyc.address],
                    ['City / district', [kyc.city, kyc.district].filter(Boolean).join(', ')],
                    ['State', kyc.state],
                    ['Pincode', kyc.pincode],
                  ]}
                />
                <Image.PreviewGroup>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <Doc label="Aadhar — front" path={kyc.aadharFront} />
                    <Doc label="Aadhar — back" path={kyc.aadharBack} />
                    <Doc label="PAN — front" path={kyc.panFront} />
                    <Doc label="PAN — back" path={kyc.panBack} />
                  </div>
                </Image.PreviewGroup>
              </div>
            ) : (
              <div className="ta-sub">No KYC submitted — it's filled by the candidate after paying through a payment link.</div>
            )}
          </Section>

          <Section title="Fees & installments">
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10, fontSize: 12.5 }}>
              <span>Course fee: <b>{inr(s.feeTotal)}</b></span>
              <span>With GST: <b>{inr(s.feeGrandTotal)}</b></span>
              <span>Paid: <b style={{ color: '#16a34a' }}>{inr(s.feePaid)}</b></span>
              <span>Due: <b style={{ color: s.feeDue ? '#dc2626' : undefined }}>{inr(s.feeDue)}</b></span>
            </div>
            {d.payments.length ? (
              <table className="ta-week">
                <thead>
                  <tr><th>Installment</th><th>Amount</th><th>Status</th><th>Sent</th><th>Paid on</th><th>Next due</th><th>Payment ID</th></tr>
                </thead>
                <tbody>
                  {d.payments.map((p) => (
                    <tr key={p._id}>
                      <td>{p.installmentNo}/{p.installmentCount}</td>
                      <td>{inr(p.amount)}</td>
                      <td><span className={`hub-badge ${PAY_BADGE[p.status] || 'hub-badge-gray'}`}>{PAY_LABEL[p.status] || p.status}</span></td>
                      <td>{fmtDate(p.created)}</td>
                      <td>{fmtDateTime(p.paidAt)}</td>
                      <td>{fmtDate(p.nextInstallmentDueAt || p.dueAt)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{p.razorpayPaymentId || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="ta-sub">No payment links sent to this email.</div>
            )}
          </Section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
            <Section title="Attendance">
              {d.attendance.total ? (
                <>
                  <div className="ta-chips" style={{ marginBottom: 10 }}>
                    {Object.entries(d.attendance.byStatus).map(([k, n]) => (
                      <span key={k} className="ta-chip">
                        <i style={{ background: k === 'Present' ? '#16a34a' : k === 'Absent' ? '#dc2626' : '#d97706' }} />
                        {k} <b>{n}</b>
                      </span>
                    ))}
                  </div>
                  <Facts
                    rows={[
                      ['First class', fmtDate(d.attendance.first)],
                      ['Last class', fmtDate(d.attendance.last)],
                      ['Time in class', `${Math.floor(d.attendance.minutes / 60)}h ${d.attendance.minutes % 60}m`],
                    ]}
                  />
                </>
              ) : (
                <div className="ta-sub">No attendance marked yet.</div>
              )}
            </Section>

            <Section title="Login account">
              {d.account ? (
                <Facts
                  rows={[
                    ['Created', fmtDateTime(d.account.created)],
                    ['Last login', fmtDateTime(d.account.lastLoginAt)],
                    ['Last seen', fmtDateTime(d.account.lastSeenAt)],
                    ['Can log in', d.account.enabled ? 'Yes' : 'No'],
                    ['Finance hold', d.account.financeHold ? `Yes, since ${fmtDate(d.account.financeHoldAt)}` : 'No'],
                    ['Access hold', d.account.rosterHold ? d.account.rosterHoldReason || 'Yes' : 'No'],
                  ]}
                />
              ) : (
                <div className="ta-sub">No CRM login found for this email.</div>
              )}
            </Section>

            <Section title="Certificates & history">
              {d.certificates.length === 0 && d.statusChanges.length === 0 && <div className="ta-sub">Nothing yet.</div>}
              {d.certificates.map((c) => (
                <div key={c._id} style={{ fontSize: 12.5, marginBottom: 6 }}>
                  🎓 <b>{c.title || c.type}</b> {c.certificateId ? `· ${c.certificateId}` : ''} · {fmtDate(c.issuedOn)}
                </div>
              ))}
              {d.statusChanges.map((c, i) => (
                <div key={i} style={{ fontSize: 12.5, marginBottom: 6 }}>
                  {fmtDateTime(c.at)} — status {c.from} → <b>{c.to}</b>{c.by ? <span className="ta-sub"> · by {c.by}</span> : null}
                </div>
              ))}
            </Section>
          </div>

          <Section
            title="Live classes — join log"
            right={<span className="ta-sub">last {d.liveClasses?.length || 0} classes</span>}
          >
            {d.liveClasses?.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="ta-week" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th style={{ textAlign: 'left' }}>What happened</th>
                      <th>Join clicked</th>
                      <th>Inside BBB</th>
                      <th>Time</th>
                      <th>Attendance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.liveClasses.map((c) => (
                      <tr key={c._id}>
                        <td style={{ textAlign: 'left', verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 700 }}>{c.title}</div>
                          <div className="ta-sub">
                            {fmtDateTime(c.scheduledStart)}
                            {c.actualStart ? ` · ran ${fmtTime(c.actualStart)}–${c.actualEnd ? fmtTime(c.actualEnd) : 'now'}` : ''}
                          </div>
                        </td>
                        <td style={{ textAlign: 'left', verticalAlign: 'top', maxWidth: 320 }}>
                          <span className={`hub-badge ${TONE_BADGE[c.tone] || 'hub-badge-gray'}`} style={{ whiteSpace: 'normal', textAlign: 'left' }}>
                            {c.verdict}
                          </span>
                          {c.attempts.filter((a) => !a.ok).map((a, i) => (
                            <div key={i} className="ta-sub" style={{ color: '#dc2626', marginTop: 4 }}>
                              {fmtTime(a.at)} — {a.error}
                            </div>
                          ))}
                          {c.attempts.length > 0 && (
                            <div className="ta-sub" style={{ marginTop: 4 }} title={c.attempts.map((a) => a.userAgent).filter(Boolean)[0] || ''}>
                              {c.attempts.length} join step(s) logged{c.sentToBbbAt ? ` · sent to BBB ${fmtTime(c.sentToBbbAt)}` : ''}
                            </div>
                          )}
                        </td>
                        <td style={{ verticalAlign: 'top' }}>{c.firstJoinClickAt ? fmtTime(c.firstJoinClickAt) : '—'}</td>
                        <td style={{ verticalAlign: 'top' }}>
                          {c.bbbFirstSeenAt ? `${fmtTime(c.bbbFirstSeenAt)}–${fmtTime(c.bbbLastSeenAt)}` : c.tracked ? 'No' : <span className="ta-sub">not tracked</span>}
                        </td>
                        <td style={{ verticalAlign: 'top' }}>{c.durationMin ? `${c.durationMin}m` : '—'}</td>
                        <td style={{ verticalAlign: 'top' }}>
                          <span className={`hub-badge ${c.attendanceStatus === 'PRESENT' ? 'hub-badge-green' : c.attendanceStatus === 'ABSENT' ? 'hub-badge-red' : 'hub-badge-yellow'}`}>
                            {c.attendanceStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ta-sub">No classes have started for this candidate's batch yet.</div>
            )}
          </Section>

          {s.notes && (
            <Section title="Notes">
              <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{s.notes}</div>
            </Section>
          )}
        </div>
      )}
    </HubModal>
  );
}
