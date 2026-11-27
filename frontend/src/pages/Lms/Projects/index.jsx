import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Radio, Space, Empty, Skeleton, message, Typography, DatePicker, Steps, Checkbox, List, Divider, Timeline, Alert, Popconfirm,
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
import '../Policies/policyDesign.css';
import { tablePagination } from '../components/ui';

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
  // qualification wording, as the learner sees it (LMS testing report #25)
  in_review: 'In Review', revision_requested: 'Revision Requested', approved: 'Qualified', rejected: 'Not qualified',
};

const PJ_TONE = { assigned: '', in_progress: 'blue', submitted: 'amber', in_review: 'amber', revision_requested: 'amber', approved: 'green', rejected: 'red' };

// A long one-paragraph brief ("… 1. Assigned Project … 2. Mandatory …") reads
// as numbered sections; anything past ~700 chars folds behind "Show full".
function ProblemText({ text }) {
  const [full, setFull] = useState(false);
  const raw = String(text || '').trim();
  if (!raw) return <div className="pjm-empty">No problem statement.</div>;
  const parts = raw.split(/\n+|\s(?=\d{1,2}\.\s+[A-Z])/).map((x) => x.trim()).filter(Boolean);
  const long = raw.length > 700;
  return (
    <div className={`pjm-ps${long && !full ? ' folded' : ''}`}>
      {parts.map((p, i) => {
        const m = p.match(/^(\d{1,2})\.\s+(.*)$/s);
        return m
          ? <p key={i} className="pjm-ps-n"><b>{m[1]}</b><span>{m[2]}</span></p>
          : <p key={i}>{p}</p>;
      })}
      {long && <button type="button" className="pjm-more" onClick={() => setFull((v) => !v)}>{full ? 'Show less ▲' : 'Show full brief ▼'}</button>}
    </div>
  );
}

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
          rowKey="id" dataSource={rows} pagination={tablePagination({ defaultPageSize: 12 })} onRow={(r) => ({ onClick: () => openDetail(r), style: { cursor: 'pointer' } })}
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

      <Modal open={!!detail} onCancel={() => setDetail(null)} footer={null} width={1040} centered destroyOnClose rootClassName="pol-modal">
        {detail && (() => {
          const d = detail;
          const at = STAGE_AT[d.status] ?? 0;
          const ms = d.milestones || [];
          const msDone = ms.filter((m) => m.status === 'done').length;
          const subs = d.submissions || [];
          const canReview = d.status !== 'approved' && d.status !== 'rejected' && subs.length > 0;
          const maxTotal = (d.rubric || []).reduce((n, r) => n + (Number(r.maxMarks) || 0), 0);
          const given = (d.rubric || []).reduce((n, r) => n + (Number(reviewState.rubricMarks[r.criterion]) || 0), 0);
          const overdue = d.dueDate && dayjs(d.dueDate).isBefore(dayjs(), 'day') && !['approved', 'rejected'].includes(d.status);
          return (
            <div className="pol-m">
              <div className="pol-m-head pjm-head">
                <div className="pjm-head-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="pol-m-tags">
                      {d.code && <span className="pol-chip violet">{d.code}</span>}
                      <span className={`pol-chip ${PJ_TONE[d.status] || ''}`}>{STATUS_LABEL[d.status] || d.status}</span>
                      {d.dueDate && <span className={`pol-chip ${overdue ? 'red' : 'blue'}`}><CalendarOutlined /> {overdue ? 'Overdue · ' : 'Due '}{dayjs(d.dueDate).format('D MMM YYYY')}</span>}
                      {d.blocker && d.blocker.text && <span className="pol-chip amber">Blocker flagged</span>}
                    </div>
                    <h3 style={{ marginTop: 8 }}>{d.title}</h3>
                    <div className="pol-m-meta">
                      <span><UserOutlined /> <b>{d.studentName}</b>{d.studentEmail ? ` · ${d.studentEmail}` : ''}</span>
                      {d.batch && <span><TeamOutlined /> {d.batch}</span>}
                      {d.courseTitle && <span><ProjectOutlined /> {d.courseTitle}</span>}
                      {d.mentorName && <span>PM: {d.mentorName}</span>}
                    </div>
                  </div>
                  {d.finalScore != null && (
                    <div className="pjm-score"><b>{d.finalScore}%</b><span>Grade {d.finalGrade || '—'}</span></div>
                  )}
                </div>
              </div>

              <div className="pol-steps" aria-label="Project lifecycle">
                {STAGES.map((s, i) => (
                  <div key={s} className={`pol-step${stageCls(i, at, d.status)}`}>
                    <i>{i < at ? <CheckCircleOutlined /> : d.status === 'rejected' && i === at ? <CloseOutlined /> : i + 1}</i>
                    <span>{stageLabel(s, d)}</span>
                  </div>
                ))}
              </div>

              <div className="pol-m-body">
                {d.blocker && d.blocker.text && (
                  <div className="pol-alert bad"><FlagOutlined /><span><b>Blocker:</b> {d.blocker.text}{d.blocker.at ? ` · flagged ${dayjs(d.blocker.at).format('D MMM')}` : ''}</span></div>
                )}
                <div className="pol-m-grid">
                  <div className="pjm-col">
                    <section className="pol-box">
                      <div className="pol-cap"><FileTextOutlined /> Problem statement</div>
                      <ProblemText text={d.problemStatement} />
                      {d.scope && <><div className="pol-cap" style={{ marginTop: 4 }}>Scope</div><ProblemText text={d.scope} /></>}
                    </section>

                    <section className="pol-box">
                      <div className="pol-cap">Submissions · {subs.length}</div>
                      {subs.length === 0 ? <div className="pjm-empty">No submission yet — the candidate hasn&apos;t sent anything.</div> : (
                        <div className="pjm-subs">
                          {subs.slice().reverse().map((s, i) => (
                            <div key={s.version} className={`pjm-sub${i === 0 ? ' cur' : ''}`}>
                              <div className="pjm-sub-top">
                                <b>v{s.version}</b>
                                <span className="pol-note">{dayjs(s.submittedAt).format('D MMM YYYY, h:mm A')}</span>
                                {i === 0 && <span className="pol-chip teal">Latest</span>}
                              </div>
                              {s.note && <div className="pjm-sub-note">{s.note}</div>}
                              <div className="pjm-links">
                                {s.githubUrl && <a href={s.githubUrl} target="_blank" rel="noopener noreferrer"><GithubOutlined /> Repo</a>}
                                {s.deploymentUrl && <a href={s.deploymentUrl} target="_blank" rel="noopener noreferrer"><LinkOutlined /> Live</a>}
                                {s.demoUrl && <a href={s.demoUrl} target="_blank" rel="noopener noreferrer"><LinkOutlined /> Demo</a>}
                                {(s.files || []).map((x) => <a key={x.url} href={`${BASE_URL}${x.url}`} target="_blank" rel="noopener noreferrer"><FileTextOutlined /> {x.name}</a>)}
                              </div>
                              {s.review && (
                                <div className={`pol-alert ${s.review.decision === 'approved' ? 'ok' : s.review.decision === 'rejected' ? 'bad' : 'info'}`}>
                                  <span><b>{STATUS_LABEL[s.review.decision] || s.review.decision.replace('_', ' ')}</b> by {s.review.byName}{s.review.feedback ? ` — ${s.review.feedback}` : ''}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  <div className="pjm-col">
                    <section className="pol-box">
                      <div className="pjm-cap-row"><span className="pol-cap"><FlagOutlined /> Milestones</span><span className="pol-note">{msDone}/{ms.length} done</span></div>
                      {ms.length > 0 && <div className="pjm-bar"><div style={{ width: `${ms.length ? (msDone / ms.length) * 100 : 0}%` }} /></div>}
                      {ms.length === 0 ? <div className="pjm-empty">No milestones set.</div> : (
                        <div className="pjm-ms">
                          {ms.map((m, i) => (
                            <div key={i} className={`pjm-m ${m.status === 'done' ? 'done' : m.status === 'in_progress' ? 'on' : ''}`}>
                              <i>{m.status === 'done' ? <CheckCircleOutlined /> : i + 1}</i>
                              <span className="pjm-m-t">{m.title}</span>
                              {m.dueDate && <span className="pol-note">{dayjs(m.dueDate).format('D MMM')}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    {canReview ? (
                      <section className="pol-box pjm-review">
                        <div className="pjm-cap-row"><span className="pol-cap"><CheckCircleOutlined /> Review v{subs[subs.length - 1].version}</span>{maxTotal > 0 && <span className="pol-chip">{given}/{maxTotal}</span>}</div>
                        <div className="pjm-dec">
                          {[['approved', 'Approve', 'ok'], ['revision_requested', 'Request revision', 'mid'], ['rejected', 'Reject', 'bad']].map(([k, label, tone]) => (
                            <button key={k} type="button" className={`pjm-dec-b ${tone}${reviewState.decision === k ? ' on' : ''}`} onClick={() => setReviewState((s) => ({ ...s, decision: k }))}>{label}</button>
                          ))}
                        </div>
                        {(d.rubric || []).length > 0 && (
                          <div className="pjm-rubric">
                            {(d.rubric || []).map((r) => (
                              <label key={r.criterion} className="pjm-rb">
                                <span>{r.criterion}</span>
                                <InputNumber size="small" min={0} max={r.maxMarks} value={reviewState.rubricMarks[r.criterion] === '' ? null : reviewState.rubricMarks[r.criterion]} onChange={(v) => setReviewState((s) => ({ ...s, rubricMarks: { ...s.rubricMarks, [r.criterion]: v ?? '' } }))} placeholder="0" style={{ width: 72 }} />
                                <small>/ {r.maxMarks}</small>
                              </label>
                            ))}
                          </div>
                        )}
                        <Input.TextArea rows={3} value={reviewState.feedback} onChange={(e) => setReviewState((s) => ({ ...s, feedback: e.target.value }))} placeholder="Feedback for the candidate…" />
                        {reviewState.decision === 'revision_requested' && (
                          <Input.TextArea rows={3} value={reviewState.changes || ''} onChange={(e) => setReviewState((s) => ({ ...s, changes: e.target.value }))} placeholder={'Requested changes — one per line\nREADME setup steps\nSample output screenshots'} />
                        )}
                      </section>
                    ) : (
                      <div className={`pol-alert ${d.status === 'approved' ? 'ok' : d.status === 'rejected' ? 'bad' : 'info'}`}>
                        <CheckCircleOutlined />
                        <span>{d.status === 'approved' ? 'Qualified — review is closed.' : d.status === 'rejected' ? 'Not qualified — review is closed.' : 'Review opens once the candidate submits.'}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="pol-m-foot">
                <div>
                  {isMgr && (
                    <Popconfirm title="Delete this project?" description="Removes the whole record — assignment, milestones and every submission." okText="Delete" okButtonProps={{ danger: true }} onConfirm={async () => { await remove({ id: d.id || d._id }); setDetail(null); }}>
                      <Button danger icon={<DeleteOutlined />}>Delete</Button>
                    </Popconfirm>
                  )}
                </div>
                <div className="pol-m-foot-r">
                  <Button onClick={() => setDetail(null)}>Close</Button>
                  {canReview && <Button type="primary" loading={saving} disabled={!reviewState.decision} onClick={submitReview}>Save review</Button>}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

/* ═══════════ STUDENT — my project(s) ═══════════ */
// design board L6 "Project 360": lifecycle bar, then Milestones | Submission | Review
// 2026-11-27: only the steps the API really moves through. "Under review" (no
// route ever set it) and "Eligibility updated" (eligibility never counted
// projects) were removed. A rejected project ends on a red "Not qualified".
const STAGES = ['Assigned', 'In progress', 'Submitted', 'Changes requested', 'Qualified'];
const STAGE_AT = { assigned: 0, in_progress: 1, submitted: 2, in_review: 2, revision_requested: 3, rejected: 4, approved: 5 };
const stageLabel = (s, p) => {
  const n = (p.submissions || []).length;
  if (s === 'Submitted' && n) return `Submitted v${n}`;
  if (s === 'Qualified' && p.status === 'rejected') return 'Not qualified';
  return s;
};
const stageCls = (i, at, status) => (i < at ? ' done' : i === at ? (status === 'rejected' ? ' bad' : ' on') : '');
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
          <div key={s} className={`ld-stp${stageCls(i, at, p.status)}`}>{stageLabel(s, p)}</div>
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
          <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>Final approval only by the Project Manager / authorised approver · every decision is logged in the audit</div>
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
