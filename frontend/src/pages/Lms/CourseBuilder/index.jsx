import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Select, Button, Empty, Skeleton, Tag, message } from 'antd';
import { ReadOutlined, FolderOpenOutlined, CalendarOutlined, UsergroupAddOutlined } from '@ant-design/icons';
import defaultCourseThumbnail from '@/style/images/course-thumbnail.jpg';
import CurriculumViewer from '../components/CurriculumViewer';
import lmsApi from '../api';

const BATCH_STATUS_COLOR = {
  Planned: 'default',
  'Open for Enrollment': 'blue',
  Running: 'green',
  Completed: 'purple',
  Cancelled: 'red',
};

// "Mon,Wed,Fri" + "11:30"/"13:30" -> "Mon, Wed, Fri · 11:30 AM–1:30 PM"
function formatSchedule(batch) {
  const days = (batch.classDays || 'Mon–Fri').split(',').map((d) => d.trim()).filter(Boolean).join(', ');
  const fmt = (hhmm) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h)) return null;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  };
  const start = fmt(batch.classTime);
  const end = fmt(batch.endTime);
  const time = start && end ? `${start}–${end}` : start || '';
  return [days, time].filter(Boolean).join(' · ');
}

// Read-only curriculum browser for teachers — one course card (with live
// Module/Chapter/Lesson counts) plus a grid of the teacher's own assigned
// batches. Clicking either opens the same CurriculumViewer modal the CRM's
// LMS → Courses list uses, showing the full Module → Chapter → Lesson tree.
export default function CourseBuilder() {
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [curriculumOpen, setCurriculumOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await lmsApi.teacherDashboard();
        const result = (res && res.result) || {};
        const list = result.courses || [];
        setCourses(list);
        setBatches(result.batches || []);
        if (list[0]) setCourseId(list[0].id);
      } catch (e) {
        message.error('Could not load your courses.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Clicking a batch card switches Course Builder to that batch's course and
  // opens its curriculum — batches don't carry a courseId (Batch.course is a
  // plain title string, see backend/src/models/appModels/lms/Batch.js), so
  // match it against the teacher's own scoped course list from the same
  // dashboard response.
  const openBatch = (batch) => {
    const match = courses.find((c) => c.title === batch.course);
    if (match) {
      setCourseId(match.id);
      setCurriculumOpen(true);
    } else {
      message.warning(`"${batch.course}" isn't set up in Course Builder yet — ask an admin to publish it as a course.`);
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  const activeCourse = courses.find((c) => c.id === courseId) || null;
  const activeBatches = batches.filter((b) => b.course === (activeCourse && activeCourse.title));

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <h2><ReadOutlined /> Course Builder</h2>
          <p>Your assigned courses and batches — click one to view its full curriculum.</p>
        </div>
        <Select
          style={{ minWidth: 260 }}
          value={courseId}
          onChange={setCourseId}
          placeholder="Select a course"
          options={courses.map((c) => ({ value: c.id, label: `${c.title} · ${c.status}` }))}
          notFoundContent="No courses assigned to you"
        />
      </div>

      {/* Course Overview Card with thumbnail — click to view curriculum */}
      {activeCourse && (
        <Card
          className="lms-course-builder-card"
          bodyStyle={{ padding: 20 }}
          hoverable
          onClick={() => setCurriculumOpen(true)}
        >
          <Row gutter={[24, 20]} align="middle">
            <Col xs={24} md={9} lg={8}>
              <div className="lms-course-builder-thumb-wrap">
                <img
                  src={activeCourse.thumbnailUrl || defaultCourseThumbnail}
                  alt={activeCourse.title}
                  className="lms-course-builder-thumb"
                  onError={(e) => {
                    e.currentTarget.src = defaultCourseThumbnail;
                  }}
                />
              </div>
            </Col>
            <Col xs={24} md={15} lg={16}>
              <div className="lms-course-builder-info">
                <div>
                  {courses.length > 1 && (
                    <Select
                      size="small"
                      style={{ minWidth: 220, marginBottom: 10 }}
                      value={courseId}
                      onClick={(e) => e.stopPropagation()}
                      onChange={setCourseId}
                      options={courses.map((c) => ({ value: c.id, label: `${c.title} · ${c.status}` }))}
                    />
                  )}
                  <h3 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: 'var(--hub-text)', letterSpacing: '-0.02em' }}>
                    {activeCourse.title}
                  </h3>
                  <p style={{ margin: 0, color: 'var(--hub-muted)', fontSize: 13, lineHeight: 1.55 }}>
                    {activeCourse.description || 'Learn and Grow in your carrer'}
                  </p>
                </div>

                <Button
                  type="primary"
                  size="large"
                  icon={<FolderOpenOutlined />}
                  className="lms-cb-curriculum-btn"
                  onClick={(e) => { e.stopPropagation(); setCurriculumOpen(true); }}
                >
                  Click to view the full curriculum →
                </Button>
              </div>
            </Col>
          </Row>
        </Card>
      )}

      {!activeCourse && (
        <Card className="lms-course-builder-card">
          <Empty description={batches.length ? 'Pick a batch below to view its curriculum.' : 'No batches have been assigned to you yet.'} />
        </Card>
      )}

      {/* ===================== My Batches ===================== */}
      <div className="lms-cb-batches-head">
        <h3><CalendarOutlined /> My Batches</h3>
        <span className="lms-cb-batches-count">{batches.length} assigned</span>
      </div>

      {batches.length === 0 ? (
        <Card className="lms-course-builder-card">
          <Empty description="No batches assigned to you yet — ask an admin to set you as the trainer on a batch." />
        </Card>
      ) : (
        <Row gutter={[16, 16]} style={{ margin: '4px 0 20px' }}>
          {batches.map((b) => {
            const isActive = activeBatches.some((ab) => ab.id === b.id);
            const course = courses.find((c) => c.title === b.course);
            return (
              <Col xs={24} sm={12} lg={6} key={b.id}>
                <Card
                  hoverable
                  onClick={() => openBatch(b)}
                  className={`lms-cb-batch-card${isActive ? ' is-active' : ''}`}
                  bodyStyle={{ padding: 16 }}
                >
                  <img
                    src={(course && course.thumbnailUrl) || defaultCourseThumbnail}
                    alt={b.course}
                    className="lms-cb-batch-thumb"
                    onError={(e) => { e.currentTarget.src = defaultCourseThumbnail; }}
                  />
                  <Tag color={BATCH_STATUS_COLOR[b.status] || 'default'} style={{ marginTop: 10 }}>{b.status}</Tag>
                  <h4 className="lms-cb-batch-name">{b.name}</h4>
                  <p className="lms-cb-batch-course">{b.course}</p>
                  <div className="lms-cb-batch-meta">
                    <span><CalendarOutlined /> {formatSchedule(b) || 'Schedule not set'}</span>
                    <span><UsergroupAddOutlined /> {b.enrolled}{b.seats ? `/${b.seats}` : ''} enrolled</span>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <CurriculumViewer
        open={curriculumOpen}
        onClose={() => setCurriculumOpen(false)}
        courseId={activeCourse && activeCourse.id}
        courseTitle={activeCourse && activeCourse.title}
      />
    </div>
  );
}
