import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Spin, message as toast } from 'antd';
import { EyeOutlined, TeamOutlined } from '@ant-design/icons';
import { getSocket } from '@/socket';
import waApi from './api';
import ChatList from './ChatList';
import ChatThread from './ChatThread';
import { Avatar, ModeSwitch, SearchBox, deviceDot } from './ui';

// Admin-only: every chat of every user who has WhatsApp — read only.
export default function LiveChats() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [mode, setMode] = useState('user');
  const [selUser, setSelUser] = useState(null);
  const [selDept, setSelDept] = useState(null);
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [q, setQ] = useState('');

  const loadUsers = useCallback(async () => {
    const res = await waApi.getAccess();
    setLoading(false);
    if (!res?.success) return toast.error(res?.message || 'Could not load users.');
    setUsers(res.result.users.filter((u) => u.hasAccess));
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const departments = useMemo(() => {
    const map = new Map();
    users.forEach((u) => {
      const d = map.get(u.department) || { name: u.department, users: 0, online: 0, chats: 0, unread: 0 };
      d.users += 1;
      if (u.device?.status === 'connected') d.online += 1;
      d.chats += u.chats;
      d.unread += u.unread;
      map.set(u.department, d);
    });
    return [...map.values()];
  }, [users]);

  useEffect(() => {
    if (!selUser && users.length) setSelUser((users.find((u) => u.chats > 0) || users[0])._id);
    if (!selDept && departments.length) setSelDept((departments.find((d) => d.chats > 0) || departments[0]).name);
  }, [users, departments, selUser, selDept]);

  const params = useMemo(() => {
    const p = mode === 'user' ? (selUser ? { userId: selUser } : null) : selDept ? { department: selDept } : null;
    return p && q ? { ...p, q } : p;
  }, [mode, selUser, selDept, q]);

  const loadChats = useCallback(
    async (quiet) => {
      if (!params) return setChats([]);
      if (!quiet) {
        setChatsLoading(true);
        setChats([]);
      }
      const res = await waApi.chats(params);
      setChatsLoading(false);
      if (res?.success) setChats(res.result);
    },
    [params]
  );

  useEffect(() => {
    const t = setTimeout(() => loadChats(false), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadChats, q]);

  useEffect(() => {
    setActiveId(null);
  }, [mode, selUser, selDept]);

  useEffect(() => {
    if (!activeId && chats.length) setActiveId(chats[0]._id);
  }, [chats, activeId]);

  useEffect(() => {
    const socket = getSocket();
    const onMsg = () => {
      loadChats(true);
      loadUsers();
    };
    socket?.on('whatsapp:message', onMsg);
    socket?.on('whatsapp:device', onMsg);
    return () => {
      socket?.off('whatsapp:message', onMsg);
      socket?.off('whatsapp:device', onMsg);
    };
  }, [loadChats, loadUsers]);

  if (loading) {
    return (
      <div className="wa-center" style={{ minHeight: 240 }}>
        <Spin />
      </div>
    );
  }

  const userRow = (u, clickable) => {
    const [label, color] = deviceDot(u.device?.status);
    const inner = (
      <>
        <Avatar id={u._id} name={u.name} size={34} />
        <div className="wa-side-text">
          <div className="wa-side-name">{u.name}</div>
          <div className="wa-side-meta">
            <span className="wa-dot" style={{ background: color }} />
            {label}
          </div>
        </div>
        <span className="wa-side-count">{u.chats}</span>
      </>
    );
    return clickable ? (
      <button type="button" key={u._id} className={`wa-side-item ${selUser === u._id ? 'active' : ''}`} onClick={() => setSelUser(u._id)} aria-pressed={selUser === u._id}>
        {inner}
      </button>
    ) : (
      <div key={u._id} className="wa-side-item static">
        {inner}
      </div>
    );
  };

  const selUserName = users.find((u) => u._id === selUser)?.name?.split(' ')[0] || '';
  const deptUsers = users.filter((u) => u.department === selDept);

  return (
    <div className="wa-live">
      <div className="wa-live-top">
        <div className="wa-row">
          <ModeSwitch
            value={mode}
            onChange={setMode}
            options={[
              { label: 'By user', value: 'user' },
              { label: 'By department', value: 'dept' },
            ]}
          />
          <span className="wa-live-hint">
            All chats of users with WhatsApp access. <strong>Read only</strong>: admin cannot send from here.
          </span>
        </div>
        <span className="wa-badge tone-amber">
          <EyeOutlined /> Admin monitoring
        </span>
      </div>

      <div className="wa-split wa-split-box">
        <div className="wa-col-side">
          {mode === 'user' ? (
            <>
              <div className="wa-col-title">Users ({users.length})</div>
              {users.length === 0 && <div className="wa-empty">Nobody has WhatsApp yet — turn it on in Individual or Department.</div>}
              {users.map((u) => userRow(u, true))}
            </>
          ) : (
            <>
              <div className="wa-col-title">Departments ({departments.length})</div>
              {departments.map((d) => (
                <button type="button" key={d.name} className={`wa-side-item ${selDept === d.name ? 'active' : ''}`} onClick={() => setSelDept(d.name)} aria-pressed={selDept === d.name}>
                  <span className={`wa-dept-icon ${selDept === d.name ? 'on' : ''}`} aria-hidden="true">
                    <TeamOutlined />
                  </span>
                  <div className="wa-side-text">
                    <div className="wa-side-name">{d.name}</div>
                    <div className="wa-side-meta">
                      {d.online} online · {d.users} users
                    </div>
                  </div>
                  <div className="wa-side-right">
                    <span className="wa-side-count">{d.chats} chats</span>
                    {d.unread > 0 && <span className="wa-unread">{d.unread}</span>}
                  </div>
                </button>
              ))}
              {selDept && (
                <>
                  <div className="wa-col-title wa-col-title-sep">Users in {selDept}</div>
                  {deptUsers.map((u) => userRow(u, false))}
                </>
              )}
            </>
          )}
        </div>

        <div className="wa-col-list">
          <div className="wa-col-title">{mode === 'user' ? `${selUserName}'s chats` : `${selDept || ''} department · all chats`}</div>
          <div className="wa-col-head">
            <SearchBox value={q} onChange={setQ} placeholder="Search name or number" label="Search chats" style={{ flex: 1 }} />
          </div>
          {chatsLoading ? (
            <div className="wa-center" style={{ padding: 24 }}>
              <Spin />
            </div>
          ) : (
            <ChatList chats={chats} activeId={activeId} onPick={setActiveId} showOwner={mode === 'dept'} empty="No chats yet." />
          )}
        </div>

        <div className="wa-col-thread">
          {activeId ? <ChatThread key={activeId} chatId={activeId} readOnly /> : <div className="wa-thread wa-center wa-thread-empty">Select a chat to view messages.</div>}
        </div>
      </div>
    </div>
  );
}
