import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, Checkbox, Space, Empty, Skeleton, message, Typography,
} from 'antd';
import {
  SoundOutlined, PlusOutlined, DeleteOutlined, TagOutlined, FileTextOutlined,
  TeamOutlined, ReadOutlined, BellOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;

// Same label-with-icon treatment as the CRM's generic Add/Edit modal
// (components/CrudTab — see .crud-lbl / .crud-lbl-icon in featureHub.css),
// matching how Lms/Projects and Lms/Assignments build their own modals, so
// every form in the LMS reads as one consistent product.
const Lbl = ({ icon, children }) => (
  <span className="crud-lbl"><span className="crud-lbl-icon">{icon}</span>{children}</span>
);

function TeacherAnnouncements() {
  const [rows, setRows] = useState([]);
  const [courses, setCourses] = useState([]);
  // Real batch NAMES this teacher trains (Batch.trainer) — Student.batch
  // (what recipients are actually matched against) stores the same name
  // string, so the option value is the name itself, not an id.
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, d] = await Promise.all([lmsApi.announcements(), lmsApi.teacherDashboard()]);
      setRows((a && a.result) || []);
      setCourses(((d && d.result && d.result.courses) || []).map((c) => ({ value: c.id, label: c.title })));
      setBatches(((d && d.result && d.result.batches) || []).map((b) => ({ value: b.name, label: b.name })));
    } catch (e) { message.error('Could not load.'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    let v; try { v = await form.validateFields(); } catch (e) { return; }
    try {
      const res = await lmsApi.createAnnouncement({ ...v, channels: v.channels || ['in_app'] });
      message.success(`Sent to ${res?.result?.recipients ?? 0} students (${res?.result?.emailed ?? 0} emailed)`);
      setOpen(false); form.resetFields(); load();
    } catch (e) { message.error('Send failed.'); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><SoundOutlined /> Announcements</h2><p>Broadcast to a course, a batch, or everyone.</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setOpen(true); setTimeout(() => form.setFieldsValue({ audience: 'course', channels: ['in_app'] }), 0); }}>
          New announcement
        </Button>
      </div>
      {rows.length === 0 ? (
        <Card><Empty description="Nothing sent yet." /></Card>
      ) : (
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Title', dataIndex: 'title' },
            { title: 'Scope', render: (_, r) => <Tag>{r.audience === 'all' ? 'All' : r.audience === 'batch' ? r.batch : r.courseTitle}</Tag> },
            { title: 'Recipients', dataIndex: 'recipientsCount', width: 100 },
            { title: 'Emailed', dataIndex: 'emailedCount', width: 90 },
            { title: 'Sent', dataIndex: 'sentAt', render: (v) => dayjs(v).format('D MMM, HH:mm') },
            { title: '', width: 50, render: (_, r) => <Button size="small" danger icon={<DeleteOutlined />} onClick={async () => { await lmsApi.deleteAnnouncement(r.id); load(); }} /> },
          ]}
          expandable={{ expandedRowRender: (r) => <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.body}</Paragraph> }}
        />
      )}

      <Modal
        className="crud-modal"
        open={open}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><SoundOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">New record</span>
              <span className="crud-modal-title-main">New announcement</span>
            </span>
          </span>
        }
        onCancel={() => setOpen(false)}
        onOk={send}
        okText="Send"
        destroyOnClose
        maskClosable={false}
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false} className="crud-form">
          <div className="crud-form-grid">
            <Form.Item name="title" label={<Lbl icon={<TagOutlined />}>Title</Lbl>} rules={[{ required: true, message: 'Title is required' }]} className="crud-form-full">
              <Input placeholder="e.g. Class rescheduled to 5 PM" />
            </Form.Item>
            <Form.Item name="body" label={<Lbl icon={<FileTextOutlined />}>Message</Lbl>} rules={[{ required: true, message: 'Message is required' }]} className="crud-form-full">
              <Input.TextArea rows={5} />
            </Form.Item>
            <Form.Item name="audience" label={<Lbl icon={<TeamOutlined />}>Audience</Lbl>} className="crud-form-full">
              <Select options={[{ value: 'course', label: 'A course' }, { value: 'batch', label: 'A batch' }, { value: 'all', label: 'All students' }]} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(p, c) => p.audience !== c.audience}>
              {({ getFieldValue }) => {
                const a = getFieldValue('audience');
                if (a === 'course') {
                  return (
                    <Form.Item name="course" label={<Lbl icon={<ReadOutlined />}>Course</Lbl>} rules={[{ required: true, message: 'Course is required' }]} className="crud-form-full">
                      <Select options={courses} showSearch optionFilterProp="label" placeholder="Select a course…" />
                    </Form.Item>
                  );
                }
                if (a === 'batch') {
                  return (
                    <Form.Item name="batch" label={<Lbl icon={<TeamOutlined />}>Batch</Lbl>} rules={[{ required: true, message: 'Batch is required' }]} className="crud-form-full">
                      <Select options={batches} showSearch optionFilterProp="label" placeholder="Select a batch…" />
                    </Form.Item>
                  );
                }
                return null;
              }}
            </Form.Item>
            <Form.Item name="channels" label={<Lbl icon={<BellOutlined />}>Send via</Lbl>} className="crud-form-full">
              <Checkbox.Group options={[{ label: 'In-app notification', value: 'in_app' }, { label: 'Email', value: 'email' }]} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

function StudentAnnouncements() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    lmsApi.myAnnouncements().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;
  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head"><div><h2><SoundOutlined /> Announcements</h2><p>Updates from your teachers.</p></div></div>
      {rows.length === 0 ? <Card><Empty description="No announcements." /></Card> : rows.map((r) => (
        <Card key={r.id} size="small" style={{ marginBottom: 12 }} title={<Space><b>{r.title}</b><Tag>{r.scope}</Tag></Space>}
          extra={<Text type="secondary">{dayjs(r.sentAt).format('D MMM, HH:mm')}</Text>}>
          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>{r.body}</Paragraph>
          <Text type="secondary" style={{ fontSize: 12 }}>— {r.from}</Text>
        </Card>
      ))}
    </div>
  );
}

export default function Announcements() {
  const admin = useSelector(selectCurrentAdmin) || {};
  return LMS_TEACHER_ROLES.includes(admin.role) ? <TeacherAnnouncements /> : <StudentAnnouncements />;
}
