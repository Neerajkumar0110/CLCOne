import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import { getSocket } from '@/socket';
import api from './api';
import {
  C, TONE, I, IB, Chip, Btn, Av, Bar, Card, Row, Col, Gauge, Donut, Line, Radar, Heat, Leg, Tabs, Note, Lbl, ScoreCard, Screen,
  Modal, Field, Toggle, Loading, ErrorBox, useData, fmtDay, fmtHM, ago,
} from './ui';

// Figma 1A "Learner 360° Report" (+ 1E on phones, + 1D share modal).
// `learnerId` = someone else's report (mentor / support / admin); default = my own.

const LV_COLOR = { ok: C.ok, wa: C.wa, er: C.er, mut: C.fa };
const COMP = [
  ['attendance', 'Attendance', 'cal', 'pri', C.pri],
  ['assessment', 'Assessment', 'checkc', 'pu', C.pu],
  ['coding', 'Coding', 'code', 'ind', C.ind],
  ['project', 'Project', 'folder', 'ok', C.ok],
];
const pct = (v) => (v == null ? '—' : `${v}%`);
const nth = (n) => {
  if (n == null) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const weekLabel = (i) => `W${i + 1}`;
const monthLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });

export function useIsMobile(bp = 760) {
  const get = () => typeof window !== 'undefined' && window.innerWidth <= bp;
  const [m, setM] = useState(get);
  useEffect(() => {
    const on = () => setM(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return m;
}

function scoreLines(r) {
  const L = r.lines;
  return {
    attendance: [
      ['Classes attended', `${L.attendance.attended} / ${L.attendance.held}`],
      ['Late joins', String(L.attendance.late)],
      ['Live participation', pct(L.attendance.livePct)],
    ],
    assessment: [
      ['Tests (avg)', pct(L.assessment.tests)],
      [`Micro tests (${L.assessment.microN})`, pct(L.assessment.micro)],
      [`Unit assessments (${L.assessment.unitN})`, pct(L.assessment.unit)],
    ],
    coding: [
      ['Exercises solved', `${L.coding.solved} / ${L.coding.attempted}`],
      ['Test cases passed', pct(L.coding.testsPct)],
      ['Quality · avg attempts', L.coding.quality ? `${L.coding.quality} · ${L.coding.avgTries}` : '—'],
    ],
    project: [
      ['Projects reviewed', String(L.project.reviewed)],
      ['Rubric average', L.project.avg == null ? '—' : `${L.project.avg} / 100`],
      ['Latest', L.project.latest ? `${L.project.latest.title} · ${L.project.latest.score}` : '—'],
    ],
  };
}

function liveText(r) {
  if (r.live && r.live.component) {
    const name = r.live.component[0].toUpperCase() + r.live.component.slice(1);
    return `Live update · ${name} score ${r.live.from} → ${r.live.to} · hire-readiness recalculated ${ago(r.live.at)}`;
  }
  return `Live · every score recalculates when attendance, a test, a coding exercise or a project review changes · last recalculated ${ago(r.computedAt)}`;
}

// ── share-with-recruiter modal (1D) ──
export function ShareModal({ open, onClose }) {
  const [row, setRow] = useState(null);
  const [show, setShow] = useState({ scores: true, projects: true, resume: true, mentor: false, contact: false });
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    api.share().then((r) => {
      const x = r && r.success ? r.result : null;
      setRow(x);
      if (x) {
        setShow({ ...show, ...x.show });
        setDays(x.expiresAt ? Math.max(1, Math.round((new Date(x.expiresAt) - new Date(x.updated || x.created)) / 86400000)) : 0);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = async () => {
    setBusy(true);
    const r = await api.saveShare({ show, expiresDays: days });
    setBusy(false);
    if (r.success) {
      setRow(r.result);
      try {
        await navigator.clipboard.writeText(r.result.url);
        message.success('Link saved and copied — share it with recruiters');
      } catch (_) {
        message.success('Link saved');
      }
    } else message.error(r.message);
  };
  const revoke = async () => {
    setBusy(true);
    const r = await api.revokeShare();
    setBusy(false);
    if (r.success) {
      setRow(null);
      message.success(r.message);
    } else message.error(r.message);
  };
  const copy = async () => {
    if (!row) return save();
    try {
      await navigator.clipboard.writeText(row.url);
      message.success('Link copied');
    } catch (_) {
      message.info(row.url);
    }
  };
  const ITEMS = [
    ['scores', 'Hire-readiness & score breakdown'],
    ['projects', 'Projects with code & demo links'],
    ['resume', 'Resume download'],
    ['mentor', 'Mentor summary'],
    ['contact', 'Email & phone number'],
  ];
  return (
    <Modal open={open} onClose={onClose} width={560} label="Share profile with recruiters">
      <Row g={10} className="g-ac">
        <IB n="share" />
        <Col g={0} style={{ flex: 1 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>Share profile with recruiters</span>
          <span className="g-s12 g-mut">Anyone with the link can view a read-only profile</span>
        </Col>
        <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: 'none', cursor: 'pointer', color: C.fa }}>
          <I n="x" />
        </button>
      </Row>
      <Row g={8} style={{ alignItems: 'flex-end' }}>
        <Field label="Public link">
          <div className="g-input">
            <I n="link" s={15} c={C.fa} />
            <input readOnly value={row ? row.url.replace(/^https?:\/\//, '') : 'Save to create your link'} aria-label="Public link" />
          </div>
        </Field>
        <Btn k="p" i="link" onClick={copy} disabled={busy}>
          Copy
        </Btn>
      </Row>
      <Lbl>What recruiters see</Lbl>
      {ITEMS.map(([k, l]) => (
        <Row key={k} g={10} className="g-ac">
          <span style={{ flex: 1, fontSize: 13 }}>{l}</span>
          <Toggle on={show[k]} onChange={(v) => setShow({ ...show, [k]: v })} label={l} />
        </Row>
      ))}
      <Row g={12}>
        <Field label="Link expires" htmlFor="sh-exp">
          <div className="g-input">
            <I n="cal" s={15} c={C.fa} />
            <select id="sh-exp" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>After 7 days</option>
              <option value={30}>After 30 days</option>
              <option value={90}>After 90 days</option>
              <option value={0}>Never</option>
            </select>
          </div>
        </Field>
        <Field label="Allowed viewers">
          <div className="g-input">
            <I n="globe" s={15} c={C.fa} />
            <span>Anyone with link</span>
          </div>
        </Field>
      </Row>
      {row ? (
        <Note tone="sky" i="eye">
          Viewed {row.views || 0} time{row.views === 1 ? '' : 's'}
          {row.lastViewedAt ? ` · last viewed ${ago(row.lastViewedAt)}` : ''}
          {row.expiresAt ? ` · expires ${fmtDay(row.expiresAt)}` : ''}
        </Note>
      ) : (
        <Note tone="sky" i="eye">
          No link yet — Save &amp; share creates one.
        </Note>
      )}
      <Row g={8} className="g-sb">
        <Btn k="d" i="x" onClick={revoke} disabled={busy || !row}>
          Revoke link
        </Btn>
        <Row g={8} style={{ width: 'auto' }}>
          <Btn k="g" onClick={onClose}>
            Cancel
          </Btn>
          <Btn k="p" i="send" onClick={save} disabled={busy}>
            Save &amp; share
          </Btn>
        </Row>
      </Row>
    </Modal>
  );
}

// ── edit my profile (skills, links, education, resume) ──
function ProfileModal({ open, onClose, learner, onSaved }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && learner)
      setF({
        city: learner.city || '',
        skills: (learner.skills || []).join(', '),
        degree: learner.education.degree || '',
        year: learner.education.year || '',
        institute: learner.education.institute || '',
        grade: learner.education.grade || '',
        github: learner.links.github || '',
        linkedin: learner.links.linkedin || '',
        portfolio: learner.links.portfolio || '',
      });
  }, [open, learner]);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const r = await api.saveProfile({
      city: f.city,
      skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean),
      education: { degree: f.degree, year: f.year, institute: f.institute, grade: f.grade },
      links: { github: f.github, linkedin: f.linkedin, portfolio: f.portfolio },
    });
    setBusy(false);
    if (r.success) {
      message.success('Profile saved');
      onSaved();
      onClose();
    } else message.error(r.message);
  };
  const inp = (k, label, ph) => (
    <Field label={label} htmlFor={`pf-${k}`}>
      <input id={`pf-${k}`} className="g-input" value={f[k]} onChange={set(k)} placeholder={ph} />
    </Field>
  );
  return (
    <Modal open={open} onClose={onClose} width={600} label="Edit profile">
      <Row g={10} className="g-ac">
        <IB n="user" />
        <span style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>Edit my profile</span>
      </Row>
      <Row g={12} className="g-ac">
        <Av name={learner.name} s={56} src={learner.photoUrl} />
        <label className="g-btn k-s sm" style={{ cursor: 'pointer' }}>
          <I n="upload" s={13} /> {busy ? 'Uploading…' : 'Upload photo'}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files && e.target.files[0];
              e.target.value = '';
              if (!file) return;
              setBusy(true);
              const r = await api.uploadPhoto(file);
              setBusy(false);
              if (r.success) {
                message.success('Photo updated');
                onSaved();
              } else message.error(r.message);
            }}
          />
        </label>
        <span className="g-s12 g-mut">JPG / PNG · shown on your report, PDF and recruiter profile</span>
      </Row>
      <Row g={12} className="g-rm">
        {inp('city', 'City', 'Gurugram, India')}
        {inp('skills', 'Skills (comma separated)', 'Python, SQL, Pandas')}
      </Row>
      <Lbl>Education</Lbl>
      <Row g={12} className="g-rm">
        {inp('degree', 'Degree', 'B.Tech, Computer Science')}
        {inp('year', 'Year', '2025')}
      </Row>
      <Row g={12} className="g-rm">
        {inp('institute', 'Institute', 'GGSIP University')}
        {inp('grade', 'Grade / CGPA', '8.1 CGPA')}
      </Row>
      <Lbl>Links</Lbl>
      {inp('github', 'GitHub', 'https://github.com/…')}
      {inp('linkedin', 'LinkedIn', 'https://linkedin.com/in/…')}
      {inp('portfolio', 'Portfolio', 'https://…')}
      <Row g={8} style={{ justifyContent: 'flex-end' }}>
        <Btn k="g" onClick={onClose}>
          Cancel
        </Btn>
        <Btn k="p" i="check" onClick={save} disabled={busy}>
          Save profile
        </Btn>
      </Row>
    </Modal>
  );
}

// ── 1E mobile ──
function MobileReport({ r, onPdf, onShare, self }) {
  const lv = LV_COLOR[r.level.tone];
  return (
    <div className="g-root">
      <div className="g-content" style={{ padding: 16, gap: 14 }}>
        <Card p={16} g={10}>
          <Row g={12} className="g-ac">
            <Gauge v={r.total || 0} txt={r.total == null ? '—' : Math.round(r.total)} s={120} c={lv} l="readiness" />
            <Col g={6} style={{ flex: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{r.learner.name}</span>
              <span>
                <Chip tone={r.level.tone} dot>
                  {r.level.label}
                </Chip>
              </span>
              <span className="g-s12 g-mut">
                Rank #{r.standing.rank || '—'} / {r.standing.of || '—'} · {nth(r.standing.percentile)} pct
              </span>
            </Col>
          </Row>
        </Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {COMP.map(([k, l, i, tone]) => (
            <div key={k} className="g-card" style={{ padding: 12, gap: 6, borderRadius: 12 }}>
              <IB n={i} tone={tone} box={28} s={14} />
              <span className="g-s12 g-mut">{l}</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: TONE[tone][1] }}>{r.scores[k] == null ? '—' : r.scores[k]}</span>
              <Bar pct={r.scores[k] || 0} tone={tone} h={5} />
            </div>
          ))}
        </div>
        <Card title={`Progress (${r.history.weeks.length} weeks)`} p={14} g={8}>
          <Line
            series={[
              { d: r.history.you, c: C.pri, area: true },
              { d: r.history.batch, c: C.fa, dash: true },
            ]}
            w={326}
            h={120}
            {...range(r)}
          />
        </Card>
        <Card title="Improve next" p={14} g={8}>
          {(r.insights.improve.length ? r.insights.improve : ['Nothing flagged — keep going']).map((t) => (
            <Row key={t} g={8}>
              <I n="down" c={C.er} s={14} />
              <span style={{ fontSize: 12.5, flex: 1 }}>{t}</span>
            </Row>
          ))}
        </Card>
        <div style={{ position: 'sticky', bottom: 0, display: 'flex', gap: 8, padding: '8px 0', background: C.bg }}>
          <Btn k="s" i="download" onClick={onPdf} style={{ flex: 1 }}>
            PDF
          </Btn>
          {self && (
            <Btn k="p" i="share" onClick={onShare} style={{ flex: 1 }}>
              Share
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function range(r) {
  const v = [...r.history.you, ...r.history.batch, ...(r.months.you || []).map((m) => m.total)].filter((x) => x != null);
  if (!v.length) return { min: 0, max: 100 };
  return { min: Math.max(0, Math.floor((Math.min(...v) - 10) / 10) * 10), max: Math.min(100, Math.ceil((Math.max(...v) + 10) / 10) * 10) };
}

export default function Learner360Report({ learnerId, crumbBase = 'LMS / 360° Report' }) {
  const id = learnerId || 'me';
  const { data: r, error, loading, reload } = useData(() => api.report(id), [id]);
  const mobile = useIsMobile();
  const [tab, setTab] = useState('weeks');
  const [shareOpen, setShareOpen] = useState(false);
  const [profOpen, setProfOpen] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const [canShare, setCanShare] = useState(true);
  const fileRef = React.useRef(null);
  useEffect(() => {
    api.myFlags().then((r) => r && r.success && setCanShare(r.result.recruiter_share_link !== false));
  }, []);

  // real time: a score event pushes 'lms:score'; a minute's poll as a safety net
  useEffect(() => {
    const s = getSocket();
    const on = () => reload();
    s?.on('lms:score', on);
    const iv = setInterval(reload, 60000);
    return () => {
      s?.off('lms:score', on);
      clearInterval(iv);
    };
  }, [reload]);

  if (loading && !r) return <Loading text="Calculating your 360° report…" />;
  if (error) return <ErrorBox text={error} />;
  if (!r) return null;
  const self = r.viewer ? r.viewer.self : id === 'me';
  const L = r.learner;
  const onPdf = async () => {
    setBusyPdf(true);
    try {
      await api.pdf(id, `${L.name} - 360 report.pdf`);
    } catch (e) {
      message.error('Could not create the PDF.');
    }
    setBusyPdf(false);
  };
  const onResume = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) return message.error('Upload your resume as a PDF.');
    setUpBusy(true);
    const res = await api.uploadResume(f);
    setUpBusy(false);
    if (res.success) {
      message.success('Resume uploaded');
      reload();
    } else message.error(res.message);
  };

  if (mobile)
    return (
      <>
        <MobileReport r={r} self={self && canShare} onPdf={onPdf} onShare={() => setShareOpen(true)} />
        <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} />
      </>
    );

  const lvColor = LV_COLOR[r.level.tone];
  const contrib = (k) => (r.scores[k] == null ? 0 : (r.scores[k] * r.weights[k]) / 100);
  const lines = scoreLines(r);
  const months = r.months;
  const series =
    tab === 'weeks'
      ? { you: r.history.you, batch: r.history.batch, xl: r.history.weeks.map((_, i) => weekLabel(i)) }
      : {
          you: months.you.map((m) => m.total),
          batch: months.you.map((m) => (months.batch.find((b) => b.month === m.month) || {}).total ?? null),
          xl: months.you.map((m) => monthLabel(m.month)),
        };
  const cmp = [
    ['Attendance', r.scores.attendance, r.batchAvg.attendance, 'pri'],
    ['Assessment', r.scores.assessment, r.batchAvg.assessment, 'pu'],
    ['Coding', r.scores.coding, r.batchAvg.coding, 'ind'],
    ['Project', r.scores.project, r.batchAvg.project, 'ok'],
    ['Engagement', r.engagement ? r.engagement.score : null, r.batchAvg.engagement, 'sky'],
  ];
  const e = r.engagement;

  return (
    <Screen
      crumb={`${crumbBase} / ${L.name}`}
      title={self ? 'My 360° Report' : `${L.name} · 360° Report`}
      actions={
        <>
          {self && canShare && (
            <Btn k="s" i="share" onClick={() => setShareOpen(true)}>
              Share with recruiter
            </Btn>
          )}
          <Btn k="p" i="download" onClick={onPdf} disabled={busyPdf}>
            {busyPdf ? 'Preparing PDF…' : 'Download PDF'}
          </Btn>
        </>
      }
    >
      <Note tone={r.live ? 'ok' : 'pri'} i="zap" role="status">
        {liveText(r)}
      </Note>

      <Row className="g-rm">
        <Card p={24} g={18} style={{ flex: 1 }} as="section">
          <Row g={18} className="g-ac">
            <span style={{ padding: 3, borderRadius: 999, border: `3px solid ${C.priM}`, display: 'inline-flex' }}>
              <Av name={L.name} s={80} src={L.photoUrl} />
            </span>
            <Col g={7} style={{ flex: 1 }}>
              <Row g={10} className="g-ac g-wrap">
                <span style={{ fontSize: 22, fontWeight: 700 }}>{L.name}</span>
                <Chip tone={r.level.tone} dot>
                  {r.level.label}
                </Chip>
                {r.standing.rank && (
                  <Chip tone="ind" i="trophy">
                    Rank #{r.standing.rank} of {r.standing.of}
                  </Chip>
                )}
                {self && (
                  <Btn k="g" sm i="edit" onClick={() => setProfOpen(true)} style={{ marginLeft: 'auto' }}>
                    Edit profile
                  </Btn>
                )}
              </Row>
              <span style={{ fontSize: 13.5, color: C.sub }}>{L.course || '—'}</span>
              <Row g={20} className="g-wrap" style={{ rowGap: 8 }}>
                {[
                  ['user', 'Learner ID', L.learnerId || '—'],
                  ['layers', 'Batch', [L.batch, L.batchTime].filter(Boolean).join(' · ') || '—'],
                  ['cal', 'Enrolled', fmtDay(L.enrolledOn)],
                  ['users', 'Mentor', L.mentor || '—'],
                ].map(([ic, k, v]) => (
                  <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <I n={ic} c={C.fa} s={14} />
                    <span className="g-mut">{k}:</span>
                    <b className="g-sb6">{v}</b>
                  </span>
                ))}
              </Row>
            </Col>
          </Row>
          <Row g={20} className="g-rm" style={{ paddingTop: 16, borderTop: `1px solid ${C.ln}` }}>
            <Col g={8}>
              <Lbl>Contact</Lbl>
              {[
                ['mail', L.email],
                ['phone', L.phoneMasked || '—'],
                ['globe', L.city || '—'],
              ].map(([ic, v]) => (
                <span key={ic} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.sub }}>
                  <I n={ic} c={C.mut} s={14} />
                  {v}
                </span>
              ))}
              <Lbl>Education</Lbl>
              {L.education.degree || L.education.institute ? (
                <>
                  <span style={{ fontSize: 12.5 }}>{[L.education.degree, L.education.year].filter(Boolean).join(' · ')}</span>
                  <span className="g-s12 g-mut">{[L.education.institute, L.education.grade].filter(Boolean).join(' · ')}</span>
                </>
              ) : (
                <span className="g-s12 g-fa">{self ? 'Add it with Edit profile' : 'Not added yet'}</span>
              )}
            </Col>
            <Col g={8}>
              <Lbl>Skills</Lbl>
              <Row g={6} className="g-wrap">
                {L.skills.length ? L.skills.map((s) => <Chip key={s} s={11.5}>{s}</Chip>) : <span className="g-s12 g-fa">{self ? 'Add your skills with Edit profile' : 'Not added yet'}</span>}
              </Row>
              <Lbl>Links</Lbl>
              <Row g={8} className="g-wrap">
                {[
                  ['git', 'GitHub', L.links.github],
                  ['linkedin', 'LinkedIn', L.links.linkedin],
                  ['globe', 'Portfolio', L.links.portfolio],
                ].map(([ic, l, href]) =>
                  href ? (
                    <Btn key={l} k="s" sm i={ic} href={href} target="_blank">
                      {l}
                    </Btn>
                  ) : (
                    <Btn key={l} k="s" sm i={ic} disabled title={`No ${l} link yet`}>
                      {l}
                    </Btn>
                  )
                )}
              </Row>
            </Col>
            <Col g={8}>
              <Lbl>Resume</Lbl>
              <Row g={10} className="g-ac" style={{ background: C.bg, borderRadius: 10, padding: 10, border: `1px solid ${C.ln}` }}>
                <IB n="file" tone="er" box={32} s={16} />
                <Col g={0} style={{ flex: 1 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{L.resume ? L.resume.name : 'No resume uploaded'}</span>
                  <span className="g-s11 g-mut">{L.resume ? `${Math.max(1, Math.round((L.resume.size || 0) / 1024))} KB · updated ${fmtDay(L.resume.updatedAt)}` : 'PDF only'}</span>
                </Col>
              </Row>
              <Row g={8}>
                {self && (
                  <>
                    <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={onResume} />
                    <Btn k="s" sm i="upload" onClick={() => fileRef.current && fileRef.current.click()} disabled={upBusy}>
                      {upBusy ? 'Uploading…' : 'Upload new'}
                    </Btn>
                  </>
                )}
                <Btn k="g" sm i="download" href={L.resume ? L.resume.url : undefined} target="_blank" disabled={!L.resume}>
                  Download
                </Btn>
              </Row>
              <Lbl>Certificates &amp; badges</Lbl>
              <Row g={6} className="g-wrap">
                {r.badges.length ? (
                  r.badges.map((b) => (
                    <Chip key={b.label} tone={b.tone} i={b.i}>
                      {b.label}
                    </Chip>
                  ))
                ) : (
                  <span className="g-s12 g-fa">Earned certificates and badges show here</span>
                )}
              </Row>
            </Col>
          </Row>
        </Card>

        <Card title="Hire-readiness score" i="target" sub="Auto-calculated · updates in real time" p={22} style={{ width: 360, flexShrink: 0 }}>
          <Col g={10} style={{ alignItems: 'center' }}>
            <Gauge v={r.total || 0} txt={r.total == null ? '—' : Math.round(r.total)} s={200} c={lvColor} l={r.level.label} />
            <Row g={6} style={{ justifyContent: 'center' }} className="g-wrap">
              <Chip tone="ok" s={10.5}>
                ≥{r.levels.jobReady} Job Ready
              </Chip>
              <Chip tone="wa" s={10.5}>
                {r.levels.almost}–{r.levels.jobReady - 1} Almost
              </Chip>
              <Chip tone="er" s={10.5}>
                &lt;{r.levels.almost} Needs work
              </Chip>
            </Row>
          </Col>
          <Row g={8}>
            {[
              ['Batch rank', r.standing.rank ? `#${r.standing.rank} / ${r.standing.of}` : '—', 'ind'],
              ['Percentile', nth(r.standing.percentile), 'pri'],
              ['To Job Ready', r.standing.toJobReady == null ? '—' : r.standing.toJobReady === 0 ? 'Reached' : `+${r.standing.toJobReady} pts`, 'ok'],
            ].map(([k, v, tone]) => (
              <Col key={k} g={2} style={{ background: C.bg, borderRadius: 10, padding: 10 }}>
                <span className="g-s11 g-mut">{k}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: TONE[tone][1] }}>{v}</span>
              </Col>
            ))}
          </Row>
          <span className="g-s11 g-mut" style={{ lineHeight: '16px' }}>
            {r.weights.attendance}% Attendance + {r.weights.assessment}% Assessment + {r.weights.coding}% Coding + {r.weights.project}% Project · weights set by admin
          </span>
        </Card>
      </Row>

      <Row className="g-rs">
        {COMP.map(([k, l, ic, tone]) => (
          <div key={k} style={{ flex: 1, minWidth: 0 }}>
            <ScoreCard i={ic} name={`${l} score`} val={r.scores[k]} tone={tone} weight={r.weights[k]} lines={lines[k]} />
          </div>
        ))}
      </Row>

      <Row className="g-rm">
        <Card title="What makes up your score" i="pie" sub="Contribution of each component" style={{ width: 380, flexShrink: 0 }}>
          <Row g={18} className="g-ac">
            <Donut segs={COMP.map(([k, , , , col]) => ({ v: contrib(k), c: col }))} s={150} center={r.total == null ? '—' : String(Math.round(r.total))} cl="of 100" />
            <Col g={10} style={{ width: 'auto' }}>
              {COMP.map(([k, l, , , col]) => (
                <Row key={k} g={8} className="g-ac" style={{ width: 'auto' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: col, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: C.sub, width: 84 }}>{l}</span>
                  <b style={{ fontSize: 12.5 }}>{r.scores[k] == null ? '—' : `${contrib(k).toFixed(1)} pts`}</b>
                </Row>
              ))}
            </Col>
          </Row>
        </Card>
        <Card title="Progress over time" i="activity" sub="Hire-readiness by week · you vs batch average" right={<Tabs items={[['weeks', 'Weeks'], ['months', 'Months']]} act={tab} onChange={setTab} />} style={{ flex: 1 }}>
          <Line
            series={[
              { d: series.you, c: C.pri, area: true, dots: true, l: 'You' },
              { d: series.batch, c: C.fa, dash: true, l: 'Batch average' },
            ]}
            w={690}
            h={190}
            {...range(r)}
            xl={series.xl}
            legend
          />
        </Card>
      </Row>

      <Row className="g-rm">
        <Card title="Skill strengths" i="brain" sub="From coding, tests & project rubrics" style={{ width: 380, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Radar
              axes={r.radar.axes}
              s={330}
              sets={[
                { d: r.radar.batch.map((v) => v || 0), c: C.fa, fo: 0.05, dash: true },
                { d: r.radar.you.map((v) => v || 0), c: C.pri },
              ]}
            />
          </div>
          <Leg
            items={[
              ['You', C.pri],
              ['Batch average', C.fa],
            ]}
          />
          {r.radar.you.some((v) => v == null) && (
            <span className="g-s11 g-fa">
              No questions answered yet on: {r.radar.axes.filter((_, i) => r.radar.you[i] == null).join(', ')}
            </span>
          )}
        </Card>
        <Card title="You vs batch average" i="chart" sub="Thick bar = you · thin bar = batch" style={{ flex: 1 }}>
          {cmp.map(([l, you, b, tone]) => {
            const d = you != null && b != null ? you - b : null;
            return (
              <Col key={l} g={5}>
                <Row className="g-sb">
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{l}</span>
                  <b style={{ fontSize: 12, color: d == null ? C.mut : d >= 0 ? C.okD : C.erD }}>
                    {you == null ? '—' : you} vs {b == null ? '—' : b}
                    {d != null ? `  (${d >= 0 ? '+' : ''}${d})` : ''}
                  </b>
                </Row>
                <Bar pct={you || 0} tone={tone} h={8} />
                <Bar pct={b || 0} col="#cbd5e1" h={4} />
              </Col>
            );
          })}
        </Card>
        <Card title="Strengths & areas to improve" i="sparkle" sub="Generated automatically from your scores" style={{ width: 340, flexShrink: 0 }}>
          <Lbl>Strengths</Lbl>
          {(r.insights.strengths.length ? r.insights.strengths : ['Not enough data yet — strengths appear as scores come in']).map((t) => (
            <Row key={t} g={8}>
              <I n="up" c={C.ok} s={15} />
              <span style={{ fontSize: 12.5, lineHeight: '18px', flex: 1 }}>{t}</span>
            </Row>
          ))}
          <Lbl>Improve next</Lbl>
          {(r.insights.improve.length ? r.insights.improve : ['Nothing flagged — keep going']).map((t) => (
            <Row key={t} g={8}>
              <I n="down" c={C.er} s={15} />
              <span style={{ fontSize: 12.5, lineHeight: '18px', flex: 1 }}>{t}</span>
            </Row>
          ))}
        </Card>
      </Row>

      <Row className="g-rm">
        <Card title="Mentor remarks" i="msg" sub="Written by your mentor · also printed on the PDF" style={{ flex: 1 }}>
          {r.remarks.length === 0 && <div className="g-empty">No remarks yet.</div>}
          {r.remarks.map((m) => (
            <Row key={m.id} g={12} style={{ background: C.bg, borderRadius: 10, padding: 12 }}>
              <Av name={m.by} col={C.ind} s={30} />
              <Col g={4} style={{ flex: 1 }}>
                <Row g={8} className="g-ac g-wrap">
                  <b style={{ fontSize: 12.5 }}>{m.by}</b>
                  <span className="g-s11 g-fa">{new Date(m.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                  {m.tone !== 'neutral' && (
                    <Chip tone={m.tone === 'positive' ? 'ok' : 'wa'} s={10}>
                      {m.tone === 'positive' ? 'Positive' : 'Action needed'}
                    </Chip>
                  )}
                  {!m.showOnReport && <Chip s={10}>Private</Chip>}
                </Row>
                <span style={{ fontSize: 12.5, color: C.sub, lineHeight: '18px' }}>{m.text}</span>
              </Col>
            </Row>
          ))}
        </Card>
        <Card title="Engagement snapshot" i="flame" sub="From Practice & Engagement Tracker" style={{ width: 360, flexShrink: 0 }}>
          <Row g={8}>
            {[
              ['Engagement', e && e.score != null ? String(e.score) : '—', 'ok'],
              ['Streak', e ? `${e.streak} d` : '—', 'or'],
              ['This week', e ? fmtHM(e.weekMin) : '—', 'pri'],
            ].map(([k, v, tone]) => (
              <Col key={k} g={2} style={{ background: C.bg, borderRadius: 10, padding: 10 }}>
                <span className="g-s11 g-mut">{k}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: TONE[tone][1] }}>{v}</span>
              </Col>
            ))}
          </Row>
          <span>
            <Chip tone={e ? e.level.tone : 'mut'} dot>
              {e ? e.level.label : 'No activity yet'}
            </Chip>
          </span>
          {e && <Heat days={e.heat} cell={13} />}
        </Card>
      </Row>

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} />
      <ProfileModal open={profOpen} onClose={() => setProfOpen(false)} learner={L} onSaved={reload} />
    </Screen>
  );
}
