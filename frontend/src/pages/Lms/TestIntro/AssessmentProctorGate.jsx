import React, { useRef, useState } from 'react';
import { Card, Button, Typography, Space, Alert } from 'antd';
import { VideoCameraOutlined, DesktopOutlined, CheckCircleFilled, ExpandOutlined } from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

/**
 * Camera + mic + screen-share + fullscreen gate for the proctored assessment
 * runner, ported from python-test-platform's frontend/components/ProctorGate.tsx.
 * Kept separate from the CRM's existing `components/ProctorGate.jsx` (camera/mic
 * only, used by the unrelated generic Quizzes flow) so that flow's behavior is
 * unaffected by this one's stricter requirements.
 */
export default function AssessmentProctorGate({ onReady }) {
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [screenGranted, setScreenGranted] = useState(false);
  const [error, setError] = useState('');
  const [requesting, setRequesting] = useState(false);

  async function requestCameraAndMic() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      cameraStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraGranted(true);
    } catch (err) {
      setError('Camera and microphone access is required to start the test.');
    }
  }

  async function requestScreenShare() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setScreenGranted(true);
    } catch (err) {
      setError('Screen sharing is required to start the test.');
    }
  }

  async function handleStart() {
    setRequesting(true);
    setError('');
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen();
      if (cameraStreamRef.current && screenStreamRef.current) {
        onReady?.({ cameraStream: cameraStreamRef.current, screenStream: screenStreamRef.current });
      }
    } catch (err) {
      setError('Fullscreen mode is required to start the test.');
      setRequesting(false);
    }
  }

  const allGranted = cameraGranted && screenGranted;

  return (
    <div className="lms-portal" style={{ padding: 4, display: 'flex', justifyContent: 'center' }}>
      <Card style={{ maxWidth: 480, width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Proctoring Setup
        </Text>
        <Title level={4} style={{ marginTop: 4, marginBottom: 16 }}>
          Before you begin
        </Title>

        <div
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            background: '#0b1120',
            borderRadius: 10,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 16 }}>
          <Button
            block
            icon={cameraGranted ? <CheckCircleFilled style={{ color: '#22c55e' }} /> : <VideoCameraOutlined />}
            disabled={cameraGranted}
            onClick={requestCameraAndMic}
            style={{ textAlign: 'left' }}
          >
            {cameraGranted ? 'Camera & Microphone — Granted' : 'Enable Camera & Microphone'}
          </Button>
          <Button
            block
            icon={screenGranted ? <CheckCircleFilled style={{ color: '#22c55e' }} /> : <DesktopOutlined />}
            disabled={screenGranted}
            onClick={requestScreenShare}
            style={{ textAlign: 'left' }}
          >
            {screenGranted ? 'Screen Sharing — Granted' : 'Enable Screen Sharing'}
          </Button>
        </Space>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          This test is proctored. Switching tabs, exiting fullscreen, or losing camera/mic/screen access will trigger a
          warning. After 3 warnings your test will be automatically suspended.
        </Paragraph>

        <Button type="primary" block size="large" icon={<ExpandOutlined />} disabled={!allGranted || requesting} onClick={handleStart}>
          {requesting ? 'Starting...' : 'Start Test (Enter Fullscreen)'}
        </Button>
      </Card>
    </div>
  );
}
