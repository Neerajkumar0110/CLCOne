import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Radio, Space, Empty, Skeleton, message, Typography, DatePicker, Drawer, Steps, Checkbox, List, Divider, Timeline, Alert, Popconfirm,
} from 'antd';
import {
  ProjectOutlined, PlusOutlined, GithubOutlined, LinkOutlined, SendOutlined, CheckCircleOutlined,
  MailOutlined, UserOutlined, TagOutlined, FileTextOutlined, CalendarOutlined, NumberOutlined, FlagOutlined, TeamOutlined,
  CloseOutlined, DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import './projects.css';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import { BASE_URL } from '@/config/serverApiConfig';
import lmsApi from '../api';
import '../components/LearnerDesign.css';

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
  const [deletingId, setDeletingId] = useState(null);

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

  const remove = async (row) => {
    setDeletingId(row.id);
    try { await lmsApi.deleteProject(row.id); message.success('Project deleted.'); load(); }
    catch (e) { message.error('Delete failed.'); } finally { setDeletingId(null); }
  };

  const submitReview = async () => {
    if (!reviewState.decision) { message.error('Pick a decision.'); return; }
    setSaving(true);
    try {
      const rubricScores = (detail.rubric || []).map((r) => ({ criterion: r.criterion, marks: Number(reviewState.rubricMarks[r.criterion]) || 0 }));
      const res = await lmsApi.reviewProject(detail.id || detail._id, { decision: reviewState.decision, feedback: reviewState.feedback, changes: reviewState.decision === 'revision_requested' ? reviewState.changes || '' : '', rubricScores });
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
            { title: 'Internship', dataIndex: 'course' },
            { title: 'Title', dataIndex: 'title' },
            { title: 'Project Manager', dataIndex: 'mentor' },
            { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v] || v}</Tag> },
            { title: 'Due', dataIndex: 'dueDate', render: (v) => (v ? dayjs(v).format('D MMM') : '—') },
            { title: 'Score', dataIndex: 'finalScore', render: (v, r) => (v != null ? `${v}% (${r.finalGrade})` : '—') },
            ...(isMgr
              ? [
                  {
                    title: '',
                    width: 60,
                    render: (_, r) => (
                      // Rows are themselves clickable (onRow opens the detail
                      // drawer) — stop the click here so Delete doesn't also
                      // pop the drawer open behind the confirm.
                      <span onClick={(e) => e.stopPropagation()}>
                        <Popconfirm
                          title="Delete this project?"
                          description="Removes the whole record — assignment, milestones and every submission."
                          okText="Delete" okButtonProps={{ danger: true }}
                          onConfirm={() => remove(r)}
                        >
                          <Button size="small" danger icon={<DeleteOutlined />} loading={deletingId === r.id} />
                        </Popconfirm>
                      </span>
                    ),
                  },
                ]
              : []),
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
              <Form.Item name="mentorEmail" label={<Lbl icon={<UserOutlined />}>Project Manager email</Lbl>} extra="Optional — defaults to the batch's trainer" className="crud-form-full">
                <Input placeholder="projectmanager@example.com" />
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
                        {reviewState.decision === 'revision_requested' && (
                          <>
                            <label className="feedback-label">Requested changes (one per line)</label>
                            <textarea
                              className="feedback"
                              value={reviewState.changes || ''}
                              onChange={(e) => setReviewState((s) => ({ ...s, changes: e.target.value }))}
                              placeholder={'README setup steps\nSample output screenshots'}
                            />
                          </>
                        )}
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
// design board L6 "Project 360": lifecycle bar, then Milestones | Submission | Review
const STAGES = ['Assigned', 'In progress', 'Submitted', 'Under review', 'Changes requested', 'Approved', 'Eligibility updated'];
const STAGE_AT = { assigned: 0, in_progress: 1, submitted: 2, in_review: 3, revision_requested: 4, rejected: 4, approved: 6 };
const MS_CHIP = { done: ['hai', 'Done'], in_progress: ['naya', 'In progress'], pending: ['gray', 'Not started'] };
const DECISION_CHIP = { approved: 'hai', rejected: 'red', revision_requested: 'adh' };

function ProjectBlock({ p, onChanged }) {
  const navigate = useNavigate();
  const last = (p.submissions || [])[p.submissions.length - 1];
  const [f, setF] = useState({ githubUrl: (last && last.githubUrl) || p.githubUrl || '', deploymentUrl: (last && last.deploymentUrl) || p.deploymentUrl || '', demoUrl: (last && last.demoUrl) || '', note: '' });
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState([]); // uploaded for the next version: { name, url }
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [blockerOpen, setBlockerOpen] = useState(false);
  const [blockerText, setBlockerText] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const at = STAGE_AT[p.status] ?? 0;
  const curMilestone = (p.milestones || []).findIndex((m) => m.status !== 'done');
  const shaOf = (u) => {
    const m = String(u || '').match(/\/commit\/([0-9a-f]{7,40})/i);
    return m ? m[1].slice(0, 7) : '';
  };

  const upload = async (list) => {
    const picked = [...(list || [])];
    if (!picked.length) return;
    setUploading(true);
    for (const file of picked) {
      if (!/\.(zip|pdf|ipynb)$/i.test(file.name)) {
        message.error(`${file.name}: only zip / pdf / ipynb`);
        continue;
      }
      if (file.size > 50 * 1024 * 1024) {
        message.error(`${file.name}: larger than 50 MB`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await lmsApi.uploadProjectFile(p.id, file).catch(() => null);
      if (r && r.success !== false && r.result) setFiles((xs) => [...xs, { name: r.result.name, url: r.result.url }]);
      else message.error((r && r.message) || `${file.name}: upload failed`);
    }
    setUploading(false);
  };
  const sendBlocker = async (text) => {
    const r = await lmsApi.setProjectBlocker(p.id, text).catch(() => null);
    if (!r || r.success === false) return message.error((r && r.message) || 'Could not save.');
    setBlockerOpen(false);
    setBlockerText('');
    onChanged();
    return null;
  };
  const nextVersion = (p.submissions || []).length + 1;
  const review = last && last.review;
  const scores = (review && review.rubricScores) || [];

  const toggleMilestone = async (idx, checked) => {
    try {
      await lmsApi.updateMilestone(p.id, { index: idx, status: checked ? 'done' : 'in_progress' });
      onChanged();
    } catch (e) {
      message.error('Update failed');
    }
  };
  const submit = async () => {
    setSaving(true);
    try {
      const res = await lmsApi.submitProject(p.id, { ...f, files });
      if (res && res.success === false) throw new Error(res.message);
      message.success((res && res.message) || 'Submitted.');
      setF((x) => ({ ...x, note: '' }));
      setFiles([]);
      onChanged();
    } catch (e) {
      message.error((e && e.message) || 'Submit failed.');
    } finally {
      setSaving(false);
    }
  };
  const requestExtension = () =>
    navigate('/learn/support', {
      state: {
        raise: {
          category: 'Project',
          subject: `Project extension request · ${p.title}`,
          reference: [p.code, p.title, p.dueDate && `due ${dayjs(p.dueDate).format('D MMM YYYY')}`].filter(Boolean).join(' · '),
          description: 'Which milestone:\nReason:\nNew date I can commit to:',
        },
      },
    });

  return (
    <div className="pj-block" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ld-hd">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>{p.title}</h1>
          <div className="ld-muted" style={{ fontSize: 14 }}>
            {[p.mentor && `Project Manager: ${p.mentor}`, p.created && `Assigned ${dayjs(p.created).format('D MMM')}`, p.dueDate && `Final due ${dayjs(p.dueDate).format('D MMM YYYY')}`].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span className={`ld-chip ${DECISION_CHIP[p.status] || 'gray'}`}>{STATUS_LABEL[p.status] || p.status}</span>
      </div>
      <div className="ld-steps" aria-label="Project lifecycle">
        {STAGES.map((s, i) => (
          <div key={s} className={`ld-stp${i < at ? ' done' : i === at ? ' on' : ''}`}>{s === 'Submitted' && (p.submissions || []).length ? `Submitted v${p.submissions.length}` : s}</div>
        ))}
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <section className="ld-card" aria-label="Milestones" style={{ gap: 12 }}>
          <div className="ld-hd"><b>Milestones</b></div>
          {p.problemStatement && <div className="ld-muted" style={{ fontSize: 13 }}>{p.problemStatement}</div>}
          <table className="ld-table">
            <thead><tr><th>Milestone</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {(p.milestones || []).length === 0 && <tr><td colSpan={3} className="ld-empty">No milestones set.</td></tr>}
              {(p.milestones || []).map((m, idx) => (
                <tr key={idx}>
                  <td><label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}><input type="checkbox" checked={m.status === 'done'} onChange={(e) => toggleMilestone(idx, e.target.checked)} /> {idx + 1} · {m.title}</label></td>
                  <td>{m.dueDate ? dayjs(m.dueDate).format('D MMM') : '—'}</td>
                  <td><span className={`ld-chip ${(MS_CHIP[m.status] || MS_CHIP.pending)[0]}`}>{(MS_CHIP[m.status] || MS_CHIP.pending)[1]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.blocker ? (
            <div className="ld-warn">
              <b>Blocker:</b> {p.blocker.text} — flagged to the PM ({dayjs(p.blocker.at).format('D MMM')}){' '}
              {p.status !== 'approved' && <button type="button" className="ld-link" onClick={() => sendBlocker('')}>Resolved</button>}
            </div>
          ) : p.status !== 'approved' && (blockerOpen ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="ld-inp" style={{ flex: 1 }} aria-label="Blocker" maxLength={500} value={blockerText} onChange={(e) => setBlockerText(e.target.value)} placeholder="What's blocking you? (e.g. API key limit)" />
              <button type="button" className="ld-btn2 sm" disabled={!blockerText.trim()} onClick={() => sendBlocker(blockerText)}>Flag to PM</button>
            </div>
          ) : (
            <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => setBlockerOpen(true)}>Blocked? Flag it to the PM</button>
          ))}
          {p.status !== 'approved' && <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={requestExtension}>Need an extension? Request it from the PM (approval recorded)</button>}
        </section>

        <section className="ld-card" aria-label="Submission" style={{ gap: 12 }}>
          <div className="ld-hd"><b>Submission{p.status === 'approved' ? '' : curMilestone >= 0 ? ` · Milestone ${curMilestone + 1}` : ` · v${nextVersion}`}</b></div>
          {p.status !== 'approved' && (
            <label
              className={`pj-drop${drag ? ' on' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
            >
              <input type="file" accept=".zip,.pdf,.ipynb" multiple style={{ display: 'none' }} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
              <b>{uploading ? 'Uploading…' : 'Drop files or browse'}</b>
              <span className="ld-muted">zip / pdf / ipynb · max 50 MB</span>
            </label>
          )}
          {files.map((x, i) => (
            <div className="ld-li" key={x.url}>
              <a href={`${BASE_URL}${x.url}`} target="_blank" rel="noopener noreferrer">{x.name}</a>
              <button type="button" className="ld-link" onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <label className="ld-label">GitHub repo + commit<input className="ld-inp full" name="githubUrl" value={f.githubUrl} onChange={set('githubUrl')} placeholder="https://github.com/…" disabled={p.status === 'approved'} /></label>
          <label className="ld-label">Deployment URL<input className="ld-inp full" name="deploymentUrl" value={f.deploymentUrl} onChange={set('deploymentUrl')} placeholder="https://…" disabled={p.status === 'approved'} /></label>
          <label className="ld-label">Demo video<input className="ld-inp full" name="demoUrl" value={f.demoUrl} onChange={set('demoUrl')} placeholder="Loom / Drive link" disabled={p.status === 'approved'} /></label>
          {p.status !== 'approved' && <label className="ld-label">Note for your Project Manager<textarea className="ld-inp full" name="note" style={{ height: 60 }} value={f.note} onChange={set('note')} /></label>}
          <div style={{ fontSize: 13, fontWeight: 600 }}>Version history</div>
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(p.submissions || []).length === 0 && <span className="ld-muted">No submission yet.</span>}
            {[...(p.submissions || [])].reverse().map((s, i) => (
              <div key={s.version} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>v{s.version} · {dayjs(s.submittedAt).format('D MMM h:mm A')}{shaOf(s.githubUrl) ? ` · sha ${shaOf(s.githubUrl)}` : ''}{(s.files || []).map((x) => <React.Fragment key={x.url}> · <a href={`${BASE_URL}${x.url}`} target="_blank" rel="noopener noreferrer">{x.name}</a></React.Fragment>)}{s.githubUrl ? <> · <a href={s.githubUrl} target="_blank" rel="noopener noreferrer">repo</a></> : null}{s.deploymentUrl ? <> · <a href={s.deploymentUrl} target="_blank" rel="noopener noreferrer">live</a></> : null}{s.demoUrl ? <> · <a href={s.demoUrl} target="_blank" rel="noopener noreferrer">demo</a></> : null}</span>
                <span className="ld-muted">{i === 0 ? 'current' : 'kept'}</span>
              </div>
            ))}
          </div>
          {p.status !== 'approved' && <button type="button" className="ld-btn md" style={{ marginTop: 'auto' }} disabled={saving} onClick={submit}>{saving ? 'Submitting…' : `Submit v${nextVersion}`}</button>}
        </section>

        <section className="ld-card" aria-label="Review" style={{ gap: 12 }}>
          <div className="ld-hd"><b>Review{last ? ` (v${last.version})` : ''}</b>{review && <span className={`ld-chip ${DECISION_CHIP[review.decision] || 'gray'}`}>{review.decision.replace('_', ' ')}</span>}</div>
          {!last && <div className="ld-muted" style={{ fontSize: 13 }}>Review appears here after your first submission.</div>}
          {last && !review && <div className="ld-muted" style={{ fontSize: 13 }}>Awaiting review (v{last.version}).</div>}
          {scores.map((s) => {
            const max = ((p.rubric || []).find((r) => r.criterion === s.criterion) || {}).maxMarks || 10;
            return (
              <div className="ld-rb" key={s.criterion}>
                <span>{s.criterion}</span>
                <div className="ld-track"><div style={{ width: `${Math.min(100, (s.marks / max) * 100)}%` }} /></div>
                <b>{s.marks}/{max}</b>
              </div>
            );
          })}
          {review && review.feedback && <div className="ld-soft">&quot;{review.feedback}&quot; — {review.byName}{review.at ? `, ${dayjs(review.at).format('D MMM')}` : ''}</div>}
          {(() => {
            // the latest review that asked for changes, and whether a newer version answered it
            const subs = p.submissions || [];
            let ri = -1;
            subs.forEach((s, i) => {
              if (s.review && (s.review.changes || []).length) ri = i;
            });
            if (ri < 0) return null;
            const answered = ri < subs.length - 1;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <b>Requested changes</b>
                {subs[ri].review.changes.map((c) => (
                  <span key={c}>• {c}{answered && <span className="ld-muted"> (v{subs[subs.length - 1].version} submitted)</span>}</span>
                ))}
              </div>
            );
          })()}
          <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Final approval only by the Project Manager / authorised approver · the eligibility update is logged in the audit</div>
        </section>
      </div>
    </div>
  );
}

function MyProjects() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    lmsApi.myProjects().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;
  return (
    <div className="ld-page">
      {rows.length === 0 ? (
        <>
          <div className="ld-head"><div><h1>My project</h1><div className="ld-muted ld-sub">Only you, your project manager and admin can see your project.</div></div></div>
          <div className="ld-card"><div className="ld-empty">No project assigned yet.</div></div>
        </>
      ) : (
        rows.map((p) => <ProjectBlock key={p.id} p={p} onChanged={load} />)
      )}
    </div>
  );
}

export default function Projects() {
  const admin = useSelector(selectCurrentAdmin) || {};
  if (MGR.includes(admin.role) || LMS_TEACHER_ROLES.includes(admin.role)) return <ManageProjects />;
  return <MyProjects />;
}
