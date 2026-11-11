import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Spin, message as toast } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getSocket } from '@/socket';
import waApi from './api';
import { Btn } from './ui';

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

// One conversation. readOnly = admin watching someone else's chat (Live Chats).
export default function ChatThread({ chatId, readOnly = false, canSend = true, onSent }) {
  const [loading, setLoading] = useState(true);
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

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
    load(false);
    const socket = getSocket();
    const onMsg = (p) => p?.chatId === String(chatId) && load(true);
    socket?.on('whatsapp:message', onMsg);
    return () => socket?.off('whatsapp:message', onMsg);
  }, [chatId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, chatId]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await waApi.send(chatId, body);
    setSending(false);
    if (res?.success) {
      setText('');
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
  let lastDay = '';
  return (
    <div className="wa-thread">
      <div className="wa-thread-head">
        <div style={{ minWidth: 0 }}>
          <div className="wa-thread-name">{chat.customerName || prettyNumber(chat.customerNumber)}</div>
          <div className="wa-thread-sub">
            {prettyNumber(chat.customerNumber)}
            {readOnly ? ` · handled by ${owner}${chat.department ? ` (${chat.department})` : ''}` : ''}
          </div>
        </div>
      </div>

      <div className="wa-thread-body">
        {messages.length === 0 && <div className="wa-thread-empty" style={{ padding: 32, textAlign: 'center' }}>No messages yet.</div>}
        {messages.map((m) => {
          const day = dayLabel(m.at);
          const showDay = day !== lastDay;
          lastDay = day;
          const out = m.direction === 'outgoing';
          return (
            <React.Fragment key={m._id}>
              {showDay && <div className="wa-day">{day}</div>}
              <div className={`wa-msg-row ${out ? 'out' : 'in'}`}>
                <div className={`wa-bubble ${out ? 'out' : 'in'} ${m.status === 'failed' ? 'failed' : ''}`}>
                  <div className="wa-bubble-text">{m.text}</div>
                  <div className="wa-bubble-meta">
                    {fmtTime(m.at)}
                    {out && (m.status === 'failed' ? ' · Not sent' : m.status === 'sending' ? ' · Sending…' : '')}
                  </div>
                  {m.status === 'failed' && m.error && <div className="wa-bubble-err">{m.error}</div>}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {readOnly ? (
        <div className="wa-thread-foot wa-thread-foot-note">Viewing as admin — replies can only be sent by {owner}.</div>
      ) : (
        <div className="wa-thread-foot">
          <textarea
            className="wa-compose"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            maxLength={4000}
            disabled={!canSend}
            placeholder={canSend ? 'Type message…' : 'Connect your WhatsApp to reply'}
            aria-label="Message"
          />
          <Btn variant="primary" icon={<SendOutlined />} loading={sending} disabled={!canSend || !text.trim()} onClick={send}>
            Send
          </Btn>
        </div>
      )}
    </div>
  );
}
