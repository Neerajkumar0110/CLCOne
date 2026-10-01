import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Radio, Space, Empty, Skeleton, message, Typography, DatePicker, Drawer, Steps, Checkbox, List, Divider, Timeline, Alert,
} from 'antd';
import {
  ProjectOutlined, PlusOutlined, GithubOutlined, LinkOutlined, SendOutlined, CheckCircleOutlined,
  MailOutlined, UserOutlined, TagOutlined, FileTextOutlined, CalendarOutlined, NumberOutlined, FlagOutlined, TeamOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

// Same label-with-icon treatment as the CRM's generic Add/Edit modal
// (components/CrudTab — see .crud-lbl / .crud-lbl-icon in featureHub.css)
// so every form in the LMS reads as one consistent product, not a mix of
// styles depending on which page happened to build it.
const Lbl = ({ icon, children }) => (
  <span className="crud-lbl"><span className="crud-lbl-icon">{icon}</span>{children}</span>
);
const SectionHead = ({ children }) => (
  <div className="crud-section-head" style={{ cursor: 'default' }}>
    <span className="crud-section-dot" />
    <span className="crud-section-name">{children}</span>
  </div>
);

const STATUS_COLOR = {
  assigned: 'default', in_progress: 'blue', submitted: 'gold',
  in_review: 'gold', revision_requested: 'orange', approved: 'green', rejected: 'red',
};
const STATUS_LABEL = {
  assigned: 'Assigned', in_progress: 'In Progress', submitted: 'Submitted',
  in_review: 'In Review', revision_requested: 'Revision Requested', approved: 'Approved', rejected: 'Rejected',
};

/* ═══════════ MANAGER / MENTOR — assign, review ═══════════ */
function ManageProjects() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const isMgr = MGR.includes(admin.role);
  const [rows, setRows] = useState([]);
  // The batches this teacher actually trains (Batch.trainer) — a manager
  // sees every batch. Same reasoning as Assignments.jsx: Course.instructor
  // is a separate, often-unset field the rest of the LMS doesn't scope
  // teachers by, so picking a batch (and deriving the course from it) is
  // what actually matches what a teacher is allowed to assign into.
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [detail, setDetail] = useState(null); // full project doc
  // Plain state (not an antd Form) — the review panel is styled with the raw
  // .submission-page CSS, which targets bare <select>/<input>/<textarea>
  // elements, not antd's wrapped markup.
  const [reviewState, setReviewState] = useState({ decision: '', feedback: '', rubricMarks: {} });
  const [reviewOpen, setReviewOpen] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, bt] = await Promise.all([
        isMgr ? lmsApi.projects() : lmsApi.teacherProjects(),
        request.list({ entity: 'batch', options: { items: 500 } }),
      ]);
      setRows((p && p.result) || []);
      const allBatches = (bt && bt.result) || [];
      const myName = String(admin.name || '').toLowerCase();
      const mine = isMgr
        ? allBatches
        : allBatches.filter((x) =>
            (Array.isArray(x.trainer) ? x.trainer : [x.trainer]).some((t) => t && String(t).toLowerCase() === myName)
          );
      setBatches(mine.map((x) => ({ value: x._id || x.id, label: x.name })));
    } catch (e) { message.error('Load failed'); } finally { setLoading(false); }
  }, [isMgr, admin.name]);
  useEffect(() => { load(); }, [load]);

  const assign = async () => {
    let v; try { v = await form.validateFields(); } catch (e) { return; }
    try {
      const res = await lmsApi.assignProject({
        ...v,
        studentEmail: v.assignTo === 'all' ? undefined : v.studentEmail,
        dueDate: v.dueDate ? v.dueDate.toISOString() : undefined,
        milestones: (v.milestones || []).map((m) => ({ ...m, dueDate: m.dueDate ? m.dueDate.toISOString() : undefined })),
      });
      message.success(res?.message || 'Assigned.');
      setOpen(false); form.resetFields(); load();
    } catch (e) { message.error('Assign failed.'); }
  };

  const openDetail = async (row) => {
    try {
      const res = await lmsApi.getProject(row.id);
      const d = res?.result || null;
      setDetail(d);
      setReviewOpen(true);
      setReviewState({ decision: '', feedback: '', rubricMarks: Object.fromEntries((d?.rubric || []).map((r) => [r.criterion, ''])) });
    } catch (e) { message.error('Load failed'); }
  };

  const submitReview = async () => {
    if (!reviewState.decision) { message.error('Pick a decision.'); return; }
    setSaving(true);
    try {
      const rubricScores = (detail.rubric || []).map((r) => ({ criterion: r.criterion, marks: Number(reviewState.rubricMarks[r.criterion]) || 0 }));
      const res = await lmsApi.reviewProject(detail.id || detail._id, { decision: reviewState.decision, feedback: reviewState.feedback, rubricScores });
      message.success(res?.message || 'Saved.');
      setDetail(null); load();
    } catch (e) { message.error('Review failed.'); } finally { setSaving(false); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><ProjectOutlined /> Project Management</h2><p>Assign individual projects, track milestones, review submissions.</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Assign project</Button>
      </div>

      {rows.length === 0 ? <Card><Empty description="No projects yet." /></Card> : (
        <Table
          rowKey="id" dataSource={rows} pagination={{ pageSize: 12 }} onRow={(r) => ({ onClick: () => openDetail(r), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Project ID', dataIndex: 'code', render: (v) => v || '—' },
            { title: 'Candidate', dataIndex: 'student' },
            { title: 'Batch', dataIndex: 'batch', render: (v) => v || '—' },
            { title: 'Course', dataIndex: 'course' },
            { title: 'Title', dataIndex: 'title' },
            { title: 'Mentor', dataIndex: 'mentor' },
            { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v] || v}</Tag> },
            { title: 'Due', dataIndex: 'dueDate', render: (v) => (v ? dayjs(v).format('D MMM') : '—') },
            { title: 'Score', dataIndex: 'finalScore', render: (v, r) => (v != null ? `${v}% (${r.finalGrade})` : '—') },
          ]}
        />
      )}

      <Modal
        className="crud-modal"
        open={open}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><ProjectOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">New record</span>
              <span className="crud-modal-title-main">Assign Project</span>
            </span>
          </span>
        }
        onCancel={() => setOpen(false)}
        onOk={assign}
        okText="Assign"
        destroyOnClose
        maskClosable={false}
        width={780}
      >
        <Form
          form={form}
          layout="vertical"
          className="crud-form"
          preserve={false}
          scrollToFirstError={{ behavior: 'smooth', block: 'center' }}
          initialValues={{ assignTo: 'all', milestones: [{}], rubric: [{ criterion: 'Functionality', maxMarks: 40 }, { criterion: 'Code quality', maxMarks: 20 }, { criterion: 'Documentation', maxMarks: 20 }, { criterion: 'Presentation', maxMarks: 20 }] }}
        >
          <div className="crud-form-grid">
            <Form.Item name="batch" label={<Lbl icon={<TeamOutlined />}>Batch</Lbl>} rules={[{ required: true, message: 'Batch is required' }]}>
              <Select options={batches} showSearch optionFilterProp="label" placeholder="Select a batch…" />
            </Form.Item>
            <Form.Item name="assignTo" label={<Lbl icon={<UserOutlined />}>Assign to</Lbl>}>
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio.Button value="all">All candidates in batch</Radio.Button>
                <Radio.Button value="one">One candidate</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.assignTo !== cur.assignTo}>
              {() =>
                form.getFieldValue('assignTo') === 'one' && (
                  <Form.Item
                    name="studentEmail"
                    label={<Lbl icon={<MailOutlined />}>Candidate email</Lbl>}
                    rules={[{ required: true, type: 'email', message: 'A valid email is required' }]}
                    className="crud-form-full"
                  >
                    <Input placeholder="candidate@example.com" />
                  </Form.Item>
                )
              }
            </Form.Item>
            {isMgr && (
              <Form.Item name="mentorEmail" label={<Lbl icon={<UserOutlined />}>Mentor email</Lbl>} extra="Optional — defaults to the batch's trainer" className="crud-form-full">
                <Input placeholder="mentor@example.com" />
              </Form.Item>
            )}
            <Form.Item name="title" label={<Lbl icon={<TagOutlined />}>Project title</Lbl>} className="crud-form-full" rules={[{ required: true, message: 'Title is required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="problemStatement" label={<Lbl icon={<FileTextOutlined />}>Problem statement</Lbl>} className="crud-form-full">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item name="scope" label={<Lbl icon={<FileTextOutlined />}>Scope</Lbl>} className="crud-form-full">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="dueDate" label={<Lbl icon={<CalendarOutlined />}>Due date</Lbl>}>
              <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
            </Form.Item>
          </div>

          <div className="crud-section">
            <SectionHead><FlagOutlined /> Milestones</SectionHead>
            <div className="crud-section-body">
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Form.List name="milestones">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((f) => (
                        <Space key={f.key} align="baseline" wrap>
                          <Form.Item {...f} name={[f.name, 'title']} rules={[{ required: true, message: 'Title' }]} style={{ marginBottom: 8 }}>
                            <Input placeholder="Milestone title" style={{ width: 280 }} />
                          </Form.Item>
                          <Form.Item {...f} name={[f.name, 'dueDate']} style={{ marginBottom: 8 }}>
                            <DatePicker placeholder="Due" format="DD MMM YYYY" />
                          </Form.Item>
                          <Button danger type="text" onClick={() => remove(f.name)}>Remove</Button>
                        </Space>
                      ))}
                      <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()}>Add milestone</Button>
                    </>
                  )}
                </Form.List>
              </Space>
            </div>
          </div>

          <div className="crud-section">
            <SectionHead><NumberOutlined /> Evaluation rubric</SectionHead>
            <div className="crud-section-body">
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Form.List name="rubric">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((f) => (
                        <Space key={f.key} align="baseline" wrap>
                          <Form.Item {...f} name={[f.name, 'criterion']} rules={[{ required: true, message: 'Criterion' }]} style={{ marginBottom: 8 }}>
                            <Input placeholder="Criterion" style={{ width: 260 }} />
                          </Form.Item>
                          <Form.Item {...f} name={[f.name, 'maxMarks']} style={{ marginBottom: 8 }}>
                            <InputNumber min={1} placeholder="Max marks" />
                          </Form.Item>
                          <Button danger type="text" onClick={() => remove(f.name)}>Remove</Button>
                        </Space>
                      ))}
                      <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()}>Add criterion</Button>
                    </>
                  )}
                </Form.List>
              </Space>
            </div>
          </div>
        </Form>
      </Modal>

      <Drawer open={!!detail} onClose={() => setDetail(null)} width={640} closable={false}>
        {detail && (
          <div className="submission-page" style={{ margin: '-24px' }}>
            <div className="page" style={{ maxWidth: 'none' }}>
              <div className="submission-header">
                <button type="button" className="back-btn" onClick={() => setDetail(null)}><CloseOutlined /></button>
                <h1>{detail.title} — {detail.studentName}</h1>
              </div>

              <div className="top-info">
                <div className="meta">
                  {detail.code && <span className="badge project">{detail.code}</span>}
                  <span className={`badge${['submitted', 'in_review'].includes(detail.status) ? ' submitted' : ''}`}>
                    {STATUS_LABEL[detail.status] || detail.status}
                  </span>
                  {detail.dueDate && <span className="badge due">Due {dayjs(detail.dueDate).format('D MMM YYYY')}</span>}
                </div>
                {detail.finalScore != null && (
                  <div className="score-card">
                    <div>
                      <span className="score-label">Final score</span>
                      <span className="score-value">{detail.finalScore}%</span>
                    </div>
                    <div>
                      <span className="score-label">Grade</span>
                      <span className="score-value">{detail.finalGrade}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="detail-card">
                <div className="section-title">Problem statement</div>
                <div style={{ padding: '16px 20px', color: '#425873', fontSize: 13, lineHeight: 1.6 }}>{detail.problemStatement || '—'}</div>

                <div className="section-title">Milestones</div>
                <div style={{ padding: '6px 20px 16px' }}>
                  <List size="small" dataSource={detail.milestones} renderItem={(m) => (
                    <List.Item style={{ border: 'none', padding: '8px 0' }}>
                      <Space>
                        {m.status === 'done' ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <Tag>{m.status}</Tag>}
                        <span>{m.title}</span>
                        {m.dueDate && <Text type="secondary">({dayjs(m.dueDate).format('D MMM')})</Text>}
                      </Space>
                    </List.Item>
                  )} />
                </div>

                <div className="section-title">Submissions</div>
                <div style={{ padding: '16px 20px' }}>
                  {(!detail.submissions || detail.submissions.length === 0) ? <Text type="secondary">No submission yet.</Text> : (
                    <Timeline items={detail.submissions.slice().reverse().map((s) => ({
                      children: (
                        <div key={s.version}>
                          <b>v{s.version}</b> — {dayjs(s.submittedAt).format('D MMM, HH:mm')}
                          <br />{s.note}
                          <br />
                          {s.githubUrl && <a href={s.githubUrl} target="_blank" rel="noopener noreferrer"><GithubOutlined /> repo</a>}{' '}
                          {s.deploymentUrl && <a href={s.deploymentUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8 }}><LinkOutlined /> live</a>}
                          {s.review && <Alert style={{ marginTop: 6 }} type={s.review.decision === 'approved' ? 'success' : s.review.decision === 'rejected' ? 'error' : 'warning'} message={`${s.review.decision.replace('_', ' ')} by ${s.review.byName}`} description={s.review.feedback} />}
                        </div>
                      ),
                    }))} />
                  )}
                </div>

                {detail.status !== 'approved' && detail.status !== 'rejected' && detail.submissions && detail.submissions.length > 0 && (
                  <>
                    <button type="button" className="review-latest" onClick={() => setReviewOpen((o) => !o)}>
                      <span><CheckCircleOutlined /> &nbsp;REVIEW LATEST SUBMISSION</span>
                      <span>{reviewOpen ? '▲' : '▼'}</span>
                    </button>
                    {reviewOpen && (
                      <div className="evaluation">
                        <div className="form-group">
                          <label className="form-label"><FlagOutlined /> Decision</label>
                          <select
                            className="decision-select"
                            value={reviewState.decision}
                            onChange={(e) => setReviewState((s) => ({ ...s, decision: e.target.value }))}
                          >
                            <option value="" disabled>Select a decision…</option>
                            <option value="approved">Approve</option>
                            <option value="revision_requested">Request revision</option>
                            <option value="rejected">Reject</option>
                          </select>
                        </div>
                        <div className="marks-grid" style={{ marginTop: 18 }}>
                          {(detail.rubric || []).map((r) => (
                            <div className="mark-field" key={r.criterion}>
                              <label>{r.criterion} (max {r.maxMarks})</label>
                              <input
                                className="mark-input"
                                type="number"
                                min={0}
                                max={r.maxMarks}
                                value={reviewState.rubricMarks[r.criterion] ?? ''}
                                onChange={(e) => setReviewState((s) => ({ ...s, rubricMarks: { ...s.rubricMarks, [r.criterion]: e.target.value } }))}
                                placeholder="0"
                              />
                            </div>
                          ))}
                        </div>
                        <label className="feedback-label">Feedback</label>
                        <textarea
                          className="feedback"
                          value={reviewState.feedback}
                          onChange={(e) => setReviewState((s) => ({ ...s, feedback: e.target.value }))}
                          placeholder="Notes for the candidate…"
                        />
                        <div className="review-actions">
                          <button type="button" className="cancel-btn" onClick={() => setDetail(null)}>Cancel</button>
                          <button type="button" className="save-btn" disabled={saving} onClick={submitReview}>{saving ? 'Saving…' : 'Save review'}</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

/* ═══════════ STUDENT — my project(s) ═══════════ */
function MyProjects() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitOpen, setSubmitOpen] = useState(null); // project
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    lmsApi.myProjects().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleMilestone = async (project, idx, checked) => {
    try {
      await lmsApi.updateMilestone(project.id, { index: idx, status: checked ? 'done' : 'in_progress' });
      load();
    } catch (e) { message.error('Update failed'); }
  };

  const doSubmit = async () => {
    let v; try { v = await form.validateFields(); } catch (e) { return; }
    setSaving(true);
    try {
      const res = await lmsApi.submitProject(submitOpen.id, v);
      message.success(res?.message || 'Submitted.');
      setSubmitOpen(null); form.resetFields(); load();
    } catch (e) { message.error('Submit failed.'); } finally { setSaving(false); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head"><div><h2><ProjectOutlined /> My Projects</h2><p>Only you, your mentor and admin can see your project.</p></div></div>
      {rows.length === 0 ? <Card><Empty description="No project assigned yet." /></Card> : rows.map((p) => (
        <Card key={p.id} style={{ marginBottom: 16 }}
          title={<Space>{p.code && <Tag color="purple">{p.code}</Tag>}<b>{p.title}</b><Tag color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status] || p.status}</Tag></Space>}
          extra={p.status !== 'approved' && <Button type="primary" icon={<SendOutlined />} onClick={() => { setSubmitOpen(p); setTimeout(() => form.setFieldsValue({ githubUrl: p.githubUrl, deploymentUrl: p.deploymentUrl }), 0); }}>Submit</Button>}>
          <Paragraph type="secondary">{p.problemStatement}</Paragraph>
          {p.mentor && <Text type="secondary">Mentor: {p.mentor}</Text>}
          <Divider style={{ margin: '10px 0' }} />
          <List size="small" header={<b>Milestones</b>} dataSource={p.milestones || []} renderItem={(m, idx) => (
            <List.Item>
              <Checkbox checked={m.status === 'done'} onChange={(e) => toggleMilestone(p, idx, e.target.checked)}>
                {m.title} {m.dueDate && <Text type="secondary">— due {dayjs(m.dueDate).format('D MMM')}</Text>}
              </Checkbox>
            </List.Item>
          )} />
          {p.submissions && p.submissions.length > 0 && (
            <>
              <Divider style={{ margin: '10px 0' }} />
              <Text strong>Latest feedback</Text>
              {(() => {
                const last = p.submissions[p.submissions.length - 1];
                if (!last.review) return <div><Text type="secondary">Awaiting review (v{last.version}).</Text></div>;
                return <Alert style={{ marginTop: 6 }} type={last.review.decision === 'approved' ? 'success' : last.review.decision === 'rejected' ? 'error' : 'warning'} message={`${last.review.decision.replace('_', ' ')} by ${last.review.byName}`} description={last.review.feedback} />;
              })()}
            </>
          )}
        </Card>
      ))}

      <Modal
        className="crud-modal"
        open={!!submitOpen}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><SendOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">Submit for review</span>
              <span className="crud-modal-title-main">{submitOpen?.title}</span>
            </span>
          </span>
        }
        onCancel={() => setSubmitOpen(null)}
        onOk={doSubmit}
        confirmLoading={saving}
        okText="Submit for review"
        destroyOnClose
        maskClosable={false}
      >
        <Form form={form} layout="vertical" className="crud-form" preserve={false}>
          <div className="crud-form-grid">
            <Form.Item name="githubUrl" label={<Lbl icon={<GithubOutlined />}>GitHub repository URL</Lbl>} className="crud-form-full">
              <Input placeholder="https://github.com/..." />
            </Form.Item>
            <Form.Item name="deploymentUrl" label={<Lbl icon={<LinkOutlined />}>Deployment / live URL</Lbl>} className="crud-form-full">
              <Input placeholder="https://..." />
            </Form.Item>
            <Form.Item name="note" label={<Lbl icon={<FileTextOutlined />}>Notes for your mentor</Lbl>} className="crud-form-full">
              <Input.TextArea rows={3} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

export default function Projects() {
  const admin = useSelector(selectCurrentAdmin) || {};
  if (MGR.includes(admin.role) || LMS_TEACHER_ROLES.includes(admin.role)) return <ManageProjects />;
  return <MyProjects />;
}
