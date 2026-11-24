import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import { C, I, Chip, Btn, Bar, Card, Row, Col, KPI, Table, Leg, KV, Note, Screen, Loading, ErrorBox, useData, ago } from './ui';

// Figma 3B "Content reading & video progress" (Learner).

const TYPE = { lesson: ['reading', 'Read'], material: ['reading', 'Read'], video: ['video', 'Video'], recording: ['video', 'Video'] };
const ST = { completed: ['Completed', 'ok'], in_progress: ['In progress', 'sky'], not_started: ['Not started', 'mut'] };
const mmss = (sec) => {
  const s = Math.round(sec || 0);
  return s >= 60 ? `${Math.floor(s / 60)}m` : s ? `${s}s` : '—';
};
const clock = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

// watched buckets (10 s each) → coloured segments
function Segments({ map, pct }) {
  const cells = String(map || '');
  if (!cells.length)
    return (
      <div style={{ height: 14, borderRadius: 7, background: C.bg2, overflow: 'hidden' }}>
        <div style={{ width: `${pct || 0}%`, height: '100%', background: C.pu }} />
      </div>
    );
  return (
    <div style={{ height: 14, borderRadius: 7, background: C.bg2, overflow: 'hidden', display: 'flex' }} role="img" aria-label={`Watched ${pct}%`}>
      {cells.split('').map((c, i) => (
        <span key={i} style={{ flex: 1, background: c === '1' ? C.pu : 'transparent' }} />
      ))}
    </div>
  );
}

export default function ContentProgress() {
  const [mod, setMod] = useState('');
  const { data: d, error, loading } = useData(() => api.contentMe(mod || undefined), [mod]);
  const [sel, setSel] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (d && d.rows.length) {
      const vid = d.rows.find((r) => (r.kind === 'video' || r.kind === 'recording') && r.status !== 'completed') || d.rows.find((r) => r.kind === 'video' || r.kind === 'recording');
      setSel(vid ? vid.id : null);
    }
  }, [d]);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  const k = d.kpis;
  const vid = d.rows.find((r) => r.id === sel) || null;
  const read = d.rows.find((r) => (r.kind === 'lesson' || r.kind === 'material') && r.status !== 'completed') || d.rows.find((r) => r.kind === 'lesson' || r.kind === 'material');
  const resumeAt = vid && vid.watchedMap ? (() => {
    const i = vid.watchedMap.indexOf('0');
    return i < 0 ? 0 : i * 10;
  })() : 0;

  return (
    <Screen crumb="LMS / Content Progress" title="Content Progress">
      <Row className="g-rs">
        <KPI i="layers" label="Modules opened" val={k.totalModules ? `${k.modulesOpened} / ${k.totalModules}` : String(k.modulesOpened)} sub={k.totalModules ? `${Math.max(0, k.totalModules - k.modulesOpened)} not started` : 'modules with activity'} tone="pri" bar={k.totalModules ? (k.modulesOpened / k.totalModules) * 100 : undefined} style={{ flex: 1 }} />
        <KPI i="reading" label="Pages read" val={k.pagesRead} sub={k.avgPageSec != null ? `avg ${Math.floor(k.avgPageSec / 60)}m ${String(k.avgPageSec % 60).padStart(2, '0')}s per page` : 'no reading yet'} tone="ind" style={{ flex: 1 }} />
        <KPI i="eye" label="Reading completion" val={k.readingCompletion == null ? '—' : `${k.readingCompletion}%`} sub={k.avgScroll != null ? `avg scroll depth ${k.avgScroll}%` : '—'} tone="ok" bar={k.readingCompletion || 0} style={{ flex: 1 }} />
        <KPI i="video" label="Video watch" val={k.videoWatch == null ? '—' : `${k.videoWatch}%`} sub={`pauses ${k.pauses} · rewatches ${k.rewatches}`} tone="pu" bar={k.videoWatch || 0} style={{ flex: 1 }} />
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card
          title={d.module || 'Recently opened'}
          i="book"
          sub={`${d.rows.length} item${d.rows.length === 1 ? '' : 's'}${d.moduleCompletion != null ? ` · ${d.moduleCompletion}% complete` : ''}`}
          style={{ flex: 1 }}
          right={
            d.modules.length > 0 && (
              <div className="g-input" style={{ width: 'auto', padding: '5px 10px' }}>
                <select value={mod || d.module || ''} onChange={(e) => setMod(e.target.value)} aria-label="Module" style={{ fontSize: 12, fontWeight: 600 }}>
                  {d.modules.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )
          }
        >
          <Table
            cols={[
              ['Lesson', 'f'],
              ['Type', 86],
              ['Time', 64],
              ['Scroll / watch', 150],
              ['Pauses · rewatch', 110],
              ['Status', 120],
            ]}
            hl={d.rows.map((r, i) => (r.id === sel ? i : -1)).filter((i) => i >= 0)}
            onRow={(i) => setSel(d.rows[i].id)}
            rows={d.rows.map((r) => {
              const [ic, l] = TYPE[r.kind] || ['file', r.kind];
              const p = r.kind === 'video' || r.kind === 'recording' ? r.videoPct : r.scrollDepth;
              const [sl, st] = ST[r.status];
              return [
                r.title,
                <>
                  <I n={ic} c={C.mut} s={15} />
                  <span style={{ fontSize: 12, color: C.sub }}>{l}</span>
                </>,
                mmss(r.activeSec),
                <>
                  <Bar pct={p || 0} col={p >= 90 ? C.ok : p > 0 ? C.wa : C.ln} w={90} />
                  <span style={{ fontSize: 12 }}>{p || 0}%</span>
                </>,
                r.kind === 'video' || r.kind === 'recording' ? `${r.pauses} · ${r.rewatches}` : '—',
                <Chip tone={st} dot>
                  {sl}
                </Chip>,
              ];
            })}
            empty="Open a lesson, study material or recording — its progress shows here."
          />
        </Card>

        <Col style={{ width: 400, flexShrink: 0 }}>
          <Card title={vid ? `Video analytics · ${vid.title}` : 'Video analytics'} i="video">
            {!vid ? (
              <span className="g-s12 g-fa">Watch a recording or video lesson to see its analytics.</span>
            ) : (
              <>
                <Segments map={vid.watchedMap} pct={vid.videoPct} />
                <Leg
                  items={[
                    ['Watched', C.pu],
                    ['Not watched', C.bg2],
                  ]}
                />
                <Row g={10}>
                  {[
                    ['Watched', `${vid.videoPct || 0}%`],
                    ['Pauses', String(vid.pauses)],
                    ['Rewatches', String(vid.rewatches)],
                    ['Length', vid.durationSec ? clock(vid.durationSec) : '—'],
                  ].map(([a, b]) => (
                    <Col key={a} g={2} style={{ flex: 1, background: C.bg, borderRadius: 10, padding: '8px 10px' }}>
                      <span className="g-s11 g-mut">{a}</span>
                      <b style={{ fontSize: 13 }}>{b}</b>
                    </Col>
                  ))}
                </Row>
                <span>
                  <Btn k="p" i="play" onClick={() => navigate(vid.kind === 'recording' ? '/learn/recordings' : '/learn/courses')}>
                    Resume at {clock(resumeAt)}
                  </Btn>
                </span>
              </>
            )}
          </Card>
          <Card title={read ? `Reading · ${read.title}` : 'Reading'} i="reading">
            {!read ? (
              <span className="g-s12 g-fa">Open a lesson or study material to see reading progress.</span>
            ) : (
              <>
                <KV k="Time on page" v={`${Math.floor(read.activeSec / 60)}m ${String(read.activeSec % 60).padStart(2, '0')}s`} />
                <KV k="Scroll depth" v={`${read.scrollDepth}%`} />
                <Bar pct={read.scrollDepth} tone={read.scrollDepth >= 90 ? 'ok' : 'wa'} h={8} />
                <KV k="Reading completion" v={read.completed ? 'Completed' : `In progress · ${read.readPct}%`} />
                <KV k="Last opened" v={ago(read.lastAt)} />
              </>
            )}
            <Note tone="sky" i="checkc">
              Lesson marks Completed at 90% scroll + 2 min active time.
            </Note>
          </Card>
        </Col>
      </Row>
    </Screen>
  );
}
