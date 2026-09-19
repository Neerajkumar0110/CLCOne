import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button, Alert, Space, Typography } from 'antd';
import { VideoCameraOutlined, CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

/**
 * Pre-test camera/mic check + tab-switch monitor, UI only — no attempt data
 * is sent anywhere. Backend wiring (recording a violation against the real
 * attempt) is a later phase; for now this only gates the student's own
 * "Start" click and shows a warning banner if they leave the tab mid-test.
 */
export default function ProctorGate({ open, onReady, onCancel }) {
  const [status, setStatus] = useState('idle'); // idle | requesting | ready | denied
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStatus('requesting');
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('denied'));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const checklist = [
    { label: 'Camera access', ok: status === 'ready' },
    { label: 'Microphone access', ok: status === 'ready' },
    { label: 'Quiet, well-lit space', ok: status === 'ready' },
  ];

  return (
    <Modal
      open={open}
      title={<span><VideoCameraOutlined /> Proctoring check</span>}
      onCancel={() => { stopStream(); onCancel?.(); }}
      footer={[
        <Button key="cancel" onClick={() => { stopStream(); onCancel?.(); }}>Cancel</Button>,
        <Button key="start" type="primary" disabled={status !== 'ready'} onClick={() => { onReady?.(); }}>
          Start test
        </Button>,
      ]}
      destroyOnClose
      width={480}
    >
      <Paragraph type="secondary">
        This test is proctored. Keep your camera on and stay on this tab — switching away is flagged.
      </Paragraph>

      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#0b1120',
          borderRadius: 10,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 14,
        }}
      >
        {status === 'ready' ? (
          <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : status === 'denied' ? (
          <Text style={{ color: '#f87171' }}>Camera/mic permission denied</Text>
        ) : (
          <LoadingOutlined style={{ color: '#94a3b8', fontSize: 22 }} />
        )}
      </div>

      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        {checklist.map((c) => (
          <Space key={c.label}>
            {c.ok ? <CheckCircleFilled style={{ color: '#22c55e' }} /> : <CloseCircleFilled style={{ color: '#cbd5e1' }} />}
            <Text>{c.label}</Text>
          </Space>
        ))}
      </Space>

      {status === 'denied' && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          message="Camera and microphone access is required to start this test."
        />
      )}
    </Modal>
  );
}
