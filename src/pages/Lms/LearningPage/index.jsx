import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Row, Col, Card, Button, List, Progress, Tag, Empty, Skeleton, Space, message, Typography, Collapse,
} from 'antd';
import {
  PlayCircleOutlined, CheckCircleTwoTone, CheckCircleOutlined, ArrowLeftOutlined, ArrowRightOutlined,
  FileTextOutlined, LinkOutlined, FilePdfOutlined, VideoCameraOutlined, BookOutlined, QuestionCircleOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';

const { Title, Text, Paragraph } = Typography;

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
      <Card style={{ minHeight: 200 }}>
        <div className="lms-lesson-html" dangerouslySetInnerHTML={{ __html: lesson.content || '<p><i>No content.</i></p>' }} />
      </Card>
    );
  if (['pdf', 'document'].includes(t) && lesson.fileUrl)
    return <iframe title={lesson.title} src={lesson.fileUrl} style={{ ...frame, height: 640 }} />;
  if (t === 'link' && lesson.externalUrl)
    return (
      <Card>
        <Space direction="vertical">
          <Text>This lesson links to an external resource.</Text>
          <Button type="primary" icon={<LinkOutlined />} href={lesson.externalUrl} target="_blank" rel="noopener">
            Open resource
          </Button>
        </Space>
      </Card>
    );
  if (['quiz', 'assignment'].includes(t))
    return <Card><Empty description={`${t} lessons open in the next update`} /></Card>;
  return <Card><Empty description="Nothing to show for this lesson yet." /></Card>;
}

const frame = { width: '100%', aspectRatio: '16 / 9', border: 0, borderRadius: 10, display: 'block' };

export default function LearningPage() {
  const [view, setView] = useState('list'); // list | course
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [courseId, setCourseId] = useState(null);
  const [outline, setOutline] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [loadingLesson, setLoadingLesson] = useState(false);
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
      </div>
    );
  }

  // ---- course player ----
  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => { setView('list'); flush(); }} style={{ paddingLeft: 0 }}>
            All courses
          </Button>
          <h2 style={{ margin: 0 }}>{outline?.course?.title || 'Loading…'}</h2>
          {outline && (
            <Progress percent={outline.progress?.percent || 0} size="small" style={{ maxWidth: 320 }} />
          )}
        </div>
      </div>

      {!outline ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            {loadingLesson ? (
              <Skeleton active paragraph={{ rows: 5 }} />
            ) : lesson ? (
              <>
                <LessonPlayer lesson={lesson} onProgress={onProgress} onComplete={markComplete} />
                <Card style={{ marginTop: 12 }}>
                  <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                    <div>
                      <Title level={4} style={{ margin: 0 }}>{lesson.title}</Title>
                      {lesson.description && <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>{lesson.description}</Paragraph>}
                    </div>
                    <Space>
                      <Button icon={<ArrowLeftOutlined />} disabled={idx <= 0} onClick={() => setLessonId(flatOrder[idx - 1])}>Previous</Button>
                      <Button icon={<CheckCircleOutlined />} type="default" onClick={markComplete}
                        disabled={lessonMeta?.status === 'completed'}>
                        {lessonMeta?.status === 'completed' ? 'Completed' : 'Mark complete'}
                      </Button>
                      <Button icon={<ArrowRightOutlined />} type="primary" disabled={idx < 0 || idx >= flatOrder.length - 1} onClick={() => setLessonId(flatOrder[idx + 1])}>Next</Button>
                    </Space>
                  </Space>
                  {lesson.attachments && lesson.attachments.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <Text strong>Attachments</Text>
                      <List
                        size="small"
                        dataSource={lesson.attachments}
                        renderItem={(a) => <List.Item><a href={a.url} target="_blank" rel="noopener">{a.name || a.url}</a></List.Item>}
                      />
                    </div>
                  )}
                  <Button type="link" icon={<QuestionCircleOutlined />} style={{ paddingLeft: 0, marginTop: 8 }} disabled>
                    Ask a question (coming soon)
                  </Button>
                </Card>
              </>
            ) : (
              <Card><Empty description="Select a lesson from the right." /></Card>
            )}
          </Col>

          <Col xs={24} lg={8}>
            <Card size="small" title="Course content" bodyStyle={{ padding: 0, maxHeight: '70vh', overflowY: 'auto' }}>
              <Collapse
                defaultActiveKey={outline.modules.map((m) => m.id)}
                ghost
                items={outline.modules.map((m) => ({
                  key: m.id,
                  label: <b>{m.title}</b>,
                  children: (m.chapters || []).map((c) => (
                    <div key={c.id} style={{ marginBottom: 6 }}>
                      <Text type="secondary" style={{ fontSize: 12, paddingLeft: 8 }}>{c.title}</Text>
                      <List
                        size="small"
                        dataSource={c.lessons || []}
                        renderItem={(l) => (
                          <List.Item
                            onClick={() => setLessonId(l.id)}
                            style={{ cursor: 'pointer', paddingLeft: 8, background: l.id === lessonId ? '#e6f4ff' : undefined }}
                          >
                            <Space size={6}>
                              {l.status === 'completed'
                                ? <CheckCircleTwoTone twoToneColor="#52c41a" />
                                : l.type === 'video' || l.type === 'recorded'
                                  ? <VideoCameraOutlined />
                                  : l.type === 'text'
                                    ? <FileTextOutlined />
                                    : l.type === 'pdf'
                                      ? <FilePdfOutlined />
                                      : <FileTextOutlined />}
                              <span style={{ fontSize: 13 }}>{l.title}</span>
                              {l.percent > 0 && l.status !== 'completed' && <Tag style={{ marginInlineEnd: 0 }}>{l.percent}%</Tag>}
                            </Space>
                          </List.Item>
                        )}
                      />
                    </div>
                  )),
                }))}
              />
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
