import React, { useEffect, useRef, useState } from 'react';
import {
  CameraOutlined, AudioOutlined, SoundOutlined, CheckCircleOutlined, CloseOutlined,
  CaretRightOutlined, ArrowRightOutlined, WarningOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import './DevicePreflightModal.css';

// Pre-join device check (spec §6): camera/mic/speaker permission status +
// a clear consent notice, with Join held until the configured requirement
// is met. Nothing here ever leaves the browser except pass/fail booleans
// (logged via lmsApi.deviceCheckLog) — the actual media stream is stopped
// the moment this modal closes.
export default function DevicePreflightModal({ open, onCancel, onConfirm, sessionId, policy }) {
  const [camera, setCamera] = useState('checking'); // checking | ok | denied | none
  const [mic, setMic] = useState('checking');
  const [micLevel, setMicLevel] = useState(0);
  const [speakerTested, setSpeakerTested] = useState(false);
  const [agree, setAgree] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);

  const stopAll = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    setCamera('checking'); setMic('checking'); setMicLevel(0); setSpeakerTested(false); setAgree(false);

    (async () => {
      // camera + mic requested separately so a denial of one doesn't hide
      // the other's real status.
      let camStream = null;
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        streamRef.current = camStream;
        // The <video> element is always mounted (see render below), so the
        // ref is already live by the time this resolves — assigning it
        // only once state said "ok" used to leave this null forever (the
        // video tag mounted after this line ran), which is why the
        // preview stayed a plain black box even with permission granted.
        if (videoRef.current) videoRef.current.srcObject = camStream;
        setCamera('ok');
      } catch (e) {
        setCamera(e && e.name === 'NotFoundError' ? 'none' : 'denied');
      }

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMic('ok');
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(micStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
        // keep the mic stream alive alongside the camera one for cleanup
        if (streamRef.current) micStream.getTracks().forEach((t) => streamRef.current.addTrack(t));
        else streamRef.current = micStream;
      } catch (e) {
        setMic(e && e.name === 'NotFoundError' ? 'none' : 'denied');
      }
    })();

    return () => stopAll();
  }, [open]);

  // Esc closes it, same as a normal modal would.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { stopAll(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const testSpeaker = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 350);
      setSpeakerTested(true);
    } catch (e) {
      /* best-effort */
    }
  };

  const cameraRequired = !!(policy && policy.cameraRequiredToJoin);
  const canJoin = agree && (!cameraRequired || camera === 'ok');

  const cancel = () => { stopAll(); onCancel(); };

  const confirm = async () => {
    stopAll();
    try {
      await lmsApi.deviceCheckLog(sessionId, { camera: camera === 'ok', microphone: mic === 'ok', speaker: speakerTested, passed: canJoin });
    } catch (e) {
      /* non-fatal — never block joining on the log call */
    }
    onConfirm();
  };

  if (!open) return null;

  const readyPill = (s) => {
    if (s === 'ok') return <span className="device-ready"><CheckCircleOutlined /> Ready</span>;
    if (s === 'checking') return <span className="device-ready is-checking">Checking…</span>;
    return <span className="device-ready is-bad"><CloseOutlined /> {s === 'none' ? 'Not found' : 'Blocked'}</span>;
  };

  const cameraBadgeClass = camera === 'ok' ? '' : camera === 'checking' ? 'is-checking' : 'is-bad';
  const cameraBadgeText = camera === 'ok' ? 'Camera On' : camera === 'checking' ? 'Checking…' : 'Camera Off';
  const placeholderText = camera === 'checking' ? 'Requesting camera…' : camera === 'none' ? 'No camera found' : 'Camera access blocked';

  return (
    <div className="device-check-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="device-check-modal">
        <div className="device-check-header">
          <div className="device-check-header-icon">
            <CameraOutlined />
          </div>

          <div className="device-check-header-content">
            <h2>Device Check Before Joining</h2>
            <p>
              As per the Class Participation &amp; Camera/Microphone Policy, please confirm your devices before joining.
              {cameraRequired && <b> Camera is mandatory for this class.</b>}
            </p>
          </div>

          <button type="button" className="device-check-close" onClick={cancel} aria-label="Close">
            <CloseOutlined />
          </button>
        </div>

        <div className="device-check-body">
          <div className="camera-preview">
            <video ref={videoRef} autoPlay muted playsInline style={{ display: camera === 'ok' ? 'block' : 'none' }} />
            {camera !== 'ok' && (
              <div className={`camera-preview-placeholder${camera === 'denied' || camera === 'none' ? ' is-denied' : ''}`}>
                {camera === 'checking' ? <VideoCameraOutlined /> : <CameraOutlined />}
                <span>{placeholderText}</span>
              </div>
            )}

            <div className={`camera-status-badge ${cameraBadgeClass}`}>
              <span className="camera-status-dot" />
              {cameraBadgeText}
            </div>

            {camera === 'ok' && (
              <div className="live-preview-badge">
                <CameraOutlined /> Live Preview
              </div>
            )}
          </div>

          <div className="device-list">
            {/* Camera */}
            <div className="device-row">
              <div className="device-icon">
                <CameraOutlined />
              </div>
              <div className="device-info">
                <h3>
                  Camera
                  {cameraRequired && <span className="device-required">(required)</span>}
                </h3>
                <p>Make sure your camera is working properly.</p>
              </div>
              {readyPill(camera)}
            </div>

            {/* Microphone */}
            <div className="device-row">
              <div className="device-icon">
                <AudioOutlined />
              </div>
              <div className="device-info">
                <h3>Microphone</h3>
                <p>Make sure your audio is working properly.</p>
                {mic === 'ok' && (
                  <div className="mic-level-wrapper">
                    <div className="mic-level">
                      <div className="mic-level-fill" style={{ width: `${micLevel}%` }} />
                    </div>
                  </div>
                )}
              </div>
              {readyPill(mic)}
            </div>

            {/* Speaker */}
            <div className="device-row">
              <div className="device-icon">
                <SoundOutlined />
              </div>
              <div className="device-info">
                <h3>Speaker</h3>
                <p>Make sure you can hear the test sound.</p>
              </div>
              <button type="button" className="test-sound-btn" onClick={testSpeaker}>
                <CaretRightOutlined />
                {speakerTested ? 'Played ✓' : 'Test sound'}
              </button>
            </div>
          </div>

          {(camera === 'denied' || mic === 'denied') && (
            <div className="device-check-warning">
              <WarningOutlined />
              <div>
                <strong>Permission blocked</strong>
                Enable camera/microphone access for this site in your browser settings, then reopen this dialog.
              </div>
            </div>
          )}

          <div className="device-consent">
            <input
              type="checkbox"
              id="deviceConsent"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <label htmlFor="deviceConsent">
              I understand and consent to my camera/microphone being used for this class as per the policy.
            </label>
          </div>
        </div>

        <div className="device-check-footer">
          <button type="button" className="cancel-btn" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="join-now-btn" disabled={!canJoin} onClick={confirm}>
            Join Now
            <ArrowRightOutlined />
          </button>
        </div>
      </div>
    </div>
  );
}
