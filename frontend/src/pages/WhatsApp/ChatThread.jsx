import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spin, message as toast } from 'antd';
import { SendOutlined, PaperClipOutlined, CloseOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getSocket } from '@/socket';
import waApi from './api';
import { Btn, ChatAvatar } from './ui';
import { BASE_URL } from '@/config/serverApiConfig';

// WhatsApp files live on the backend under /public/uploads/whatsapp/
const mediaUrl = (u) => (u && u.startsWith('/') ? String(BASE_URL || '').replace(/\/+$/, '') + u : u);

const fmtTime = (d) => (d ? dayjs(d).format('h:mm A') : '');
const dayLabel = (d) => {
  const t = dayjs(d);
  if (t.isSame(dayjs(), 'day')) return 'Today';
  if (t.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  return t.format('D MMM YYYY');
};
export const prettyNumber = (n) => {
  const d = String(n || '');
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : d ? `+${d}` : '';
};
const kb = (n) => (!n ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const extOf = (name, mime) => {
  const e = String(name || '').split('.').pop();
  if (e && e.length <= 5 && e !== name) return e.toUpperCase();
  return String(mime || '').split('/').pop().toUpperCase().slice(0, 4) || 'FILE';
};
const isPhoto = (m) => m.type === 'image' || m.type === 'sticker';
// older file messages were saved as "📷 Photo caption" / "📄 name — caption"
const captionOf = (m) => {
  const t = m.text || '';
  if (!m.media) return t;
  if (/^📄 /.test(t)) return t.includes(' — ') ? t.split(' — ').slice(1).join(' — ') : '';
  return t.replace(/^(📷 Photo|🎬 Video|🎤 Voice message|🎵 Audio|🙂 Sticker)\s?/, '');
};
const quoteText = (m) => {
  const cap = captionOf(m);
  if (!m.media) return m.text || '';
  const lab = isPhoto(m) ? '📷 Photo' : `📄 ${m.media.fileName || 'Document'}`;
  return cap ? `${lab} ${cap}` : lab;
};

const Tick = ({ double, read }) => (
  <svg className={`wa-tick ${read ? 'read' : ''}`} viewBox={double ? '0 0 18 11' : '0 0 16 11'} aria-hidden="true">
    <path d="M12.07.65 11.4.1a.38.38 0 0 0-.53.06L5.6 6.78 3.13 4.47a.38.38 0 0 0-.53.01l-.6.6a.38.38 0 0 0 0 .54l3.3 3.13c.16.15.4.14.55-.03l6.28-7.53a.38.38 0 0 0-.06-.54z" />
    {double && <path d="M16.07.65 15.4.1a.38.38 0 0 0-.53.06L9.6 6.78l-.75-.7-.95 1.14 1.4 1.32c.16.15.4.14.55-.03l6.28-7.53a.38.38 0 0 0-.06-.54z" />}
  </svg>
);
function Status({ m }) {
  if (m.direction !== 'outgoing') return null;
  if (m.status === 'failed') return <span className="wa-st fail" title="Not sent">!</span>;
  if (m.status === 'sending') return <span className="wa-st" title="Sending">🕓</span>;
  if (m.status === 'read') return <span className="wa-st" title="Seen"><Tick double read /></span>;
  if (m.status === 'delivered') return <span className="wa-st" title="Delivered"><Tick double /></span>;
  return <span className="wa-st" title="Sent"><Tick /></span>;
}

function Media({ m, onOpen }) {
  const md = m.media || {};
  const url = md.local || mediaUrl(md.url);
  if (isPhoto(m) || (md.mime || '').startsWith('image/')) {
    const src = url || md.thumb;
    return (
      <button type="button" className={`wa-photo ${url ? '' : 'blur'}`} onClick={() => url && onOpen(url)} aria-label="Open photo">
        {src ? <img src={src} alt="" /> : <span className="wa-photo-none">📷</span>}
        {md.pending && !url && <span className="wa-spin" aria-label="Loading photo" />}
        {md.error && !url && <span className="wa-photo-err">Photo not available</span>}
      </button>
    );
  }
  if (m.type === 'video' && url) return <video className="wa-video" src={url} controls preload="metadata" />;
  if (m.type === 'audio' && url) return <audio className="wa-audio" src={url} controls preload="none" />;
  const name = md.fileName || 'Document';
  const Tag = url ? 'a' : 'div';
  return (
    <Tag className="wa-doc" {...(url ? { href: url, target: '_blank', rel: 'noreferrer', download: md.fileName || true } : {})}>
      <span className="wa-doc-ic">{extOf(md.fileName, md.mime)}</span>
      <span className="wa-doc-nm">
        <b>{name}</b>
        <span>{[md.pages ? `${md.pages} page${md.pages === 1 ? '' : 's'}` : null, kb(md.size)].filter(Boolean).join(' · ')}{md.pending && !url ? ' · loading…' : ''}{md.error && !url ? ' · not available' : ''}</span>
      </span>
      {url && <DownloadOutlined className="wa-doc-dl" />}
    </Tag>
  );
}

// One conversation. readOnly = admin watching someone else's chat (Live Chats).
export default function ChatThread({ chatId, readOnly = false, canSend = true, onSent }) {
  const [loading, setLoading] = useState(true);
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // a message object
  const [file, setFile] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [pending, setPending] = useState(null); // optimistic bubble while sending
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const filePreview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => filePreview && URL.revokeObjectURL(filePreview), [filePreview]);

  const load = useCallback(
    async (quiet) => {
      if (!quiet) setLoading(true);
      const res = await waApi.messages(chatId);
      if (res?.success) {
        setChat(res.result.chat);
        setMessages(res.result.messages);
        if (!readOnly && res.result.chat.unread) waApi.markRead(chatId);
      } else if (!quiet) {
        toast.error(res?.message || 'Could not load messages.');
      }
      setLoading(false);
    },
    [chatId, readOnly]
  );

  useEffect(() => {
    setText('');
    setReplyTo(null);
    setFile(null);
    setLightbox(null);
    load(false);
    const socket = getSocket();
    const onMsg = (p) => p?.chatId === String(chatId) && load(true);
    socket?.on('whatsapp:message', onMsg);
    return () => socket?.off('whatsapp:message', onMsg);
  }, [chatId, load]);

  // keep the newest message in view — scroll ONLY the message list
  // (scrollIntoView also shifted the page's overflow:hidden panels, which hid
  // the chat list's top and stopped both columns from scrolling)
  const bodyRef = useRef(null);
  const nearBottom = useRef(true);
  const toBottom = useCallback(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => {
    nearBottom.current = true;
    toBottom();
  }, [messages.length, chatId, pending, toBottom]);
  // a photo that finishes loading makes the list taller: stay at the bottom
  const onMediaLoad = () => nearBottom.current && toBottom();

  useEffect(() => {
    if (!lightbox) return undefined;
    const esc = (e) => e.key === 'Escape' && setLightbox(null);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [lightbox]);

  const byId = useMemo(() => new Map(messages.map((m) => [String(m._id), m])), [messages]);

  const startReply = (m) => {
    setReplyTo(m);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const jumpTo = (id) => {
    const el = id && document.getElementById(`wa-m-${id}`);
    if (!el) return;
    const box = bodyRef.current;
    if (box) box.scrollBy({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !file) || sending) return;
    setSending(true);
    setPending({
      _id: 'pending',
      direction: 'outgoing',
      status: 'sending',
      text: body,
      at: new Date(),
      type: file ? (file.type.startsWith('image/') ? 'image' : 'document') : 'text',
      media: file ? { local: filePreview, fileName: file.name, size: file.size, mime: file.type } : undefined,
      quoted: replyTo ? { messageId: replyTo._id, text: quoteText(replyTo), fromCustomer: replyTo.direction === 'incoming' } : undefined,
    });
    const res = await waApi.send(chatId, body, { file, replyTo: replyTo?._id });
    setSending(false);
    setPending(null);
    if (res?.success) {
      setText('');
      setFile(null);
      setReplyTo(null);
      onSent && onSent();
    } else {
      toast.error(res?.message || 'Message not sent.');
    }
    load(true);
  };

  if (loading && !chat) {
    return (
      <div className="wa-thread wa-center">
        <Spin />
      </div>
    );
  }
  if (!chat) return <div className="wa-thread wa-center wa-thread-empty">Chat not found.</div>;

  const owner = (chat.userName || '').split(' ')[0] || 'the chat owner';
  const customer = chat.customerName || prettyNumber(chat.customerNumber);
  const list = pending ? [...messages, pending] : messages;
  let lastDay = '';
  return (
    <div className="wa-thread">
      <div className="wa-thread-head">
        <div className="wa-thread-who">
          <ChatAvatar chat={chat} size={38} />
          <div style={{ minWidth: 0 }}>
            <div className="wa-thread-name">{customer}</div>
            {(chat.customerName || readOnly) && (
              <div className="wa-thread-sub">
                {chat.customerName ? prettyNumber(chat.customerNumber) : ''}
                {readOnly ? `${chat.customerName ? ' · ' : ''}handled by ${owner}${chat.department ? ` (${chat.department})` : ''}` : ''}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="wa-thread-body"
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        onLoadCapture={onMediaLoad}
      >
        {list.length === 0 && <div className="wa-thread-empty" style={{ padding: 32, textAlign: 'center' }}>No messages yet.</div>}
        {list.map((m) => {
          const day = dayLabel(m.at);
          const showDay = day !== lastDay;
          lastDay = day;
          const out = m.direction === 'outgoing';
          const cap = captionOf(m);
          const q = m.quoted && m.quoted.text ? m.quoted : null;
          const qMsg = q && q.messageId ? byId.get(String(q.messageId)) : null;
          return (
            <React.Fragment key={m._id}>
              {showDay && <div className="wa-day">{day}</div>}
              <div id={`wa-m-${m._id}`} className={`wa-msg-row ${out ? 'out' : 'in'}`} onDoubleClick={() => !readOnly && m._id !== 'pending' && startReply(m)}>
                <div className={`wa-bubble ${out ? 'out' : 'in'} ${m.status === 'failed' ? 'failed' : ''} ${m.media && isPhoto(m) ? 'has-photo' : ''}`}>
                  {!readOnly && m._id !== 'pending' && (
                    <button type="button" className="wa-reply-btn" title="Reply" aria-label="Reply to this message" onClick={() => startReply(m)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" /></svg>
                    </button>
                  )}
                  {q && (
                    <button type="button" className={`wa-quote ${q.fromCustomer ? 'them' : 'me'}`} onClick={() => jumpTo(q.messageId)}>
                      <b>{q.fromCustomer ? customer : 'You'}</b>
                      <span>{qMsg ? quoteText(qMsg) : q.text}</span>
                    </button>
                  )}
                  {m.media && <Media m={m} onOpen={setLightbox} />}
                  {cap && <div className="wa-bubble-text">{cap}</div>}
                  <div className="wa-bubble-meta">
                    {m.via === 'teamchat' && (
                      <span title="Written in Team Chat (LMS) — not sent on WhatsApp" style={{ color: '#5b5bd6', fontWeight: 600 }}>Team Chat ·</span>
                    )}
                    {fmtTime(m.at)}
                    {m.via !== 'teamchat' && <Status m={m} />}
                  </div>
                  {m.status === 'failed' && m.error && <div className="wa-bubble-err">{m.error}</div>}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {readOnly ? (
        <div className="wa-thread-foot wa-thread-foot-note">Viewing as admin — replies can only be sent by {owner}.</div>
      ) : (
        <div className="wa-compose-wrap">
          {replyTo && (
            <div className={`wa-replybar ${replyTo.direction === 'incoming' ? 'them' : 'me'}`}>
              <span className="q">
                <b>{replyTo.direction === 'incoming' ? customer : 'You'}</b>
                <span>{quoteText(replyTo)}</span>
              </span>
              <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><CloseOutlined /></button>
            </div>
          )}
          {file && (
            <div className="wa-filebar">
              {filePreview ? <img src={filePreview} alt="" /> : <span className="wa-doc-ic">{extOf(file.name, file.type)}</span>}
              <span className="nm"><b>{file.name}</b><span>{kb(file.size)}</span></span>
              <button type="button" aria-label="Remove file" onClick={() => setFile(null)}><CloseOutlined /></button>
            </div>
          )}
          <div className="wa-thread-foot">
            <button type="button" className="wa-attach" aria-label="Attach a photo or document" title="Photo or document (up to 16 MB)" disabled={!canSend} onClick={() => fileRef.current?.click()}>
              <PaperClipOutlined />
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && f.size > 16 * 1024 * 1024) toast.error('WhatsApp files can be up to 16 MB.');
                else if (f) setFile(f);
                e.target.value = '';
              }}
            />
            <textarea
              ref={inputRef}
              className="wa-compose"
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && replyTo) setReplyTo(null);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              maxLength={4000}
              disabled={!canSend}
              placeholder={canSend ? (file ? 'Add a caption…' : 'Type message…') : 'Connect your WhatsApp to reply'}
              aria-label="Message"
            />
            <Btn variant="primary" icon={<SendOutlined />} loading={sending} disabled={!canSend || (!text.trim() && !file)} onClick={send}>
              Send
            </Btn>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="wa-lightbox" role="dialog" aria-label="Photo" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="wa-lightbox-bar">
            <a href={lightbox} download target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Download photo"><DownloadOutlined /></a>
            <button type="button" aria-label="Close photo" onClick={() => setLightbox(null)}><CloseOutlined /></button>
          </div>
        </div>
      )}
    </div>
  );
}
