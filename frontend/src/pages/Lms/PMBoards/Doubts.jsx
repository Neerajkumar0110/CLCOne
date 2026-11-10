import React, { lazy, useEffect, useState } from 'react';
import { Alert, message } from 'antd';
import lmsApi from '../api';
import { PMPage, PMTabs, Legacy, Loading, useLoad, useTab, res, fmtDayTime, shortName, errText } from './shared';

const AllDoubts = lazy(() => import('../Doubts'));

// P10 — doubts with self-explaining filters (UI-08): waiting for my reply /
// answered, waiting for the learner / resolved; the thread with reply, pin
// for batch and mark resolved. Same doubt endpoints as the old page, which
// stays on the "All doubts" tab.

const F = [
  ['open', 'Waiting for my reply', 'The learner asked, you haven\'t answered yet', ['adh', 'Needs reply']],
  ['answered', 'Answered · waiting for learner', 'You replied, waiting for the learner to confirm', ['naya', 'Answered']],
  ['resolved', 'Resolved', 'The learner confirmed or it was marked resolved', ['hai', 'Resolved']],
];
const ROLE = { teacher: 'you', manager: 'manager', student: 'learner' };

function Thread({ id, onChanged }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState('');
  const { data: d, loading, error, reload } = useLoad(async () => res(await lmsApi.doubt(id)), [id]);
  if (loading && !d) return <Loading />;
  if (error || !d) return <Alert type="error" showIcon message={error || 'Not found.'} />;
  const meta = F.find((x) => x[0] === d.status) || F[0];
  const run = async (key, fn, ok) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && r.success === false) throw new Error(r.message);
      message.success(ok);
      await reload();
      onChanged();
      return true;
    } catch (e) {
      message.error(errText(e, 'Failed.'));
      return false;
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="ld-card" aria-label="Doubt">
      <div className="ld-hd"><b style={{ fontSize: 16 }}>"{d.title}"</b><span className={`ld-chip ${meta[3][0]}`}>{d.status === 'open' ? 'Waiting for my reply' : meta[3][1]}</span></div>
      <div className="ld-muted" style={{ fontSize: 13 }}>{d.studentName}{d.course ? ` · ${d.course}` : ''}{d.lessonTitle ? ` · ${d.lessonTitle}` : ''} · {fmtDayTime(d.created)}{d.pinned ? ' · 📌 pinned for batch' : ''}</div>
      {d.body && <div className="pm-msg">{d.body}</div>}
      {(d.replies || []).map((r, i) => (
        <div key={i} className="pm-msg reply" style={r.byRole === 'student' ? { background: '#f8fafc' } : undefined}>
          <b>{r.byName} ({ROLE[r.byRole] || r.byRole}):</b> {r.body}
          <div className="ld-muted" style={{ fontSize: 11 }}>{fmtDayTime(r.at)}</div>
        </div>
      ))}
      {d.canReply && d.status !== 'resolved' && (
        <textarea className="ld-inp" aria-label="Reply" style={{ height: 110, padding: 10, resize: 'none' }} placeholder="Write a reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 'auto', flexWrap: 'wrap' }}>
        {d.canModerate && <button type="button" className="ld-btn2" disabled={!!busy} onClick={() => run('pin', () => lmsApi.pinDoubt(id), d.pinned ? 'Unpinned.' : 'Pinned for the batch.')}>{d.pinned ? 'Unpin' : 'Pin for batch'}</button>}
        {d.status !== 'resolved' ? (
          <button type="button" className="ld-btn2" disabled={!!busy} onClick={() => run('resolve', () => lmsApi.resolveDoubt(id), 'Marked resolved.')}>Mark resolved</button>
        ) : (
          <button type="button" className="ld-btn2" disabled={!!busy} onClick={() => run('reopen', () => lmsApi.resolveDoubt(id, { reopen: true }), 'Reopened.')}>Reopen</button>
        )}
        {d.canReply && d.status !== 'resolved' && (
          <button
            type="button"
            className="ld-btn"
            disabled={!reply.trim() || !!busy}
            onClick={async () => {
              if (await run('reply', () => lmsApi.replyDoubt(id, { body: reply.trim() }), 'Reply sent — learner notified.')) setReply('');
            }}
          >
            {busy === 'reply' ? 'Sending…' : 'Send reply'}
          </button>
        )}
      </div>
      <div className="ld-muted" style={{ fontSize: 12 }}>After you reply the status is "Answered — waiting for learner"; the learner or you mark it resolved</div>
    </section>
  );
}

function Board() {
  const [f, setF] = useState('open');
  const [sel, setSel] = useState('');
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.doubts()) || [], []);
  const list = data || [];
  const items = list.filter((d) => d.status === f).sort((a, b) => new Date(b.lastReplyAt || b.created) - new Date(a.lastReplyAt || a.created));
  useEffect(() => {
    if (!items.some((d) => d.id === sel)) setSel(items[0] ? items[0].id : '');
  }, [f, data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} />;
  const chip = (F.find((x) => x[0] === f) || F[0])[3];

  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {F.map(([k, label, sub]) => (
          <button key={k} type="button" className={`pm-f${f === k ? ' on' : ''}`} onClick={() => setF(k)}>
            <b>{label} · {list.filter((d) => d.status === k).length}</b>
            <span>{sub}</span>
          </button>
        ))}
      </div>
      <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: '420px minmax(0, 1fr)', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card pm-scroll" style={{ gap: 8 }} aria-label="Doubts list">
          {items.length === 0 && <div className="ld-empty">No doubt in this filter.</div>}
          {items.map((q) => (
            <button key={q.id} type="button" className={`pm-q${sel === q.id ? ' on' : ''}`} onClick={() => setSel(q.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}><b>{q.title}</b><span className={`ld-chip ${chip[0]}`}>{chip[1]}</span></div>
              <span className="ld-muted">{shortName(q.studentName)} · {fmtDayTime(q.created)} · {q.replyCount ? `${q.replyCount} repl${q.replyCount > 1 ? 'ies' : 'y'}` : 'no replies yet'}{q.pinned ? ' · 📌' : ''}</span>
            </button>
          ))}
        </section>
        {sel ? <Thread key={sel} id={sel} onChanged={reload} /> : <section className="ld-card"><div className="ld-empty">Pick a doubt from the list.</div></section>}
      </div>
    </>
  );
}

export default function PMDoubts() {
  const [tab, setTab] = useTab('board');
  return (
    <PMPage title="Doubts" sub="Every filter explains what it means" right={<PMTabs tabs={[['board', 'Doubts'], ['all', 'All doubts (table)']]} value={tab} onChange={setTab} />}>
      {tab === 'board' ? <Board /> : <Legacy><AllDoubts /></Legacy>}
    </PMPage>
  );
}
