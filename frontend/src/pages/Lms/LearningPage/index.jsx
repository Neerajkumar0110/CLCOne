import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Row, Col, Card, Button, List, Progress, Tag, Empty, Skeleton, Space, message, Typography, Collapse,
} from 'antd';
import {
  PlayCircleOutlined, CheckCircleTwoTone, CheckCircleOutlined, ArrowLeftOutlined, ArrowRightOutlined,
  FileTextOutlined, LinkOutlined, FilePdfOutlined, VideoCameraOutlined, BookOutlined, QuestionCircleOutlined,
  FolderOpenOutlined, ClockCircleOutlined, DownOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import CurriculumViewer from '../components/CurriculumViewer';

const { Text } = Typography;

const ytEmbed = (id) => `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
const vimeoEmbed = (id) => `https://player.vimeo.com/video/${id}`;

function LessonPlayer({ lesson, onProgress, onComplete }) {
  const videoRef = useRef(null);
  const watched = useRef(0);
  const tick = useRef(null);

  // coarse "time on lesson" counter — flushed by the parent every 15s
  useEffect(() => {
    watched.current = 0;
    tick.current = setInterval(() => {
      watched.current += 1;
      onProgress({ watchedSeconds: watched.current });
    }, 1000);
    return () => clearInterval(tick.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  if (!lesson) return null;
  const t = lesson.type;

  if (t === 'video' && lesson.videoId && lesson.videoSource !== 'vimeo')
    return <iframe title={lesson.title} src={ytEmbed(lesson.videoId)} style={frame} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />;
  if ((t === 'video' && lesson.videoSource === 'vimeo') || (t === 'video' && /vimeo/.test(lesson.videoUrl || '')))
    return <iframe title={lesson.title} src={vimeoEmbed(lesson.videoId)} style={frame} allow="autoplay; fullscreen" allowFullScreen />;
  if (t === 'video' && lesson.videoUrl)
    return (
      <video
        ref={videoRef}
        src={lesson.videoUrl}
        controls
        style={{ ...frame, background: '#000' }}
        onTimeUpdate={(e) => {
          const v = e.target;
          if (v.duration) onProgress({ positionSec: v.currentTime, durationSec: v.duration, percent: (v.currentTime / v.duration) * 100 });
        }}
        onEnded={() => onComplete()}
      />
    );
  if (t === 'recorded' && lesson.media && lesson.media.url)
    return <iframe title={lesson.title} src={lesson.media.url} style={frame} allowFullScreen />;
  if (t === 'text')
    return (
      <div className="lms-lesson-html" dangerouslySetInnerHTML={{ __html: lesson.content || '<p><i>No content.</i></p>' }} />
    );
  if (['pdf', 'document'].includes(t) && lesson.fileUrl)
    return <iframe title={lesson.title} src={lesson.fileUrl} style={{ ...frame, height: 640 }} />;
  if (t === 'link' && lesson.externalUrl)
    return (
      <Space direction="vertical">
        <Text>This lesson links to an external resource.</Text>
        <Button type="primary" icon={<LinkOutlined />} href={lesson.externalUrl} target="_blank" rel="noopener">
          Open resource
        </Button>
      </Space>
    );
  if (['quiz', 'assignment'].includes(t))
    return <Empty description={`${t} lessons open in the next update`} />;
  return <Empty description="Nothing to show for this lesson yet." />;
}

// Frame-based types (video/iframe) get the dark letterboxed wrapper; every
// other type (text/link/quiz/…) gets a plain padded area — mixing the two
// caused a visible dark seam where an inner Card's own border collided with
// the outer letterbox background.
const FRAME_TYPES = new Set(['video', 'recorded', 'pdf', 'document']);

const TYPE_META = {
  video: { icon: <VideoCameraOutlined />, label: 'Video' },
  recorded: { icon: <VideoCameraOutlined />, label: 'Recorded class' },
  text: { icon: <FileTextOutlined />, label: 'Reading' },
  pdf: { icon: <FilePdfOutlined />, label: 'PDF' },
  document: { icon: <FileTextOutlined />, label: 'Document' },
  link: { icon: <LinkOutlined />, label: 'Resource' },
  quiz: { icon: <QuestionCircleOutlined />, label: 'Quiz' },
  assignment: { icon: <QuestionCircleOutlined />, label: 'Assignment' },
};

const frame = { width: '100%', aspectRatio: '16 / 9', border: 0, borderRadius: 0, display: 'block' };

export default function LearningPage() {
  const [view, setView] = useState('list'); // list | course
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  // "View curriculum" modal from the list view — reuses the same
  // Module/Chapter/Lesson viewer the CRM and Teacher's Course Builder use.
  const [curriculumCourse, setCurriculumCourse] = useState(null); // { id, title } | null

  const [courseId, setCourseId] = useState(null);
  const [outline, setOutline] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [loadingLesson, setLoadingLesson] = useState(false);
  // Accordion — only the module containing the current lesson stays open;
  // everything else is collapsed until clicked.
  const [openModuleKey, setOpenModuleKey] = useState(null);
  const pending = useRef({});

  useEffect(() => {
    (async () => {
      try {
        const res = await lmsApi.myLearnCourses();
        setCourses((res && res.result) || []);
      } catch (e) {
        message.error('Could not load your courses.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const openCourse = useCallback(async (id) => {
    setCourseId(id);
    setView('course');
    setOutline(null);
    setLesson(null);
    try {
      const res = await lmsApi.learnCourse(id);
      const o = (res && res.result) || null;
      setOutline(o);
      if (o && o.resume) setLessonId(o.resume);
    } catch (e) {
      message.error('Could not open the course.');
    }
  }, []);

  const openLesson = useCallback(async (id) => {
    if (!id) return;
    setLessonId(id);
    setLoadingLesson(true);
    try {
      const res = await lmsApi.lessonView(id);
      setLesson((res && res.result) || null);
    } catch (e) {
      message.error('Could not load the lesson.');
    } finally {
      setLoadingLesson(false);
    }
  }, []);

  useEffect(() => {
    if (lessonId) openLesson(lessonId);
  }, [lessonId, openLesson]);

  // Auto-expand whichever module holds the current lesson (e.g. after
  // Next/Previous crosses into a new module) — every other module stays
  // collapsed until the learner clicks it themselves.
  useEffect(() => {
    if (!outline || !lessonId) return;
    const owner = outline.modules.find((m) =>
      (m.chapters || []).some((c) => (c.lessons || []).some((l) => l.id === lessonId))
    );
    if (owner) setOpenModuleKey(owner.id);
  }, [outline, lessonId]);

  // flush accumulated progress every 15s + on lesson change / unmount
  const flush = useCallback(async () => {
    const p = pending.current;
    if (!lessonId || !Object.keys(p).length) return;
    pending.current = {};
    try {
      const res = await lmsApi.lessonProgress(lessonId, p);
      if (res && res.result && res.result.course) {
        setOutline((o) => (o ? { ...o, progress: { ...o.progress, ...res.result.course } } : o));
      }
    } catch (e) {
      /* best-effort */
    }
  }, [lessonId]);

  useEffect(() => {
    const iv = setInterval(flush, 15000);
    return () => {
      clearInterval(iv);
      flush();
    };
  }, [flush]);

  const onProgress = (patch) => {
    pending.current = { ...pending.current, ...patch, watchedSeconds: Math.max(pending.current.watchedSeconds || 0, patch.watchedSeconds || 0) };
  };

  const flatOrder = (outline && outline.order) || [];
  const idx = flatOrder.indexOf(lessonId);
  const lessonMeta = (() => {
    if (!outline) return null;
    for (const m of outline.modules) for (const c of m.chapters) {
      const l = (c.lessons || []).find((x) => x.id === lessonId);
      if (l) return l;
    }
    return null;
  })();

  const markComplete = async () => {
    try {
      const res = await lmsApi.lessonComplete(lessonId);
      message.success('Lesson marked complete');
      if (res && res.result && res.result.course) {
        setOutline((o) => (o ? { ...o, progress: { ...o.progress, ...res.result.course } } : o));
      }
      // reflect in the tree
      setOutline((o) => {
        if (!o) return o;
        const next = JSON.parse(JSON.stringify(o));
        for (const m of next.modules) for (const c of m.chapters) for (const l of c.lessons || []) if (l.id === lessonId) { l.status = 'completed'; l.percent = 100; }
        return next;
      });
    } catch (e) {
      message.error('Could not mark complete.');
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  // ---- course list ----
  if (view === 'list') {
    return (
      <div className="lms-portal" style={{ padding: 4 }}>
        <div className="lms-portal-head">
          <div><h2><BookOutlined /> My Courses</h2><p>Pick up where you left off.</p></div>
        </div>
        {courses.length === 0 ? (
          <Card><Empty description="You are not enrolled in any course yet." /></Card>
        ) : (
          <Row gutter={[16, 16]}>
            {courses.map((c) => (
              <Col xs={24} sm={12} lg={8} key={c.id}>
                <Card
                  hoverable
                  onClick={() => openCourse(c.id)}
                  cover={c.thumbnailUrl ? <img alt={c.title} src={c.thumbnailUrl} style={{ height: 140, objectFit: 'cover' }} /> : null}
                >
                  <Card.Meta title={c.title} description={<Text type="secondary">{c.instructor || '—'} · {c.level || ''}</Text>} />

                  <div
                    className="lms-course-builder-chips"
                    style={{ marginTop: 10, cursor: 'pointer' }}
                    title="View full curriculum"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurriculumCourse({ id: c.id, title: c.title });
                    }}
                  >
                    <div className="lms-course-chip">
                      <BookOutlined />
                      <span><b>{c.modules ?? 0}</b> Modules</span>
                    </div>
                    <div className="lms-course-chip">
                      <FileTextOutlined />
                      <span><b>{c.lessons ?? 0}</b> Lessons</span>
                    </div>
                    {c.durationHours ? (
                      <div className="lms-course-chip">
                        <ClockCircleOutlined />
                        <span><b>{c.durationHours}h</b> Duration</span>
                      </div>
                    ) : null}
                    <div className="lms-course-chip">
                      <FolderOpenOutlined />
                      <span>View curriculum</span>
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <Progress percent={c.progress || 0} size="small" />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {c.completedLessons || 0}/{c.totalLessons || c.lessons || 0} lessons
                    </Text>
                  </div>
                  <Button type="primary" ghost block style={{ marginTop: 12 }} icon={<PlayCircleOutlined />}>
                    {c.progress > 0 ? 'Continue' : 'Start learning'}
                  </Button>
                </Card>
              </Col>
            ))}
          </Row>
        )}

        <CurriculumViewer
          open={!!curriculumCourse}
          onClose={() => setCurriculumCourse(null)}
          courseId={curriculumCourse && curriculumCourse.id}
          courseTitle={curriculumCourse && curriculumCourse.title}
        />
      </div>
    );
  }

  // ---- course player ----
  const pct = outline?.progress?.percent || 0;
  const totalLessons = outline?.progress?.totalLessons ?? flatOrder.length;
  const completedLessons = outline?.progress?.completedLessons ?? 0;

  const lessonIcon = (l) =>
    l.status === 'completed' ? (
      <CheckCircleTwoTone twoToneColor="#16a34a" />
    ) : l.type === 'video' || l.type === 'recorded' ? (
      <VideoCameraOutlined />
    ) : l.type === 'pdf' ? (
      <FilePdfOutlined />
    ) : (
      <FileTextOutlined />
    );

  return (
    <div className="lms-portal lms-player" style={{ padding: 4 }}>
      <button type="button" className="lms-player-back" onClick={() => { setView('list'); flush(); }}>
        <ArrowLeftOutlined /> All courses
      </button>

      <div className="lms-player-head">
        <div className="lms-player-head-info">
          <span className="lms-player-head-kicker"><BookOutlined /> Course</span>
          <h2 className="lms-player-title">{outline?.course?.title || 'Loading…'}</h2>
        </div>
        {outline && (
          <div className="lms-player-progress">
            <div className="lms-player-progress-ring" style={{ '--pct': pct }}>
              <span>{pct}%</span>
            </div>
            <div className="lms-player-progress-info">
              <div className="lms-player-progress-label">{pct}% complete</div>
              <div className="lms-player-progress-sub">{completedLessons}/{totalLessons} lessons</div>
              <div className="lms-player-progress-track">
                <div className="lms-player-progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {!outline ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            {loadingLesson ? (
              <Skeleton active paragraph={{ rows: 5 }} />
            ) : lesson ? (
              <div className="lms-player-card">
                <div className={FRAME_TYPES.has(lesson.type) ? 'lms-player-media' : 'lms-player-content'}>
                  <LessonPlayer lesson={lesson} onProgress={onProgress} onComplete={markComplete} />
                </div>

                <div className="lms-player-lesson-meta">
                  <div className="lms-player-lesson-tags">
                    {idx >= 0 && (
                      <span className="lms-player-lesson-kicker">Lesson {idx + 1} of {flatOrder.length}</span>
                    )}
                    {TYPE_META[lesson.type] && (
                      <span className="lms-player-lesson-type">
                        {TYPE_META[lesson.type].icon} {TYPE_META[lesson.type].label}
                      </span>
                    )}
                  </div>
                  <h3 className="lms-player-lesson-title">{lesson.title}</h3>
                  {lesson.description && <p className="lms-player-lesson-desc">{lesson.description}</p>}

                  <div className="lms-player-actions">
                    <Button icon={<ArrowLeftOutlined />} disabled={idx <= 0} onClick={() => setLessonId(flatOrder[idx - 1])}>
                      Previous
                    </Button>
                    <Button
                      icon={<CheckCircleOutlined />}
                      className={lessonMeta?.status === 'completed' ? '' : 'lms-player-complete-btn'}
                      onClick={markComplete}
                      disabled={lessonMeta?.status === 'completed'}
                    >
                      {lessonMeta?.status === 'completed' ? 'Completed' : 'Mark complete'}
                    </Button>
                    <Button
                      icon={<ArrowRightOutlined />}
                      type="primary"
                      disabled={idx < 0 || idx >= flatOrder.length - 1}
                      onClick={() => setLessonId(flatOrder[idx + 1])}
                    >
                      Next
                    </Button>
                  </div>

                  {lesson.attachments && lesson.attachments.length > 0 && (
                    <div className="lms-player-attachments">
                      <Text strong style={{ fontSize: 12.5 }}>Attachments</Text>
                      <List
                        size="small"
                        dataSource={lesson.attachments}
                        renderItem={(a) => (
                          <List.Item>
                            <a href={a.url} target="_blank" rel="noopener">{a.name || a.url}</a>
                          </List.Item>
                        )}
                      />
                    </div>
                  )}

                  <Button type="link" icon={<QuestionCircleOutlined />} className="lms-player-ask-btn" disabled>
                    Ask a question (coming soon)
                  </Button>
                </div>
              </div>
            ) : (
              <Card><Empty description="Select a lesson from the right." /></Card>
            )}
          </Col>

          <Col xs={24} lg={8}>
            <div className="lms-player-sidebar">
              <div className="lms-player-sidebar-head">
                <span>Course content</span>
                <span className="lms-player-sidebar-count">{completedLessons}/{totalLessons}</span>
              </div>
              <div className="lms-player-sidebar-body">
                <Collapse
                  accordion
                  activeKey={openModuleKey}
                  onChange={(key) => setOpenModuleKey(Array.isArray(key) ? key[0] : key)}
                  ghost
                  expandIconPosition="end"
                  expandIcon={({ isActive }) => (
                    <DownOutlined className={`lms-player-module-chevron${isActive ? ' is-open' : ''}`} />
                  )}
                  className="lms-player-modules"
                  items={outline.modules.map((m, mi) => {
                    const moduleLessons = (m.chapters || []).flatMap((c) => c.lessons || []);
                    const moduleDone = moduleLessons.filter((l) => l.status === 'completed').length;
                    const moduleComplete = moduleLessons.length > 0 && moduleDone === moduleLessons.length;
                    return {
                    key: m.id,
                    label: (
                      <div className="lms-player-module-head">
                        <span className={`lms-player-module-index${moduleComplete ? ' is-done' : ''}`}>
                          {moduleComplete ? <CheckCircleTwoTone twoToneColor="#16a34a" /> : mi + 1}
                        </span>
                        <span className="lms-player-module-title">{m.title}</span>
                        {moduleLessons.length > 0 && (
                          <span className="lms-player-module-count">{moduleDone}/{moduleLessons.length}</span>
                        )}
                      </div>
                    ),
                    children: (m.chapters || []).map((c) => (
                      <div key={c.id} className="lms-player-chapter">
                        <div className="lms-player-chapter-label">{c.title}</div>
                        {(c.lessons || []).map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            className={`lms-player-lesson-row${l.id === lessonId ? ' is-active' : ''}`}
                            onClick={() => setLessonId(l.id)}
                          >
                            <span className="lms-player-lesson-row-icon">{lessonIcon(l)}</span>
                            <span className="lms-player-lesson-row-title">{l.title}</span>
                            {l.percent > 0 && l.status !== 'completed' && (
                              <Tag className="lms-player-lesson-row-pct">{l.percent}%</Tag>
                            )}
                          </button>
                        ))}
                      </div>
                    )),
                  };
                  })}
                />
              </div>
            </div>
          </Col>
        </Row>
      )}
    </div>
  );
}
