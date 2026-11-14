import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Popconfirm, Spin, message as toast } from 'antd';
import { PlusOutlined, ReloadOutlined, DisconnectOutlined, EditOutlined, QrcodeOutlined } from '@ant-design/icons';
import { getSocket } from '@/socket';
import waApi from './api';
import ChatList from './ChatList';
import ChatThread, { prettyNumber } from './ChatThread';
import { Btn, Notice, SearchBox } from './ui';

// Admin › Business Numbers: company WhatsApp numbers (not one person's) —
// add a number, scan its QR, see status, and read + reply to every chat on it.
// Backend: /api/whatsapp/admin/business* (whatsappController, kind 'business').

const STATUS = {
  connected: ['Connected', 'green'],
  connecting: ['Waiting for QR scan', 'amber'],
  disconnected: ['Disconnected', 'red'],
};

function QrPanel({ number, onChanged }) {
  const [qr, setQr] = useState({ url: null, error: null, loading: false });
  const urlRef = useRef(null);

  const loadQr = useCallback(async () => {
    setQr((s) => ({ ...s, loading: true }));
    const res = await waApi.business.qrImage(number._id);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = res.success ? res.url : null;
    setQr({ url: urlRef.current, error: res.success ? null : res.message, loading: false });
  }, [number._id]);

  useEffect(() => {
    loadQr();
    const qrTimer = setInterval(loadQr, 4000);
    const statusTimer = setInterval(async () => {
      const res = await waApi.business.status(number._id);
      if (res?.success && res.result && res.result.status !== number.status) onChanged(res.result);
    }, 3000);
    return () => {
      clearInterval(qrTimer);
      clearInterval(statusTimer);
    };
  }, [number._id, number.status, loadQr, onChanged]);

  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);

  return (
    <div className="wa-connect">
      <div className="wa-connect-text">
        <span className="wa-badge tone-amber">Waiting for QR scan</span>
        <h2>Link {number.label}</h2>
        <p>
          Scan this QR code with WhatsApp on the phone that has <strong>{prettyNumber(number.phoneNumber)}</strong>.
        </p>
        <ol className="wa-steps">
          <li>Open WhatsApp (or WhatsApp Business) on that phone</li>
          <li>
            Tap <strong>Settings › Linked devices › Link a device</strong>
          </li>
          <li>Scan the QR code shown here</li>
        </ol>
      </div>
      <div className="wa-qr-col">
        <div className="wa-qr-box" role="img" aria-label="WhatsApp QR code">
          {qr.url ? <img src={qr.url} alt="Scan this QR code with WhatsApp" /> : qr.loading ? <Spin /> : <span>{qr.error || 'QR code will appear here'}</span>}
        </div>
        <div className="wa-sub">Checking status every 3 sec…</div>
        <Btn size="sm" icon={<ReloadOutlined />} onClick={loadQr}>
          Refresh QR
        </Btn>
      </div>
    </div>
  );
}

export default function BusinessNumbers() {
  const [data, setData] = useState({ configured: true, numbers: [] });
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newNum, setNewNum] = useState('');
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    const res = await waApi.business.list();
    setLoading(false);
    if (res?.success) {
      setData(res.result);
      setSelId((cur) => cur || res.result.numbers[0]?._id || null);
    } else toast.error(res?.message || 'Could not load business numbers.');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sel = data.numbers.find((n) => String(n._id) === String(selId)) || null;

  const loadChats = useCallback(async () => {
    if (!sel) return setChats([]);
    const res = await waApi.chats({ userId: sel.userId, ...(q ? { q } : {}) });
    if (res?.success) setChats(res.result);
    return undefined;
  }, [sel?.userId, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setActiveId(null);
  }, [selId]);

  useEffect(() => {
    const t = setTimeout(loadChats, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadChats, q]);

  // live: new WhatsApp messages / status changes
  useEffect(() => {
    const socket = getSocket();
    const onMsg = () => {
      loadChats();
      load();
    };
    socket?.on('whatsapp:message', onMsg);
    socket?.on('whatsapp:chat', onMsg);
    socket?.on('whatsapp:device', load);
    return () => {
      socket?.off('whatsapp:message', onMsg);
      socket?.off('whatsapp:chat', onMsg);
      socket?.off('whatsapp:device', load);
    };
  }, [loadChats, load]);

  const replace = useCallback((n) => {
    setData((d) => ({ ...d, numbers: d.numbers.map((x) => (String(x._id) === String(n._id) ? { ...x, ...n } : x)) }));
    if (n.status === 'connected') toast.success(`${n.label || 'Number'} connected`);
  }, []);

  const add = async () => {
    setAdding(true);
    const res = await waApi.business.create(label, phone);
    setAdding(false);
    if (!res?.success) return toast.error(res?.message || 'Could not add the number.');
    toast.success(res.message || 'Now scan the QR code.');
    setAddOpen(false);
    setLabel('');
    setPhone('');
    await load();
    setSelId(res.result._id);
    return undefined;
  };

  const check = async (n) => {
    setBusy(`check-${n._id}`);
    const res = await waApi.business.status(n._id);
    setBusy('');
    if (res?.success && res.result) replace(res.result);
    else toast.error(res?.message || 'Could not check status.');
  };
  const relink = async (n) => {
    setBusy(`relink-${n._id}`);
    const res = await waApi.business.relink(n._id);
    setBusy('');
    if (res?.success) {
      replace(res.result);
      toast.success(res.message);
    } else toast.error(res?.message || 'Could not create a new QR.');
  };
  const rename = async (n) => {
    const v = window.prompt('Name for this number', n.label || '');
    if (!v || !v.trim()) return;
    const res = await waApi.business.rename(n._id, v.trim());
    if (res?.success) load();
    else toast.error(res?.message || 'Could not rename.');
  };
  const remove = async (n) => {
    const res = await waApi.business.remove(n._id);
    if (res?.success) {
      toast.success(res.message);
      setSelId(null);
      load();
    } else toast.error(res?.message || 'Could not remove.');
  };
  const startChat = async () => {
    const res = await waApi.business.openChat(sel._id, newNum, newName);
    if (!res?.success) return toast.error(res?.message || 'Could not open chat.');
    setNewOpen(false);
    setNewNum('');
    setNewName('');
    await loadChats();
    setActiveId(res.result._id);
    return undefined;
  };

  if (loading) {
    return (
      <div className="wa-center" style={{ minHeight: 240 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div>
      <div className="wa-bar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="wa-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {data.numbers.map((n) => {
            const [lbl, tone] = STATUS[n.status] || STATUS.disconnected;
            const on = String(n._id) === String(selId);
            return (
              <button
                key={n._id}
                type="button"
                onClick={() => setSelId(n._id)}
                aria-pressed={on}
                className="wa-list-item"
                style={{ width: 'auto', minWidth: 210, border: on ? '2px solid #0f7a3d' : '1px solid var(--hub-border, #dbe4e7)', borderRadius: 12, padding: '8px 12px', textAlign: 'left' }}
              >
                <div className="wa-list-top">
                  <span className="wa-list-name">{n.label}</span>
                  {n.unread > 0 && <span className="wa-unread">{n.unread}</span>}
                </div>
                <div className="wa-list-bottom" style={{ gap: 6 }}>
                  <span className="wa-list-last">{prettyNumber(n.phoneNumber)}</span>
                  <span className={`wa-badge tone-${tone}`} style={{ fontSize: 11 }}>
                    {lbl}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <Btn variant="primary" icon={<PlusOutlined />} disabled={!data.configured} onClick={() => setAddOpen(true)}>
          Add business number
        </Btn>
      </div>

      {!data.configured && (
        <div className="wa-pad">
          <Notice tone="amber" title="WhatsApp is not set up on the server yet.">
            The DeroPo API key is missing on the server.
          </Notice>
        </div>
      )}

      {!data.numbers.length ? (
        <div className="wa-empty" style={{ padding: 40 }}>
          No business number yet. Press <strong>Add business number</strong>, enter the company WhatsApp number and scan the QR code with that phone.
        </div>
      ) : sel ? (
        <>
          <div className="wa-bar">
            <div className="wa-row" style={{ gap: 10 }}>
              <span className={`wa-badge tone-${(STATUS[sel.status] || STATUS.disconnected)[1]}`}>{(STATUS[sel.status] || STATUS.disconnected)[0]}</span>
              <span className="wa-strong">
                {sel.label} · {prettyNumber(sel.phoneNumber)}
              </span>
              <span className="wa-sub">
                {sel.chats} chat(s){sel.lastCheckedAt ? ` · checked ${new Date(sel.lastCheckedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}
              </span>
            </div>
            <div className="wa-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <Btn icon={<ReloadOutlined />} loading={busy === `check-${sel._id}`} onClick={() => check(sel)}>
                Check status
              </Btn>
              <Btn icon={<QrcodeOutlined />} loading={busy === `relink-${sel._id}`} onClick={() => relink(sel)}>
                New QR
              </Btn>
              <Btn icon={<EditOutlined />} onClick={() => rename(sel)}>
                Rename
              </Btn>
              <Popconfirm
                title="Remove this business number from the CRM?"
                description="Its chats stay readable. Also remove the CRM under Linked devices on that phone."
                okText="Remove"
                okButtonProps={{ danger: true }}
                onConfirm={() => remove(sel)}
              >
                <Btn variant="danger" icon={<DisconnectOutlined />}>
                  Remove
                </Btn>
              </Popconfirm>
            </div>
          </div>

          {sel.status !== 'connected' ? (
            <QrPanel number={sel} onChanged={replace} />
          ) : (
            <div className="wa-split">
              <div className="wa-col-list">
                <div className="wa-col-head">
                  <SearchBox value={q} onChange={setQ} placeholder="Search name or number" label="Search chats" style={{ flex: 1 }} />
                  <Btn variant="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)} aria-label="New chat">
                    New
                  </Btn>
                </div>
                <ChatList chats={chats} activeId={activeId} onPick={setActiveId} empty="No chats yet. Customers who message this number show up here." />
              </div>
              <div className="wa-col-thread">
                {activeId ? (
                  <ChatThread key={activeId} chatId={activeId} canSend onSent={loadChats} />
                ) : (
                  <div className="wa-thread wa-center wa-thread-empty">Select a chat to read and reply from {sel.label}.</div>
                )}
              </div>
            </div>
          )}
        </>
      ) : null}

      <Modal
        title="Add business WhatsApp number"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={add}
        okText="Add & show QR"
        confirmLoading={adding}
        okButtonProps={{ disabled: !phone.trim(), style: { background: phone.trim() ? '#0f7a3d' : undefined } }}
      >
        <label className="wa-label" htmlFor="wa-biz-label">
          Name
        </label>
        <input id="wa-biz-label" className="wa-input wa-input-full" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Sales WhatsApp" />
        <label className="wa-label" htmlFor="wa-biz-num" style={{ marginTop: 14 }}>
          Business WhatsApp number (with country code)
        </label>
        <input id="wa-biz-num" className="wa-input wa-input-full" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="91 98765 43210" inputMode="tel" />
        <p className="wa-sub" style={{ marginTop: 10 }}>
          Next you scan a QR code with the phone that has this number. Every WhatsApp admin can then read and reply to its chats here, and each new chat becomes a CRM lead.
        </p>
      </Modal>

      <Modal
        title={`New chat from ${sel ? sel.label : ''}`}
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        onOk={startChat}
        okText="Open chat"
        okButtonProps={{ disabled: !newNum.trim(), style: { background: newNum.trim() ? '#0f7a3d' : undefined } }}
      >
        <label className="wa-label" htmlFor="wa-biz-new-num">
          Customer number (with country code)
        </label>
        <input id="wa-biz-new-num" className="wa-input wa-input-full" value={newNum} onChange={(e) => setNewNum(e.target.value)} placeholder="91 98765 43210" inputMode="tel" />
        <label className="wa-label" htmlFor="wa-biz-new-name" style={{ marginTop: 14 }}>
          Name (optional)
        </label>
        <input id="wa-biz-new-name" className="wa-input wa-input-full" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Customer name" />
      </Modal>
    </div>
  );
}
