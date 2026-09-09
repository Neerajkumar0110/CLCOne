import React, { useCallback, useEffect, useState } from 'react';
import { Row, Col, Card, Progress, Button, Alert, Skeleton, Empty, Tag, Tooltip } from 'antd';
import {
  ReadOutlined,
  TrophyOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  ExportOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';

// Student portal — Phase 2 shell. Reads the CRM's LmsEnrolment projection
// (always available) enriched with live Moodle data (may be degraded). The
// course player, live classes, assignments and exams tabs land in later
// phases; this screen is My Learning + Continue Learning + account state.

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return '—';
  }
}

function StatCard({ icon, label, value }) {
  return (
    <Card size="small" className="lms-stat">
      <div className="lms-stat-icon">{icon}</div>
      <div>
        <div className="lms-stat-value">{value}</div>
        <div className="lms-stat-label">{label}</div>
      </div>
    </Card>
  );
}

export default function StudentPortal() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [me, setMe] = useState(null);
  const [courses, setCourses] = useState([]);
  const [coursesDegraded, setCoursesDegraded] = useState(false);
  const [openingMoodle, setOpeningMoodle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, meRes, coursesRes] = await Promise.all([
        lmsApi.portalConfig(),
        lmsApi.me(),
        lmsApi.myCourses(),
      ]);
      setCfg(cfgRes && cfgRes.result);
      setMe(meRes && meRes.result);
      setCourses((coursesRes && coursesRes.result && coursesRes.result.courses) || []);
      setCoursesDegraded(!!(coursesRes && coursesRes.result && coursesRes.result.degraded));
    } catch (e) {
      setError('Could not load your learning dashboard. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openInMoodle = async (wantsurl) => {
    setOpeningMoodle(true);
    try {
      const res = await lmsApi.ssoLoginUrl(wantsurl);
      const url = res && res.result && res.result.url;
      if (url) window.open(url, '_blank', 'noopener');
    } catch (e) {
      /* the button just no-ops if SSO isn't configured */
    } finally {
      setOpeningMoodle(false);
    }
  };

  if (loading) {
    return (
      <div className="lms-portal">
        <Skeleton active paragraph={{ rows: 2 }} />
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          {[0, 1, 2].map((i) => (
            <Col xs={24} sm={8} key={i}>
              <Card size="small">
                <Skeleton active paragraph={{ rows: 1 }} />
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    );
  }

  const notConfigured = cfg && !cfg.configured;
  const provisioning = me && me.moodle && me.moodle.provisioning;
  const name = (me && me.user && me.user.name) || 'there';
  const counts = (me && me.counts) || {};

  return (
    <div className="lms-portal">
      <div className="lms-portal-head">
        <div>
          <h2>Welcome back, {name.split(' ')[0]}</h2>
          <p>Your courses, progress and upcoming sessions in one place.</p>
        </div>
        <div className="lms-portal-actions">
          <Button icon={<ReloadOutlined />} onClick={load}>
            Refresh
          </Button>
          {cfg && cfg.ssoEnabled && (
            <Button type="primary" icon={<ExportOutlined />} loading={openingMoodle} onClick={() => openInMoodle('/my/')}>
              Open in Moodle
            </Button>
          )}
        </div>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      {notConfigured && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="The learning platform is not connected yet"
          description="Once Moodle is wired up (see the LMS Build Blueprint, Phase 0–1) your courses and live classes will appear here automatically."
        />
      )}

      {!notConfigured && provisioning && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Setting up your learning account"
          description="We're creating your Moodle profile. This usually takes under a minute — refresh shortly."
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <StatCard icon={<ReadOutlined />} label="Active courses" value={counts.activeCourses ?? 0} />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard icon={<CheckCircleOutlined />} label="Completed" value={counts.completedCourses ?? 0} />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard icon={<TrophyOutlined />} label="Certificates" value={counts.certificates ?? 0} />
        </Col>
      </Row>

      <div className="lms-section-title">
        <h3>Continue learning</h3>
        {coursesDegraded && (
          <Tooltip title="Live course data from Moodle is temporarily unavailable — showing the last known state.">
            <Tag color="orange">offline data</Tag>
          </Tooltip>
        )}
      </div>

      {courses.length === 0 ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              notConfigured
                ? 'No courses yet — they will show up once enrolments sync.'
                : "You're not enrolled in any courses yet."
            }
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {courses.map((c) => (
            <Col xs={24} sm={12} lg={8} key={c.enrolmentId || c.moodleCourseId}>
              <Card
                size="small"
                className="lms-course-card"
                cover={
                  c.thumbnailUrl ? (
                    <div className="lms-course-thumb" style={{ backgroundImage: `url(${c.thumbnailUrl})` }} />
                  ) : (
                    <div className="lms-course-thumb lms-course-thumb--blank">
                      <ReadOutlined />
                    </div>
                  )
                }
                actions={[
                  <Button
                    key="resume"
                    type="link"
                    icon={<PlayCircleOutlined />}
                    onClick={() => openInMoodle(`/course/view.php?id=${c.moodleCourseId}`)}
                  >
                    {c.progressPct > 0 ? 'Resume' : 'Start'}
                  </Button>,
                ]}
              >
                <div className="lms-course-title">{c.title}</div>
                <Progress
                  percent={Math.round(c.progressPct || 0)}
                  size="small"
                  status={c.completedOn ? 'success' : 'active'}
                />
                <div className="lms-course-meta">
                  <span>{c.completedOn ? `Completed ${fmtDate(c.completedOn)}` : `Last activity ${fmtDate(c.lastActivityAt)}`}</span>
                  {c.source === 'batch' && <Tag>batch</Tag>}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <div className="lms-portal-foot">
        Live classes, assignments, quizzes and exams arrive in later phases of the LMS build.
      </div>
    </div>
  );
}
