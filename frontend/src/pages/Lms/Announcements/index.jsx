import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, Checkbox, Space, Empty, Skeleton, message, Typography,
} from 'antd';
import { SoundOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;

function TeacherAnnouncements() {
  const [rows, setRows] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, d] = await Promise.all([lmsApi.announcements(), lmsApi.teacherDashboard()]);
      setRows((a && a.result) || []);
      setCourses(((d && d.result && d.result.courses) || []).map((c) => ({ value: c.id, label: c.title })));
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

      <Modal open={open} title="New announcement" onCancel={() => setOpen(false)} onOk={send} okText="Send" destroyOnClose width={560}>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="body" label="Message" rules={[{ required: true }]}><Input.TextArea rows={5} /></Form.Item>
          <Form.Item name="audience" label="Audience"><Select options={[{ value: 'course', label: 'A course' }, { value: 'batch', label: 'A batch' }, { value: 'all', label: 'All students' }]} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.audience !== c.audience}>
            {({ getFieldValue }) => {
              const a = getFieldValue('audience');
              if (a === 'course') return <Form.Item name="course" label="Course" rules={[{ required: true }]}><Select options={courses} /></Form.Item>;
              if (a === 'batch') return <Form.Item name="batch" label="Batch name" rules={[{ required: true }]}><Input placeholder="Exact batch name" /></Form.Item>;
              return null;
            }}
          </Form.Item>
          <Form.Item name="channels" label="Send via">
            <Checkbox.Group options={[{ label: 'In-app notification', value: 'in_app' }, { label: 'Email', value: 'email' }]} />
          </Form.Item>
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
