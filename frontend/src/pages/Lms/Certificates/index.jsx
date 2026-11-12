import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Checkbox, Space, Empty, Skeleton, message, Typography, Divider, Row, Col, Collapse, Progress, Tooltip,
} from 'antd';
import {
  TrophyOutlined, SafetyCertificateOutlined, ReloadOutlined, DownloadOutlined, TeamOutlined,
  LockOutlined, CheckCircleFilled, ClockCircleOutlined, FileDoneOutlined, EyeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import { BASE_URL } from '@/config/serverApiConfig';
import lmsApi from '../api';
import '../components/LearnerDesign.css';

// Every PDF download helper can fail (expired token, revoked certificate…) —
// surface it as a toast instead of a silent dead button.
const dl = (promise) =>
  promise.catch((e) => message.error(e?.userMessage || e?.message || 'Download failed. Please try again.'));

const { Text, Paragraph, Title } = Typography;
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

function slug(s) {
  return String(s || 'certificate').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Admin/Super Admin/Support/Sales Manager/owner + Teacher — "which batches
// exist, who's in them, who's actually earned a certificate yet" (per-batch
// headcount + roster), reading services/lms/certificatePdf's same
// Issued/Sent gate the student-facing download uses.
function BatchRoster() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    lmsApi.certificateRoster().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Roster load failed')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (!rows.length) return <Empty description="No candidates yet." />;

  return (
    <Collapse
      items={rows.map((b) => ({
        key: b.batch,
        label: (
          <Space>
            <b>{b.batch}</b>
            <Text type="secondary">{b.course}</Text>
            <Tag color={b.completed === b.total ? 'green' : 'blue'}>{b.completed}/{b.total} completed</Tag>
          </Space>
        ),
        children: (
          <Table
            rowKey="email"
            size="small"
            pagination={false}
            dataSource={b.students}
            columns={[
              { title: 'Candidate', dataIndex: 'name' },
              { title: 'Email', dataIndex: 'email' },
              { title: 'Progress', dataIndex: 'progress', width: 140, render: (v) => <Progress percent={v} size="small" /> },
              { title: 'Status', dataIndex: 'status', width: 100 },
              {
                title: 'Certificate',
                width: 170,
                render: (_, s) => (s.certificate
                  ? <Tag color="gold">{s.certificate.certificateId} · {s.certificate.grade}</Tag>
                  : <Tag>Not yet</Tag>),
              },
              {
                title: '',
                width: 100,
                render: (_, s) => (s.certificate ? (
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => dl(lmsApi.downloadCertificatePdf(s.certificate.id, false, slug(`${s.name}-${s.certificate.certificateId}`)))}
                  >
                    PDF
                  </Button>
                ) : null),
              },
            ]}
          />
        ),
      }))}
    />
  );
}

// isManagerRole: Admin/Super Admin/Support/Sales Manager/owner aren't a
// trainer on anything, so teacherDashboard()'s "my own courses" list always
// comes back empty for them (same gap fixed earlier for Assignments/
// AssessmentDashboard) — they instead get every course in the system.
function TeacherCertificates({ isManagerRole }) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [rule, setRule] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ruleForm] = Form.useForm();
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueForm] = Form.useForm();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [d, h] = await Promise.all([
          isManagerRole
            ? request.list({ entity: 'course', options: { items: 500, sortBy: 'title', sortValue: 1 } })
            : lmsApi.teacherDashboard(),
          lmsApi.certHistory(),
        ]);
        const list = isManagerRole
          ? ((d && d.result) || []).map((c) => ({ value: c._id, label: c.title }))
          : ((d && d.result && d.result.courses) || []).map((c) => ({ value: c.id, label: c.title }));
        setCourses(list);
        setHistory((h && h.result) || []);
        if (list[0]) setCourseId(list[0].value);
      } catch (e) { message.error('Load failed'); } finally { setLoading(false); }
    })();
  }, [isManagerRole]);

  const loadRule = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await lmsApi.certRule(id);
      const r = (res && res.result) || null;
      setRule(r);
      ruleForm.setFieldsValue(r || { minCoursePercent: 100, minAttendancePercent: 0, requireAllAssignments: false, minQuizPercent: 0, autoIssue: true, validMonths: 0, title: 'Certificate of Completion', type: 'Completion' });
    } catch (e) { /* */ }
  }, [ruleForm]);
  useEffect(() => { loadRule(courseId); }, [courseId, loadRule]);

  const saveRule = async () => {
    let v; try { v = await ruleForm.validateFields(); } catch (e) { return; }
    try { await lmsApi.saveCertRule(courseId, v); message.success('Rule saved'); loadRule(courseId); }
    catch (e) { message.error('Save failed'); }
  };
  const runNow = async () => {
    setRunning(true);
    try { const res = await lmsApi.runCertificates(courseId); message.success(res?.message || 'Done'); const h = await lmsApi.certHistory(); setHistory((h && h.result) || []); }
    catch (e) { message.error('Run failed'); } finally { setRunning(false); }
  };
  const issue = async () => {
    let v; try { v = await issueForm.validateFields(); } catch (e) { return; }
    try {
      const res = await lmsApi.issueCertificate({ course: courseId, studentEmail: v.studentEmail, force: v.force });
      message.success(res?.message || 'Done');
      setIssueOpen(false); issueForm.resetFields();
      const h = await lmsApi.certHistory(); setHistory((h && h.result) || []);
    } catch (e) { message.error('Failed'); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><TrophyOutlined /> Certificates</h2><p>Set the criteria — the system issues them automatically.</p></div>
        <Select style={{ minWidth: 240 }} value={courseId} onChange={setCourseId} options={courses} placeholder="Internship" />
      </div>

      <Card size="small" title={<Space><TeamOutlined /> Batch roster — who's in which batch, who's completed</Space>} style={{ marginBottom: 12 }}>
        <BatchRoster />
      </Card>

      {!courseId ? <Card><Empty description="No internships assigned." /></Card> : (
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={10}>
            <Card size="small" title="Issue criteria">
              <Form form={ruleForm} layout="vertical">
                <Form.Item name="title" label="Certificate title"><Input /></Form.Item>
                <Form.Item name="type" label="Type"><Select options={['Completion', 'Participation', 'Merit', 'Achievement'].map((v) => ({ value: v, label: v }))} /></Form.Item>
                <Space wrap>
                  <Form.Item name="minCoursePercent" label="Min internship %"><InputNumber min={0} max={100} /></Form.Item>
                  <Form.Item name="minAttendancePercent" label="Min attendance %"><InputNumber min={0} max={100} /></Form.Item>
                  <Form.Item name="minQuizPercent" label="Min quiz %"><InputNumber min={0} max={100} /></Form.Item>
                  <Form.Item name="validMonths" label="Valid (months, 0=∞)"><InputNumber min={0} /></Form.Item>
                </Space>
                <Space size="large">
                  <Form.Item name="requireAllAssignments" valuePropName="checked" noStyle><Checkbox>All assignments evaluated</Checkbox></Form.Item>
                  <Form.Item name="autoIssue" valuePropName="checked" noStyle><Checkbox>Auto-issue</Checkbox></Form.Item>
                  <Form.Item name="enabled" valuePropName="checked" noStyle initialValue><Checkbox>Enabled</Checkbox></Form.Item>
                </Space>
                <Divider style={{ margin: '12px 0' }} />
                <Space>
                  <Button type="primary" onClick={saveRule}>Save rule</Button>
                  <Button icon={<ReloadOutlined />} loading={running} onClick={runNow}>Re-check all candidates</Button>
                  <Button onClick={() => setIssueOpen(true)}>Issue manually</Button>
                </Space>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card size="small" title="Issued certificates">
              <Table
                rowKey="id"
                size="small"
                dataSource={history}
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: 'None yet' }}
                columns={[
                  { title: 'Candidate', dataIndex: 'student' },
                  { title: 'Internship', dataIndex: 'course' },
                  { title: 'ID', dataIndex: 'certificateId' },
                  { title: 'Grade', dataIndex: 'grade', width: 70 },
                  { title: 'Issued', dataIndex: 'issuedOn', render: (v) => (v ? dayjs(v).format('D MMM YY') : '—') },
                  { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={['Issued', 'Sent'].includes(s) ? 'green' : 'default'}>{s}</Tag> },
                  {
                    title: '',
                    width: 90,
                    render: (_, r) => (['Issued', 'Sent'].includes(r.status) ? (
                      <Button size="small" icon={<DownloadOutlined />} onClick={() => dl(lmsApi.downloadCertificatePdf(r.id, false, slug(`${r.student}-${r.certificateId}`)))}>PDF</Button>
                    ) : null),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}

      {isManagerRole && <ExternalReview />}

      <Modal open={issueOpen} title="Issue certificate manually" onCancel={() => setIssueOpen(false)} onOk={issue} okText="Check & issue" destroyOnClose>
        <Form form={issueForm} layout="vertical" preserve={false}>
          <Form.Item name="studentEmail" label="Candidate email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="force" valuePropName="checked" noStyle><Checkbox>Force (ignore criteria)</Checkbox></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/// Design board L8 — certificate preview on the left (520px, dark panel), one
// card per programme on the right (issued: download / copy verify link /
// correction; not yet: the requirement rows), then the public verify preview.
// External (IBM / Microsoft / Google…) certificates — design L8. The learner
// adds the provider's verification link and/or the file; Support verifies.
const EXT_CHIP = { unverified: ['adh', 'Unverified'], verified: ['hai', 'Verified'], rejected: ['red', 'Not verified'] };
function ExternalCertificates() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ provider: '', title: '', credentialId: '', verifyUrl: '', issuedOn: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => lmsApi.myExternalCertificates().then((r) => setRows((r && r.result) || [])).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pickFile = async (e) => {
    const fl = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!fl) return;
    if (!/\.(pdf|png|jpe?g)$/i.test(fl.name) || fl.size > 10 * 1024 * 1024) return message.error('PDF / PNG / JPG, max 10 MB');
    setBusy(true);
    const r = await lmsApi.externalCertificateFile(fl).catch(() => null);
    setBusy(false);
    if (r && r.success !== false && r.result) setFile(r.result);
    else message.error((r && r.message) || 'Upload failed.');
    return null;
  };
  const save = async () => {
    setBusy(true);
    const r = await lmsApi.addExternalCertificate({ ...f, file }).catch(() => null);
    setBusy(false);
    if (!r || r.success === false) return message.error((r && r.message) || 'Could not add.');
    setF({ provider: '', title: '', credentialId: '', verifyUrl: '', issuedOn: '' });
    setFile(null);
    setOpen(false);
    load();
    return null;
  };
  const remove = async (c) => {
    const r = await lmsApi.removeExternalCertificate(c.id).catch(() => null);
    if (r && r.success !== false) load();
  };
  return (
    <>
      {rows.map((c) => {
        const chip = EXT_CHIP[c.status] || EXT_CHIP.unverified;
        return (
          <section className="ld-card" key={c.id} aria-label={`${c.provider} certificate`}>
            <div className="ld-hd"><b>{c.provider} · {c.title}</b><span className={`ld-chip ${chip[0]}`}>{chip[1]}</span></div>
            <div className="ld-muted" style={{ fontSize: 13 }}>
              {c.status === 'unverified'
                ? 'Learner-provided upload · provider verification link pending check by Support'
                : `${c.status === 'verified' ? 'Verified' : 'Checked'} by ${c.reviewedByName || 'Support'}${c.reviewedAt ? ` · ${dayjs(c.reviewedAt).format('D MMM YYYY')}` : ''}${c.reviewNote ? ` · ${c.reviewNote}` : ''}`}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
              {c.verifyUrl && <a href={c.verifyUrl} target="_blank" rel="noopener noreferrer">Provider verify link</a>}
              {c.file && <a href={`${BASE_URL}${c.file.url}`} target="_blank" rel="noopener noreferrer">{c.file.name}</a>}
              {c.status !== 'verified' && <button type="button" className="ld-link" onClick={() => remove(c)}>Remove</button>}
            </div>
          </section>
        );
      })}
      {open ? (
        <section className="ld-card" aria-label="Add external certificate">
          <b>Add an external certificate</b>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="ld-label">Provider<input className="ld-inp full" maxLength={80} value={f.provider} onChange={set('provider')} placeholder="IBM / Microsoft / Google" /></label>
            <label className="ld-label">Issued on<input className="ld-inp full" type="date" value={f.issuedOn} onChange={set('issuedOn')} /></label>
          </div>
          <label className="ld-label">Certificate name<input className="ld-inp full" maxLength={200} value={f.title} onChange={set('title')} placeholder="Generative AI for Business and Professionals" /></label>
          <label className="ld-label">Provider verification link<input className="ld-inp full" maxLength={500} value={f.verifyUrl} onChange={set('verifyUrl')} placeholder="https://…" /></label>
          <label className="ld-label">Credential ID (optional)<input className="ld-inp full" maxLength={120} value={f.credentialId} onChange={set('credentialId')} /></label>
          <label className="ld-btn2 sm" style={{ alignSelf: 'flex-start' }}>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={pickFile} />
            {file ? `✓ ${file.name}` : busy ? 'Uploading…' : 'Certificate file (PDF / image)'}
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="ld-btn2 sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="ld-btn sm" disabled={busy || !f.provider.trim() || !f.title.trim() || (!f.verifyUrl.trim() && !file)} onClick={save}>Add for verification</button>
          </div>
        </section>
      ) : (
        <button type="button" className="ld-link" style={{ fontSize: 13, alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>+ Add an external certificate (IBM / Microsoft…)</button>
      )}
    </>
  );
}

// Support / management: learners' external certificates to check against the
// provider's link, then mark Verified or Not verified (learner is notified).
function ExternalReview() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('unverified');
  const [busyId, setBusyId] = useState(null);
  const load = useCallback(() => lmsApi.adminExternalCertificates(status).then((r) => setRows((r && r.result) || [])).catch(() => {}), [status]);
  useEffect(() => {
    load();
  }, [load]);
  const decide = (r, decision) => {
    let note = '';
    Modal.confirm({
      title: decision === 'verified' ? `Verify ${r.provider} certificate?` : `Mark ${r.provider} certificate as not verified?`,
      content: <Input.TextArea rows={2} placeholder="Note for the learner (optional)" onChange={(e) => { note = e.target.value; }} />,
      okText: decision === 'verified' ? 'Verified' : 'Not verified',
      okButtonProps: { danger: decision !== 'verified' },
      onOk: async () => {
        setBusyId(r.id);
        const res = await lmsApi.reviewExternalCertificate(r.id, decision, note).catch(() => null);
        setBusyId(null);
        if (!res || res.success === false) return message.error((res && res.message) || 'Could not save.');
        load();
        return null;
      },
    });
  };
  return (
    <Card style={{ marginTop: 16 }} title={<span><SafetyCertificateOutlined /> External certificates (learner-provided)</span>} extra={
      <Select size="small" value={status} onChange={setStatus} style={{ width: 150 }} options={[{ value: 'unverified', label: 'To verify' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Not verified' }, { value: '', label: 'All' }]} />
    }>
      <Table
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description="Nothing here" /> }}
        columns={[
          { title: 'Learner', render: (_, r) => <><b>{r.studentName}</b><br /><Typography.Text type="secondary">{r.studentEmail}</Typography.Text></> },
          { title: 'Certificate', render: (_, r) => <><b>{r.provider}</b> · {r.title}{r.credentialId ? <><br /><Typography.Text type="secondary">ID {r.credentialId}</Typography.Text></> : null}</> },
          {
            title: 'Proof',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                {r.verifyUrl && <a href={r.verifyUrl} target="_blank" rel="noopener noreferrer">Provider link</a>}
                {r.file && <a href={`${BASE_URL}${r.file.url}`} target="_blank" rel="noopener noreferrer">{r.file.name}</a>}
              </Space>
            ),
          },
          { title: 'Added', width: 110, render: (_, r) => dayjs(r.created).format('D MMM YY') },
          { title: 'Status', width: 120, render: (_, r) => <Tag color={r.status === 'verified' ? 'green' : r.status === 'rejected' ? 'red' : 'orange'}>{(EXT_CHIP[r.status] || EXT_CHIP.unverified)[1]}</Tag> },
          {
            title: '',
            width: 200,
            render: (_, r) =>
              r.status === 'unverified' ? (
                <Space>
                  <Button size="small" type="primary" loading={busyId === r.id} onClick={() => decide(r, 'verified')}>Verified</Button>
                  <Button size="small" danger disabled={busyId === r.id} onClick={() => decide(r, 'rejected')}>Not verified</Button>
                </Space>
              ) : (
                <Typography.Text type="secondary">{r.reviewedByName}</Typography.Text>
              ),
          },
        ]}
      />
    </Card>
  );
}

function StudentCertificates() {
  const navigate = useNavigate();
  const admin = useSelector(selectCurrentAdmin) || {};
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    lmsApi.myCertificates().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;

  const issued = rows.filter((c) => c.eligible);
  const cur = rows[sel] || issued[0] || rows[0];
  const learner = [admin.name, admin.surname].filter(Boolean).join(' ') || 'Learner';
  const verifyLink = (c) => (c.verificationUrl ? new URL(c.verificationUrl, window.location.origin).href : '');
  const copyLink = (c) => {
    const link = verifyLink(c);
    if (!link) return;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => message.success('Verify link copied')).catch(() => message.info(link));
  };
  const correction = (c) =>
    navigate('/learn/support', {
      state: {
        raise: {
          category: 'Certificate',
          subject: `Certificate correction · ${c.certificateId}`,
          reference: [c.title, c.certificateId].filter(Boolean).join(' · '),
          description: 'What is wrong on the certificate (name spelling, programme, date…):',
          expected: 'It should read:',
        },
      },
    });
  const masked = learner.split(' ').map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(' ');

  return (
    <div className="ld-page">
      <div className="ld-head">
        <div>
          <h1>My certificates</h1>
          <div className="ld-muted ld-sub">Career Lab certificates and external ones (IBM / Microsoft) are shown separately</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="ld-card"><div className="ld-empty">Not enrolled in any internship yet.</div></div>
      ) : (
        <div className="ld-grid" style={{ gridTemplateColumns: '520px minmax(0, 1fr)', flex: 1 }}>
          <div className="ld-card" style={{ alignItems: 'center', justifyContent: 'center', background: '#0b1a33', borderColor: '#0b1a33' }} aria-label="Certificate preview">
            <div style={{ width: '100%', maxWidth: 440, minHeight: 600, background: '#fbf6ea', border: '6px double #b08d3c', padding: '36px 30px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', opacity: cur && cur.eligible ? 1 : 0.6 }}>
              <div style={{ fontSize: 12, letterSpacing: '.2em', fontWeight: 700, color: '#0b1a33' }}>CAREER LAB CONSULTING</div>
              <div style={{ fontSize: 13, letterSpacing: '.15em', fontWeight: 700, color: '#0b1a33' }}>INTERN<span style={{ color: '#b08d3c' }}>X</span>-AI</div>
              <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 44, fontWeight: 700, color: '#0b1a33', marginTop: 18 }}>CERTIFICATE</div>
              <div style={{ fontSize: 14, letterSpacing: '.25em', color: '#8a6d2b', fontWeight: 600 }}>OF COMPLETION</div>
              <div style={{ fontSize: 13, fontStyle: 'italic', color: '#334155', marginTop: 14 }}>This certificate is proudly presented to</div>
              <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 30, color: '#0b1a33', borderBottom: '1px solid #b08d3c', padding: '0 24px 6px' }}>{learner}</div>
              <div style={{ fontSize: 12, fontStyle: 'italic', color: '#334155' }}>For successfully completing the</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0b1a33', textTransform: 'uppercase' }}>{cur ? cur.title || cur.course : ''}</div>
              <div style={{ display: 'flex', gap: 24, marginTop: 'auto', fontSize: 11, color: '#334155' }}>
                <div><b style={{ color: '#0b1a33' }}>CERTIFICATE ID</b><br />{cur && cur.eligible ? cur.certificateId : 'issued on completion'}</div>
                <div><b style={{ color: '#0b1a33' }}>DATE</b><br />{cur && cur.issuedOn ? dayjs(cur.issuedOn).format('D MMM YYYY') : '—'}</div>
              </div>
              {!(cur && cur.eligible) && <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600 }}>PREVIEW — not unlocked yet</div>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            {rows.map((c, i) => (
              <section className="ld-card" key={c.course} aria-label={c.title} style={{ outline: cur === c ? '2px solid #0e7490' : 'none', cursor: 'pointer' }} onClick={() => setSel(i)}>
                <div className="ld-hd"><b>{c.title}{c.track ? ` · ${c.track}` : ''}</b><span className={`ld-chip ${c.eligible ? 'hai' : 'gray'}`}>{c.eligible ? 'Issued' : 'Not yet eligible'}</span></div>
                {c.eligible ? (
                  <>
                    <div className="ld-muted" style={{ fontSize: 13 }}>Issued by Career Lab · {c.issuedOn ? dayjs(c.issuedOn).format('D MMM YYYY') : '—'} · ID {c.certificateId}{c.grade ? ` · Grade ${c.grade}` : ''}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ld-btn md" onClick={() => lmsApi.downloadCertificatePdf(c.id, true, slug(`${c.course}-${c.certificateId}`))}>Download PDF</button>
                      {c.verificationUrl && <button type="button" className="ld-btn2" onClick={() => copyLink(c)}>Copy verify link</button>}
                      <button type="button" className="ld-btn2" onClick={() => correction(c)}>Name correction request</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="ld-li"><span>{c.durationMonths}-month duration complete</span>{c.durationOk ? <b style={{ color: '#166534' }}>done</b> : <span style={{ color: '#991b1b', fontWeight: 600 }}>missing</span>}</div>
                    <div className="ld-li"><span>Capstone project submitted</span>{c.projectOk ? <b style={{ color: '#166534' }}>done</b> : <span style={{ color: '#991b1b', fontWeight: 600 }}>pending</span>}</div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ld-btn2 sm" onClick={() => lmsApi.previewCertificatePdf(c.courseId)}>Preview PDF</button>
                    </div>
                  </>
                )}
              </section>
            ))}
            <ExternalCertificates />
            {issued[0] && (
              <section className="ld-card" aria-label="Public verify page">
                <div className="ld-hd"><b>Public verify page (preview)</b></div>
                <div className="ld-soft" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <b style={{ color: '#166534' }}>Valid certificate</b>
                  <span>{issued[0].title} · Career Lab Consulting Pvt. Ltd.</span>
                  <span>Issued {issued[0].issuedOn ? dayjs(issued[0].issuedOn).format('D MMM YYYY') : '—'} · {masked}</span>
                  <span className="ld-muted">Marks, contact and login details are never shown</span>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Certificates() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const isManagerRole = MGR.includes(admin.role);
  if (isManagerRole || LMS_TEACHER_ROLES.includes(admin.role)) return <TeacherCertificates isManagerRole={isManagerRole} />;
  return <StudentCertificates />;
}
