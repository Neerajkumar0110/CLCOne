import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { getSocket } from '@/socket';
import { API_BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';
import lmsApi from '../api';

// Subtitles / CC for a class recording (recording transcript & subtitle spec,
// 24 Oct 2026). The caption track is the recording's transcript as WebVTT,
// served by GET /api/lms/recordings/:id/captions.vtt after the same access
// check as the video. A <track src> can't send the login token, so the file
// is fetched with it and handed to the player as a blob: URL — there is never
// a public caption link.

// A file the browser's own <video> can play. BBB's "video" export
// (video-0.m4v: screen share + slides + webcams + audio) and its raw
// webcams.webm are on the SAME timeline as the transcript (checked on the VPS
// 23 Nov 2026: durations match to < 0.1 s), so captions line up exactly.
export const isMediaFile = (url) => /\.(m4v|mp4|webm|mov|ogv)(\?|#|$)/i.test(String(url || ''));

// Which source the player shows for this recording:
//   'video' — native <video> (Subtitles / CC + live transcript highlight work)
//   'frame' — BBB's own playback page / Drive / YouTube (iframe, no CC)
export function videoSourceFor(rec) {
  if (!rec || !rec.url) return null;
  if (rec.provider === 'external') return null;
  if (rec.provider === 'bigbluebutton') return isMediaFile(rec.downloadUrl) ? rec.downloadUrl : null;
  return rec.url; // our own uploads / Drive imports — a file on this server
}

export function useCaptions(recId) {
  const [info, setInfo] = useState(null); // transcript-status result
  const [src, setSrc] = useState(null); // blob: URL of the WebVTT

  const load = useCallback(async () => {
    if (!recId) return;
    const st = await lmsApi.recordingTranscriptStatus(recId).catch(() => null);
    const r = st && st.success ? st.result : { status: 'NONE', captionsAvailable: false };
    setInfo(r);
    if (!r.captionsAvailable) {
      setSrc(null);
      return;
    }
    try {
      const token = storePersist.get('auth')?.current?.token;
      const resp = await axios.get(`${API_BASE_URL}lms/recordings/${recId}/captions.vtt`, {
        responseType: 'blob',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blob = new Blob([resp.data], { type: 'text/vtt' });
      setSrc(URL.createObjectURL(blob));
    } catch (e) {
      // captions failing must never break the video
      setSrc(null);
      setInfo((x) => ({ ...(x || {}), captionsAvailable: false, status: (x && x.status) || 'FAILED' }));
    }
  }, [recId]);

  useEffect(() => {
    setInfo(null);
    setSrc(null);
    load();
  }, [load]);

  // free the old blob when it is replaced / the player closes
  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src);
    },
    [src]
  );

  // still being made → check again every minute, and at once on the socket push
  useEffect(() => {
    if (!info || !['PENDING', 'PROCESSING'].includes(info.status)) return undefined;
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [info, load]);
  useEffect(() => {
    const s = getSocket();
    const on = (p) => p && String(p.recording) === String(recId) && load();
    s?.on('lms:transcript', on);
    return () => s?.off('lms:transcript', on);
  }, [recId, load]);

  return { info, src, reload: load };
}

// Show / hide the caption track on a <video> without touching the rest of
// the player. The native CC menu (and fullscreen) keep working; if the
// viewer flips it there, onChange keeps our button in step.
export function useTrackMode(mediaRef, src, on, onChange, playerKey) {
  useEffect(() => {
    const el = mediaRef && mediaRef.current;
    if (!el || el.tagName !== 'VIDEO' || !src) return undefined;
    const apply = () => {
      for (const t of Array.from(el.textTracks || [])) {
        if (t.kind === 'captions' || t.kind === 'subtitles') t.mode = on ? 'showing' : 'hidden';
      }
    };
    apply();
    const trackEl = el.querySelector('track');
    trackEl && trackEl.addEventListener('load', apply);
    const tracks = el.textTracks;
    const onTracks = () => {
      const t = Array.from(tracks || []).find((x) => x.kind === 'captions' || x.kind === 'subtitles');
      if (t && (t.mode === 'showing') !== on && onChange) onChange(t.mode === 'showing');
    };
    tracks && tracks.addEventListener && tracks.addEventListener('change', onTracks);
    return () => {
      trackEl && trackEl.removeEventListener('load', apply);
      tracks && tracks.removeEventListener && tracks.removeEventListener('change', onTracks);
    };
    // playerKey: the <video> element itself may change (player switched)
  }, [mediaRef, src, on, onChange, playerKey]);
}

// Short text for the CC button / tooltip
export function ccState(info, hasVideo) {
  if (!hasVideo) return { ready: false, note: 'Subtitles need the class video file — use the transcript instead.' };
  if (!info) return { ready: false, note: 'Checking subtitles…' };
  if (info.captionsAvailable) return { ready: true, note: `Subtitles: ${info.languageLabel || 'available'}` };
  if (info.status === 'PENDING' || info.status === 'PROCESSING') return { ready: false, note: 'Transcript and subtitles are being prepared.' };
  if (info.status === 'FAILED') return { ready: false, note: 'Subtitles are not available for this recording — the team has been told.' };
  return { ready: false, note: 'Subtitles are not ready yet — they are made after the class.' };
}
