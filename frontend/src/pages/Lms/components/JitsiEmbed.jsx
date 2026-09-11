import React, { useEffect, useRef } from 'react';
import { Modal, Spin } from 'antd';

// In-app Jitsi meeting for STUDENTS ONLY — simplified toolbar (camera / mic /
// hangup only) and no pre-join prompt: displayName/email are passed straight
// into JitsiMeetExternalAPI from the CRM's own stored user, so nobody has to
// type a name or pick devices on a "join meeting" screen each time. Teachers
// keep the full native Jitsi experience in a real new tab (see LiveClasses/
// index.jsx onJoin) — this component is never used for them.
const TOOLBAR = ['microphone', 'camera', 'hangup'];

let scriptPromises = {};
function loadExternalApi(domain) {
  const src = `https://${domain}/external_api.js`;
  if (window.JitsiMeetExternalAPI && scriptPromises[src]) return scriptPromises[src];
  scriptPromises[src] = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing && window.JitsiMeetExternalAPI) return resolve();
    const el = existing || document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load meeting service.'));
    if (!existing) document.body.appendChild(el);
  });
  return scriptPromises[src];
}

export default function JitsiEmbed({ open, onClose, config }) {
  const containerRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    if (!open || !config) return;
    let cancelled = false;

    loadExternalApi(config.domain)
      .then(() => {
        if (cancelled || !containerRef.current || !window.JitsiMeetExternalAPI) return;
        const api = new window.JitsiMeetExternalAPI(config.domain, {
          roomName: config.roomName,
          parentNode: containerRef.current,
          width: '100%',
          height: '100%',
          userInfo: { displayName: config.displayName, email: config.email },
          configOverwrite: {
            prejoinPageEnabled: false,
            disableDeepLinking: true,
            toolbarButtons: TOOLBAR,
            startWithAudioMuted: !config.isModerator,
            startWithVideoMuted: false,
            defaultLanguage: 'en',
            // Jitsi's whiteboard has no view-only mode — anyone in the call
            // who has it can draw on it. Students only ever load this embed,
            // so disabling the feature here means a teacher-started
            // whiteboard never becomes editable (or visible) on their side.
            whiteboard: { enabled: false },
          },
          interfaceConfigOverwrite: {
            TOOLBAR_BUTTONS: TOOLBAR,
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            MOBILE_APP_PROMO: false,
            LANG_DETECTION: false,
          },
        });
        apiRef.current = api;
        api.addEventListener('readyToClose', () => onClose());
      })
      .catch(() => onClose());

    return () => {
      cancelled = true;
      if (apiRef.current) {
        apiRef.current.dispose();
        apiRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="90vw"
      style={{ top: 16, maxWidth: 1400 }}
      bodyStyle={{ height: '80vh', padding: 0, background: '#000' }}
      destroyOnClose
      maskClosable={false}
    >
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Spin tip="Joining class…" />
      </div>
    </Modal>
  );
}
