import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { message } from 'antd';
import { SearchOutlined, EditOutlined, CheckOutlined, CloseOutlined, DownloadOutlined, AimOutlined, ThunderboltOutlined, FileTextOutlined } from '@ant-design/icons';
import { getSocket } from '@/socket';
import { API_BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';
import lmsApi from '../api';
import './transcript.css';

// Synced class transcript (WhisperLiveKit plan, phase 1 = recorded videos).
// Line times are seconds of the recording's own media file, so:
//   • <video> (our uploads): the playing second highlights its line, and a
//     click on any line seeks the video there;
//   • BBB player (iframe, other origin — its clock can't be read): a click
//     re-opens the player at that second (onSeekFrame).

export const fmtTime = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

// BBB playback understands ?t=1h2m3s
export const withStartTime = (url, sec) => {
  if (!url) return url;
  const s = Math.max(0, Math.floor(sec));
  const t = `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;
  const [base, hash] = url.split('#');
  const clean = base.replace(/([?&])t=[^&]*&?/, '$1').replace(/[?&]$/, '');
  return `${clean}${clean.includes('?') ? '&' : '?'}t=${t}${hash ? `#${hash}` : ''}`;
};

function Highlight({ text, q }) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      <Highlight text={text.slice(i + q.length)} q={q} />
    </>
  );
}

export default function TranscriptPanel({ rec, mediaRef, isFrame, onSeekFrame, dark = false, style }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const [follow, setFollow] = useState(true);
  const [editing, setEditing] = useState(null); // { i, text }
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const rowRefs = useRef({});
  const autoScrolling = useRef(false);
  const recId = rec && rec.id;

  const load = useCallback(async () => {
    if (!recId) return;
    const res = await lmsApi.recordingTranscript(recId).catch(() => null);
    if (res && res.success) setData(res.result);
    else setData({ status: 'error', segments: [], message: (res && res.message) || 'Could not load the transcript.' });
  }, [recId]);

  useEffect(() => {
    setData(null);
    setActive(-1);
    setQ('');
    setEditing(null);
    setFollow(true);
    load();
  }, [load]);

  // still being made → check again every 30 s, and instantly on the socket push
  useEffect(() => {
    if (!data || !['queued', 'processing'].includes(data.status)) return undefined;
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [data, load]);
  useEffect(() => {
    const s = getSocket();
    const on = (p) => p && String(p.recording) === String(recId) && load();
    s?.on('lms:transcript', on);
    return () => s?.off('lms:transcript', on);
  }, [recId, load]);

  const segs = useMemo(() => (data && data.segments) || [], [data]);

  // playing second → active line (binary search on start times)
  useEffect(() => {
    if (isFrame || !segs.length) return undefined;
    const el = mediaRef && mediaRef.current;
    if (!el || el.tagName !== 'VIDEO') return undefined;
    const onTime = () => {
      const ms = el.currentTime * 1000;
      let lo = 0;
      let hi = segs.length - 1;
      let hit = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segs[mid].s <= ms) {
          hit = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      setActive(hit);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('seeked', onTime);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('seeked', onTime);
    };
  }, [segs, isFrame, mediaRef, data]);

  // keep the active line in view while following the video
  useEffect(() => {
    if (!follow || active < 0 || q || editing) return;
    const row = rowRefs.current[active];
    const box = listRef.current;
    if (!row || !box) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 40 || top > box.scrollTop + box.clientHeight - 80) {
      autoScrolling.current = true;
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: 'smooth' });
      setTimeout(() => {
        autoScrolling.current = false;
      }, 600);
    }
  }, [active, follow, q, editing]);

  const seek = (seg) => {
    const sec = seg.s / 1000;
    if (isFrame) {
      onSeekFrame && onSeekFrame(sec);
      return;
    }
    const el = mediaRef && mediaRef.current;
    if (el && el.tagName === 'VIDEO') {
      el.currentTime = sec;
      el.play && el.play().catch(() => {});
      setFollow(true);
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const res = await lmsApi.recordingTranscriptEdit(recId, editing.i, editing.text).catch(() => null);
    setBusy(false);
    if (res && res.success) {
      setData((d) => ({ ...d, edited: true, segments: d.segments.map((s, i) => (i === editing.i ? { ...s, t: editing.text } : s)) }));
      setEditing(null);
    } else message.error((res && res.message) || 'Could not save.');
  };

  const requestNow = async () => {
    setBusy(true);
    const res = await lmsApi.recordingTranscriptRequest(recId).catch(() => null);
    setBusy(false);
    if (res && res.success) {
      message.success(res.message || 'Queued.');
      load();
    } else message.error((res && res.message) || 'Could not queue it.');
  };

  const download = async (format) => {
    try {
      const token = storePersist.get('auth')?.current?.token;
      const r = await axios.get(`${API_BASE_URL}lms/recordings/${recId}/transcript/${format}`, {
        responseType: 'blob',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const name = (/filename="([^"]+)"/.exec(r.headers['content-disposition'] || '') || [])[1] || `transcript.${format}`;
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      message.error('Download failed.');
    }
  };

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return null;
    return segs.map((s, i) => (s.t.toLowerCase().includes(term) ? i : -1)).filter((i) => i >= 0);
  }, [q, segs]);

  const status = data ? data.status : 'loading';
  const canEdit = !!(data && data.canEdit);
  const pct = data && data.durationSec ? Math.min(100, Math.round(((data.progressSec || 0) / data.durationSec) * 100)) : 0;

  return (
    <div className={`tp ${dark ? 'tp-dark' : ''}`} style={style}>
      <div className="tp-head">
        <span className="tp-title">
          <FileTextOutlined /> Transcript
          {status === 'done' && <span className="tp-sub">{segs.length} lines{data.edited ? ' · corrected' : ''}</span>}
        </span>
        {status === 'done' && (
          <span className="tp-actions">
            {!isFrame && !follow && !q && (
              <button type="button" className="tp-chip" onClick={() => setFollow(true)} title="Scroll with the video">
                <AimOutlined /> Follow
              </button>
            )}
            <button type="button" className="tp-chip" onClick={() => download('txt')} title="Download as text">
              <DownloadOutlined /> TXT
            </button>
            <button type="button" className="tp-chip" onClick={() => download('vtt')} title="Download captions (WebVTT)">
              VTT
            </button>
          </span>
        )}
      </div>

      {status === 'done' && segs.length > 0 && (
        <label className="tp-search">
          <SearchOutlined aria-hidden="true" />
          <span className="tp-sr">Search the transcript</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search what was said…" />
          {matches && <span className="tp-count">{matches.length} found</span>}
        </label>
      )}

      {status === 'done' && isFrame && <div className="tp-hint">Click any line — the class video jumps to that moment.</div>}

      <div
        className="tp-list"
        ref={listRef}
        onScroll={() => {
          if (!autoScrolling.current && follow && !isFrame) setFollow(false);
        }}
      >
        {status === 'loading' && <div className="tp-empty">Loading transcript…</div>}
        {status === 'error' && <div className="tp-empty">{data.message}</div>}
        {status === 'none' && (
          <div className="tp-empty">
            <b>No transcript yet.</b>
            <span>Transcripts are made automatically at night, newest classes first.</span>
            {canEdit && (
              <button type="button" className="tp-btn" disabled={busy} onClick={requestNow}>
                <ThunderboltOutlined /> Transcribe now
              </button>
            )}
          </div>
        )}
        {status === 'queued' && (
          <div className="tp-empty">
            <b>In the transcript queue{data.queueAhead != null ? ` — ${data.queueAhead} ahead` : ''}.</b>
            <span>It is made at night when the server is free (never during a live class).</span>
            {canEdit && (
              <button type="button" className="tp-btn" disabled={busy} onClick={requestNow}>
                <ThunderboltOutlined /> Transcribe this first
              </button>
            )}
          </div>
        )}
        {status === 'processing' && (
          <div className="tp-empty">
            <b>Writing the transcript… {pct ? `${pct}%` : ''}</b>
            <div className="tp-bar">
              <span style={{ width: `${pct || 3}%` }} />
            </div>
            <span>This page updates by itself when it is ready.</span>
          </div>
        )}
        {(status === 'failed' || status === 'skipped') && (
          <div className="tp-empty">
            <b>{status === 'skipped' ? 'No transcript for this recording.' : 'The transcript could not be made.'}</b>
            {canEdit && data.error && <span className="tp-err">{data.error}</span>}
            {canEdit && status === 'failed' && (
              <button type="button" className="tp-btn" disabled={busy} onClick={requestNow}>
                Try again
              </button>
            )}
          </div>
        )}
        {status === 'done' && !segs.length && <div className="tp-empty">No speech was found in this recording.</div>}
        {status === 'done' && matches && !matches.length && <div className="tp-empty">Nothing matches “{q}”.</div>}

        {status === 'done' &&
          (matches || segs.map((_, i) => i)).map((i) => {
            const s = segs[i];
            const on = i === active;
            if (editing && editing.i === i) {
              return (
                <div key={i} className="tp-row is-editing" ref={(el) => (rowRefs.current[i] = el)}>
                  <span className="tp-time">{fmtTime(s.s)}</span>
                  <div className="tp-edit">
                    <textarea
                      autoFocus
                      rows={2}
                      value={editing.text}
                      onChange={(e) => setEditing({ i, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          save();
                        }
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                    <span>
                      <button type="button" className="tp-icon ok" disabled={busy} onClick={save} aria-label="Save">
                        <CheckOutlined />
                      </button>
                      <button type="button" className="tp-icon" onClick={() => setEditing(null)} aria-label="Cancel">
                        <CloseOutlined />
                      </button>
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={i}
                ref={(el) => (rowRefs.current[i] = el)}
                className={`tp-row ${on ? 'is-active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => seek(s)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), seek(s))}
                title={`Play from ${fmtTime(s.s)}`}
              >
                <span className="tp-time">{fmtTime(s.s)}</span>
                <span className="tp-text">
                  <Highlight text={s.t} q={q.trim()} />
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className="tp-icon tp-pen"
                    aria-label="Correct this line"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ i, text: s.t });
                    }}
                  >
                    <EditOutlined />
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
