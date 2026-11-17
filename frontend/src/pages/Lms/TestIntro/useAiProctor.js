import { useEffect, useRef, useState } from 'react';
import lmsApi from '@/pages/Lms/api';

// In-browser AI proctoring for a running test (management ask 2026-11-16).
// Everything runs on the learner's own machine — no video or audio is sent
// anywhere; only when a rule is broken does one small camera JPEG go to the
// server as evidence (proctor-event `snapshot`).
//
//   MULTIPLE_PERSONS  2+ people on camera in 3 checks in a row (~4.5 s)
//   PHONE_DETECTED    a mobile phone on camera in 3 checks in a row
//   LOUD_NOISE        loud sound / talking for ~70% of an 8 s window,
//                     measured against the room's own level from the first 4 s
//   CAMERA_OFF        the camera track ends (camera unplugged / blocked)
//   SCREEN_SHARE_STOPPED  the screen-share track ends ("Stop sharing")
//
// Objects come from TensorFlow.js COCO-SSD ("person", "cell phone"), loaded
// from jsDelivr the first time a test starts (~5 MB, then cached by the
// browser). If it can't load, the camera / screen / tab rules still apply and
// the failure is logged as a gate issue for the team.

const TFJS = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const COCO = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';

const CHECK_MS = 1500;
const HITS_NEEDED = 3;
const PERSON_MIN = 0.6;
const PHONE_MIN = 0.5;
const AUDIO_MS = 200;
const AUDIO_WINDOW = 40; // 8 s of samples
const AUDIO_LOUD_SHARE = 0.7;
const AUDIO_CALIBRATE = 20; // first 4 s = the room's normal level

let modelPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
}
function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      if (!window.tf) await loadScript(TFJS);
      if (!window.cocoSsd) await loadScript(COCO);
      return window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
    })().catch((e) => {
      modelPromise = null; // let the next test try again
      throw e;
    });
  }
  return modelPromise;
}

// a small JPEG of the camera with the detected boxes drawn on it
function snapshot(video, boxes = []) {
  try {
    const w = 360;
    const h = Math.round((video.videoHeight / video.videoWidth) * w) || 270;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.drawImage(video, 0, 0, w, h);
    const k = w / (video.videoWidth || w);
    g.lineWidth = 3;
    g.font = 'bold 14px sans-serif';
    boxes.forEach((p) => {
      const [x, y, bw, bh] = p.bbox.map((v) => v * k);
      g.strokeStyle = '#ef4444';
      g.strokeRect(x, y, bw, bh);
      g.fillStyle = '#ef4444';
      g.fillText(`${p.class} ${Math.round(p.score * 100)}%`, x + 4, Math.max(14, y - 4));
    });
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fillRect(0, h - 20, w, 20);
    g.fillStyle = '#fff';
    g.font = '12px sans-serif';
    g.fillText(new Date().toLocaleString('en-IN'), 6, h - 6);
    return c.toDataURL('image/jpeg', 0.6);
  } catch (e) {
    return undefined;
  }
}

export default function useAiProctor({ active, streams, report, testType }) {
  const [status, setStatus] = useState({ vision: 'off', audio: 'off' });
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    const cam = streams && streams.cameraStream;
    const screen = streams && streams.screenStream;
    if (!active || !cam) return undefined;

    let stopped = false;
    let fired = false;
    const timers = [];
    const cleanups = [];
    const fire = (type, detail, video, boxes) => {
      if (fired || stopped) return;
      fired = true;
      reportRef.current(type, { detail, snapshot: video ? snapshot(video, boxes) : undefined });
    };

    // camera / screen share switched off
    const camTrack = cam.getVideoTracks()[0];
    const screenTrack = screen && screen.getVideoTracks()[0];
    const onCamEnd = () => fire('CAMERA_OFF', 'Camera stopped');
    const onScreenEnd = () => fire('SCREEN_SHARE_STOPPED', 'Screen sharing stopped');
    if (camTrack) {
      camTrack.addEventListener('ended', onCamEnd);
      cleanups.push(() => camTrack.removeEventListener('ended', onCamEnd));
    }
    if (screenTrack) {
      screenTrack.addEventListener('ended', onScreenEnd);
      cleanups.push(() => screenTrack.removeEventListener('ended', onScreenEnd));
    }

    // a private video element to read camera frames from
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream(cam.getVideoTracks());
    video.play().catch(() => {});
    cleanups.push(() => {
      video.pause();
      video.srcObject = null;
    });

    // ── people / phone on camera ──
    setStatus((s) => ({ ...s, vision: 'loading' }));
    loadModel()
      .then((model) => {
        if (stopped) return;
        setStatus((s) => ({ ...s, vision: 'on' }));
        let people = 0;
        let phone = 0;
        let busy = false;
        timers.push(
          setInterval(async () => {
            if (busy || fired || stopped || video.readyState < 2) return;
            busy = true;
            try {
              const preds = await model.detect(video, 10, 0.4);
              const persons = preds.filter((p) => p.class === 'person' && p.score >= PERSON_MIN);
              const phones = preds.filter((p) => p.class === 'cell phone' && p.score >= PHONE_MIN);
              people = persons.length >= 2 ? people + 1 : 0;
              phone = phones.length ? phone + 1 : 0;
              if (people >= HITS_NEEDED) {
                fire('MULTIPLE_PERSONS', `${persons.length} people on camera (${Math.round(Math.max(...persons.map((p) => p.score)) * 100)}%)`, video, persons);
              } else if (phone >= HITS_NEEDED) {
                fire('PHONE_DETECTED', `Mobile phone on camera (${Math.round(Math.max(...phones.map((p) => p.score)) * 100)}%)`, video, phones);
              }
            } catch (e) {
              /* one bad frame — try the next one */
            } finally {
              busy = false;
            }
          }, CHECK_MS)
        );
      })
      .catch((e) => {
        if (stopped) return;
        setStatus((s) => ({ ...s, vision: 'failed' }));
        lmsApi.reportAssessmentGateIssue?.({ testType, step: 'ai-proctor', error: String((e && e.message) || e).slice(0, 200) });
      });

    // ── loud sound / talking ──
    const audioTrack = cam.getAudioTracks()[0];
    const AC = window.AudioContext || window.webkitAudioContext;
    if (audioTrack && AC) {
      try {
        const ctx = new AC();
        ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        const calib = [];
        const recent = [];
        let threshold = null;
        setStatus((s) => ({ ...s, audio: 'on' }));
        timers.push(
          setInterval(() => {
            if (fired || stopped) return;
            an.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
            const rms = Math.sqrt(sum / buf.length);
            if (threshold === null) {
              calib.push(rms);
              if (calib.length >= AUDIO_CALIBRATE) {
                const sorted = calib.slice().sort((a, b) => a - b);
                threshold = Math.max(0.04, sorted[Math.floor(sorted.length / 2)] * 4);
              }
              return;
            }
            recent.push(rms > threshold);
            if (recent.length > AUDIO_WINDOW) recent.shift();
            const loud = recent.filter(Boolean).length;
            if (recent.length === AUDIO_WINDOW && loud / AUDIO_WINDOW >= AUDIO_LOUD_SHARE) {
              fire('LOUD_NOISE', `Loud sound / talking for about ${Math.round((loud * AUDIO_MS) / 1000)} of the last 8 seconds`, video, []);
            }
          }, AUDIO_MS)
        );
        cleanups.push(() => ctx.close().catch(() => {}));
      } catch (e) {
        setStatus((s) => ({ ...s, audio: 'failed' }));
      }
    }

    return () => {
      stopped = true;
      timers.forEach(clearInterval);
      cleanups.forEach((f) => f());
    };
  }, [active, streams, testType]);

  return status;
}
