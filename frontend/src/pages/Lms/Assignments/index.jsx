import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Tag, Button, Modal, Form, Input, InputNumber, Select, Checkbox, DatePicker, Drawer, Dropdown,
  Space, Empty, Skeleton, message, Typography,
} from 'antd';
import {
  PlusOutlined, FileTextOutlined, EditOutlined, DeleteOutlined, UploadOutlined, CheckOutlined,
  CalendarOutlined, NumberOutlined, FormOutlined, CheckSquareOutlined,
  LinkOutlined, TeamOutlined, SearchOutlined, MoreOutlined, ArrowLeftOutlined, UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;
const fmt = (v) => (v ? dayjs(v).format('D MMM YYYY, HH:mm') : '—');
// Submission status -> the .assignments-page .status.* colour it reads as:
// evaluated = done (green), submitted = awaiting grading (amber),
// resubmit_requested = needs the student's attention (red).
const SUB_STATUS_CLASS = { evaluated: 'submitted', submitted: 'pending', resubmit_requested: 'overdue' };

// An assignment row's own aggregate status (.assignments-page .status.*):
// unpublished = closed; nothing submitted past its due date = overdue;
// nothing submitted yet but still open = pending; anything submitted
// (awaiting grading, graded, or resubmit-requested) = submitted.
const ASG_STATUS_LABEL = { submitted: 'Submitted', pending: 'Pending', overdue: 'Overdue', closed: 'Closed' };
function assignmentStatus(r) {
  if (!r.published) return 'closed';
  const total = (r.submissions.submitted || 0) + (r.submissions.evaluated || 0) + (r.submissions.resubmit_requested || 0);
  if (total > 0) return 'submitted';
  return r.dueDate && new Date(r.dueDate) < new Date() ? 'overdue' : 'pending';
}
const PAGE_SIZE = 8;

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
  const [evalRow, setEvalRow] = useState(null);
  // Plain state (not an antd Form) — the evaluate panel is styled with the
  // raw .submission-page CSS, which targets bare <input>/<textarea>
  // elements, not antd's wrapped markup.
  const [evalMarks, setEvalMarks] = useState('');
  const [evalGrade, setEvalGrade] = useState('');
  const [evalFeedback, setEvalFeedback] = useState('');
  const [evalResubmit, setEvalResubmit] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(true);

  // list filters + pagination (.assignments-page filter-card / table-footer)
  const [q, setQ] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

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
  useEffect(() => { setPage(1); }, [q, batchFilter, statusFilter]);

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (batchFilter && r.batch !== batchFilter) return false;
      if (statusFilter && assignmentStatus(r) !== statusFilter) return false;
      if (needle && !`${r.title} ${r.batch} ${r.code}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, batchFilter, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
  const openEval = (r) => {
    setEvalRow(r);
    setEvalMarks(r.marks != null ? String(r.marks) : '');
    setEvalGrade(r.grade || '');
    setEvalFeedback(r.feedback || '');
    setEvalResubmit(false);
    setReviewOpen(true);
  };
  const doEvaluate = async () => {
    try {
      await lmsApi.evaluateSubmission(evalRow.id, {
        marks: evalMarks === '' ? undefined : Number(evalMarks),
        grade: evalGrade,
        feedback: evalFeedback,
        requestResubmission: evalResubmit,
      });
      setEvalRow(null);
      openSubs(subFor);
      load();
    } catch (e) {
      message.error('Save failed.');
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="assignments-page">
      <div className="page">
        <div className="page-header">
          <div className="title">
            <div className="title-icon"><FileTextOutlined /></div>
            <div>
              <h1>Assignments</h1>
              <div className="subtitle">Create, collect and evaluate.</div>
            </div>
          </div>
          <button type="button" className="create-btn" onClick={() => openEditor(null)} disabled={!batches.length}>
            <PlusOutlined /> Create Assignment
          </button>
        </div>

        {rows.length === 0 ? (
          <Card><Empty description={batches.length ? 'No assignments yet.' : 'You have no batches assigned.'} /></Card>
        ) : (
          <>
        <div className="filter-card">
          <div className="search-box">
            <SearchOutlined style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#9aa8bb', fontSize: 14 }} />
            <input placeholder="Search by title, batch or assignment id…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="filter-select" value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
            <option value="">All Batches</option>
            {batches.map((b) => <option key={b.value} value={b.label}>{b.label}</option>)}
          </select>
          <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            {Object.entries(ASG_STATUS_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>

        {filteredRows.length === 0 ? (
          <Card><Empty description="No assignments match these filters." /></Card>
        ) : (
          <div className="table-card">
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Assignment ID</th>
                    <th>Title</th>
                    <th>Batch</th>
                    <th>Due date</th>
                    <th>Marks</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const st = assignmentStatus(r);
                    return (
                      <tr key={r.id}>
                        <td className="assignment-id">{r.code || '—'}</td>
                        <td className="assignment-title">{r.title}</td>
                        <td className="batch">{r.batch || '—'}</td>
                        <td>{fmt(r.dueDate)}</td>
                        <td className="marks">{r.maxMarks}</td>
                        <td><span className={`status ${st}`}>{ASG_STATUS_LABEL[st]}</span></td>
                        <td>
                          <div className="action-group">
                            <button type="button" className="view-btn" onClick={() => openSubs(r)}>View</button>
                            <Dropdown
                              trigger={['click']}
                              placement="bottomRight"
                              menu={{
                                items: [
                                  { key: 'edit', label: 'Edit', icon: <EditOutlined /> },
                                  { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true },
                                ],
                                onClick: ({ key }) => {
                                  if (key === 'edit') openEditor(r);
                                  else if (key === 'delete') {
                                    Modal.confirm({ title: 'Delete assignment?', onOk: async () => { await lmsApi.deleteAssignment(r.id); load(); } });
                                  }
                                },
                              }}
                            >
                              <button type="button" className="more-btn"><MoreOutlined /></button>
                            </Dropdown>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                Showing {(page - 1) * PAGE_SIZE + 1} to {(page - 1) * PAGE_SIZE + pageRows.length} of {filteredRows.length} assignments
              </span>
              <div className="pagination">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <button type="button" key={n} className={n === page ? 'active' : ''} onClick={() => setPage(n)}>{n}</button>
                ))}
                <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount}>›</button>
              </div>
            </div>
          </div>
        )}
          </>
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
        <div className="assignments-page" style={{ minHeight: 'auto', background: 'transparent' }}>
          <div className="table-card">
            <div className="table-wrapper">
              <table style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Marks</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {subs.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: '#9aa8bb' }}>No submissions yet</td></tr>
                  ) : (
                    subs.map((r) => (
                      <tr key={r.id}>
                        <td>{r.studentName}</td>
                        <td>{fmt(r.submittedAt)}</td>
                        <td><span className={`status ${SUB_STATUS_CLASS[r.status] || 'pending'}`}>{r.status}</span></td>
                        <td className="marks">{r.marks != null ? `${r.marks}${r.grade ? ` (${r.grade})` : ''}` : '—'}</td>
                        <td>
                          <div className="action-group">
                            <button type="button" className="view-btn" onClick={() => openEval(r)}>Open</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Drawer>

      <Drawer open={!!evalRow} onClose={() => setEvalRow(null)} width={640} closable={false}>
        {evalRow && (
          <div className="submission-page" style={{ margin: '-24px' }}>
            <div className="page" style={{ maxWidth: 'none' }}>
              <div className="submission-header">
                <button type="button" className="back-btn" onClick={() => setEvalRow(null)}><ArrowLeftOutlined /></button>
                <h1>Submissions — {subFor ? (subFor.code || subFor.title) : ''}</h1>
              </div>

              <div className="top-info">
                <div className="meta">
                  {subFor?.code && <span className="badge project">{subFor.code}</span>}
                  <span className={`badge${evalRow.status === 'evaluated' ? ' submitted' : ''}`}>{evalRow.status}</span>
                  {subFor?.dueDate && <span className="badge due">Due {dayjs(subFor.dueDate).format('D MMM YYYY')}</span>}
                </div>
                <div className="score-card">
                  <div>
                    <span className="score-label">Status</span>
                    <span className="score-value" style={{ fontSize: 15 }}>{evalRow.status}</span>
                  </div>
                  <div>
                    <span className="score-label">Marks</span>
                    <span className="score-value">{evalRow.marks != null ? `${evalRow.marks}${evalRow.grade ? ` (${evalRow.grade})` : ''}` : '—'}</span>
                  </div>
                </div>
              </div>

              <div className="detail-card">
                <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'center', gap: 8, color: '#233752', fontWeight: 700 }}>
                  <UserOutlined /> {evalRow.studentName}
                </div>
                {evalRow.text && <div style={{ padding: '0 20px 16px', color: '#425873', fontSize: 13, lineHeight: 1.6 }}>{evalRow.text}</div>}

                <div className="section-title">Submission Details</div>
                <div className="details-grid">
                  <div className="detail-item"><label>Submission date</label><strong>{fmt(evalRow.submittedAt)}</strong></div>
                  <div className="detail-item"><label>Batch</label><strong>{subFor?.batch || '—'}</strong></div>
                  <div className="detail-item"><label>Attempt</label><strong>#{evalRow.attempt || 1}</strong></div>
                  <div className="detail-item">
                    <label>Type</label>
                    <strong>
                      {(evalRow.files || []).length ? (
                        evalRow.files.map((f, i) => (
                          <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
                            <LinkOutlined /> {f.name || f.url}
                          </a>
                        ))
                      ) : (
                        (subFor?.submissionType || '—').toUpperCase()
                      )}
                    </strong>
                  </div>
                </div>

                <button type="button" className="review-latest" onClick={() => setReviewOpen((o) => !o)}>
                  <span><CheckSquareOutlined /> &nbsp;REVIEW SUBMISSION</span>
                  <span>{reviewOpen ? '▲' : '▼'}</span>
                </button>
                {reviewOpen && (
                  <div className="evaluation">
                    <div className="marks-grid">
                      <div className="mark-field">
                        <label>Marks</label>
                        <input className="mark-input" type="number" min={0} value={evalMarks} onChange={(e) => setEvalMarks(e.target.value)} placeholder="0" />
                      </div>
                      <div className="mark-field">
                        <label>Grade</label>
                        <input className="mark-input" type="text" value={evalGrade} onChange={(e) => setEvalGrade(e.target.value)} placeholder="A / B / C…" />
                      </div>
                    </div>
                    <label className="feedback-label">Feedback</label>
                    <textarea className="feedback" value={evalFeedback} onChange={(e) => setEvalFeedback(e.target.value)} placeholder="Notes for the candidate…" />
                    <label className="form-label" style={{ marginTop: 14, cursor: 'pointer' }}>
                      <input type="checkbox" checked={evalResubmit} onChange={(e) => setEvalResubmit(e.target.checked)} /> Request resubmission instead
                    </label>
                    <div className="review-actions">
                      <button type="button" className="cancel-btn" onClick={() => setEvalRow(null)}>Cancel</button>
                      <button type="button" className="save-btn" onClick={doEvaluate}>Save</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>
      </div>
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
