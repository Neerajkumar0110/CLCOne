import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Checkbox, DatePicker, Drawer,
  Space, Empty, Skeleton, message, Typography, Descriptions,
} from 'antd';
import { PlusOutlined, FileTextOutlined, EditOutlined, DeleteOutlined, UploadOutlined, CheckOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;
const fmt = (v) => (v ? dayjs(v).format('D MMM YYYY, HH:mm') : '—');

/* ───────────────────────── teacher ───────────────────────── */
function TeacherAssignments() {
  const [rows, setRows] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form] = Form.useForm();
  const [editing, setEditing] = useState(null); // null | {} (new) | row
  const [subFor, setSubFor] = useState(null);
  const [subs, setSubs] = useState([]);
  const [evalForm] = Form.useForm();
  const [evalRow, setEvalRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, d] = await Promise.all([lmsApi.assignments(), lmsApi.teacherDashboard()]);
      setRows((a && a.result) || []);
      setCourses(((d && d.result && d.result.courses) || []).map((c) => ({ value: c.id, label: c.title })));
    } catch (e) {
      message.error('Could not load assignments.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEditor = (row) => {
    setEditing(row || {});
    setTimeout(() =>
      form.setFieldsValue(
        row
          ? { ...row, dueDate: row.dueDate ? dayjs(row.dueDate) : null }
          : { maxMarks: 100, passingMarks: 40, submissionType: 'file', allowResubmission: true, published: true }
      ), 0);
  };
  const save = async () => {
    let v;
    try { v = await form.validateFields(); } catch (e) { return; }
    const body = { ...v, dueDate: v.dueDate ? v.dueDate.toISOString() : undefined };
    try {
      if (editing && editing.id) await lmsApi.updateAssignment(editing.id, body);
      else await lmsApi.createAssignment(body);
      setEditing(null);
      form.resetFields();
      load();
    } catch (e) {
      message.error('Save failed.');
    }
  };

  const openSubs = async (row) => {
    setSubFor(row);
    setSubs([]);
    try {
      const res = await lmsApi.assignmentSubmissions(row.id);
      setSubs((res && res.result) || []);
    } catch (e) {
      message.error('Could not load submissions.');
    }
  };
  const doEvaluate = async () => {
    let v;
    try { v = await evalForm.validateFields(); } catch (e) { return; }
    try {
      await lmsApi.evaluateSubmission(evalRow.id, v);
      setEvalRow(null);
      evalForm.resetFields();
      openSubs(subFor);
      load();
    } catch (e) {
      message.error('Save failed.');
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><FileTextOutlined /> Assignments</h2><p>Create, collect and evaluate.</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)} disabled={!courses.length}>
          Create assignment
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card><Empty description={courses.length ? 'No assignments yet.' : 'You have no courses assigned.'} /></Card>
      ) : (
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Title', dataIndex: 'title' },
            { title: 'Due', dataIndex: 'dueDate', render: fmt },
            { title: 'Max', dataIndex: 'maxMarks', width: 70 },
            {
              title: 'Submissions',
              render: (_, r) => (
                <Space>
                  <Tag color="blue">{r.submissions.submitted} to grade</Tag>
                  <Tag color="green">{r.submissions.evaluated} done</Tag>
                  {r.submissions.resubmit_requested > 0 && <Tag color="orange">{r.submissions.resubmit_requested} resubmit</Tag>}
                </Space>
              ),
            },
            { title: 'Status', dataIndex: 'published', render: (p) => <Tag color={p ? 'green' : 'default'}>{p ? 'Published' : 'Draft'}</Tag> },
            {
              title: '',
              width: 200,
              render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => openSubs(r)}>Submissions</Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(r)} />
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() =>
                    Modal.confirm({ title: 'Delete assignment?', onOk: async () => { await lmsApi.deleteAssignment(r.id); load(); } })
                  } />
                </Space>
              ),
            },
          ]}
        />
      )}

      <Modal open={!!editing} title={editing?.id ? 'Edit assignment' : 'Create assignment'} onCancel={() => setEditing(null)} onOk={save} okText="Save" destroyOnClose width={560}>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="course" label="Course" rules={[{ required: true }]}>
            <Select options={courses} disabled={!!editing?.id} />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="instructions" label="Instructions"><Input.TextArea rows={3} /></Form.Item>
          <Space size="large" wrap>
            <Form.Item name="dueDate" label="Due date"><DatePicker showTime format="D MMM YYYY HH:mm" /></Form.Item>
            <Form.Item name="maxMarks" label="Max marks"><InputNumber min={1} /></Form.Item>
            <Form.Item name="passingMarks" label="Passing marks"><InputNumber min={0} /></Form.Item>
          </Space>
          <Form.Item name="submissionType" label="Submission type">
            <Select options={['pdf', 'doc', 'image', 'text', 'file'].map((v) => ({ value: v, label: v.toUpperCase() }))} />
          </Form.Item>
          <Space size="large">
            <Form.Item name="allowResubmission" valuePropName="checked" noStyle><Checkbox>Allow resubmission</Checkbox></Form.Item>
            <Form.Item name="published" valuePropName="checked" noStyle><Checkbox>Published</Checkbox></Form.Item>
          </Space>
        </Form>
      </Modal>

      <Drawer open={!!subFor} title={subFor ? `Submissions — ${subFor.title}` : ''} width={640} onClose={() => setSubFor(null)}>
        <Table
          rowKey="id"
          size="small"
          dataSource={subs}
          pagination={false}
          locale={{ emptyText: 'No submissions yet' }}
          columns={[
            { title: 'Student', dataIndex: 'studentName' },
            { title: 'Submitted', dataIndex: 'submittedAt', render: fmt },
            { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'evaluated' ? 'green' : s === 'resubmit_requested' ? 'orange' : 'blue'}>{s}</Tag> },
            { title: 'Marks', render: (_, r) => (r.marks != null ? `${r.marks}${r.grade ? ` (${r.grade})` : ''}` : '—') },
            { title: '', render: (_, r) => <Button size="small" onClick={() => { setEvalRow(r); setTimeout(() => evalForm.setFieldsValue({ marks: r.marks, grade: r.grade, feedback: r.feedback }), 0); }}>Open</Button> },
          ]}
        />
      </Drawer>

      <Modal open={!!evalRow} title={evalRow ? `Evaluate — ${evalRow.studentName}` : ''} onCancel={() => setEvalRow(null)} onOk={doEvaluate} okText="Save" destroyOnClose>
        {evalRow && (
          <>
            {evalRow.text && <Paragraph style={{ background: '#f6f7f9', padding: 10, borderRadius: 8 }}>{evalRow.text}</Paragraph>}
            {(evalRow.files || []).map((f, i) => <div key={i}><a href={f.url} target="_blank" rel="noopener">{f.name || f.url}</a></div>)}
            <Form form={evalForm} layout="vertical" style={{ marginTop: 12 }} preserve={false}>
              <Space size="large">
                <Form.Item name="marks" label="Marks"><InputNumber min={0} /></Form.Item>
                <Form.Item name="grade" label="Grade"><Input style={{ width: 100 }} /></Form.Item>
              </Space>
              <Form.Item name="feedback" label="Feedback"><Input.TextArea rows={3} /></Form.Item>
              <Form.Item name="requestResubmission" valuePropName="checked" noStyle><Checkbox>Request resubmission instead</Checkbox></Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
}

/* ───────────────────────── student ───────────────────────── */
function StudentAssignments() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subFor, setSubFor] = useState(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lmsApi.myAssignments();
      setRows((res && res.result) || []);
    } catch (e) {
      message.error('Could not load assignments.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    let v;
    try { v = await form.validateFields(); } catch (e) { return; }
    const files = (v.fileUrl || '').split(/\s+/).filter(Boolean).map((u) => ({ name: u.split('/').pop(), url: u }));
    try {
      await lmsApi.submitAssignment(subFor.id, { text: v.text || '', files });
      setSubFor(null);
      form.resetFields();
      load();
      message.success('Submitted');
    } catch (e) {
      message.error('Submit failed.');
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head"><div><h2><FileTextOutlined /> Assignments</h2><p>Submit your work and see feedback.</p></div></div>
      {rows.length === 0 ? (
        <Card><Empty description="No assignments yet." /></Card>
      ) : (
        rows.map((r) => {
          const s = r.mySubmission;
          const canSubmit = !s || s.status === 'resubmit_requested' || (s.status === 'submitted' && r.allowResubmission);
          return (
            <Card key={r.id} size="small" style={{ marginBottom: 12 }} title={<Space><b>{r.title}</b><Tag>{r.course}</Tag></Space>}
              extra={<Text type="secondary">Due {fmt(r.dueDate)}</Text>}>
              {r.description && <Paragraph type="secondary" style={{ marginBottom: 8 }}>{r.description}</Paragraph>}
              {r.instructions && <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{r.instructions}</Paragraph>}
              {(r.attachments || []).map((a, i) => <div key={i}><a href={a.url} target="_blank" rel="noopener">{a.name || a.url}</a></div>)}
              <div style={{ marginTop: 10 }}>
                {!s && <Tag>Not submitted</Tag>}
                {s && <Tag color={s.status === 'evaluated' ? 'green' : s.status === 'resubmit_requested' ? 'orange' : 'blue'}>{s.status}</Tag>}
                {s && s.marks != null && <Tag color="green">{s.marks}/{r.maxMarks}{s.grade ? ` · ${s.grade}` : ''}</Tag>}
              </div>
              {s && s.feedback && (
                <Paragraph style={{ background: '#f0f9ff', padding: 10, borderRadius: 8, marginTop: 8 }}>
                  <b>Feedback:</b> {s.feedback}
                </Paragraph>
              )}
              <Button type="primary" size="small" icon={<UploadOutlined />} style={{ marginTop: 8 }} disabled={!canSubmit}
                onClick={() => { setSubFor(r); setTimeout(() => form.setFieldsValue({ text: s?.text, fileUrl: (s?.files || []).map((f) => f.url).join(' ') }), 0); }}>
                {s ? 'Resubmit' : 'Submit'}
              </Button>
            </Card>
          );
        })
      )}

      <Modal open={!!subFor} title={subFor ? `Submit — ${subFor.title}` : ''} onCancel={() => setSubFor(null)} onOk={submit} okText="Submit" destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="text" label="Your answer / notes"><Input.TextArea rows={4} /></Form.Item>
          <Form.Item name="fileUrl" label="File link(s)" tooltip="Paste one or more URLs (Drive / Dropbox / etc.), space-separated">
            <Input.TextArea rows={2} placeholder="https://drive.google.com/…" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default function Assignments() {
  const admin = useSelector(selectCurrentAdmin) || {};
  return LMS_TEACHER_ROLES.includes(admin.role) ? <TeacherAssignments /> : <StudentAssignments />;
}
