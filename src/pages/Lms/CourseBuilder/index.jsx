import React, { useCallback, useEffect, useState } from 'react';
import {
  Row, Col, Card, Button, List, Collapse, Modal, Form, Input, InputNumber, Select, Checkbox,
  Space, Popconfirm, Empty, Skeleton, Tag, message, Typography,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined,
  ReadOutlined, VideoCameraOutlined, FileTextOutlined, FilePdfOutlined, LinkOutlined, FormOutlined,
} from '@ant-design/icons';
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
const typeIcon = (t) => (LESSON_TYPES.find((x) => x.value === t) || {}).icon || <FileTextOutlined />;

export default function CourseBuilder() {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [outline, setOutline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingOutline, setLoadingOutline] = useState(false);
  const [modal, setModal] = useState(null); // {kind, mode, parentId, data}
  const [form] = Form.useForm();

  useEffect(() => {
    (async () => {
      try {
        const res = await lmsApi.teacherDashboard();
        const list = (res && res.result && res.result.courses) || [];
        setCourses(list);
        if (list[0]) setCourseId(list[0].id);
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

  const del = async (kind, id) => {
    try {
      if (kind === 'module') await lmsApi.deleteModule(id);
      if (kind === 'chapter') await lmsApi.deleteChapter(id);
      if (kind === 'lesson') await lmsApi.deleteLesson(id);
      loadOutline(courseId);
    } catch (e) {
      message.error('Delete failed.');
    }
  };

  // swap order with the previous/next sibling
  const move = async (kind, list, index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[index];
    const b = list[j];
    const key = kind === 'module' ? 'modules' : kind === 'chapter' ? 'chapters' : 'lessons';
    try {
      await lmsApi.reorderCurriculum(courseId, { [key]: [{ id: a.id, order: b.order }, { id: b.id, order: a.order }] });
      loadOutline(courseId);
    } catch (e) {
      message.error('Reorder failed.');
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

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

      {!courseId ? (
        <Card><Empty description="You have no courses yet. Ask an admin to set you as the course instructor." /></Card>
      ) : loadingOutline ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : !outline ? (
        <Card><Empty description="Could not load outline" /></Card>
      ) : (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal({ kind: 'module', mode: 'add' })}>
              Add module
            </Button>
            <Text type="secondary">
              {outline.counts.modules} modules · {outline.counts.chapters} chapters · {outline.counts.lessons} lessons
            </Text>
          </Space>

          {outline.modules.length === 0 ? (
            <Card><Empty description="No modules yet — add the first one." /></Card>
          ) : (
            <Collapse
              defaultActiveKey={outline.modules.map((m) => m.id)}
              items={outline.modules.map((m, mi) => ({
                key: m.id,
                label: (
                  <Space>
                    <b>{m.title}</b>
                    <Tag>{(m.chapters || []).length} ch</Tag>
                  </Space>
                ),
                extra: (
                  <Space onClick={(e) => e.stopPropagation()}>
                    <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={mi === 0} onClick={() => move('module', outline.modules, mi, -1)} />
                    <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={mi === outline.modules.length - 1} onClick={() => move('module', outline.modules, mi, 1)} />
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openModal({ kind: 'module', mode: 'edit', data: m })} />
                    <Popconfirm title="Delete this module and everything in it?" onConfirm={() => del('module', m.id)}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
                children: (
                  <>
                    <Button size="small" icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => openModal({ kind: 'chapter', mode: 'add', parentId: m.id })}>
                      Add chapter
                    </Button>
                    {(m.chapters || []).map((c, ci) => (
                      <Card key={c.id} size="small" style={{ marginBottom: 8 }} title={<b>{c.title}</b>}
                        extra={
                          <Space>
                            <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={ci === 0} onClick={() => move('chapter', m.chapters, ci, -1)} />
                            <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={ci === m.chapters.length - 1} onClick={() => move('chapter', m.chapters, ci, 1)} />
                            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openModal({ kind: 'chapter', mode: 'edit', data: c })} />
                            <Popconfirm title="Delete chapter + its lessons?" onConfirm={() => del('chapter', c.id)}>
                              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                          </Space>
                        }
                      >
                        <List
                          size="small"
                          dataSource={c.lessons || []}
                          locale={{ emptyText: 'No lessons' }}
                          renderItem={(l, li) => (
                            <List.Item
                              actions={[
                                <Button key="u" size="small" type="text" icon={<ArrowUpOutlined />} disabled={li === 0} onClick={() => move('lesson', c.lessons, li, -1)} />,
                                <Button key="d" size="small" type="text" icon={<ArrowDownOutlined />} disabled={li === c.lessons.length - 1} onClick={() => move('lesson', c.lessons, li, 1)} />,
                                <Button key="e" size="small" type="text" icon={<EditOutlined />} onClick={() => openModal({ kind: 'lesson', mode: 'edit', data: l })} />,
                                <Popconfirm key="x" title="Delete lesson?" onConfirm={() => del('lesson', l.id)}>
                                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                                </Popconfirm>,
                              ]}
                            >
                              <Space>
                                {typeIcon(l.type)}
                                <span>{l.title}</span>
                                <Tag>{l.type}</Tag>
                                {l.isPreview && <Tag color="blue">preview</Tag>}
                                {l.published === false && <Tag color="orange">draft</Tag>}
                              </Space>
                            </List.Item>
                          )}
                        />
                        <Button size="small" type="dashed" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => openModal({ kind: 'lesson', mode: 'add', parentId: c.id })}>
                          Add lesson
                        </Button>
                      </Card>
                    ))}
                  </>
                ),
              }))}
            />
          )}
        </>
      )}

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
