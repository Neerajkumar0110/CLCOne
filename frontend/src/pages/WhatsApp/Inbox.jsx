import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Popconfirm, Spin, message as toast } from 'antd';
import { PlusOutlined, ReloadOutlined, DisconnectOutlined, MessageOutlined, PhoneOutlined, UserOutlined } from '@ant-design/icons';
import { getSocket } from '@/socket';
import waApi from './api';
import ChatList from './ChatList';
import ChatThread, { prettyNumber } from './ChatThread';
import { Btn, Notice, SearchBox } from './ui';

const STATUS = {
  connected: ['Connected', 'green'],
  connecting: ['Waiting for QR scan', 'amber'],
  disconnected: ['Disconnected', 'red'],
};

// Step 1: number → DeroPo device. Step 2: QR (re-fetched every 4s) while the
// status is polled every 3s until it turns connected.
function ConnectPanel({ device, configured, onChanged }) {
  const [phone, setPhone] = useState(device?.phoneNumber || '');
  const [creating, setCreating] = useState(false);
  const [qr, setQr] = useState({ url: null, error: null, loading: false });
  const qrUrlRef = useRef(null);
  const waiting = !!device && device.status !== 'connected';
  const [label, tone] = device ? STATUS[device.status] || STATUS.disconnected : ['Not connected', 'amber'];

  const loadQr = useCallback(async () => {
    setQr((s) => ({ ...s, loading: true }));
    const res = await waApi.qrImage();
    if (qrUrlRef.current) URL.revokeObjectURL(qrUrlRef.current);
    qrUrlRef.current = res.success ? res.url : null;
    setQr({ url: qrUrlRef.current, error: res.success ? null : res.message, loading: false });
  }, []);

  useEffect(() => {
    if (!waiting) return undefined;
    loadQr();
    const qrTimer = setInterval(loadQr, 4000); // DeroPo: poll the QR every ~3s until scanned
    const statusTimer = setInterval(async () => {
      const res = await waApi.deviceStatus();
      if (res?.success && res.result && res.result.status !== device.status) onChanged(res.result);
    }, 3000);
    return () => {
      clearInterval(qrTimer);
      clearInterval(statusTimer);
    };
  }, [waiting, device?.deviceId, device?.status, loadQr, onChanged]);

  useEffect(() => () => qrUrlRef.current && URL.revokeObjectURL(qrUrlRef.current), []);

  const create = async () => {
    setCreating(true);
    const res = await waApi.createDevice(phone);
    setCreating(false);
    if (res?.success) {
      toast.success(res.message || 'Now scan the QR code.');
      onChanged(res.result);
    } else toast.error(res?.message || 'Could not start WhatsApp linking.');
  };

  return (
    <div className="wa-connect">
      <div className="wa-connect-text">
        <span className={`wa-badge tone-${tone}`}>{label}</span>
        <h2>Connect your WhatsApp</h2>
        <p>Admin has given you WhatsApp access. Link your work number once to message leads from inside the CRM.</p>
        {!configured && (
          <Notice tone="amber" title="WhatsApp is not set up on the server yet.">
            The admin needs to add the DeroPo access token on the server. You can come back after that.
          </Notice>
        )}
        <label className="wa-label" htmlFor="wa-phone">
          Your WhatsApp number (with country code)
        </label>
        <div className="wa-row">
          <input
            id="wa-phone"
            className="wa-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && configured && phone.trim() && create()}
            placeholder="91 98765 43210"
            inputMode="tel"
          />
          <Btn variant="primary" loading={creating} disabled={!configured || !phone.trim()} onClick={create}>
            {device ? 'Get a new QR code' : 'Connect'}
          </Btn>
        </div>
        <ol className="wa-steps">
          <li>Open WhatsApp on your phone</li>
          <li>
            Tap <strong>Settings › Linked devices › Link a device</strong>
          </li>
          <li>Scan the QR code shown here</li>
        </ol>
      </div>
      <div className="wa-qr-col">
        <div className="wa-qr-box" role="img" aria-label="WhatsApp QR code">
          {waiting ? (
            qr.url ? (
              <img src={qr.url} alt="Scan this QR code with WhatsApp" />
            ) : qr.loading ? (
              <Spin />
            ) : (
              <span>{qr.error || 'QR code will appear here'}</span>
            )
          ) : (
            <span>QR code from DeroPo appears here after you press Connect</span>
          )}
        </div>
        {waiting && (
          <>
            <div className="wa-sub">Checking status every 3 sec…</div>
            <Btn size="sm" icon={<ReloadOutlined />} onClick={loadQr}>
              Refresh QR
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

export default function Inbox({ initialDevice, configured }) {
  const [device, setDevice] = useState(initialDevice || null);
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newNum, setNewNum] = useState('');
  const [newName, setNewName] = useState('');
  const [opening, setOpening] = useState(false);
  const [checking, setChecking] = useState(false);

  const connected = device?.status === 'connected';

  const loadChats = useCallback(async () => {
    const res = await waApi.chats(q ? { q } : {});
    if (res?.success) setChats(res.result);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(loadChats, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadChats, q]);

  useEffect(() => {
    const socket = getSocket();
    const onMsg = () => loadChats();
    const onDevice = async () => {
      const res = await waApi.me();
      if (res?.success) setDevice(res.result.device);
    };
    socket?.on('whatsapp:message', onMsg);
    socket?.on('whatsapp:chat', onMsg);
    socket?.on('whatsapp:device', onDevice);
    return () => {
      socket?.off('whatsapp:message', onMsg);
      socket?.off('whatsapp:chat', onMsg);
      socket?.off('whatsapp:device', onDevice);
    };
  }, [loadChats]);

  // Check the live status once on open — the phone may have been unlinked.
  useEffect(() => {
    if (!initialDevice) return;
    waApi.deviceStatus().then((res) => res?.success && res.result && setDevice(res.result));
  }, [initialDevice]);

  const onChanged = useCallback((d) => {
    setDevice(d);
    if (d?.status === 'connected') toast.success('WhatsApp connected');
  }, []);

  const recheck = async () => {
    setChecking(true);
    const res = await waApi.deviceStatus();
    setChecking(false);
    if (res?.success && res.result) setDevice(res.result);
    else toast.error(res?.message || 'Could not check status.');
  };

  const removeDevice = async () => {
    const res = await waApi.removeDevice();
    if (res?.success) {
      toast.success(res.message);
      setDevice(null);
    } else toast.error(res?.message || 'Could not remove.');
  };

  const startChat = async () => {
    setOpening(true);
    const res = await waApi.openChat(newNum, newName);
    setOpening(false);
    if (!res?.success) return toast.error(res?.message || 'Could not open chat.');
    setNewOpen(false);
    setNewNum('');
    setNewName('');
    await loadChats();
    setActiveId(res.result._id);
  };

  if (!connected) {
    return (
      <>
        <ConnectPanel device={device} configured={configured} onChanged={onChanged} />
        {chats.length > 0 && (
          <div className="wa-sub" style={{ padding: '0 28px 24px' }}>
            You have {chats.length} earlier chat(s). They show again once you are connected.
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="wa-bar">
        <div className="wa-row">
          <span className="wa-badge tone-green">Connected</span>
          <span className="wa-strong">{prettyNumber(device.phoneNumber)}</span>
        </div>
        <div className="wa-row">
          <Btn icon={<ReloadOutlined />} loading={checking} onClick={recheck}>
            Check status
          </Btn>
          <Popconfirm
            title="Remove this WhatsApp number from the CRM?"
            description="Your chats stay. Also remove the CRM from Linked devices on your phone."
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={removeDevice}
          >
            <Btn variant="danger" icon={<DisconnectOutlined />}>
              Disconnect
            </Btn>
          </Popconfirm>
        </div>
      </div>

      <div className="wa-split">
        <div className="wa-col-list">
          <div className="wa-col-head">
            <SearchBox value={q} onChange={setQ} placeholder="Search name or number" label="Search chats" style={{ flex: 1 }} />
            <Btn variant="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)} aria-label="New chat">
              New
            </Btn>
          </div>
          <ChatList chats={chats} activeId={activeId} onPick={setActiveId} empty="No chats yet. Press New to message a customer." />
        </div>
        <div className="wa-col-thread">
          {activeId ? (
            <ChatThread key={activeId} chatId={activeId} canSend={connected} onSent={loadChats} />
          ) : (
            <div className="wa-thread wa-center wa-thread-empty">Select a chat, or press New to message a customer.</div>
          )}
        </div>
      </div>

      <Modal
        rootClassName="wa-modal"
        width={500}
        title={
          <span className="wa-modal-title">
            <span className="wa-modal-title-icon">
              <MessageOutlined />
            </span>
            <span>
              New WhatsApp chat
              <small>From your number {prettyNumber(device?.phoneNumber)}</small>
            </span>
          </span>
        }
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        onOk={startChat}
        okText="Open chat"
        confirmLoading={opening}
        okButtonProps={{ disabled: !newNum.trim(), icon: <MessageOutlined /> }}
      >
        <div className="wa-field">
          <label className="wa-label" htmlFor="wa-new-num">
            Customer number (with country code)
          </label>
          <div className="wa-input-wrap">
            <PhoneOutlined />
            <input id="wa-new-num" className="wa-input" value={newNum} onChange={(e) => setNewNum(e.target.value)} placeholder="91 98765 43210" inputMode="tel" autoFocus />
          </div>
        </div>
        <div className="wa-field">
          <label className="wa-label" htmlFor="wa-new-name">
            Name (optional)
          </label>
          <div className="wa-input-wrap">
            <UserOutlined />
            <input id="wa-new-name" className="wa-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Customer name" />
          </div>
        </div>
      </Modal>
    </>
  );
}
