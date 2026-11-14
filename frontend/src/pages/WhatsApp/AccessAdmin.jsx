import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Spin, message as toast } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import waApi from './api';
import Inbox from './Inbox';
import LiveChats from './LiveChats';
import BusinessNumbers from './BusinessNumbers';
import { Avatar, Btn, DeviceTag, FilterPills, ModeSwitch, Notice, PageHeader, RoleChip, SearchBox, Tabs, Toggle } from './ui';

// Same rule as backend services/whatsapp/access.js — recomputed here so the
// table updates live while the admin is still editing (before Save).
function evaluate(departments, u) {
  if (u.source === 'admin') return { on: true, reason: 'Admin — always on' };
  const d = departments[u.department];
  const viaDept = !!(d && d.enabled && d.roles.includes(u.role));
  if (u.mode === 'block') return { on: false, reason: viaDept ? 'Blocked individually (dept is on)' : 'Blocked individually' };
  if (u.mode === 'allow') return { on: true, reason: viaDept ? 'Allowed (also via department)' : 'Allowed individually' };
  if (viaDept) return { on: true, reason: `Via ${u.department} department` };
  if (!d) return { on: false, reason: 'No department access' };
  return { on: false, reason: d.enabled ? `Role not enabled in ${u.department}` : `${u.department} department is off` };
}

const MODE_OPTIONS = [
  { label: 'Department', value: 'inherit', tone: 'dark' },
  { label: 'Allow', value: 'allow', tone: 'green' },
  { label: 'Block', value: 'block', tone: 'red' },
];

// Admin view of Messenger › WhatsApp: Individual / Department access, Live
// Chats (everyone's chats, read only) and the admin's own Inbox.
export default function AccessAdmin({ me }) {
  const [tab, setTab] = useState('business');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);
  const [departments, setDepartments] = useState({});
  const [modes, setModes] = useState({});
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async (keepEdits) => {
    const res = await waApi.getAccess();
    setLoading(false);
    if (!res?.success) return toast.error(res?.message || 'Could not load WhatsApp access.');
    setData(res.result);
    if (!keepEdits) {
      setDepartments(res.result.departments);
      setModes(Object.fromEntries(res.result.users.map((u) => [u._id, u.mode])));
      setDirty(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const users = useMemo(() => {
    if (!data) return [];
    return data.users.map((u) => {
      const mode = modes[u._id] || 'inherit';
      return { ...u, mode, eff: evaluate(departments, { ...u, mode }) };
    });
  }, [data, modes, departments]);

  const shown = users.filter((u) => {
    if (deptFilter !== 'All' && u.department !== deptFilter) return false;
    if (!q) return true;
    return `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q.toLowerCase());
  });

  const withAccess = users.filter((u) => u.eff.on);
  const stats = {
    withAccess: withAccess.length,
    deptOn: (data?.departmentNames || []).filter((d) => departments[d]?.enabled).length,
    overrides: users.filter((u) => u.mode !== 'inherit').length,
    connected: withAccess.filter((u) => u.device?.status === 'connected').length,
  };

  const setMode = (id, mode) => {
    setModes((m) => ({ ...m, [id]: mode }));
    setDirty(true);
  };
  const toggleDept = (name, on) => {
    setDepartments((ds) => {
      const cur = ds[name] || { enabled: false, roles: [] };
      const roles = on && cur.roles.length === 0 ? [...(data.departmentRoles[name] || [])] : cur.roles;
      return { ...ds, [name]: { enabled: on, roles } };
    });
    setDirty(true);
  };
  const toggleRole = (name, role, on) => {
    setDepartments((ds) => {
      const cur = ds[name] || { enabled: false, roles: [] };
      const roles = on ? [...new Set([...cur.roles, role])] : cur.roles.filter((r) => r !== role);
      return { ...ds, [name]: { enabled: roles.length > 0 && (on ? true : cur.enabled), roles } };
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    const res = await waApi.saveAccess({
      departments,
      users: Object.entries(modes)
        .filter(([, m]) => m === 'allow' || m === 'block')
        .map(([userId, mode]) => ({ userId, mode })),
    });
    setSaving(false);
    if (!res?.success) return toast.error(res?.message || 'Could not save.');
    toast.success('WhatsApp access saved');
    load(false);
  };

  const refreshDevices = async () => {
    setRefreshing(true);
    const res = await waApi.refreshDevices();
    setRefreshing(false);
    if (!res?.success) return toast.error(res?.message || 'Could not check numbers.');
    toast.success(`Checked ${res.result.checked} number(s)${res.result.failed ? `, ${res.result.failed} could not be checked` : ''}`);
    load(true);
  };

  if (loading && !data) {
    return (
      <div className="wa-page">
        <PageHeader />
        <div className="wa-card wa-center" style={{ minHeight: 240 }}>
          <Spin />
        </div>
      </div>
    );
  }
  if (!data) return <div className="wa-page"><PageHeader /></div>;

  const accessTab = tab === 'individual' || tab === 'department';

  return (
    <div className="wa-page">
      <PageHeader
        actions={
          accessTab ? (
            <>
              {dirty && <span className="wa-badge tone-amber">Unsaved changes</span>}
              <Btn icon={<ReloadOutlined />} loading={refreshing} onClick={refreshDevices}>
                Check all numbers
              </Btn>
              <Btn variant="primary" loading={saving} disabled={!dirty} onClick={save}>
                Save changes
              </Btn>
            </>
          ) : null
        }
      />

      {tab !== 'inbox' && (
        <>
          <div className="wa-stats">
            <div className="wa-stat">
              <div className="wa-stat-label">Users with WhatsApp</div>
              <div className="wa-stat-val">
                {stats.withAccess} <small>/ {users.length}</small>
              </div>
            </div>
            <div className="wa-stat">
              <div className="wa-stat-label">Departments enabled</div>
              <div className="wa-stat-val">
                {stats.deptOn} <small>/ {data.departmentNames.length}</small>
              </div>
            </div>
            <div className="wa-stat">
              <div className="wa-stat-label">Individual overrides</div>
              <div className="wa-stat-val">{stats.overrides}</div>
            </div>
            <div className="wa-stat">
              <div className="wa-stat-label">Devices connected</div>
              <div className="wa-stat-val wa-green">{stats.connected}</div>
            </div>
          </div>

          {!data.configured && (
            <Notice tone="amber" title="DeroPo is not set up on the server.">
              Add DEROPO_ACCESS_TOKEN to the backend .env and restart. Until then nobody can link a number.
            </Notice>
          )}
          <Notice title="How access works:">
            a user sees WhatsApp if their <b>department + role</b> is enabled, OR they are given <b>Allow</b> individually. <b>Block</b> always wins — it
            hides WhatsApp even when the department is on.
          </Notice>
        </>
      )}

      <div className="wa-card">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'business', label: 'Business Numbers' },
            { key: 'individual', label: 'Individual' },
            { key: 'department', label: 'Department' },
            { key: 'live', label: 'Live Chats', count: withAccess.length },
            { key: 'inbox', label: 'My Inbox' },
          ]}
        />

        {tab === 'individual' && (
          <div className="wa-pad">
            <div className="wa-toolbar">
              <SearchBox value={q} onChange={setQ} placeholder="Search by name, email or role" label="Search users" style={{ flex: '1 1 260px' }} />
              <FilterPills options={['All', ...data.departmentNames, 'Admin']} value={deptFilter} onChange={setDeptFilter} />
            </div>
            <div className="wa-table-wrap">
              <table className="wa-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Department · Role</th>
                    <th>Individual setting</th>
                    <th>WhatsApp visible?</th>
                    <th>Device</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u._id}>
                      <td>
                        <div className="wa-user">
                          <Avatar id={u._id} name={u.name} />
                          <div style={{ minWidth: 0 }}>
                            <div className="wa-strong">{u.name}</div>
                            <div className="wa-sub">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="wa-medium">{u.department}</div>
                        <div className="wa-sub">{u.role}</div>
                      </td>
                      <td>
                        {u.source === 'admin' ? (
                          <span className="wa-sub">Always on (admin)</span>
                        ) : (
                          <ModeSwitch options={MODE_OPTIONS} value={u.mode} onChange={(v) => setMode(u._id, v)} />
                        )}
                      </td>
                      <td>
                        <span className={`wa-badge ${u.eff.on ? 'tone-green' : 'tone-gray'}`}>{u.eff.on ? 'Visible' : 'Hidden'}</span>
                        <div className="wa-sub" style={{ marginTop: 4 }}>{u.eff.reason}</div>
                      </td>
                      <td>
                        {u.eff.on ? <DeviceTag status={u.device?.status} /> : <span className="wa-tag tone-gray">—</span>}
                        {u.eff.on && u.device?.phoneNumber && <div className="wa-sub" style={{ marginTop: 4 }}>+{u.device.phoneNumber}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length === 0 && <div className="wa-empty">No users match this search.</div>}
          </div>
        )}

        {tab === 'department' && (
          <div className="wa-pad wa-dept-grid">
            {data.departmentNames.map((name) => {
              const d = departments[name] || { enabled: false, roles: [] };
              const members = users.filter((u) => u.department === name);
              const visible = members.filter((u) => u.eff.on).length;
              const blocked = members.filter((u) => u.mode === 'block').length;
              return (
                <div key={name} className={`wa-dept ${d.enabled ? 'on' : ''}`}>
                  <div className="wa-dept-head">
                    <div>
                      <div className="wa-dept-name">{name}</div>
                      <div className="wa-dept-meta">
                        {members.length} members · {visible} can see WhatsApp
                      </div>
                    </div>
                    <Toggle checked={d.enabled} onChange={(on) => toggleDept(name, on)} label={`${d.enabled ? 'Turn off' : 'Turn on'} WhatsApp for ${name}`} />
                  </div>
                  <div className="wa-dept-label">Roles that get WhatsApp</div>
                  <div className="wa-chips">
                    {(data.departmentRoles[name] || []).map((r) => (
                      <RoleChip key={r} checked={d.enabled && d.roles.includes(r)} onChange={(on) => toggleRole(name, r, on)}>
                        {r}
                      </RoleChip>
                    ))}
                  </div>
                  <div className="wa-dept-note">
                    New users added to these roles get WhatsApp automatically.
                    {blocked ? ` ${blocked} user(s) blocked individually.` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'live' && (
          <div className="wa-pad">
            <LiveChats />
          </div>
        )}

        {tab === 'inbox' && <Inbox initialDevice={me.device} configured={me.configured} embedded />}

        {tab === 'business' && <BusinessNumbers />}
      </div>
    </div>
  );
}
