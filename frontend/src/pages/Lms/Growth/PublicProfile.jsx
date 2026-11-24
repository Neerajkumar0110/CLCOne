import React from 'react';
import { useParams } from 'react-router-dom';
import api from './api';
import { C, I, IB, Chip, Btn, Av, Bar, Card, Row, Col, Gauge, Radar, KV, Note, useData } from './ui';

// Figma 1D "Recruiter shareable profile (public link)" — no login. Shows only
// what the learner allowed in the share modal; the link can expire / be revoked.

const LV = { ok: C.ok, wa: C.wa, er: C.er, mut: C.fa };
const nth = (n) => (n == null ? '—' : `${n}${['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`);

function Shell({ children, expires }) {
  return (
    <div className="g-root" style={{ minHeight: '100vh', background: C.w }}>
      <div style={{ background: C.ink, padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <IB n="grad" bg={C.pri} c={C.w} box={34} />
        <span style={{ fontSize: 15, fontWeight: 700, color: C.w, flex: 1 }}>CareerLab · Verified Learner Profile</span>
        <Chip tone="ok" i="shield">
          Verified by CareerLab
        </Chip>
        {expires && <span style={{ fontSize: 12, color: C.fa }}>Link expires {new Date(expires).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      </div>
      {children}
    </div>
  );
}

export default function PublicProfile() {
  const { token } = useParams();
  const { data: p, error, loading } = useData(() => api.publicProfile(token), [token]);
  if (loading && !p)
    return (
      <Shell>
        <div className="g-empty">Loading profile…</div>
      </Shell>
    );
  if (error || !p)
    return (
      <Shell>
        <div style={{ padding: 32 }}>
          <Note tone="er">{error || 'This profile link is not available.'}</Note>
        </div>
      </Shell>
    );
  const L = p.learner;
  const contactHref = L.email ? `mailto:${L.email}` : `mailto:support@careerlabconsulting.com?subject=${encodeURIComponent(`Enquiry about ${L.name} (profile ${token})`)}`;
  return (
    <Shell expires={p.expiresAt}>
      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 20 }} className="g-pub">
        <Row g={20} className="g-rm">
          <Card p={24} g={14} style={{ flex: 1 }}>
            <Row g={16} className="g-ac">
              <Av name={L.name} s={72} src={L.photoUrl} />
              <Col g={5} style={{ flex: 1 }}>
                <span style={{ fontSize: 24, fontWeight: 700 }}>{L.name}</span>
                <span style={{ fontSize: 13.5, color: C.sub }}>{[L.course, L.city].filter(Boolean).join(' · ')}</span>
                <Row g={6} className="g-wrap">
                  {(L.skills || []).map((s) => (
                    <Chip key={s} s={11.5}>
                      {s}
                    </Chip>
                  ))}
                </Row>
              </Col>
            </Row>
            <Row g={10} className="g-wrap">
              {L.resume && (
                <Btn k="p" i="download" href={L.resume.url} target="_blank">
                  Download resume
                </Btn>
              )}
              <Btn k="s" i="mail" href={contactHref}>
                {L.email ? 'Email' : 'Contact via CareerLab'}
              </Btn>
              {L.phone && (
                <Btn k="s" i="phone" href={`tel:${L.phone}`}>
                  {L.phone}
                </Btn>
              )}
              {L.links && L.links.github && (
                <Btn k="s" i="git" href={L.links.github} target="_blank">
                  GitHub
                </Btn>
              )}
              {L.links && L.links.linkedin && (
                <Btn k="s" i="linkedin" href={L.links.linkedin} target="_blank">
                  LinkedIn
                </Btn>
              )}
            </Row>
          </Card>
          {p.scores && (
            <Card title="Hire-readiness" i="target" style={{ width: 330, flexShrink: 0 }}>
              <Row g={14} className="g-ac">
                <Gauge v={p.total || 0} txt={p.total == null ? '—' : Math.round(p.total)} s={130} c={LV[p.level.tone]} l={p.level.label} />
                <Col g={8} style={{ width: 'auto' }}>
                  <span>
                    <Chip tone={p.level.tone} dot>
                      {p.level.label}
                    </Chip>
                  </span>
                  <b style={{ fontSize: 13 }}>{nth(p.standing.percentile)} percentile</b>
                  <span className="g-s12 g-mut">{p.standing.rank ? `Rank ${p.standing.rank} of ${p.standing.of} in batch` : 'Rank not available'}</span>
                </Col>
              </Row>
            </Card>
          )}
        </Row>

        <Row g={20} className="g-rm">
          {p.scores && (
            <Card title="Score breakdown" i="chart" style={{ width: 330, flexShrink: 0 }}>
              {[
                ['Attendance', p.scores.attendance, 'pri'],
                ['Assessment', p.scores.assessment, 'pu'],
                ['Coding', p.scores.coding, 'ind'],
                ['Project', p.scores.project, 'ok'],
              ].map(([l, v, t]) => (
                <Col key={l} g={5}>
                  <KV k={l} v={v == null ? '—' : String(v)} />
                  <Bar pct={v || 0} tone={t} h={7} />
                </Col>
              ))}
            </Card>
          )}
          {p.radar && (
            <Card title="Skill strengths" i="brain" style={{ width: 340, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Radar axes={p.radar.axes} s={296} sets={[{ d: p.radar.you.map((v) => v || 0), c: C.pri }]} />
              </div>
            </Card>
          )}
          {p.projects && (
            <Card title="Projects (mentor-reviewed)" i="folder" style={{ flex: 1 }}>
              {p.projects.length === 0 && <div className="g-empty">No reviewed projects yet.</div>}
              {p.projects.map((x) => (
                <Col key={`${x.title}${x.at}`} g={6} style={{ background: C.bg, borderRadius: 10, padding: 12 }}>
                  <Row className="g-sb g-ac">
                    <b style={{ fontSize: 13 }}>{x.title}</b>
                    <Chip tone={x.qualified ? 'ok' : 'wa'} s={10.5}>
                      {x.qualified ? 'Qualified' : 'Reviewed'} · {x.score}
                    </Chip>
                  </Row>
                  {x.stack && <span className="g-s12 g-mut">{x.stack}</span>}
                  <Row g={8}>
                    {x.github && (
                      <Btn k="s" sm i="git" href={x.github} target="_blank">
                        Code
                      </Btn>
                    )}
                    {x.demo && (
                      <Btn k="s" sm i="globe" href={x.demo} target="_blank">
                        Live demo
                      </Btn>
                    )}
                  </Row>
                </Col>
              ))}
            </Card>
          )}
        </Row>

        <Row g={20} className="g-rm">
          <Card title="Certificates & badges" i="award" style={{ flex: 1 }}>
            <Row g={8} className="g-wrap">
              {p.badges.length ? (
                p.badges.map((b) => (
                  <Chip key={b.label} tone={b.tone} i={b.i} s={12}>
                    {b.label}
                  </Chip>
                ))
              ) : (
                <span className="g-s12 g-fa">None yet.</span>
              )}
            </Row>
          </Card>
          {p.mentor && (
            <Card title="Mentor summary" i="msg" style={{ flex: 1 }}>
              <span style={{ fontSize: 13, color: C.sub, lineHeight: '20px' }}>
                “{p.mentor.text}” — {p.mentor.by}, Mentor
              </span>
            </Card>
          )}
        </Row>
      </div>
      <div style={{ background: C.bg, padding: '14px 32px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span className="g-s12 g-mut">
          Shared by {L.name}
          {L.email ? '' : ' · personal contact hidden by learner'}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.pri }}>
          <I n="link" s={13} /> {window.location.host}/p/{token}
        </span>
      </div>
    </Shell>
  );
}

export function Verify360() {
  const { code } = useParams();
  const { data, error, loading } = useData(() => api.verify360(code), [code]);
  return (
    <Shell>
      <div style={{ padding: 32, maxWidth: 640 }}>
        {loading && <div className="g-empty">Checking…</div>}
        {!loading && (error || !data) && <Note tone="er">{error || 'This report could not be verified.'}</Note>}
        {data && (
          <Card title="Genuine CareerLab 360° report" i="shield" tone="ok">
            <KV k="Learner" v={data.name} />
            <KV k="Hire-readiness on the report" v={data.total == null ? '—' : String(data.total)} />
            <KV k="Generated" v={new Date(data.generatedAt).toLocaleString('en-IN')} />
            <Note tone="ok" i="checkc">
              This PDF was generated by CareerLab LMS. If the numbers on your copy differ from these, it was changed after download.
            </Note>
          </Card>
        )}
      </div>
    </Shell>
  );
}
