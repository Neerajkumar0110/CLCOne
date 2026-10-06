import React, { useEffect, useState } from 'react';
import { Skeleton, Alert, Empty } from 'antd';
import {
  TrophyOutlined,
  CheckSquareOutlined,
  FileTextOutlined,
  ExperimentOutlined,
  ProjectOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  BellOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import lmsApi from '../api';
import './MyOverview.css';

// Spec §3 "Learner Portal — every learner should have a single dashboard
// showing their complete academic and placement-readiness record, with an
// 'Overall Eligibility/Progress' card at top." Every number here already
// existed on its own page (Attendance, Results, Quizzes, Projects, Policies,
// Certificates) — this is the missing "home" view that puts them together,
// backed by GET /api/lms/my/overview (learnerOverview.js).

function StatCard({ icon, title, value, tone }) {
  return (
    <div className="ov-stat-card">
      <div className={`ov-stat-icon ${tone}`}>{icon}</div>
      <div className="ov-stat-content">
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function StatusBadge({ passed, applicable }) {
  if (!applicable) return <span className="ov-status-badge neutral">N/A</span>;
  if (passed) {
    return (
      <span className="ov-status-badge success">
        <CheckSquareOutlined />
        Passed
      </span>
    );
  }
  return (
    <span className="ov-status-badge danger">
      <SolutionOutlined />
      Not met
    </span>
  );
}

export default function LearnerOverview() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);
  const navigate = useNavigate();
  const admin = useSelector(selectCurrentAdmin) || {};

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await lmsApi.myOverview();
        if (alive) setD((res && res.result) || null);
      } catch (e) {
        if (alive) setErr('Could not load your overview.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
  if (err) return <Alert type="error" showIcon message={err} style={{ margin: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 80 }} description="Nothing to show yet." />;

  const elig = d.eligibility;
  const attendance = d.attendance && d.attendance.summary;
  const assessments = d.assessments || {};
  const assessmentResults = assessments.results || [];
  const qualifiedCount = assessmentResults.filter((r) => r.qualified === true).length;
  const quizzes = Array.isArray(d.quizzes) ? d.quizzes : d.quizzes?.result || [];
  const quizzesCompleted = quizzes.filter((q) => q.attemptsUsed > 0).length;
  const projects = Array.isArray(d.projects) ? d.projects : d.projects?.result || [];
  const projectsApproved = projects.filter((p) => p.status === 'approved').length;
  const policies = Array.isArray(d.policies) ? d.policies : d.policies?.result || [];
  const policiesPending = policies.filter((p) => p.status !== 'acknowledged').length;
  const certificates = Array.isArray(d.certificates) ? d.certificates : d.certificates?.result || [];
  const notifications = d.notifications || {};
  const pendingPolicies = policies.filter((p) => p.status !== 'acknowledged').slice(0, 6);
  const firstName = (admin.name || 'there').split(' ')[0];

  return (
    <div className="ov-root">
      {/* ================= WELCOME ================= */}
      <section className="ov-welcome-banner">
        <div className="ov-welcome-content">
          <span className="ov-welcome-small">👋 Welcome Back,</span>
          <h1>
            {admin.name} {admin.surname || ''}
          </h1>
          <p>Your complete academic and placement-readiness record, in one place.</p>
        </div>
        <div className="ov-welcome-art">
          <div className="art-laptop">💻</div>
          <div className="art-books">📚</div>
          <div className="art-plant">🌿</div>
        </div>
      </section>

      {/* ================= STATS ================= */}
      <section className="ov-stats-grid">
        <StatCard icon={<CheckSquareOutlined />} title="Attendance" value={attendance ? `${attendance.attendancePct}%` : '—'} tone="blue" />
        <StatCard icon={<FileTextOutlined />} title="Assessments qualified" value={`${qualifiedCount} / ${assessmentResults.length}`} tone="purple" />
        <StatCard icon={<ExperimentOutlined />} title="Quizzes completed" value={`${quizzesCompleted} / ${quizzes.length}`} tone="green" />
        <StatCard icon={<ProjectOutlined />} title="Projects approved" value={`${projectsApproved} / ${projects.length}`} tone="orange" />
        <StatCard icon={<SolutionOutlined />} title="Policies pending" value={policiesPending} tone="red" />
        <StatCard icon={<SafetyCertificateOutlined />} title="Certificates" value={certificates.length} tone="cyan" />
        <StatCard icon={<BellOutlined />} title="Unread notifications" value={notifications.unread || 0} tone="violet" />
      </section>

      {/* ================= ELIGIBILITY ================= */}
      <section className="ov-eligibility-layout">
        <div className="ov-eligibility-card">
          <div className="ov-section-heading">
            <div>
              <h2>Overall Eligibility</h2>
              <span>{elig ? elig.course?.title || '' : 'No active course'}</span>
            </div>
            {elig && elig.course?.title && <span className="ov-plan-badge">{elig.course.title}</span>}
          </div>

          {!elig ? (
            <Empty style={{ padding: 40 }} description="No eligibility rule configured for your course yet." />
          ) : (
            <div className="ov-eligibility-body">
              <div className="ov-score-container">
                <div className="ov-progress-ring" style={{ '--progress': `${elig.score * 3.6}deg` }}>
                  <div className="ov-progress-inner">
                    <strong>{elig.score}%</strong>
                    <span>Eligible</span>
                  </div>
                </div>
              </div>

              <div className="ov-eligibility-details">
                <div className="ov-score-line">
                  <span className={`ov-action-badge ${elig.eligible ? 'ok' : ''}`}>{elig.state}</span>
                  <strong>Score {elig.score}%</strong>
                  <span>Required {elig.threshold}%</span>
                </div>

                {elig.missing && elig.missing.length > 0 && (
                  <div className="ov-warning-box">
                    <div className="ov-warning-icon">!</div>
                    <div>
                      <strong>Still needed to become eligible</strong>
                      {elig.missing.map((m) => (
                        <div className="ov-warning-item" key={m}>
                          {m}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* PROGRESS CTA */}
        <div className="ov-progress-card">
          <div>
            <span className="ov-progress-label">YOUR PROGRESS</span>
            <h2>Your Progress Matters</h2>
            <p>Complete your modules, assessments and assignments to become eligible for the next phase.</p>
            <button type="button" className="ov-primary-button" onClick={() => navigate('/learn/curriculum')}>
              View Curriculum
              <ArrowRightOutlined />
            </button>
          </div>
          <div className="ov-target-illustration">
            <TrophyOutlined style={{ fontSize: 90 }} />
          </div>
        </div>
      </section>

      {/* ================= CRITERIA TABLE ================= */}
      {elig && (
        <section className="ov-criteria-card">
          <div className="ov-criteria-header">
            <div>
              <h2>Eligibility Criteria Details</h2>
              <p>Your current performance against program requirements</p>
            </div>
            <button type="button" className="ov-view-button" onClick={() => navigate('/learn/eligibility')}>
              View Details
              <ArrowRightOutlined />
            </button>
          </div>

          <div className="ov-table-wrapper">
            <table className="ov-table">
              <thead>
                <tr>
                  <th>CRITERION</th>
                  <th>MANDATORY</th>
                  <th>REQUIRED %</th>
                  <th>ACHIEVED %</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {(elig.items || []).map((item) => (
                  <tr key={item.key}>
                    <td>
                      <strong>{item.label}</strong>
                    </td>
                    <td>
                      <span className={item.mandatory ? 'ov-mandatory-badge' : 'ov-optional-badge'}>
                        {item.mandatory ? 'Mandatory' : 'Optional'}
                      </span>
                    </td>
                    <td>{item.required}</td>
                    <td>
                      <div className="ov-achieved-value">
                        <strong>{item.achieved}</strong>
                        <div className="ov-mini-progress">
                          <span style={{ width: `${Math.min(item.achieved, 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusBadge passed={item.passed} applicable={item.applicable} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ov-tip-box">
            <div className="ov-tip-icon">💡</div>
            <div className="ov-tip-box-text">
              <strong>{elig.eligible ? 'Great work — you’re eligible!' : 'Keep up the good work!'}</strong>
              <span>
                {elig.eligible
                  ? `You've met the eligibility bar at ${elig.score}%.`
                  : `You're currently ${elig.score}% eligible. Focus on the items above to unlock the next stage.`}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ================= SECONDARY INFO ================= */}
      <section className="ov-two-up">
        <div className="ov-criteria-card">
          <div className="ov-criteria-header">
            <div>
              <h2>Attendance summary</h2>
            </div>
            <button type="button" className="ov-view-button" onClick={() => navigate('/learn/attendance')}>
              View details
              <ArrowRightOutlined />
            </button>
          </div>
          {!attendance ? (
            <div className="ov-empty-note">No attendance yet</div>
          ) : (
            <div className="ov-simple-list">
              <div className="ov-simple-list-item">
                <span>Present</span>
                <strong>{attendance.present}</strong>
              </div>
              <div className="ov-simple-list-item">
                <span>Late</span>
                <strong>{attendance.late}</strong>
              </div>
              <div className="ov-simple-list-item">
                <span>Partial</span>
                <strong>{attendance.partial}</strong>
              </div>
              <div className="ov-simple-list-item">
                <span>Absent</span>
                <strong>{attendance.absent}</strong>
              </div>
              <div className="ov-simple-list-item">
                <span>Excused</span>
                <strong>{attendance.excused}</strong>
              </div>
            </div>
          )}
        </div>

        <div className="ov-criteria-card">
          <div className="ov-criteria-header">
            <div>
              <h2>Recent notifications</h2>
            </div>
            <button type="button" className="ov-view-button" onClick={() => navigate('/learn/notifications')}>
              View all
              <ArrowRightOutlined />
            </button>
          </div>
          {(notifications.recent || []).length === 0 ? (
            <div className="ov-empty-note">No notifications</div>
          ) : (
            <div className="ov-simple-list">
              {(notifications.recent || []).slice(0, 6).map((n) => (
                <div className={`ov-simple-list-item ${!n.read ? 'unread' : ''}`} key={n.id}>
                  <strong>{n.title}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="ov-two-up">
        <div className="ov-criteria-card">
          <div className="ov-criteria-header">
            <div>
              <h2>Projects</h2>
            </div>
            <button type="button" className="ov-view-button" onClick={() => navigate('/learn/projects')}>
              View details
              <ArrowRightOutlined />
            </button>
          </div>
          {projects.length === 0 ? (
            <div className="ov-empty-note">No project assigned yet</div>
          ) : (
            <div className="ov-table-wrapper">
              <table className="ov-table">
                <thead>
                  <tr>
                    <th>TITLE</th>
                    <th>MENTOR</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p._id || p.title}>
                      <td>{p.title}</td>
                      <td>{p.mentorName || '—'}</td>
                      <td>
                        <span className="ov-plain-badge">{p.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="ov-criteria-card">
          <div className="ov-criteria-header">
            <div>
              <h2>Policies</h2>
            </div>
            <button type="button" className="ov-view-button" onClick={() => navigate('/learn/policies')}>
              View details
              <ArrowRightOutlined />
            </button>
          </div>
          {pendingPolicies.length === 0 ? (
            <div className="ov-empty-note">Nothing pending — all acknowledged</div>
          ) : (
            <div className="ov-table-wrapper">
              <table className="ov-table">
                <thead>
                  <tr>
                    <th>POLICY</th>
                    <th>MANDATORY</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPolicies.map((p) => (
                    <tr key={p._id || p.title}>
                      <td>{p.title}</td>
                      <td>
                        <span className={p.mandatory ? 'ov-mandatory-badge' : 'ov-optional-badge'}>
                          {p.mandatory ? 'Mandatory' : 'Optional'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
