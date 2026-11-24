import React, { useCallback, useEffect, useState } from 'react';
import { message, Modal } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { getSocket } from '@/socket';
import lmsApi from '../api';
import './transcript.css';

// Manager / support view of the transcript + subtitle pipeline (recording
// transcript spec §5 "retry and monitoring", "backfill"): how many are ready /
// waiting / failed, every failed recording with its reason, retry (one or
// all), and re-writing the old Devanagari ones in Hinglish. Everything goes
// through the night queue — one at a time, never during a live class.

const TABS = [
  ['failed', 'Failed'],
  ['skipped', 'No audio'],
  ['processing', 'Running'],
  ['queued', 'Waiting'],
  ['done', 'Ready'],
];
const MODE = { roman: 'Hinglish', english: 'English', hindi: 'Hindi' };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const mins = (ms) => (ms ? `${Math.max(1, Math.round(ms / 60000))} min` : '—');

export default function TranscriptQueueCard({ compact = false }) {
  const [q, setQ] = useState(null);
  const [tab, setTab] = useState('failed');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([lmsApi.transcriptQueue().catch(() => null), lmsApi.transcriptList(tab).catch(() => null)]);
    setQ(s && s.success ? s.result : null);
    setRows(l && l.success ? l.result : []);
  }, [tab]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);
  useEffect(() => {
    const s = getSocket();
    const on = () => load();
    s?.on('lms:transcript', on);
    return () => s?.off('lms:transcript', on);
  }, [load]);

  const c = (q && q.counts) || {};
  const w = (q && q.worker) || {};

  const retry = async (ids) => {
    setBusy(true);
    const r = await lmsApi.transcriptRetry(ids).catch(() => null);
    setBusy(false);
    if (r && r.success) {
      message.success(r.message || 'Queued.');
      load();
    } else message.error((r && r.message) || 'Could not retry.');
  };
  const now = async (recordingId) => {
    setBusy(true);
    const r = await lmsApi.recordingTranscriptRequest(recordingId).catch(() => null);
    setBusy(false);
    if (r && r.success) {
      message.success(r.message || 'Queued first.');
      load();
    } else message.error((r && r.message) || 'Could not queue it.');
  };
  const backfill = () =>
    Modal.confirm({
      title: 'Re-write old transcripts in Hinglish?',
      content:
        'Every finished transcript written in another script (the first ones are Devanagari) is re-written in Hinglish (English letters) at night, one at a time. The old text stays readable until the new one is ready. Transcripts corrected by hand are left as they are.',
      okText: 'Yes, queue them',
      onOk: async () => {
        const r = await lmsApi.transcriptBackfill('roman').catch(() => null);
        if (r && r.success) {
          message.success(r.message || 'Queued.');
          load();
        } else message.error((r && r.message) || 'Could not queue them.');
      },
    });

  return (
    <div className="tq">
      <div className="tq-head">
        <b>Transcripts &amp; subtitles</b>
        <span className={`tq-dot ${w.enabled ? 'ok' : 'off'}`} title={w.enabled ? 'Whisper is installed on this server' : 'Whisper runs on the live server only'} />
        <span className="tq-muted">
          {w.enabled ? `${w.inWindow ? 'night window open' : `runs ${w.window || 'at night'}`} · model ${w.model || '—'}` : 'runs on the live server, at night'}
        </span>
        <button type="button" className="tp-chip" style={{ marginLeft: 'auto' }} onClick={load} aria-label="Refresh">
          <ReloadOutlined />
        </button>
      </div>

      <div className="tq-stats">
        {[
          ['done', 'Ready', 'ok'],
          ['queued', 'Waiting', ''],
          ['processing', 'Running', ''],
          ['failed', 'Failed', 'bad'],
          ['skipped', 'No audio', 'muted'],
        ].map(([k, l, cls]) => (
          <button key={k} type="button" className={`tq-stat ${cls} ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)} aria-pressed={tab === k}>
            <span>{c[k] || 0}</span>
            {l}
          </button>
        ))}
      </div>
      {q && q.running && (
        <div className="tq-muted">
          <SyncOutlined spin /> Running now: {q.running.durationSec ? `${Math.round(((q.running.progressSec || 0) / q.running.durationSec) * 100)}%` : 'starting'}
        </div>
      )}

      <div className="tq-actions">
        {(c.failed || 0) + (c.skipped || 0) > 0 && (
          <button type="button" className="tp-btn" disabled={busy} onClick={() => retry()}>
            Retry all failed ({(c.failed || 0) + (c.skipped || 0)})
          </button>
        )}
        <button type="button" className="tp-chip" disabled={busy} onClick={backfill} title="Re-write Devanagari / English transcripts in Hinglish">
          Re-write old ones in Hinglish
        </button>
      </div>

      <div className="tq-tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="tq-list" style={compact ? { maxHeight: 260 } : undefined}>
        {!rows && <div className="tq-muted">Loading…</div>}
        {rows && rows.length === 0 && <div className="tq-muted">Nothing here.</div>}
        {rows &&
          rows.map((r) => (
            <div key={r.id} className="tq-row">
              <div className="tq-main">
                <b>{r.batchName || r.className || 'Recording'}</b>
                <span className="tq-muted">
                  {day(r.date)}
                  {r.mode ? ` · ${MODE[r.mode] || r.mode}` : ''}
                  {r.status === 'done' ? ` · took ${mins(r.processingMs)}` : ''}
                  {r.attempts ? ` · ${r.attempts} tr${r.attempts === 1 ? 'y' : 'ies'}` : ''}
                  {r.status === 'queued' && r.retryAfter && new Date(r.retryAfter) > new Date() ? ` · next try ${new Date(r.retryAfter).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
                {r.error && ['failed', 'skipped', 'queued'].includes(r.status) && <span className="tp-err">{r.error}</span>}
              </div>
              {['failed', 'skipped'].includes(r.status) && (
                <button type="button" className="tp-chip" disabled={busy} onClick={() => retry([r.id])}>
                  Retry
                </button>
              )}
              {r.status === 'queued' && (
                <button type="button" className="tp-chip" disabled={busy || r.recordingStatus !== 'AVAILABLE'} onClick={() => now(r.recording)}>
                  Do it first
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
