import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Spin } from 'antd';
import { WhatsAppOutlined } from '@ant-design/icons';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { getSocket } from '@/socket';
import HubModal from '@/components/HubModal';
import useWhatsAppAccess from '@/pages/WhatsApp/useWhatsAppAccess';
import waApi from '@/pages/WhatsApp/api';
import '@/pages/WhatsApp/whatsapp.css';

const Inbox = lazy(() => import('@/pages/WhatsApp/Inbox'));

// Header WhatsApp for every user given WhatsApp in Messenger › WhatsApp ›
// Individual (Allow) or by department. One click opens their own inbox: the
// QR to link their number if it isn't linked yet, otherwise their chats.
// Owner / Super Admin already have the ad-chat WhatsApp button (ChatChannels),
// so they don't get a second one here.
const SUPER_ADMIN_ROLES = ['owner', 'Super Admin'];

export default function WhatsAppButton() {
  const admin = useSelector(selectCurrentAdmin);
  const access = useWhatsAppAccess();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [barSlot, setBarSlot] = useState(null); // header spot for Connected / Check status / Disconnect
  const show = access.hasAccess && !SUPER_ADMIN_ROLES.includes(admin?.role);
  const connected = access.device?.status === 'connected';

  const loadUnread = useCallback(async () => {
    const res = await waApi.chats();
    // like WhatsApp: the badge counts chats with something unread
    if (res?.success && Array.isArray(res.result)) setUnread(res.result.filter((c) => c.unread > 0).length);
  }, []);

  useEffect(() => {
    if (!show) return undefined;
    loadUnread();
    const s = getSocket();
    let t = null;
    const on = () => {
      clearTimeout(t);
      t = setTimeout(loadUnread, 600);
    };
    s?.on('whatsapp:message', on);
    s?.on('whatsapp:chat', on);
    return () => {
      clearTimeout(t);
      s?.off('whatsapp:message', on);
      s?.off('whatsapp:chat', on);
    };
  }, [show, loadUnread]);

  if (!show) return null;

  const label = connected ? `WhatsApp${unread ? `, ${unread} unread` : ''}` : 'WhatsApp — link your number';
  return (
    <>
      <div className="cc-group" role="group" aria-label="WhatsApp">
        <button
          type="button"
          className={`cc-btn cc-whatsapp ${unread ? 'has-unread' : ''} ${open ? 'is-open' : ''}`}
          aria-label={label}
          title={label}
          onClick={() => setOpen(true)}
        >
          <WhatsAppOutlined />
          {unread > 0 && <span className="cc-badge">{unread > 99 ? '99+' : unread}</span>}
          {!connected && <span className="wa-hdr-dot" aria-hidden="true" />}
        </button>
      </div>
      <HubModal
        open={open}
        onClose={() => {
          setOpen(false);
          loadUnread();
        }}
        title="WhatsApp"
        subtitle={connected ? 'Your chats from your own WhatsApp number' : 'Scan the QR code with your phone to link your WhatsApp'}
        width={1180}
        headerExtra={<div className="wa-head-slot" ref={setBarSlot} />}
      >
        <div className="wa-page wa-page-modal">
          {open && (
            <Suspense fallback={<div className="wa-center" style={{ padding: 48 }}><Spin /></div>}>
              <Inbox initialDevice={access.device} configured={access.configured} barSlot={barSlot} />
            </Suspense>
          )}
        </div>
      </HubModal>
    </>
  );
}
