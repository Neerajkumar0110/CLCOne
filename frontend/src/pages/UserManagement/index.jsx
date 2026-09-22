import React, { useEffect, useState } from "react";
import HubTabs from "@/components/HubTabs";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import {
  SafetyCertificateOutlined,
  UserAddOutlined,
  EditOutlined,
  DeleteOutlined,
  UndoOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  UsergroupDeleteOutlined,
  MoreOutlined,
  DownOutlined,
  ReadOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import { fillMatrixDefaults } from "@/config/defaultPermissionMatrix";
import { ROLE_COLORS } from "@/config/roles";
import Users, {
  initialsOf,
  colorFor,
  roles,
  modules,
  defaultMatrix,
  fetchPermissionRecords,
  savePermissionRecord,
  NEW_TEAM_COLORS,
  useTeams,
} from "./Users";

// Shows soft-deleted users (GET /api/admin/list?removed=true) with a Restore
// action (PATCH /api/admin/update/:id { removed: false }) — nothing is ever
// permanently gone from this screen.
function DeletedUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await request.list({ entity: "admin", options: { removed: "true" } });
    const backendUsers = res?.success ? res.result : [];
    setUsers(
      backendUsers.map((u) => {
        const name = [u.name, u.surname].filter(Boolean).join(" ");
        return { ...u, name, init: initialsOf(name || u.email), color: colorFor(u.email) };
      })
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const restoreUser = async (user) => {
    const res = await request.update({ entity: "admin", id: user._id, jsonData: { removed: false } });
    if (res?.success) {
      setUsers((prev) => prev.filter((u) => u.email !== user.email));
    }
  };

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading deleted users…</div>
      </div>
    );
  }

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3><UsergroupDeleteOutlined /> Deleted Users</h3>
        <span className="hub-badge hub-badge-gray">{users.length} deleted</span>
      </div>

      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <div className="hub-empty">No deleted users.</div>
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.email}>
                <td>
                  <div className="hub-person">
                    <div className="hub-avatar" style={{ background: u.color, opacity: 0.6 }}>
                      {u.init}
                    </div>
                    {u.name}
                  </div>
                </td>
                <td>{u.email}</td>
                <td>
                  <span className="hub-badge hub-badge-blue">{u.role}</span>
                </td>
                <td>
                  <button type="button" className="hub-btn" onClick={() => restoreUser(u)}>
                    <UndoOutlined /> Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RolesPermissions() {
  const [matrix, setMatrix] = useState(defaultMatrix);
  const [records, setRecords] = useState({});
  const [selectedRole, setSelectedRole] = useState(roles[0]);
  const [loading, setLoading] = useState(true);

  // Load saved role permissions from the backend; any role with no saved
  // record yet gets seeded with its default matrix and saved immediately.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const roleRecords = await fetchPermissionRecords("role");
      const byRole = Object.fromEntries(roleRecords.map((r) => [r.key, r]));
      const base = defaultMatrix();
      const nextMatrix = { ...base };
      const nextRecords = {};

      for (const role of roles) {
        if (byRole[role]) {
          const { matrix: filled, changed } = fillMatrixDefaults(byRole[role].matrix, role);
          nextMatrix[role] = filled;
          nextRecords[role] = byRole[role];
          // A module added after this record was first saved (e.g. Finance,
          // Support) — persist the backfilled defaults so it's complete next time.
          if (changed) {
            const saved = await savePermissionRecord({
              id: byRole[role]._id,
              scope: "role",
              key: role,
              matrix: filled,
            });
            if (saved?.success) nextRecords[role] = saved.result;
          }
        } else {
          const saved = await savePermissionRecord({ scope: "role", key: role, matrix: base[role] });
          if (saved?.success) nextRecords[role] = saved.result;
        }
      }

      if (!cancelled) {
        setMatrix(nextMatrix);
        setRecords(nextRecords);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (role, mod, perm) => {
    const updatedRoleMatrix = {
      ...matrix[role],
      [mod]: { ...matrix[role][mod], [perm]: !matrix[role][mod][perm] },
    };
    setMatrix((prev) => ({ ...prev, [role]: updatedRoleMatrix }));

    const record = records[role];
    const saved = await savePermissionRecord({
      id: record?._id,
      scope: "role",
      key: role,
      matrix: updatedRoleMatrix,
    });
    if (saved?.success) {
      setRecords((prev) => ({ ...prev, [role]: saved.result }));
    }
  };

  const enabledCount = Object.values(matrix[selectedRole]).filter(
    (p) => p.view || p.edit || p.delete
  ).length;

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading permissions…</div>
      </div>
    );
  }

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Roles</h3>
        </div>
        <div className="hub-btn-group">
          {roles.map((role) => (
            <button
              key={role}
              type="button"
              className={`hub-btn role-color-button ${selectedRole === role ? "selected" : ""}`}
              style={{ "--role-color": ROLE_COLORS[role] || "#475569" }}
              onClick={() => setSelectedRole(role)}
            >
              {role}
            </button>
          ))}
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Permissions — {selectedRole}</h3>
          <span className="hub-badge hub-badge-purple">
            {enabledCount}/{modules.length} modules enabled
          </span>
        </div>

        <p style={{ fontSize: 12, color: "#8c8c8c", marginTop: -8, marginBottom: 14 }}>
          Toggle View, Edit and Delete independently for each module.
        </p>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>View</th>
                <th>Edit</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((mod) => {
                const perms = matrix[selectedRole][mod];
                return (
                  <tr key={mod}>
                    <td>{mod}</td>
                    <td>
                      <button
                        type="button"
                        className={`hub-switch ${perms.view ? "on" : ""}`}
                        onClick={() => toggle(selectedRole, mod, "view")}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`hub-switch ${perms.edit ? "on" : ""}`}
                        onClick={() => toggle(selectedRole, mod, "edit")}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`hub-switch ${perms.delete ? "on" : ""}`}
                        onClick={() => toggle(selectedRole, mod, "delete")}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   TEAM MANAGEMENT
========================================================= */


function CreateTeamModal({ open, onClose, onCreated, colorSeed }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setName("");
    setError("");
  };

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");

    const res = await request.create({
      entity: "team",
      jsonData: {
        name: name.trim(),
        members: [],
        color: NEW_TEAM_COLORS[colorSeed % NEW_TEAM_COLORS.length],
      },
    });

    setSubmitting(false);
    if (!res?.success) {
      setError(res?.message || "Could not create team.");
      return;
    }
    await onCreated?.();
    reset();
    onClose();
  };

  return (
    <HubModal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Create Team"
      width={360}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={() => { reset(); onClose(); }}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create Team"}
          </button>
        </>
      }
    >
      {error && (
        <div className="hub-form-row">
          <span className="hub-badge hub-badge-red">{error}</span>
        </div>
      )}
      <div className="hub-form-row">
        <label>Team Name</label>
        <input
          className="hub-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sales — West"
          autoFocus
        />
        <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>
          Assign a lead and members afterwards from Edit User.
        </span>
      </div>
    </HubModal>
  );
}

function RenameTeamModal({ open, team, onClose, onRenamed }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (team) setName(team.name);
    setError("");
  }, [team, open]);

  if (!open || !team) return null;

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");

    const res = await request.update({ entity: "team", id: team._id, jsonData: { name: name.trim() } });

    setSubmitting(false);
    if (!res?.success) {
      setError(res?.message || "Could not rename team.");
      return;
    }
    await onRenamed?.();
    onClose();
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title={`Rename "${team.name}"`}
      width={360}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {error && (
        <div className="hub-form-row">
          <span className="hub-badge hub-badge-red">{error}</span>
        </div>
      )}
      <div className="hub-form-row">
        <label>Team Name</label>
        <input className="hub-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
    </HubModal>
  );
}

function TeamManagement({ teams, onReload }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());

  const toggleMembers = (name) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const deleteTeam = async (team) => {
    setMenuOpenFor(null);
    if (!window.confirm(`Delete "${team.name}"? Its members will no longer be grouped under it.`)) return;
    const res = await request.delete({ entity: "team", id: team._id });
    if (res?.success) await onReload?.();
  };

  return (
    <div className="hub-stack">
      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Teams</div>
          <div className="hub-kpi-value">{teams.length}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Members</div>
          <div className="hub-kpi-value">{new Set(teams.flatMap((t) => t.members)).size}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Avg Team Size</div>
          <div className="hub-kpi-value">
            {teams.length ? (teams.reduce((s, t) => s + t.members.length, 0) / teams.length).toFixed(1) : "0.0"}
          </div>
        </div>
      </div>

      <div className="hub-card" style={{ padding: "16px 20px" }}>
        <div className="hub-card-header" style={{ margin: 0 }}>
          <h3>Teams</h3>
          <button type="button" className="hub-btn hub-btn-primary" onClick={() => setCreateOpen(true)}>
            <PlusOutlined /> Create Team
          </button>
        </div>
      </div>

      {teams.length === 0 && (
        <div className="hub-card">
          <div className="hub-empty">No teams yet — create one above, or from Add User's "+ Create New Team" option.</div>
        </div>
      )}

      <div className="hub-grid-3">
        {teams.map((t) => {
          const color = t.color || "#2563EB";
          // The lead is already shown in the header — don't repeat them below.
          const otherMembers = t.members.filter((m) => m !== t.lead);
          const isCollapsed = collapsed.has(t.name);
          return (
            <div className="hub-card" key={t.name} style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  padding: "18px 20px 16px",
                  background: `linear-gradient(135deg, ${color}, ${color}99)`,
                  color: "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <h3 style={{ margin: 0, color: "#fff", fontSize: 16, fontWeight: 700 }}>{t.name}</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span className="hub-badge" style={{ background: "rgba(255,255,255,0.25)", color: "#fff" }}>
                      {t.members.length} member{t.members.length === 1 ? "" : "s"}
                    </span>
                    <div className="hub-dropdown">
                      <button
                        type="button"
                        className="hub-icon-btn"
                        onClick={() => setMenuOpenFor(menuOpenFor === t.name ? null : t.name)}
                        aria-label="Team options"
                      >
                        <MoreOutlined />
                      </button>
                      {menuOpenFor === t.name && (
                        <>
                          <div
                            style={{ position: "fixed", inset: 0, zIndex: 10 }}
                            onClick={() => setMenuOpenFor(null)}
                          />
                          <div className="hub-dropdown-menu">
                            <button
                              type="button"
                              className="hub-dropdown-item"
                              onClick={() => { setMenuOpenFor(null); setRenameTarget(t); }}
                            >
                              <EditOutlined /> Rename Team
                            </button>
                            <button
                              type="button"
                              className="hub-dropdown-item hub-dropdown-item-danger"
                              onClick={() => deleteTeam(t)}
                            >
                              <DeleteOutlined /> Delete Team
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
                  <div
                    className="hub-avatar"
                    style={{
                      background: "rgba(255,255,255,0.22)",
                      color: "#fff",
                      border: "2px solid rgba(255,255,255,0.5)",
                    }}
                  >
                    {t.lead ? initialsOf(t.lead) : "?"}
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, opacity: 0.85, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                      Team Lead
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t.lead || "Unassigned"}</div>
                  </div>
                </div>
              </div>

              <div style={{ padding: "14px 20px 18px" }}>
                <button
                  type="button"
                  className={`hub-accordion-toggle ${isCollapsed ? "" : "open"}`}
                  onClick={() => toggleMembers(t.name)}
                >
                  <span>Members ({otherMembers.length})</span>
                  <DownOutlined />
                </button>
                <div className={`hub-accordion-body ${isCollapsed ? "closed" : ""}`}>
                  <div>
                    {otherMembers.length === 0 ? (
                      <div className="hub-empty">No other members yet.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {otherMembers.map((m) => (
                          <div className="hub-person" key={m}>
                            <div className="hub-avatar" style={{ background: color }}>
                              {initialsOf(m)}
                            </div>
                            <span style={{ fontSize: 13 }}>{m}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <CreateTeamModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onReload}
        colorSeed={teams.length}
      />
      <RenameTeamModal
        open={!!renameTarget}
        team={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={onReload}
      />
    </div>
  );
}

/* =========================================================
   SHIFT MANAGEMENT
========================================================= */

const SHIFT_OPTIONS = [
  "Morning (9:00 AM – 5:00 PM)",
  "Evening (2:00 PM – 10:00 PM)",
  "Night (10:00 PM – 6:00 AM)",
];

// Backed by the real `shift` API (backend/src/models/appModels/Shift.js) —
// a plain generic-CRUD model, no custom controller needed.
function AssignShiftModal({ open, onClose, onAssigned }) {
  const [adminName, setAdminName] = useState("");
  const [shift, setShift] = useState(SHIFT_OPTIONS[0]);
  const [days, setDays] = useState("Mon–Fri");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setAdminName("");
      setShift(SHIFT_OPTIONS[0]);
      setDays("Mon–Fri");
      setError("");
    }
  }, [open]);

  const submit = async () => {
    if (!adminName.trim()) return;
    setSaving(true);
    setError("");
    const res = await request.create({
      entity: "shift",
      jsonData: { adminName: adminName.trim(), shift, days: days.trim() || "Mon–Fri", status: "On Shift" },
    });
    setSaving(false);
    if (res?.success) {
      onAssigned();
      onClose();
    } else {
      setError(res?.message || "Could not assign that shift.");
    }
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="Assign Shift"
      width={420}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Assigning…" : "Assign"}
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Agent Name</label>
        <input
          className="hub-input"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
          placeholder="e.g. Priya Sharma"
        />
      </div>
      <div className="hub-form-row">
        <label>Shift</label>
        <select className="hub-select" value={shift} onChange={(e) => setShift(e.target.value)}>
          {SHIFT_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="hub-form-row">
        <label>Working Days</label>
        <input
          className="hub-input"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          placeholder="e.g. Mon–Fri"
        />
      </div>
      {error && <div style={{ color: "var(--hub-red)", fontSize: 12.5 }}>{error}</div>}
    </HubModal>
  );
}

function ShiftManagement() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);

  const loadShifts = async () => {
    setLoading(true);
    const res = await request.listAll({ entity: "shift" });
    setShifts(res?.success ? res.result : []);
    setLoading(false);
  };

  useEffect(() => {
    loadShifts();
  }, []);

  const toggleStatus = async (s) => {
    const nextStatus = s.status === "On Shift" ? "Off" : "On Shift";
    setShifts((prev) => prev.map((row) => (row._id === s._id ? { ...row, status: nextStatus } : row)));
    await request.update({ entity: "shift", id: s._id, jsonData: { status: nextStatus } });
  };

  const removeShift = async (s) => {
    if (!window.confirm(`Remove ${s.adminName}'s shift assignment?`)) return;
    const res = await request.delete({ entity: "shift", id: s._id });
    if (res?.success) setShifts((prev) => prev.filter((row) => row._id !== s._id));
  };

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading shifts…</div>
      </div>
    );
  }

  return (
    <div className="hub-stack">
    <div className="hub-card">
      <div className="hub-card-header">
        <h3>Shift Schedule</h3>
        <div className="hub-row" style={{ gap: 12, alignItems: "center" }}>
          <span className="hub-badge hub-badge-green">
            {shifts.filter((s) => s.status === "On Shift").length} on shift now
          </span>
          <button type="button" className="hub-btn hub-btn-primary" onClick={() => setAssignOpen(true)}>
            <PlusOutlined /> Assign Shift
          </button>
        </div>
      </div>

      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Shift</th>
              <th>Working Days</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shifts.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="hub-empty">No shift assignments yet — click "Assign Shift" to add one.</div>
                </td>
              </tr>
            )}
            {shifts.map((s) => (
              <tr key={s._id}>
                <td>
                  <div className="hub-person">
                    <div className="hub-avatar" style={{ background: colorFor(s.adminName) }}>
                      {initialsOf(s.adminName)}
                    </div>
                    {s.adminName}
                  </div>
                </td>
                <td>{s.shift}</td>
                <td>{s.days}</td>
                <td>
                  <button
                    type="button"
                    className={`hub-badge ${s.status === "On Shift" ? "hub-badge-green" : "hub-badge-gray"}`}
                    style={{ border: "none", cursor: "pointer" }}
                    onClick={() => toggleStatus(s)}
                  >
                    {s.status}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="hub-btn"
                    style={{ padding: "4px 8px" }}
                    onClick={() => removeShift(s)}
                    title="Remove shift assignment"
                  >
                    <DeleteOutlined />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AssignShiftModal open={assignOpen} onClose={() => setAssignOpen(false)} onAssigned={loadShifts} />
    </div>

    <LoginActivityPanel />
    </div>
  );
}

function formatSessionDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Backed by the real `loginactivity` API (backend/src/models/appModels/
// LoginActivity.js) — every registered admin ("jitne register hai sab yaha
// show ho"), 10 per page, with live on/off status, today's login count, and
// today's logged-in hours. Sessions are tracked server-side from actual
// socket connect/disconnect (backend/src/socket.js), not a manual toggle.
function LoginActivityPanel() {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailFor, setDetailFor] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadPage = async (targetPage) => {
    setLoading(true);
    const res = await request.get({ entity: `loginactivity/summary?page=${targetPage}&limit=10` });
    if (res?.success) {
      setRows(res.result);
      setPage(res.pagination.page);
      setPages(res.pagination.pages);
      setCount(res.pagination.count);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetail = async (row) => {
    setDetailFor(row);
    setDetailData(null);
    setDetailLoading(true);
    const res = await request.get({ entity: `loginactivity/detail/${row._id}` });
    setDetailData(res?.success ? res.result : null);
    setDetailLoading(false);
  };

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3>Login Activity — Today</h3>
        <span className="hub-badge hub-badge-green">
          {rows.filter((r) => r.online).length} online now
        </span>
      </div>

      {loading ? (
        <div className="hub-empty">Loading…</div>
      ) : (
        <>
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Logins Today</th>
                  <th>Hours Today</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="hub-empty">No registered users.</div>
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td>
                      <div className="hub-person">
                        <div className="hub-avatar" style={{ background: colorFor(r.name) }}>
                          {initialsOf(r.name)}
                        </div>
                        {r.name}
                      </div>
                    </td>
                    <td>
                      <span className={`hub-badge ${r.online ? "hub-badge-green" : "hub-badge-gray"}`}>
                        {r.online ? "Online" : "Offline"}
                      </span>
                    </td>
                    <td>{r.loginCount}</td>
                    <td>{r.hoursToday}h</td>
                    <td>
                      <button
                        type="button"
                        className="hub-btn"
                        style={{ padding: "4px 10px" }}
                        onClick={() => openDetail(r)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="hub-row" style={{ justifyContent: "center", gap: 12, marginTop: 14, alignItems: "center" }}>
              <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => loadPage(page - 1)}>
                Prev
              </button>
              <span style={{ fontSize: 12.5, color: "#667085" }}>
                Page {page} of {pages} · {count} users
              </span>
              <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => loadPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}

      <HubModal
        open={!!detailFor}
        onClose={() => {
          setDetailFor(null);
          setDetailData(null);
        }}
        title={detailFor ? `${detailFor.name} — Today's Sessions` : ""}
        width={480}
      >
        {detailLoading ? (
          <div className="hub-empty">Loading…</div>
        ) : !detailData || detailData.sessions.length === 0 ? (
          <div className="hub-empty">No login sessions today.</div>
        ) : (
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Login</th>
                  <th>Logout</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {detailData.sessions.map((s) => (
                  <tr key={s._id}>
                    <td>{fmtTime(s.loginAt)}</td>
                    <td>{s.logoutAt ? fmtTime(s.logoutAt) : "Still active"}</td>
                    <td>{s.durationSeconds != null ? formatSessionDuration(s.durationSeconds) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </HubModal>
    </div>
  );
}

export default function UserManagement() {
  const [tab, setTab] = useState("users");
  const { teams, teamsLoading, loadTeams, assignUserToTeam } = useTeams();

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>User Management</h2>
          <p>Manage users, teams, shifts, access and support — all in one place</p>
        </div>
      </div>

      <HubTabs
        tabs={[
          { key: "users", label: "Users", icon: <UserAddOutlined /> },
          { key: "teachers", label: "Teachers", icon: <SolutionOutlined /> },
          { key: "students", label: "Students", icon: <ReadOutlined /> },
          { key: "deleted", label: "Deleted Users", icon: <UsergroupDeleteOutlined /> },
          { key: "roles", label: "Roles & Permissions", icon: <SafetyCertificateOutlined /> },
          { key: "teams", label: "Team Management", icon: <TeamOutlined /> },
          { key: "shifts", label: "Shift Management", icon: <ClockCircleOutlined /> },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "users" && <Users teams={teams} onAssignTeam={assignUserToTeam} />}
      {tab === "teachers" && <Users teams={teams} onAssignTeam={assignUserToTeam} roleFilter="Teacher" />}
      {tab === "students" && <Users teams={teams} onAssignTeam={assignUserToTeam} roleFilter="Student" />}
      {tab === "deleted" && <DeletedUsers />}
      {tab === "roles" && <RolesPermissions />}
      {tab === "teams" &&
        (teamsLoading ? (
          <div className="hub-card">
            <div className="hub-empty">Loading teams…</div>
          </div>
        ) : (
          <TeamManagement teams={teams} onReload={loadTeams} />
        ))}
      {tab === "shifts" && <ShiftManagement />}
    </div>
  );
}
