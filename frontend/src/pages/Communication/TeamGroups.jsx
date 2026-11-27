import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Select, message } from 'antd';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { request } from '@/request';
import { useMessages } from '@/context/messagesContext';

// Team Chat groups (LMS testing report #40 / WhatsApp ask 2c). A Teacher,
// Support or admin makes a group — a whole batch and/or chosen people — and
// everyone in it writes in one thread. Learners see only their own groups.

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const nameOf = (u) => [u && u.name, u && u.surname].filter(Boolean).join(' ') || (u && u.email) || '';

function NewGroup({ open, onClose, onDone }) {
  const { conversations } = useMessages();
  const [name, setName] = useState('');
  const [batch, setBatch] = useState('');
  const [batches, setBatches] = useState([]);
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    request.list({ entity: 'batch', options: { items: 500, sortBy: 'name', sortValue: 1 } }).then((r) => setBatches(((r && r.result) || []).map((b) => b.name)));
  }, [open]);
  const save = async () => {
    if (name.trim().length < 2) return message.warning('Name the group.');
    if (!batch && !people.length) return message.warning('Pick a batch or add people.');
    setBusy(true);
    const r = await request.post({ entity: 'message/groups', jsonData: { name: name.trim(), batch: batch || undefined, memberIds: people } });
    setBusy(false);
    if (r && r.success) {
      setName('');
      setBatch('');
      setPeople([]);
      onDone(r.result && r.result.id);
    }
  };
  return (
    <Modal open={open} title="New group" onCancel={onClose} onOk={save} okText={busy ? 'Creating…' : 'Create group'} confirmLoading={busy} destroyOnClose>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Group name
          <input className="hub-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. OCT262330PM — class group" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Add a whole batch (all its learners)
          <Select allowClear showSearch value={batch || undefined} onChange={(v) => setBatch(v || '')} placeholder="Optional — pick a batch" options={batches.map((b) => ({ value: b, label: b }))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Add people (teacher, Support, anyone)
          <Select
            mode="multiple"
            showSearch
            optionFilterProp="label"
            value={people}
            onChange={setPeople}
            placeholder="Search a name"
            options={(conversations || []).map((c) => ({ value: c.user._id, label: `${nameOf(c.user)}${c.user.role ? ` · ${c.user.role}` : ''}` }))}
          />
        </label>
        <small style={{ color: '#64748b' }}>You are added automatically. Learners only see groups they are in.</small>
      </div>
    </Modal>
  );
}

export default function TeamGroups() {
  const me = useSelector(selectCurrentAdmin) || {};
  const [groups, setGroups] = useState([]);
  const [canCreate, setCanCreate] = useState(false);
  const [sel, setSel] = useState(null);
  const [thread, setThread] = useState(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const bottomRef = useRef(null);

  const loadGroups = useCallback(async () => {
    const r = await request.get({ entity: 'message/groups' });
    if (r && r.success) {
      setGroups(r.result.groups || []);
      setCanCreate(!!r.result.canCreate);
    }
  }, []);
  const loadThread = useCallback(async (id) => {
    if (!id) return;
    const r = await request.get({ entity: `message/groups/${id}/thread` });
    if (r && r.success) setThread(r.result);
  }, []);
  useEffect(() => {
    loadGroups();
    const t = setInterval(loadGroups, 15000);
    return () => clearInterval(t);
  }, [loadGroups]);
  useEffect(() => {
    if (!sel) return undefined;
    loadThread(sel);
    const t = setInterval(() => loadThread(sel), 5000);
    return () => clearInterval(t);
  }, [sel, loadThread]);
  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ block: 'end' });
  }, [thread && thread.messages && thread.messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !sel) return;
    setDraft('');
    const r = await request.post({ entity: `message/groups/${sel}/send`, jsonData: { text } });
    if (r && r.success) {
      loadThread(sel);
      loadGroups();
    } else setDraft(text);
  };

  return (
    <div className="lu-chat" style={{ display: 'flex', height: 560 }}>
      <div className="hub-chat-people-list" style={{ width: 240, flexShrink: 0, overflowY: 'auto' }}>
        <div className="hub-chat-people-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>GROUPS <span style={{ fontWeight: 600, opacity: 0.7 }}>· {groups.length}</span></span>
          {canCreate && (
            <button type="button" className="hub-btn hub-btn-primary" style={{ height: 26, padding: '0 10px', fontSize: 12 }} onClick={() => setCreating(true)}>
              + New
            </button>
          )}
        </div>
        {groups.length === 0 && <div className="hub-chat-people-empty">{canCreate ? 'No groups yet — create one.' : 'You are not in any group yet.'}</div>}
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => { setSel(g.id); setShowMembers(false); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 0, borderBottom: '1px solid #eef2f7', background: sel === g.id ? '#eef6ff' : 'transparent', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <b style={{ fontSize: 13 }}>{g.name}</b>
              {g.unread > 0 && <span style={{ background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 11, padding: '0 7px', height: 18, lineHeight: '18px' }}>{g.unread}</span>}
            </div>
            <div style={{ fontSize: 11.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {g.lastMessage ? g.lastMessage.text : `${g.members} members${g.batch ? ` · ${g.batch}` : ''}`}
            </div>
          </button>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderLeft: '1px solid #eef2f7' }}>
        {!sel || !thread ? (
          <div style={{ margin: 'auto', color: '#64748b', fontSize: 14 }}>Pick a group</div>
        ) : (
          <>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #eef2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>{thread.group.name}</b>
                <div style={{ fontSize: 12, color: '#64748b' }}>{thread.group.members.length} members{thread.group.batch ? ` · ${thread.group.batch}` : ''}</div>
              </div>
              <button type="button" className="hub-btn" style={{ height: 30 }} onClick={() => setShowMembers((x) => !x)}>{showMembers ? 'Chat' : 'Members'}</button>
            </div>
            {showMembers ? (
              <div style={{ flex: 1, overflowY: 'auto', padding: 14, fontSize: 13 }}>
                {thread.group.members.map((m) => (
                  <div key={m.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{m.name}</span>
                    <span style={{ color: '#64748b' }}>{m.role}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, background: '#f8fafc' }}>
                {thread.messages.length === 0 && <div style={{ margin: 'auto', color: '#64748b', fontSize: 13 }}>No messages yet — say hello.</div>}
                {thread.messages.map((m) => {
                  const mine = String(m.from) === String(me._id);
                  return (
                    <div key={m._id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '75%', background: mine ? '#dcfce7' : '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '6px 10px' }}>
                      {!mine && <div style={{ fontSize: 11.5, fontWeight: 600, color: '#0e7490' }}>{m.fromName}</div>}
                      <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</div>
                      <div style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'right' }}>{fmt(m.created)}</div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #eef2f7' }}>
              <input
                className="hub-input"
                style={{ flex: 1 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={`Message ${thread.group.name}…`}
              />
              <button type="button" className="hub-btn hub-btn-primary" onClick={send} disabled={!draft.trim()}>Send</button>
            </div>
          </>
        )}
      </div>
      <NewGroup open={creating} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); loadGroups(); if (id) setSel(id); }} />
    </div>
  );
}
