import React from 'react';
import { Button, Modal } from 'antd';
import {
  SoundOutlined, DeleteOutlined, TeamOutlined, CalendarOutlined, UserOutlined, MailOutlined, BellOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import '../Policies/policyDesign.css';

// Announcement text is typed by staff with WhatsApp-style **bold** and bare
// links. Show it formatted (bold, clickable links) instead of raw ** marks.
const TOKEN = /(\*\*[^*\n]+?\*\*|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
function inline(text, keyBase) {
  return String(text).split(TOKEN).filter((p) => p !== '').map((p, i) => {
    const k = `${keyBase}-${i}`;
    if (/^\*\*[^*\n]+?\*\*$/.test(p)) return <strong key={k}>{p.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(p)) return <a key={k} href={p} target="_blank" rel="noopener noreferrer" className="anm-link">{p}</a>;
    return <React.Fragment key={k}>{p}</React.Fragment>;
  });
}
export function RichText({ text }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  return (
    <div className="anm-rich">
      {lines.map((l, i) => {
        const t = l.trim();
        if (!t) return <div key={i} className="anm-gap" />;
        // a line that is only bold (e.g. "**📢 Notice**") reads as a heading
        const heading = /^\*\*[^*]+\*\*$/.test(t);
        const num = /^(\d+)[.)]\s+(.*)$/.exec(t);
        if (num) return <div key={i} className="anm-li"><span className="anm-num">{num[1]}</span><span>{inline(num[2], i)}</span></div>;
        if (/^[-•*]\s+/.test(t)) return <div key={i} className="anm-li"><span className="anm-dot" /><span>{inline(t.replace(/^[-•*]\s+/, ''), i)}</span></div>;
        return <div key={i} className={heading ? 'anm-h' : 'anm-p'}>{heading ? t.slice(2, -2) : inline(l, i)}</div>;
      })}
    </div>
  );
}

// plain one-line preview for lists: no ** marks, links shortened
export const plainText = (s) => String(s || '').replace(/\*\*/g, '').replace(/https?:\/\/\S+/g, '🔗 link').replace(/\s+/g, ' ').trim();

export const scopeOf = (r) => (
  r.scope
  || (r.audience === 'all' ? 'All candidates'
    : r.audience === 'batch' ? r.batch
      : r.audience === 'batches' ? (r.batches || []).join(', ')
        : r.audience === 'learners' ? `${(r.learnerNames || []).length} learner${(r.learnerNames || []).length === 1 ? '' : 's'}`
          : r.courseTitle) || '—'
);

export function AnnouncementModal({ item, onClose, onDelete }) {
  const r = item;
  const important = r && r.priority === 'important';
  return (
    <Modal open={!!r} onCancel={onClose} footer={null} width={820} centered destroyOnClose rootClassName="pol-modal">
      {r && (
        <div className="pol-m">
          <div className={`pol-m-head anm-head${important ? ' important' : ''}`}>
            <div className="pol-m-tags">
              <span className={`pol-chip ${important ? 'red' : 'violet'}`}>{important ? <><ExclamationCircleOutlined /> Important</> : <><SoundOutlined /> General</>}</span>
              <span className="pol-chip blue"><TeamOutlined /> {scopeOf(r)}</span>
            </div>
            <h3>{r.title}</h3>
            <div className="pol-m-meta">
              <span><CalendarOutlined /> {dayjs(r.sentAt).format('D MMM YYYY, hh:mm A')}</span>
              {(r.from || r.teacherName) && <span><UserOutlined /> By {r.from || r.teacherName}</span>}
              {r.recipientsCount != null && <span><BellOutlined /> {r.recipientsCount} recipient{r.recipientsCount === 1 ? '' : 's'}</span>}
              {r.emailedCount ? <span><MailOutlined /> {r.emailedCount} emailed</span> : null}
            </div>
            {r.audience === 'learners' && (r.learnerNames || []).length > 0 && (
              <div className="pol-pending" style={{ maxHeight: 64 }}>{r.learnerNames.map((n) => <span key={n} className="pol-chip">{n}</span>)}</div>
            )}
          </div>
          <div className="pol-m-body">
            <div className="pol-m-text anm-text"><RichText text={r.body || 'No message.'} /></div>
          </div>
          <div className="pol-m-foot">
            <div className="pol-m-foot-r">
              {onDelete && <Button danger icon={<DeleteOutlined />} onClick={() => onDelete(r)}>Delete</Button>}
            </div>
            <div className="pol-m-foot-r"><Button type="primary" onClick={onClose}>Close</Button></div>
          </div>
        </div>
      )}
    </Modal>
  );
}
