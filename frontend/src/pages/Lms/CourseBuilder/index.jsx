import React, { useCallback, useEffect, useState } from 'react';
import {
  Row, Col, Card, Button, Modal, Form, Input, InputNumber, Select, Checkbox,
  Space, Empty, Skeleton, Tag, message, Typography,
} from 'antd';
import {
  PlusOutlined,
  ReadOutlined, VideoCameraOutlined, FileTextOutlined, FilePdfOutlined, LinkOutlined, FormOutlined,
  BookOutlined, FolderOpenOutlined, ClockCircleOutlined, TeamOutlined, RobotOutlined, BarChartOutlined,
  CodeOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import defaultCourseThumbnail from '@/style/images/course-thumbnail.jpg';
import lmsApi from '../api';

const { Text } = Typography;

const LESSON_TYPES = [
  { value: 'video', label: 'Video', icon: <VideoCameraOutlined /> },
  { value: 'recorded', label: 'Recorded class', icon: <VideoCameraOutlined /> },
  { value: 'text', label: 'Text lesson', icon: <FileTextOutlined /> },
  { value: 'pdf', label: 'PDF', icon: <FilePdfOutlined /> },
  { value: 'document', label: 'Document', icon: <FileTextOutlined /> },
  { value: 'link', label: 'External link', icon: <LinkOutlined /> },
  { value: 'quiz', label: 'Quiz (coming soon)', icon: <FormOutlined /> },
  { value: 'assignment', label: 'Assignment (coming soon)', icon: <FormOutlined /> },
];

// Manually edit titles & descriptions here
const FEATURE_CARDS = [
  {
    title: 'Agentic AI',
    description: 'Build autonomous AI agents that can plan, reason, and take actions using tools and APIs.',
    icon: <RobotOutlined />,
    color: 'purple',
    // 👇 EITHER paste a direct image URL as a string (e.g. 'https://…/agent.jpg')
    // OR reference a file placed in the "public" folder like this: '/agent.jpg'
    thumbnail: '/agent.jpg', // 👈 served directly from the public folder
  },
  {
    title: 'Data Analytics',
    description: 'Learn to collect, clean, visualize, and derive insights from data using modern analytics tools.',
    icon: <BarChartOutlined />,
    color: 'blue',
    // 👇 EITHER paste a direct image URL as a string (e.g. 'https://…/data.jpg')
    // OR place a file in the "public" folder and reference it like '/yourimage.jpg'
    thumbnail: '/ana.jpg', // 👈 served directly from the public folder
  },
  {
    title: 'Python + AI',
    description: 'Master Python fundamentals and apply them to build real-world AI and machine learning projects.',
    icon: <CodeOutlined />,
    color: 'green',
    // 👇 EITHER paste a direct image URL as a string (e.g. 'https://…/python.jpg')
    // OR place a file in the "public" folder and reference it like '/yourimage.jpg'
    thumbnail: '/Python%20with%20AI.png', // 👈 served directly from the public folder (spaces encoded as %20)
  },
  {
    title: 'AI Engineering',
    description: 'Design, deploy, and scale production-grade AI systems and ML pipelines end to end.',
    icon: <ThunderboltOutlined />,
    color: 'orange',
    // 👇 EITHER paste a direct image URL as a string (e.g. 'https://…/ai-engineering.jpg')
    // OR place a file in the "public" folder and reference it like '/yourimage.jpg'
    thumbnail: '/image.png', // 👈 served directly from the public folder
  },
];

export default function CourseBuilder() {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [outline, setOutline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingOutline, setLoadingOutline] = useState(false);
  const [modal, setModal] = useState(null); // {kind, mode, parentId, data}
  const [form] = Form.useForm();
  const [selectedCategory, setSelectedCategory] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await lmsApi.teacherDashboard();
        const list = (res && res.result && res.result.courses) || [];
        setCourses(list);
        const fwd = list.find((c) => /full[\s-]*stack/i.test(c.title));
        if (fwd) {
          setCourseId(fwd.id);
        } else if (list[0]) {
          setCourseId(list[0].id);
        }
      } catch (e) {
        message.error('Could not load your courses.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadOutline = useCallback(async (id) => {
    if (!id) return;
    setLoadingOutline(true);
    try {
      const res = await lmsApi.courseOutline(id);
      setOutline((res && res.result) || null);
    } catch (e) {
      message.error('Could not load the course outline.');
    } finally {
      setLoadingOutline(false);
    }
  }, []);

  useEffect(() => {
    if (courseId) loadOutline(courseId);
  }, [courseId, loadOutline]);

  const openModal = (cfg) => {
    setModal(cfg);
    setTimeout(() => form.setFieldsValue(cfg.data || { type: 'video', published: true }), 0);
  };
  const closeModal = () => {
    setModal(null);
    form.resetFields();
  };

  const submit = async () => {
    let v;
    try {
      v = await form.validateFields();
    } catch (e) {
      return;
    }
    const { kind, mode, parentId, data } = modal;
    try {
      if (kind === 'module') {
        if (mode === 'add') await lmsApi.addModule(courseId, v);
        else await lmsApi.updateModule(data.id, v);
      } else if (kind === 'chapter') {
        if (mode === 'add') await lmsApi.addChapter(parentId, v);
        else await lmsApi.updateChapter(data.id, v);
      } else if (kind === 'lesson') {
        if (mode === 'add') await lmsApi.addLesson(parentId, v);
        else await lmsApi.updateLesson(data.id, v);
      }
      closeModal();
      loadOutline(courseId);
    } catch (e) {
      message.error('Save failed.');
    }
  };

  // Clicking a feature card tries to jump to a matching course (by category or title keyword),
  // and highlights the selected card. If no matching course exists, it just toggles the highlight.
  const handleFeatureCardClick = (card) => {
    setSelectedCategory((prev) => (prev === card.title ? null : card.title));

    const keyword = card.title.toLowerCase();
    const match = courses.find(
      (c) =>
        (c.category && c.category.toLowerCase().includes(keyword)) ||
        (c.title && c.title.toLowerCase().includes(keyword))
    );
    if (match) {
      setCourseId(match.id);
    } else {
      message.info(`No course found yet for "${card.title}".`);
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  const activeCourse =
    courses.find((c) => c.id === courseId) ||
    courses.find((c) => /full[\s-]*stack/i.test(c.title)) ||
    (outline && outline.course) ||
    (courses.length > 0 ? courses[0] : null) ||
    {
      id: courseId || 'course-default',
      title: 'Full Stack Web Development',
      status: 'Published',
      category: 'Certification',
      level: 'Beginner',
      mode: 'Live',
      durationHours: 6,
      thumbnailUrl: defaultCourseThumbnail,
      description: 'Comprehensive curriculum covering front-end and back-end web development with modern full-stack architectures.',
    };

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <h2><ReadOutlined /> Course Builder</h2>
          <p>Build the curriculum: Module → Chapter → Lesson. Use ↑ ↓ to reorder.</p>
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

      {/* Course Overview Card with thumbnail */}
      {activeCourse && (
        <Card className="lms-course-builder-card" bodyStyle={{ padding: 20 }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Tag color={activeCourse.status === 'Published' ? 'green' : 'orange'}>
                        {activeCourse.status || 'Draft'}
                      </Tag>
                      <Tag color="cyan">{activeCourse.category || 'Certification'}</Tag>
                      {activeCourse.level && <Tag color="blue">{activeCourse.level}</Tag>}
                      {activeCourse.mode && <Tag color="purple">{activeCourse.mode}</Tag>}
                    </div>
                    {courses.length > 1 && (
                      <Select
                        size="small"
                        style={{ minWidth: 220 }}
                        value={courseId}
                        onChange={setCourseId}
                        options={courses.map((c) => ({ value: c.id, label: `${c.title} · ${c.status}` }))}
                      />
                    )}
                  </div>
                  <h3 style={{ margin: '8px 0 6px', fontSize: 22, fontWeight: 800, color: 'var(--hub-text)', letterSpacing: '-0.02em' }}>
                    {activeCourse.title}
                  </h3>
                  <p style={{ margin: 0, color: 'var(--hub-muted)', fontSize: 13, lineHeight: 1.55 }}>
                    {activeCourse.description || 'Learn and Grow in your carrer'}
                  </p>
                </div>

                <div className="lms-course-builder-chips">
                  <div className="lms-course-chip">
                    <BookOutlined />
                    <span><b>{outline?.counts?.modules ?? activeCourse.modules ?? 0}</b> Modules</span>
                  </div>
                  <div className="lms-course-chip">
                    <FolderOpenOutlined />
                    <span><b>{outline?.counts?.chapters ?? 0}</b> Chapters</span>
                  </div>
                  <div className="lms-course-chip">
                    <FileTextOutlined />
                    <span><b>{outline?.counts?.lessons ?? activeCourse.lessons ?? 0}</b> Lessons</span>
                  </div>
                  {activeCourse.durationHours ? (
                    <div className="lms-course-chip">
                      <ClockCircleOutlined />
                      <span><b>{activeCourse.durationHours}h</b> Duration</span>
                    </div>
                  ) : null}
                  {activeCourse.enrolled != null ? (
                    <div className="lms-course-chip">
                      <TeamOutlined />
                      <span><b>{activeCourse.enrolled}</b> Enrolled</span>
                    </div>
                  ) : null}
                </div>

                <Space wrap>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => openModal({ kind: 'module', mode: 'add' })}
                  >
                    Add Module
                  </Button>
                </Space>
              </div>
            </Col>
          </Row>
        </Card>
      )}

      {/* ===================== Feature / Category Cards — added here ===================== */}
      <Row gutter={[16, 16]} style={{ margin: '20px 0' }}>
        {FEATURE_CARDS.map((card, idx) => {
          const isSelected = selectedCategory === card.title;
          return (
            <Col xs={24} sm={12} lg={6} key={idx}>
              <Card
                hoverable
                onClick={() => handleFeatureCardClick(card)}
                style={{
                  height: '100%',
                  borderRadius: 12,
                  cursor: 'pointer',
                  border: isSelected ? '2px solid var(--ant-primary-color, #1677ff)' : undefined,
                  boxShadow: isSelected ? '0 0 0 2px rgba(22,119,255,0.15)' : undefined,
                }}
                bodyStyle={{ padding: 18 }}
              >
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {/* 👇 thumbnail image for this card is set on the card object (FEATURE_CARDS above) — renders here if provided */}
                  {card.thumbnail ? (
                    <img
                      src={card.thumbnail}
                      alt={card.title}
                      style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 10 }}
                    />
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        fontSize: 18,
                        background: 'var(--hub-muted-bg, #f5f5f5)',
                        color: 'var(--hub-text)',
                      }}
                    >
                      {card.icon}
                    </div>
                  )}
                  <Tag color={card.color} style={{ width: 'fit-content' }}>
                    {card.title}
                  </Tag>
                  <h4 style={{ margin: '4px 0 2px', fontSize: 15, fontWeight: 700, color: 'var(--hub-text)' }}>
                    {card.title}
                  </h4>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--hub-muted)', lineHeight: 1.5 }}>
                    {card.description}
                  </p>
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>
      {/* ===================== End Feature / Category Cards ===================== */}

      <Modal
        open={!!modal}
        title={modal ? `${modal.mode === 'add' ? 'Add' : 'Edit'} ${modal.kind}` : ''}
        onCancel={closeModal}
        onOk={submit}
        okText="Save"
        destroyOnClose
        width={modal?.kind === 'lesson' ? 620 : 460}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
            <Input placeholder="e.g. Introduction to React" />
          </Form.Item>

          {modal?.kind !== 'lesson' && (
            <Form.Item name="description" label="Description">
              <Input.TextArea rows={2} />
            </Form.Item>
          )}

          {modal?.kind === 'lesson' && (
            <>
              <Form.Item name="type" label="Lesson type" rules={[{ required: true }]}>
                <Select options={LESSON_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(p, c) => p.type !== c.type}>
                {({ getFieldValue }) => {
                  const t = getFieldValue('type');
                  if (['video', 'recorded'].includes(t))
                    return (
                      <>
                        <Form.Item name="videoSource" label="Video source">
                          <Select
                            allowClear
                            options={[
                              { value: 'youtube', label: 'YouTube' },
                              { value: 'vimeo', label: 'Vimeo' },
                              { value: 'upload', label: 'Uploaded / cloud URL' },
                              { value: 'cloud', label: 'Cloud-hosted' },
                              { value: 'bbb', label: 'BigBlueButton recording' },
                            ]}
                          />
                        </Form.Item>
                        <Form.Item name="videoUrl" label="Video URL">
                          <Input placeholder="https://youtu.be/… or https://…/video.mp4" />
                        </Form.Item>
                        <Form.Item name="durationSec" label="Duration (seconds)">
                          <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                      </>
                    );
                  if (t === 'text')
                    return (
                      <Form.Item name="content" label="Lesson content (HTML allowed)">
                        <Input.TextArea rows={6} />
                      </Form.Item>
                    );
                  if (['pdf', 'document'].includes(t))
                    return (
                      <Form.Item name="fileUrl" label="File URL">
                        <Input placeholder="https://…/notes.pdf" />
                      </Form.Item>
                    );
                  if (t === 'link')
                    return (
                      <Form.Item name="externalUrl" label="External URL">
                        <Input placeholder="https://…" />
                      </Form.Item>
                    );
                  return <Text type="secondary">This lesson type is wired in a later update.</Text>;
                }}
              </Form.Item>
              <Space size="large">
                <Form.Item name="isPreview" valuePropName="checked" noStyle>
                  <Checkbox>Free preview</Checkbox>
                </Form.Item>
                <Form.Item name="published" valuePropName="checked" noStyle initialValue>
                  <Checkbox>Published</Checkbox>
                </Form.Item>
                <Form.Item name="allowDownload" valuePropName="checked" noStyle>
                  <Checkbox>Allow download</Checkbox>
                </Form.Item>
              </Space>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}