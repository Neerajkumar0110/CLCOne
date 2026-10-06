import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button, Checkbox, Alert, Progress } from 'antd';
import { CameraOutlined, AudioOutlined, SoundOutlined, CheckCircleFilled, CloseCircleFilled, VideoCameraOutlined } from '@ant-design/icons';
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
        // The <video> element is always mounted (see render below) so the
        // ref is already attached by the time this resolves — assigning it
        // conditionally on a "camera === 'ok'" render used to leave this
        // null forever (the video tag only mounted once state said 'ok',
        // by which point this assignment had already run), which is why
        // the preview stayed a plain black box even with permission granted.
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

  const confirm = async () => {
    stopAll();
    try {
      await lmsApi.deviceCheckLog(sessionId, { camera: camera === 'ok', microphone: mic === 'ok', speaker: speakerTested, passed: canJoin });
    } catch (e) {
      /* non-fatal — never block joining on the log call */
    }
    onConfirm();
  };

  const statusNode = (s) => {
    if (s === 'checking') return <span className="dpf-row-status is-checking">checking…</span>;
    if (s === 'ok') return <span className="dpf-row-status is-ok"><CheckCircleFilled /> Ready</span>;
    return <span className="dpf-row-status is-bad"><CloseCircleFilled /> {s === 'none' ? 'Not found' : 'Blocked'}</span>;
  };

  const placeholderText = camera === 'checking' ? 'Requesting camera…' : camera === 'none' ? 'No camera found' : 'Camera access blocked';

  return (
    <Modal
      open={open}
      title="Device check before joining"
      onCancel={() => { stopAll(); onCancel(); }}
      width={480}
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto', overflowX: 'hidden' } }}
      footer={[
        <Button key="c" onClick={() => { stopAll(); onCancel(); }}>Cancel</Button>,
        <Button key="j" type="primary" disabled={!canJoin} onClick={confirm}>Join Now</Button>,
      ]}
      destroyOnClose
    >
      <p className="dpf-intro">
        As per the Class Participation &amp; Camera/Microphone Policy, please confirm your devices before joining.
        {cameraRequired && <b> Camera is mandatory for this class.</b>}
      </p>

      <div className="dpf-video-box">
        {/* Always mounted (never conditionally unmounted) so the ref is
           already live the moment getUserMedia resolves — see the comment
           above. Hidden behind the placeholder overlay until it has a
           stream. */}
        <video ref={videoRef} autoPlay muted playsInline style={{ display: camera === 'ok' ? 'block' : 'none' }} />
        {camera !== 'ok' && (
          <div className={`dpf-video-placeholder${camera === 'denied' || camera === 'none' ? ' is-denied' : ''}`}>
            {camera === 'checking' ? <VideoCameraOutlined /> : <CameraOutlined />}
            <span>{placeholderText}</span>
          </div>
        )}
      </div>

      <div className="dpf-rows">
        <div className="dpf-row">
          <div className="dpf-row-icon"><CameraOutlined /></div>
          <span className="dpf-row-label">
            Camera
            {cameraRequired && <span className="dpf-row-required">(required)</span>}
          </span>
          {statusNode(camera)}
        </div>

        <div className="dpf-row dpf-row-column">
          <div className="dpf-row-top">
            <div className="dpf-row-icon"><AudioOutlined /></div>
            <span className="dpf-row-label">Microphone</span>
            {statusNode(mic)}
          </div>
          {mic === 'ok' && (
            <Progress className="dpf-mic-level" percent={micLevel} showInfo={false} size="small" strokeColor="#16a34a" />
          )}
        </div>

        <div className="dpf-row">
          <div className="dpf-row-icon"><SoundOutlined /></div>
          <span className="dpf-row-label">Speaker</span>
          <button type="button" className="dpf-speaker-btn" onClick={testSpeaker}>
            {speakerTested ? 'Played ✓' : 'Test sound'}
          </button>
        </div>
      </div>

      {(camera === 'denied' || mic === 'denied') && (
        <Alert
          className="dpf-alert"
          type="warning"
          showIcon
          message="Permission blocked"
          description="Enable camera/microphone access for this site in your browser settings, then reopen this dialog."
        />
      )}

      <Checkbox className="dpf-consent" checked={agree} onChange={(e) => setAgree(e.target.checked)}>
        I understand and consent to my camera/microphone being used for this class as per the policy.
      </Checkbox>
    </Modal>
  );
}
