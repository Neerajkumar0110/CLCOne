import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloseOutlined, LoadingOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import request from '@/request/request';

// Fullscreen, no-chrome VS Code session (OpenVSCode Server on the VPS,
// editing this CRM's own codebase) — opened as an overlay rather than a
// normal routed page so the rest of the CRM visually disappears behind it
// without touching the shared layout. The close button is the only way
// back; there's no in-place navigation inside the overlay.
//
// Access to the actual editor is gated server-side (backend/src/controllers/
// appControllers/operation/codeEditorController + nginx auth_request on the
// VPS), not by anything in this component — this page just asks for a
// one-time ticket and, if granted, embeds the resulting URL.
export default function CodeEditor() {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', url: null, message: null });
  const iframeRef = useRef(null);

  const close = useCallback(() => navigate('/'), [navigate]);

  const openSession = useCallback(async () => {
    setState({ status: 'loading', url: null, message: null });
    const res = await request.post({ entity: 'code-editor/session', jsonData: {} });
    if (!res?.success || !res?.result?.url) {
      setState({
        status: 'error',
        url: null,
        message: res?.message || 'Could not start a Code Editor session.',
      });
      return;
    }
    setState({ status: 'ready', url: res.result.url, message: null });
  }, []);

  useEffect(() => {
    openSession();
  }, [openSession]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: '#1e1e1e',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: '#181818',
          borderBottom: '1px solid #2d2d2d',
          flex: '0 0 auto',
        }}
      >
        <span style={{ color: '#cccccc', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700 }}>CLC InternX Code Lab</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {state.status === 'ready' && (
            <button
              type="button"
              title="Reload session"
              onClick={openSession}
              style={iconBtnStyle}
            >
              <ReloadOutlined />
            </button>
          )}
          <button type="button" title="Close (Esc)" onClick={close} style={{ ...iconBtnStyle, color: '#ff6b6b' }}>
            <CloseOutlined />
          </button>
        </div>
      </div>

      <div style={{ flex: '1 1 auto', position: 'relative' }}>
        {state.status === 'loading' && (
          <Centered>
            <LoadingOutlined style={{ fontSize: 28, color: '#8c8c8c' }} spin />
            <div style={{ marginTop: 12 }}>Starting your Code Editor session…</div>
          </Centered>
        )}

        {state.status === 'error' && (
          <Centered>
            <WarningOutlined style={{ fontSize: 28, color: '#faad14' }} />
            <div style={{ marginTop: 12, maxWidth: 420, textAlign: 'center' }}>{state.message}</div>
            <button type="button" onClick={openSession} style={{ ...iconBtnStyle, width: 'auto', padding: '6px 16px', marginTop: 16 }}>
              Try again
            </button>
            <button type="button" onClick={close} style={{ ...iconBtnStyle, width: 'auto', padding: '6px 16px', marginTop: 8, color: '#ff6b6b' }}>
              Back to CRM
            </button>
          </Centered>
        )}

        {state.status === 'ready' && (
          <iframe
            ref={iframeRef}
            title="Code Editor"
            src={state.url}
            allow="clipboard-read; clipboard-write"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        )}
      </div>
    </div>
  );
}

function Centered({ children }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#cccccc',
        fontSize: 13.5,
      }}
    >
      {children}
    </div>
  );
}

const iconBtnStyle = {
  width: 30,
  height: 30,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: '1px solid #3c3c3c',
  borderRadius: 6,
  color: '#cccccc',
  cursor: 'pointer',
  fontSize: 14,
};
