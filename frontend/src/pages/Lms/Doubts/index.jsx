import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, Drawer, Space, Empty, Skeleton, message, Typography, Segmented,
} from 'antd';
import { QuestionCircleOutlined, PushpinFilled, PushpinOutlined, CheckOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;
const ago = (v) => (v ? dayjs(v).fromNow?.() || dayjs(v).format('D MMM HH:mm') : '');

function Thread({ id, onChange }) {
  const [d, setD] = useState(null);
  const [reply, setReply] = useState('');
  const load = useCallback(async () => {
    try { const res = await lmsApi.doubt(id); setD((res && res.result) || null); } catch (e) { message.error('Load failed'); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Skeleton active />;
  return (
    <div>
      <Paragraph strong style={{ fontSize: 16 }}>{d.title}</Paragraph>
      {d.body && <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{d.body}</Paragraph>}
      <Text type="secondary">Asked by {d.studentName} · {dayjs(d.created).format('D MMM, HH:mm')}</Text>
      <div style={{ margin: '14px 0', borderTop: '1px solid #eee' }} />
      {(d.replies || []).map((r, i) => (
        <Card key={i} size="small" style={{ marginBottom: 8, background: r.byRole === 'student' ? '#fff' : '#f0f9ff' }}>
          <Space><Text strong>{r.byName}</Text><Tag>{r.byRole}</Tag><Text type="secondary" style={{ fontSize: 12 }}>{dayjs(r.at).format('D MMM, HH:mm')}</Text></Space>
          <Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{r.body}</Paragraph>
        </Card>
      ))}
      {d.canReply && d.status !== 'resolved' && (
        <Space.Compact style={{ width: '100%', marginTop: 8 }}>
          <Input.TextArea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" />
        </Space.Compact>
      )}
      <Space style={{ marginTop: 8 }}>
        {d.canReply && d.status !== 'resolved' && (
          <Button type="primary" disabled={!reply.trim()} onClick={async () => { await lmsApi.replyDoubt(id, { body: reply }); setReply(''); load(); onChange && onChange(); }}>Reply</Button>
        )}
        {d.status !== 'resolved'
          ? <Button icon={<CheckOutlined />} onClick={async () => { await lmsApi.resolveDoubt(id); load(); onChange && onChange(); }}>Mark resolved</Button>
          : <Button onClick={async () => { await lmsApi.resolveDoubt(id, { reopen: true }); load(); onChange && onChange(); }}>Reopen</Button>}
        {d.canModerate && (
          <Button icon={d.pinned ? <PushpinFilled /> : <PushpinOutlined />} onClick={async () => { await lmsApi.pinDoubt(id); load(); onChange && onChange(); }}>
            {d.pinned ? 'Unpin' : 'Pin'}
          </Button>
        )}
      </Space>
    </div>
  );
}

export default function Doubts() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const isTeacher = LMS_TEACHER_ROLES.includes(admin.role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [asking, setAsking] = useState(false);
  const [courses, setCourses] = useState([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lmsApi.doubts(status === 'all' ? {} : { status });
      setRows((res && res.result) || []);
    } catch (e) { message.error('Could not load.'); } finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isTeacher) lmsApi.myLearnCourses().then((r) => setCourses(((r && r.result) || []).map((c) => ({ value: c.id, label: c.title }))));
  }, [isTeacher]);

  const ask = async () => {
    let v; try { v = await form.validateFields(); } catch (e) { return; }
    try { await lmsApi.askDoubt(v); setAsking(false); form.resetFields(); load(); message.success('Posted'); }
    catch (e) { message.error('Failed'); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><QuestionCircleOutlined /> Doubts / Questions</h2><p>{isTeacher ? 'Answer your students.' : 'Ask and track your questions.'}</p></div>
        <Space>
          <Segmented value={status} onChange={setStatus} options={[{ label: 'All', value: 'all' }, { label: 'Open', value: 'open' }, { label: 'Answered', value: 'answered' }, { label: 'Resolved', value: 'resolved' }]} />
          {!isTeacher && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAsking(true)} disabled={!courses.length}>Ask a question</Button>}
        </Space>
      </div>

      {rows.length === 0 ? (
        <Card><Empty description="No questions here." /></Card>
      ) : (
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          onRow={(r) => ({ onClick: () => setOpenId(r.id), style: { cursor: 'pointer' } })}
          columns={[
            { title: '', width: 30, render: (_, r) => (r.pinned ? <PushpinFilled style={{ color: '#faad14' }} /> : null) },
            { title: 'Question', dataIndex: 'title' },
            { title: 'Course', dataIndex: 'course' },
            ...(isTeacher ? [{ title: 'Student', dataIndex: 'studentName' }] : []),
            { title: 'Replies', dataIndex: 'replyCount', width: 70 },
            { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'resolved' ? 'green' : s === 'answered' ? 'blue' : 'orange'}>{s}</Tag> },
            { title: 'Updated', dataIndex: 'lastReplyAt', render: (v, r) => dayjs(v || r.created).format('D MMM, HH:mm') },
          ]}
        />
      )}

      <Drawer open={!!openId} width={620} onClose={() => setOpenId(null)} title="Question" destroyOnClose>
        {openId && <Thread id={openId} onChange={load} />}
      </Drawer>

      <Modal open={asking} title="Ask a question" onCancel={() => setAsking(false)} onOk={ask} okText="Post" destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="course" label="Course" rules={[{ required: true }]}><Select options={courses} /></Form.Item>
          <Form.Item name="title" label="Question" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="body" label="Details"><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
