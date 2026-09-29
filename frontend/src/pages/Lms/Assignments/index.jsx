import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Checkbox, DatePicker, Drawer,
  Space, Empty, Skeleton, message, Typography, Descriptions,
} from 'antd';
import {
  PlusOutlined, FileTextOutlined, EditOutlined, DeleteOutlined, UploadOutlined, CheckOutlined,
  CalendarOutlined, NumberOutlined, FormOutlined, CheckSquareOutlined,
  TrophyOutlined, MessageOutlined, LinkOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;
const fmt = (v) => (v ? dayjs(v).format('D MMM YYYY, HH:mm') : '—');

// Same label-with-icon treatment as the CRM's generic Add/Edit modal
// (components/CrudTab — see .crud-lbl / .crud-lbl-icon in featureHub.css),
// matching how Lms/Projects builds its own modals, so every form in the LMS
// reads as one consistent product regardless of which page built it.
const Lbl = ({ icon, children }) => (
  <span className="crud-lbl"><span className="crud-lbl-icon">{icon}</span>{children}</span>
);

/* ───────────────────────── teacher ───────────────────────── */
function TeacherAssignments() {
  const [rows, setRows] = useState([]);
  // The batches actually assigned to this teacher (Batch.trainer) — not the
  // Course list, which the backend permission check no longer keys off of
  // (a teacher can train a batch without being listed as that Course's
  // `instructor`, which is what used to throw "You can only add assignments
  // to your own courses").
  const [batches, setBatches] = useState([]);
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
      setBatches(((d && d.result && d.result.batches) || []).map((b) => ({ value: b.id, label: b.name })));
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)} disabled={!batches.length}>
          Create assignment
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card><Empty description={batches.length ? 'No assignments yet.' : 'You have no batches assigned.'} /></Card>
      ) : (
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Assignment ID', dataIndex: 'code', render: (v) => v || '—' },
            { title: 'Title', dataIndex: 'title' },
            { title: 'Batch', dataIndex: 'batch', render: (v) => v || '—' },
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

      <Modal
        className="crud-modal"
        open={!!editing}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><FileTextOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">{editing?.id ? 'Edit record' : 'New record'}</span>
              <span className="crud-modal-title-main">{editing?.id ? 'Edit assignment' : 'Create assignment'}</span>
            </span>
          </span>
        }
        onCancel={() => setEditing(null)}
        onOk={save}
        okText="Save"
        destroyOnClose
        maskClosable={false}
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false} className="crud-form">
          <div className="crud-form-grid">
            <Form.Item name="batch" label={<Lbl icon={<TeamOutlined />}>Batch</Lbl>} rules={[{ required: true, message: 'Batch is required' }]} className="crud-form-full">
              <Select options={batches} disabled={!!editing?.id} showSearch optionFilterProp="label" placeholder="Select a batch…" />
            </Form.Item>
            <Form.Item name="title" label={<Lbl icon={<FileTextOutlined />}>Title</Lbl>} rules={[{ required: true, message: 'Title is required' }]} className="crud-form-full">
              <Input placeholder="e.g. Week 3 — Data cleaning project" />
            </Form.Item>
            <Form.Item name="description" label={<Lbl icon={<FileTextOutlined />}>Description</Lbl>} className="crud-form-full">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="instructions" label={<Lbl icon={<FormOutlined />}>Instructions</Lbl>} className="crud-form-full">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item name="dueDate" label={<Lbl icon={<CalendarOutlined />}>Due date</Lbl>}>
              <DatePicker showTime format="D MMM YYYY HH:mm" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="submissionType" label={<Lbl icon={<UploadOutlined />}>Submission type</Lbl>}>
              <Select options={['pdf', 'doc', 'image', 'text', 'file', 'link'].map((v) => ({ value: v, label: v.toUpperCase() }))} />
            </Form.Item>
            <Form.Item name="maxMarks" label={<Lbl icon={<NumberOutlined />}>Max marks</Lbl>}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="passingMarks" label={<Lbl icon={<NumberOutlined />}>Passing marks</Lbl>}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="allowResubmission" valuePropName="checked" className="crud-form-full">
              <Checkbox><Lbl icon={<CheckSquareOutlined />}>Allow resubmission</Lbl></Checkbox>
            </Form.Item>
            <Form.Item name="published" valuePropName="checked" className="crud-form-full">
              <Checkbox><Lbl icon={<CheckOutlined />}>Published</Lbl></Checkbox>
            </Form.Item>
          </div>
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

      <Modal
        className="crud-modal"
        open={!!evalRow}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><CheckSquareOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">Evaluate submission</span>
              <span className="crud-modal-title-main">{evalRow ? evalRow.studentName : ''}</span>
            </span>
          </span>
        }
        onCancel={() => setEvalRow(null)}
        onOk={doEvaluate}
        okText="Save"
        destroyOnClose
        maskClosable={false}
      >
        {evalRow && (
          <>
            {evalRow.text && <Paragraph style={{ background: 'var(--hub-surface-2)', padding: 10, borderRadius: 8 }}>{evalRow.text}</Paragraph>}
            {(evalRow.files || []).map((f, i) => <div key={i}><a href={f.url} target="_blank" rel="noopener">{f.name || f.url}</a></div>)}
            <Form form={evalForm} layout="vertical" className="crud-form" preserve={false}>
              <div className="crud-form-grid">
                <Form.Item name="marks" label={<Lbl icon={<NumberOutlined />}>Marks</Lbl>}>
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="grade" label={<Lbl icon={<TrophyOutlined />}>Grade</Lbl>}>
                  <Input />
                </Form.Item>
                <Form.Item name="feedback" label={<Lbl icon={<MessageOutlined />}>Feedback</Lbl>} className="crud-form-full">
                  <Input.TextArea rows={3} />
                </Form.Item>
                <Form.Item name="requestResubmission" valuePropName="checked" className="crud-form-full">
                  <Checkbox><Lbl icon={<UploadOutlined />}>Request resubmission instead</Lbl></Checkbox>
                </Form.Item>
              </div>
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
            <Card key={r.id} size="small" style={{ marginBottom: 12 }} title={<Space>{r.code && <Tag color="purple">{r.code}</Tag>}<b>{r.title}</b><Tag>{r.course}</Tag></Space>}
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
                <Paragraph style={{ background: 'var(--hub-blue-soft)', padding: 10, borderRadius: 8, marginTop: 8 }}>
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

      <Modal
        className="crud-modal"
        open={!!subFor}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><UploadOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">Submit for review</span>
              <span className="crud-modal-title-main">{subFor ? subFor.title : ''}</span>
            </span>
          </span>
        }
        onCancel={() => setSubFor(null)}
        onOk={submit}
        okText="Submit"
        destroyOnClose
        maskClosable={false}
      >
        <Form form={form} layout="vertical" className="crud-form" preserve={false}>
          <div className="crud-form-grid">
            <Form.Item name="text" label={<Lbl icon={<FileTextOutlined />}>Your answer / notes</Lbl>} className="crud-form-full">
              <Input.TextArea rows={4} />
            </Form.Item>
            <Form.Item
              name="fileUrl"
              label={<Lbl icon={<LinkOutlined />}>File link(s)</Lbl>}
              tooltip="Paste one or more URLs (Drive / Dropbox / etc.), space-separated"
              className="crud-form-full"
            >
              <Input.TextArea rows={2} placeholder="https://drive.google.com/…" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

export default function Assignments() {
  const admin = useSelector(selectCurrentAdmin) || {};
  return LMS_TEACHER_ROLES.includes(admin.role) ? <TeacherAssignments /> : <StudentAssignments />;
}
