import React, { useRef, useState } from 'react';
import { Card, Button, Typography, Space, Alert } from 'antd';
import { VideoCameraOutlined, DesktopOutlined, CheckCircleFilled, ExpandOutlined, LaptopOutlined } from '@ant-design/icons';
import lmsApi from '@/pages/Lms/api';

const { Title, Paragraph, Text } = Typography;

// Phones and tablets can't share their screen from a browser at all
// (getDisplayMedia doesn't exist there), so the test can never start on one.
const canShareScreen = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
const canUseCamera = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// What actually went wrong, in words a learner can act on — the gate used to
// say only "access is required" whatever the cause, so a learner whose
// camera was blocked, busy in another app or missing couldn't tell why the
// test "doesn't open".
function cameraError(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera / microphone is blocked for this site. Click the camera icon in the address bar → Allow, then click "Enable Camera & Microphone" again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found. Connect one (or use a laptop with a built-in camera) and try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your camera or microphone is being used by another app or tab (live class, Zoom, Meet, WhatsApp…). Close it and try again.';
    default:
      return 'Could not turn on the camera and microphone. Check that they are connected and allowed for this site, then try again.';
  }
}
function screenError(err) {
  if (err && err.name === 'NotAllowedError') {
    return 'Screen sharing was cancelled. Click "Enable Screen Sharing", choose "Entire screen" and press Share.';
  }
  return 'Could not start screen sharing. Use Chrome or Edge on a laptop / desktop and try again.';
}

/**
 * Camera + mic + screen-share + fullscreen gate for the proctored assessment
 * runner, ported from python-test-platform's frontend/components/ProctorGate.tsx.
 * Kept separate from the CRM's existing `components/ProctorGate.jsx` (camera/mic
 * only, used by the unrelated generic Quizzes flow) so that flow's behavior is
 * unaffected by this one's stricter requirements.
 */
export default function AssessmentProctorGate({ testType, onReady }) {
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [screenGranted, setScreenGranted] = useState(false);
  const [error, setError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const unsupported = !canShareScreen() || !canUseCamera();

  const fail = (step, message, err) => {
    setError(message);
    lmsApi.reportAssessmentGateIssue({ testType, step, error: `${(err && err.name) || ''} ${(err && err.message) || message}`.trim() });
  };

  async function requestCameraAndMic() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      cameraStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraGranted(true);
    } catch (err) {
      fail('camera', cameraError(err), err);
    }
  }

  async function requestScreenShare() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setScreenGranted(true);
    } catch (err) {
      fail('screen', screenError(err), err);
    }
  }

  async function handleStart() {
    setRequesting(true);
    setError('');
    const el = document.documentElement;
    const enter = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      // Older Safari only has the webkit- version; a browser with neither
      // still starts (the proctor watches for tab switches either way)
      // instead of being stuck on this screen forever.
      if (enter) await enter.call(el);
    } catch (err) {
      fail('fullscreen', 'Fullscreen was blocked. Click "Start Test" again and allow fullscreen when the browser asks.', err);
      setRequesting(false);
      return;
    }
    if (cameraStreamRef.current && screenStreamRef.current) {
      onReady?.({ cameraStream: cameraStreamRef.current, screenStream: screenStreamRef.current });
    } else {
      setRequesting(false);
    }
  }

  const allGranted = cameraGranted && screenGranted;

  if (unsupported) {
    return (
      <div className="lms-portal" style={{ padding: 4, display: 'flex', justifyContent: 'center' }}>
        <Card style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <LaptopOutlined style={{ fontSize: 40, color: '#2563eb' }} />
          <Title level={4} style={{ marginTop: 12 }}>Open this test on a laptop or desktop</Title>
          <Paragraph type="secondary">
            This test is proctored with screen sharing, which phones and tablets can't do from a browser. Open the CRM on a
            laptop or desktop in <b>Google Chrome</b> or <b>Microsoft Edge</b> and start the test there.
          </Paragraph>
        </Card>
      </div>
    );
  }

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
