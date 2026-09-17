import React, { useCallback, useEffect, useState } from 'react';
import {
  Row, Col, Card, Button, Modal, Form, Input, InputNumber, Select, Checkbox,
  Space, Empty, Skeleton, Tag, message, Typography, Upload,
} from 'antd';
import {
  PlusOutlined,
  ReadOutlined, VideoCameraOutlined, FileTextOutlined, FilePdfOutlined, LinkOutlined, FormOutlined,
  BookOutlined, FolderOpenOutlined, ClockCircleOutlined, TeamOutlined, RobotOutlined, BarChartOutlined,
  CodeOutlined, ThunderboltOutlined, UploadOutlined,
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

// Golden glow color used on hover for every feature card
const GOLD_GLOW = 'rgba(255, 191, 0, 0.55)';

// Converts a File into a base64 string so it can be stored on the form
const getBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });

// Small reusable picker used inside the Add/Edit Module modal for choosing a thumbnail image
function ModuleThumbnailPicker({ form }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    const existing = form.getFieldValue('thumbnailUrl');
    setPreview(existing || null);
  }, [form]);

  const beforeUpload = async (file) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('Please select an image file.');
      return Upload.LIST_IGNORE;
    }
    const isLt5M = file.size / 1024 / 1024 < 5;
    if (!isLt5M) {
      message.error('Image must be smaller than 5MB.');
      return Upload.LIST_IGNORE;
    }

    const base64 = await getBase64(file);
    setPreview(base64);
    form.setFieldsValue({ thumbnailUrl: base64 });
    return false; // prevent actual upload; we just want the base64 preview + form value
  };

  return (
    <Upload
      listType="picture-card"
      showUploadList={false}
      beforeUpload={beforeUpload}
      accept="image/*"
    >
      {preview ? (
        <img
          src={preview}
          alt="Module thumbnail"
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }}
        />
      ) : (
        <div>
          <UploadOutlined />
          <div style={{ marginTop: 8 }}>Upload Pic</div>
        </div>
      )}
    </Upload>
  );
}

export default function CourseBuilder() {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [outline, setOutline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingOutline, setLoadingOutline] = useState(false);
  const [modal, setModal] = useState(null); // {kind, mode, parentId, data}
  const [form] = Form.useForm();
  const [selectedCategory, setSelectedCategory] = useState(null);

  // tracks which feature card is currently hovered (index or null)
  const [hoveredCard, setHoveredCard] = useState(null);

  // feature card click -> course preview modal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCourse, setPreviewCourse] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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
  // highlights the selected card, and opens a course-preview modal with Modules/Chapters/Lessons/
  // Duration/Enrolled stats. If no matching course exists, a placeholder preview is shown instead.
  const handleFeatureCardClick = async (card) => {
    setSelectedCategory((prev) => (prev === card.title ? null : card.title));

    const keyword = card.title.toLowerCase();
    const match = courses.find(
      (c) =>
        (c.category && c.category.toLowerCase().includes(keyword)) ||
        (c.title && c.title.toLowerCase().includes(keyword))
    );

    setPreviewLoading(true);
    setPreviewOpen(true);

    if (match) {
      try {
        const res = await lmsApi.courseOutline(match.id);
        const outlineData = (res && res.result) || {};
        setPreviewCourse({
          ...match,
          counts: outlineData.counts || {},
          thumbnailUrl: match.thumbnailUrl || card.thumbnail || defaultCourseThumbnail,
        });
      } catch (e) {
        setPreviewCourse({
          ...match,
          counts: {},
          thumbnailUrl: match.thumbnailUrl || card.thumbnail || defaultCourseThumbnail,
        });
      }
    } else {
      setPreviewCourse({
        title: card.title,
        description: card.description,
        thumbnailUrl: card.thumbnail || defaultCourseThumbnail,
        status: 'Coming soon',
        category: card.title,
        counts: { modules: 0, chapters: 0, lessons: 0 },
        durationHours: null,
        enrolled: null,
        isPlaceholder: true,
      });
    }
    setPreviewLoading(false);
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewCourse(null);
  };

  const goToCourseBuilder = () => {
    if (previewCourse && !previewCourse.isPlaceholder) {
      setCourseId(previewCourse.id);
    }
    closePreview();
  };

  // Computes the transform/transition/shadow (including hover glow) for each feature card
  const getCardStyle = (idx, color) => {
    const isHovered = hoveredCard === idx;
    const isOtherHovered = hoveredCard !== null && !isHovered;

    let transform = 'translateY(0) scale(1)';
    let transition = 'transform 0.7s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.5s ease';
    let boxShadow = '0 6px 18px rgba(15, 23, 42, 0.06)';
    let zIndex = 1;

    if (isHovered) {
      transform = 'translateY(-14px) scale(1.045)';
      transition = 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.3s ease';
      // lift shadow + a soft golden glow ring around the card
      boxShadow = `0 22px 34px rgba(15, 23, 42, 0.16), 0 0 0 3px ${GOLD_GLOW}, 0 0 28px 6px ${GOLD_GLOW}`;
      zIndex = 3;
    } else if (isOtherHovered) {
      const distance = idx - hoveredCard;
      const shift = distance > 0 ? 10 : -10;
      transform = `translateY(4px) scale(0.965) translateX(${shift}px)`;
      transition = 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.6s ease';
      boxShadow = '0 3px 10px rgba(15, 23, 42, 0.04)';
      zIndex = 1;
    }

    return { transform, transition, boxShadow, zIndex, borderRadius: 16, willChange: 'transform' };
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
      {/* idle floating keyframes for the feature cards */}
      <style>{`
        @keyframes lmsFeatureFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-7px); }
        }
        .lms-feature-float {
          animation: lmsFeatureFloat 4.2s ease-in-out infinite;
        }
        .lms-feature-float.paused {
          animation-play-state: paused;
        }
      `}</style>

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

      {/* ===================== Feature / Category Cards ===================== */}
      <Row
        gutter={[16, 16]}
        style={{ margin: '20px 0' }}
        onMouseLeave={() => setHoveredCard(null)}
      >
        {FEATURE_CARDS.map((card, idx) => {
          const isSelected = selectedCategory === card.title;
          const cardStyle = getCardStyle(idx, card.color);
          const isAnyHovered = hoveredCard !== null;

          return (
            <Col xs={24} sm={12} lg={6} key={idx}>
              <div
                className={`lms-feature-float${isAnyHovered ? ' paused' : ''}`}
                style={{
                  animationDelay: `${idx * 0.35}s`,
                  ...cardStyle,
                }}
                onMouseEnter={() => setHoveredCard(idx)}
              >
                <Card
                  hoverable
                  onClick={() => handleFeatureCardClick(card)}
                  style={{
                    height: '100%',
                    borderRadius: 16,
                    cursor: 'pointer',
                    border: isSelected ? '2px solid var(--ant-primary-color, #1677ff)' : '1px solid rgba(15,23,42,0.06)',
                    boxShadow: 'none', // shadow/glow is driven by the wrapper's cardStyle above
                    overflow: 'hidden',
                  }}
                  bodyStyle={{ padding: 18 }}
                >
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {/* thumbnail image for this card is set on the card object (FEATURE_CARDS above) — renders here if provided */}
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
              </div>
            </Col>
          );
        })}
      </Row>
      {/* ===================== End Feature / Category Cards ===================== */}

      {/* Add/Edit Module/Chapter/Lesson modal */}
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

          {/* module thumbnail picker — shown only for the "module" modal */}
          {modal?.kind === 'module' && (
            <Form.Item name="thumbnailUrl" label="Module Thumbnail">
              <ModuleThumbnailPicker form={form} />
            </Form.Item>
          )}

          {modal?.kind !== 'lesson' && (
            <Form.Item name="description" label="Description">
              <Input.TextArea rows={2} />
            </Form.Item>
          )}

          {(modal?.kind === 'module' || modal?.kind === 'chapter') && (
            <Space size="large">
              {modal?.kind === 'chapter' && (
                <Form.Item name="sessionLabel" label="Session label">
                  <Input placeholder="e.g. S1 or S2–3" style={{ width: 140 }} />
                </Form.Item>
              )}
              <Form.Item name="hours" label="Hours">
                <InputNumber min={0} step={0.5} style={{ width: 120 }} />
              </Form.Item>
            </Space>
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

      {/* Course preview modal — opens when a feature card is clicked */}
      <Modal
        open={previewOpen}
        onCancel={closePreview}
        footer={
          previewCourse && !previewCourse.isPlaceholder
            ? [
                <Button key="close" onClick={closePreview}>Close</Button>,
                <Button key="open" type="primary" onClick={goToCourseBuilder}>
                  Open in Builder
                </Button>,
              ]
            : [<Button key="close" onClick={closePreview}>Close</Button>]
        }
        width={520}
        title={null}
      >
        {previewLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : previewCourse ? (
          <div>
            <img
              src={previewCourse.thumbnailUrl}
              alt={previewCourse.title}
              style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 10, marginBottom: 16 }}
              onError={(e) => { e.currentTarget.src = defaultCourseThumbnail; }}
            />

            <Space wrap style={{ marginBottom: 8 }}>
              <Tag color={previewCourse.status === 'Published' ? 'green' : 'orange'}>
                {previewCourse.status || 'Draft'}
              </Tag>
              <Tag color="cyan">{previewCourse.category}</Tag>
            </Space>

            <h3 style={{ margin: '4px 0 6px', fontSize: 20, fontWeight: 800 }}>
              {previewCourse.title}
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--hub-muted)', fontSize: 13, lineHeight: 1.55 }}>
              {previewCourse.description}
            </p>

            <div className="lms-course-builder-chips">
              <div className="lms-course-chip">
                <BookOutlined />
                <span><b>{previewCourse.counts?.modules ?? 0}</b> Modules</span>
              </div>
              <div className="lms-course-chip">
                <FolderOpenOutlined />
                <span><b>{previewCourse.counts?.chapters ?? 0}</b> Chapters</span>
              </div>
              <div className="lms-course-chip">
                <FileTextOutlined />
                <span><b>{previewCourse.counts?.lessons ?? 0}</b> Lessons</span>
              </div>
              {previewCourse.durationHours ? (
                <div className="lms-course-chip">
                  <ClockCircleOutlined />
                  <span><b>{previewCourse.durationHours}h</b> Duration</span>
                </div>
              ) : null}
              {previewCourse.enrolled != null ? (
                <div className="lms-course-chip">
                  <TeamOutlined />
                  <span><b>{previewCourse.enrolled}</b> Enrolled</span>
                </div>
              ) : null}
            </div>

            {previewCourse.isPlaceholder && (
              <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                No course is linked to this category yet.
              </Text>
            )}
          </div>
        ) : (
          <Empty description="No details found" />
        )}
      </Modal>
    </div>
  );
}