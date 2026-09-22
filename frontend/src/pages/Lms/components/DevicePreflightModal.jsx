import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button, Checkbox, Alert, Space, Progress, Typography } from 'antd';
import { CameraOutlined, AudioOutlined, SoundOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;

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
        setCamera('ok');
        streamRef.current = camStream;
        if (videoRef.current) videoRef.current.srcObject = camStream;
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

  const statusIcon = (s) => {
    if (s === 'checking') return <Text type="secondary">checking…</Text>;
    if (s === 'ok') return <CheckCircleFilled style={{ color: '#52c41a' }} />;
    return <CloseCircleFilled style={{ color: '#ff4d4f' }} />;
  };

  return (
    <Modal
      open={open}
      title="Device check before joining"
      onCancel={() => { stopAll(); onCancel(); }}
      width={480}
      footer={[
        <Button key="c" onClick={() => { stopAll(); onCancel(); }}>Cancel</Button>,
        <Button key="j" type="primary" disabled={!canJoin} onClick={confirm}>Join Now</Button>,
      ]}
      destroyOnClose
    >
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        As per the Class Participation & Camera/Microphone Policy, please confirm your devices before joining.
        {cameraRequired && <b> Camera is mandatory for this class.</b>}
      </Paragraph>

      <div style={{ background: '#000', borderRadius: 8, height: 160, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {camera === 'ok' ? (
          <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Text style={{ color: '#999' }}>{camera === 'checking' ? 'Requesting camera…' : 'No camera preview'}</Text>
        )}
      </div>

      <Space direction="vertical" style={{ width: '100%' }} size={10}>
        <Space><CameraOutlined /> <Text>Camera</Text> {statusIcon(camera)} {cameraRequired && <Text type="danger" style={{ fontSize: 12 }}>(required)</Text>}</Space>
        <Space style={{ width: '100%' }}>
          <AudioOutlined /> <Text>Microphone</Text> {statusIcon(mic)}
        </Space>
        {mic === 'ok' && <Progress percent={micLevel} showInfo={false} size="small" strokeColor="#52c41a" />}
        <Space>
          <SoundOutlined /> <Text>Speaker</Text>
          <Button size="small" onClick={testSpeaker}>{speakerTested ? 'Played ✓' : 'Test sound'}</Button>
        </Space>
      </Space>

      {(camera === 'denied' || mic === 'denied') && (
        <Alert style={{ marginTop: 12 }} type="warning" showIcon message="Permission blocked" description="Enable camera/microphone access for this site in your browser settings, then reopen this dialog." />
      )}

      <Checkbox style={{ marginTop: 14 }} checked={agree} onChange={(e) => setAgree(e.target.checked)}>
        I understand and consent to my camera/microphone being used for this class as per the policy.
      </Checkbox>
    </Modal>
  );
}
