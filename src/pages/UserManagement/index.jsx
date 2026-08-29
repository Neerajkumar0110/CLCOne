import React, { useEffect, useState } from "react";
import HubTabs from "@/components/HubTabs";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import {
  SafetyCertificateOutlined,
  ReloadOutlined,
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
} from "@ant-design/icons";
import { PERMISSION_MODULES } from "@/config/permissionModules";
import { buildDefaultMatrix, fillMatrixDefaults } from "@/config/defaultPermissionMatrix";
import {
  ROLES,
  KNOWN_NON_SELECTABLE_ROLES,
  FINANCE_SUB_ROLES,
  MANAGER_TEAM_ROLES,
  NO_TEAM_FIELD_ROLES,
  NO_EDIT_ROLES,
  BELOW_TEAM_MANAGER_ROLES,
  ROLE_ALIASES,
  DEFAULT_FALLBACK_ROLE,
} from "@/config/roles";

const AVATAR_COLORS = ["#2563EB", "#722ED1", "#13C2C2", "#FA8C16", "#EB2F96", "#52C41A"];

function initialsOf(name) {
  return name.trim().split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function colorFor(email) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const roles = ROLES;

// Same module list the sidebar and route guards use — kept in one shared file
// (frontend/src/config/permissionModules.js) so they can never drift apart.
const modules = PERMISSION_MODULES;

// Includes the non-selectable Super Admin/owner tier too, so a matrix entry
// always exists for whatever role a loaded user actually has.
const matrixRoles = [...KNOWN_NON_SELECTABLE_ROLES, ...roles];

function defaultMatrix() {
  return buildDefaultMatrix(matrixRoles);
}

// Backed by the real `permission` API (backend/src/models/appModels/Permission.js).
// scope: 'role' rows are the shared defaults, 'user' rows override a single person.
async function fetchPermissionRecords(scope) {
  const res = await request.listAll({ entity: "permission" });
  const all = res?.success ? res.result : [];
  return all.filter((p) => p.scope === scope);
}

async function savePermissionRecord({ id, scope, key, matrix }) {
  if (id) {
    return request.update({ entity: "permission", id, jsonData: { matrix } });
  }
  return request.create({ entity: "permission", jsonData: { scope, key, matrix } });
}

const NO_TEAM = "__none__";
const NEW_TEAM = "__new__";

function AddUserModal({ open, onClose, onAdd, teams }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Defaults to the lowest-privilege role — Super Admin/Admin creation is
  // gated server-side to Super Admin requesters, so it shouldn't be the default pick.
  const [role, setRole] = useState("Executive");
  const [subRole, setSubRole] = useState(FINANCE_SUB_ROLES[0]);
  const [teamChoice, setTeamChoice] = useState(NO_TEAM);
  const [newTeamName, setNewTeamName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Only roles that lead a team get to spin up a brand new one here.
  const isManagerRole = MANAGER_TEAM_ROLES.includes(role);

  useEffect(() => {
    if (NO_TEAM_FIELD_ROLES.includes(role) || (!isManagerRole && teamChoice === NEW_TEAM)) {
      setTeamChoice(NO_TEAM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const reset = () => {
    setName("");
    setEmail("");
    setTeamChoice(NO_TEAM);
    setNewTeamName("");
    setFormError("");
    setSubRole(FINANCE_SUB_ROLES[0]);
  };

  const submit = async () => {
    if (!name.trim() || !email.trim()) return;
    if (teamChoice === NEW_TEAM && !newTeamName.trim()) return;

    setSubmitting(true);
    setFormError("");

    // Real backend call — POST /api/admin/create. Login is passwordless
    // (OTP-only), so no password is collected here.
    const res = await request.create({
      entity: "admin",
      jsonData: {
        name: name.trim(),
        email: email.trim(),
        role,
        ...(role === "Finance" ? { subRole } : {}),
      },
    });

    setSubmitting(false);

    if (!res?.success) {
      setFormError(res?.message || "Could not create user.");
      return;
    }

    const created = res.result;
    await onAdd(
      {
        _id: created._id,
        name: created.name,
        init: initialsOf(created.name),
        color: colorFor(created.email),
        email: created.email,
        role: created.role,
        subRole: created.subRole,
        enabled: created.enabled,
      },
      { teamChoice, newTeamName: newTeamName.trim() }
    );
    reset();
    onClose();
  };

  return (
    <HubModal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add New User"
      width={400}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={() => { reset(); onClose(); }}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Add User"}
          </button>
        </>
      }
    >
      {formError && (
        <div className="hub-form-row">
          <span className="hub-badge hub-badge-red">{formError}</span>
        </div>
      )}

      <div className="hub-form-row">
        <label>Full Name</label>
        <input className="hub-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rohan Malhotra" />
      </div>

      <div className="hub-form-row">
        <label>Email</label>
        <input className="hub-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@careerlabconsulting.com" />
      </div>

      <div className="hub-form-row">
        <label>Role</label>
        <select className="hub-select" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {role === "Finance" && (
        <div className="hub-form-row">
          <label>Finance Position</label>
          <select className="hub-select" value={subRole} onChange={(e) => setSubRole(e.target.value)}>
            {FINANCE_SUB_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      {!NO_TEAM_FIELD_ROLES.includes(role) && (
        <div className="hub-form-row">
          <label>Team</label>
          <select className="hub-select" value={teamChoice} onChange={(e) => setTeamChoice(e.target.value)}>
            <option value={NO_TEAM}>No team (assign later)</option>
            {teams.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
            {isManagerRole && <option value={NEW_TEAM}>+ Create New Team</option>}
          </select>
        </div>
      )}

      {isManagerRole && teamChoice === NEW_TEAM && (
        <div className="hub-form-row">
          <label>New Team Name</label>
          <input
            className="hub-input"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="e.g. Sales — West"
          />
        </div>
      )}
    </HubModal>
  );
}

// Lets an admin change an existing user's role (position) and/or move them to
// a different team — e.g. promoting an Executive, or assigning a Team
// Manager to the team they now lead.
function EditUserModal({ open, onClose, onSave, user, teams, allUsers, onAssignTeam }) {
  const [role, setRole] = useState(roles[0]);
  const [subRole, setSubRole] = useState(FINANCE_SUB_ROLES[0]);
  const [teamChoice, setTeamChoice] = useState(NO_TEAM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [assignEmail, setAssignEmail] = useState("");
  const [assignedNote, setAssignedNote] = useState("");

  useEffect(() => {
    if (!user) return;
    setRole(user.role);
    setSubRole(user.subRole || FINANCE_SUB_ROLES[0]);
    const currentTeam = teams.find((t) => t.members.includes(user.name));
    setTeamChoice(currentTeam ? currentTeam.name : NO_TEAM);
    setFormError("");
    setAssignEmail("");
    setAssignedNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, open]);

  if (!open || !user) return null;

  // Super Admin's account is provisioned once, outside this UI — its role
  // can't be reassigned from here.
  const isProtectedRole = KNOWN_NON_SELECTABLE_ROLES.includes(user.role);

  // Admin / Sales Manager / Team Manager have no team concept at all. Team
  // Leader either already leads one (shown, not chosen) or can be made lead
  // of an existing team that doesn't have one yet — editing never creates a
  // brand new team, that only happens from Add User.
  const isNoTeamRole = NO_TEAM_FIELD_ROLES.includes(role);
  const isManagerRole = MANAGER_TEAM_ROLES.includes(role);
  const ledTeam = teams.find((t) => t.lead === user.name || t.members.includes(user.name));
  const unledTeams = teams.filter((t) => !t.lead);
  const effectiveTeamChoice = isNoTeamRole ? NO_TEAM : isManagerRole ? (ledTeam ? ledTeam.name : teamChoice) : teamChoice;

  const submit = async () => {
    setSubmitting(true);
    setFormError("");

    const res = await request.update({
      entity: "admin",
      id: user._id,
      jsonData: isProtectedRole ? {} : { role, ...(role === "Finance" ? { subRole } : {}) },
    });
    setSubmitting(false);

    if (!res?.success) {
      setFormError(res?.message || "Could not update user.");
      return;
    }

    await onSave(user, isProtectedRole ? user.role : role, { teamChoice: effectiveTeamChoice, newTeamName: "" });
    onClose();
  };

  // Only offered once the manager already has a real (saved) team.
  const isRealTeam = isManagerRole ? !!ledTeam : effectiveTeamChoice !== NO_TEAM;
  const assignablePeople = (allUsers ?? []).filter(
    (u) =>
      BELOW_TEAM_MANAGER_ROLES.includes(u.role) &&
      u.email !== user.email &&
      !teams.some((t) => t.members.includes(u.name))
  );

  const assignTeamMember = () => {
    const person = assignablePeople.find((u) => u.email === assignEmail);
    if (!person) return;
    onAssignTeam(person.name, effectiveTeamChoice, "");
    setAssignedNote(`${person.name} added to "${effectiveTeamChoice}".`);
    setAssignEmail("");
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title={`Edit — ${user.name}`}
      width={400}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save Changes"}
          </button>
        </>
      }
    >
      {formError && (
        <div className="hub-form-row">
          <span className="hub-badge hub-badge-red">{formError}</span>
        </div>
      )}

      <div className="hub-form-row">
        <label>Role / Position</label>
        {isProtectedRole ? (
          <>
            <div className="hub-input" style={{ background: "#f5f5f5", color: "#8c8c8c" }}>{user.role}</div>
            <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>
              Super Admin's role can't be changed here.
            </span>
          </>
        ) : (
          <>
            <select className="hub-select" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {role !== user.role && (
              <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>
                Their permissions will reset to the "{role}" role's default.
              </span>
            )}
          </>
        )}
      </div>

      {role === "Finance" && (
        <div className="hub-form-row">
          <label>Finance Position</label>
          <select className="hub-select" value={subRole} onChange={(e) => setSubRole(e.target.value)}>
            {FINANCE_SUB_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      {isNoTeamRole ? null : isManagerRole ? (
        <div className="hub-form-row">
          <label>Team</label>
          {ledTeam ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 8,
                background: "#f0f6ff",
                border: "1px solid #dbe4f3",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: ledTeam.color || "#2563eb", flexShrink: 0 }} />
              <strong style={{ fontSize: 13.5, color: "#101828" }}>{ledTeam.name}</strong>
              <span style={{ fontSize: 11.5, color: "#8c8c8c", marginLeft: "auto" }}>
                {ledTeam.members.length} member{ledTeam.members.length === 1 ? "" : "s"}
              </span>
            </div>
          ) : unledTeams.length > 0 ? (
            <>
              <select className="hub-select" value={teamChoice} onChange={(e) => setTeamChoice(e.target.value)}>
                <option value={NO_TEAM}>Not leading a team</option>
                {unledTeams.map((t) => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
              <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>
                Saving will make {user.name} the lead of the selected team.
              </span>
            </>
          ) : (
            <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>
              No existing team without a lead — create one from Add User instead.
            </span>
          )}
        </div>
      ) : (
        <div className="hub-form-row">
          <label>Team</label>
          <select className="hub-select" value={teamChoice} onChange={(e) => setTeamChoice(e.target.value)}>
            <option value={NO_TEAM}>No team</option>
            {teams.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {isManagerRole && isRealTeam && (
        <div className="hub-form-row">
          <label>Assign a team member to "{ledTeam.name}"</label>
          <div className="hub-row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <select
              className="hub-select"
              style={{ flex: 1 }}
              value={assignEmail}
              onChange={(e) => setAssignEmail(e.target.value)}
            >
              <option value="">Select a team member by email…</option>
              {assignablePeople.map((sp) => (
                <option key={sp.email} value={sp.email}>{sp.name} · {sp.email} ({sp.role})</option>
              ))}
            </select>
            <button type="button" className="hub-btn" disabled={!assignEmail} onClick={assignTeamMember}>
              + Add
            </button>
          </div>
          {assignablePeople.length === 0 && (
            <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>
              No unassigned accounts left to add.
            </span>
          )}
          {assignedNote && <span className="hub-badge hub-badge-green">{assignedNote}</span>}
        </div>
      )}
    </HubModal>
  );
}

// Shows one user's own permission grid (seeded from their role's defaults)
// and lets it be toggled per module — independent of other users on the same role.
function UserPermissionsModal({ open, user, onClose, onToggle, onReset }) {
  if (!open || !user) return null;

  const perms = user.permissions;
  const enabledCount = Object.values(perms).filter((p) => p.view || p.edit || p.delete).length;

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title={`Permissions — ${user.name}`}
      subtitle={`Role: ${user.role} · toggle View, Edit and Delete to add or remove access per module`}
      width={520}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onReset}>
            <ReloadOutlined /> Reset to Role Default
          </button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="hub-row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: "#8c8c8c" }}>
          Turning a switch on adds that access; turning it off removes it — just for this user.
        </span>
        <span className="hub-badge hub-badge-purple">
          {enabledCount}/{modules.length} modules enabled
        </span>
      </div>

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
              const p = perms[mod];
              return (
                <tr key={mod}>
                  <td>{mod}</td>
                  <td>
                    <button
                      type="button"
                      className={`hub-switch ${p.view ? "on" : ""}`}
                      onClick={() => onToggle(mod, "view")}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`hub-switch ${p.edit ? "on" : ""}`}
                      onClick={() => onToggle(mod, "edit")}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`hub-switch ${p.delete ? "on" : ""}`}
                      onClick={() => onToggle(mod, "delete")}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </HubModal>
  );
}

function Users({ teams, onAssignTeam }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [permUserEmail, setPermUserEmail] = useState(null);
  const [editUserEmail, setEditUserEmail] = useState(null);

  // Load real users from the backend (GET /api/admin/list), then load each
  // one's saved permissions — anyone with no saved record yet gets seeded
  // from their role's default and saved immediately (scope: 'user', key: email).
  const loadUsers = async () => {
    setLoading(true);
    const usersRes = await request.list({ entity: "admin" });
    const backendUsers = usersRes?.success ? usersRes.result : [];

    const userRecords = await fetchPermissionRecords("user");
    const byEmail = Object.fromEntries(userRecords.map((r) => [r.key, r]));
    const base = defaultMatrix();

    const loaded = [];
    for (const u of backendUsers) {
      const resolvedRole =
        roles.includes(u.role) || KNOWN_NON_SELECTABLE_ROLES.includes(u.role)
          ? u.role
          : ROLE_ALIASES[u.role] || DEFAULT_FALLBACK_ROLE;
      const displayUser = {
        _id: u._id,
        name: [u.name, u.surname].filter(Boolean).join(" "),
        email: u.email,
        role: resolvedRole,
        subRole: u.subRole,
        enabled: u.enabled,
        init: initialsOf([u.name, u.surname].filter(Boolean).join(" ") || u.email),
        color: colorFor(u.email),
      };

      const existing = byEmail[u.email];
      if (existing) {
        const { matrix: filled, changed } = fillMatrixDefaults(existing.matrix, displayUser.role);
        let permRecordId = existing._id;
        if (changed) {
          const saved = await savePermissionRecord({
            id: existing._id,
            scope: "user",
            key: u.email,
            matrix: filled,
          });
          if (saved?.success) permRecordId = saved.result._id;
        }
        loaded.push({ ...displayUser, permissions: filled, permRecordId });
      } else {
        const defaultForRole = base[displayUser.role];
        const saved = await savePermissionRecord({
          scope: "user",
          key: u.email,
          matrix: defaultForRole,
        });
        loaded.push({
          ...displayUser,
          permissions: defaultForRole,
          permRecordId: saved?.success ? saved.result._id : undefined,
        });
      }
    }

    setUsers(loaded);
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePermission = async (email, mod, permType) => {
    const target = users.find((u) => u.email === email);
    if (!target) return;

    const updatedMatrix = {
      ...target.permissions,
      [mod]: { ...target.permissions[mod], [permType]: !target.permissions[mod][permType] },
    };
    setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, permissions: updatedMatrix } : u)));

    const saved = await savePermissionRecord({
      id: target.permRecordId,
      scope: "user",
      key: email,
      matrix: updatedMatrix,
    });
    if (saved?.success) {
      setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, permRecordId: saved.result._id } : u)));
    }
  };

  const resetPermissions = async (email) => {
    const target = users.find((u) => u.email === email);
    if (!target) return;

    const defaults = defaultMatrix()[target.role];
    setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, permissions: defaults } : u)));

    const saved = await savePermissionRecord({
      id: target.permRecordId,
      scope: "user",
      key: email,
      matrix: defaults,
    });
    if (saved?.success) {
      setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, permRecordId: saved.result._id } : u)));
    }
  };

  const permUser = users.find((u) => u.email === permUserEmail) ?? null;
  const editUser = users.find((u) => u.email === editUserEmail) ?? null;

  // Role changed → their permissions should reflect the NEW position, not
  // stay frozen on the old one, so reset the override to the new role's default.
  const saveUserEdit = async (user, newRole, teamInfo) => {
    if (newRole !== user.role) {
      const defaults = defaultMatrix()[newRole];
      await savePermissionRecord({ id: user.permRecordId, scope: "user", key: user.email, matrix: defaults });
    }
    onAssignTeam(user.name, teamInfo.teamChoice, teamInfo.newTeamName);
    await loadUsers();
  };

  // Soft delete (DELETE /api/admin/delete/:id) — the user stops showing here
  // but stays visible, and restorable, under the "Deleted Users" tab.
  const deleteUser = async (user) => {
    if (!window.confirm(`Delete ${user.name}? They'll be moved to Deleted Users and can be restored later.`)) return;
    const res = await request.delete({ entity: "admin", id: user._id });
    if (res?.success) {
      setUsers((prev) => prev.filter((u) => u.email !== user.email));
    }
  };

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading users…</div>
      </div>
    );
  }

  return (
    <>
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>All Users</h3>
          <button
            className="hub-btn hub-btn-primary"
            type="button"
            onClick={() => setAddOpen(true)}
          >
            <UserAddOutlined /> Add User
          </button>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">No users yet — add one to get started.</div>
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.email}>
                  <td>
                    <div className="hub-person">
                      <div className="hub-avatar" style={{ background: u.color }}>
                        {u.init}
                      </div>
                      {u.name}
                    </div>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <span className="hub-badge hub-badge-blue">
                      {u.role}{u.role === "Finance" && u.subRole ? ` · ${u.subRole}` : ""}
                    </span>
                  </td>
                  <td>
                    <span className={`hub-badge ${u.enabled ? "hub-badge-green" : "hub-badge-gray"}`}>
                      {u.enabled ? "Active — can log in" : "Disabled"}
                    </span>
                  </td>
                  <td>
                    <div className="hub-row" style={{ gap: 8, flexWrap: "nowrap" }}>
                      {!NO_EDIT_ROLES.includes(u.role) && (
                        <button type="button" className="hub-btn" onClick={() => setEditUserEmail(u.email)}>
                          <EditOutlined /> Edit
                        </button>
                      )}
                      <button type="button" className="hub-btn" onClick={() => setPermUserEmail(u.email)}>
                        <SafetyCertificateOutlined /> Permissions
                      </button>
                      <button
                        type="button"
                        className="hub-btn"
                        style={{ color: "#e11d48", borderColor: "#fecdd3" }}
                        onClick={() => deleteUser(u)}
                      >
                        <DeleteOutlined /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        teams={teams}
        onAdd={async (u, teamInfo) => {
          await loadUsers();
          onAssignTeam(u.name, teamInfo.teamChoice, teamInfo.newTeamName);
        }}
      />

      <EditUserModal
        open={!!editUserEmail}
        user={editUser}
        teams={teams}
        allUsers={users}
        onAssignTeam={onAssignTeam}
        onClose={() => setEditUserEmail(null)}
        onSave={saveUserEdit}
      />

      <UserPermissionsModal
        open={!!permUserEmail}
        user={permUser}
        onClose={() => setPermUserEmail(null)}
        onToggle={(mod, permType) => togglePermission(permUserEmail, mod, permType)}
        onReset={() => resetPermissions(permUserEmail)}
      />
    </>
  );
}

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
              className="hub-btn"
              style={
                selectedRole === role
                  ? { background: "#2563eb", borderColor: "#2563eb", color: "#fff" }
                  : {}
              }
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

const NEW_TEAM_COLORS = ["#2563EB", "#7C3AED", "#0891B2", "#D97706", "#E11D48", "#16A34A"];

export default function UserManagement() {
  const [tab, setTab] = useState("users");
  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

  // Teams are backed by the real `team` API (backend/src/models/appModels/Team.js).
  const loadTeams = async () => {
    const res = await request.listAll({ entity: "team" });
    setTeams(res?.success ? res.result : []);
    setTeamsLoading(false);
  };

  useEffect(() => {
    loadTeams();
  }, []);

  // Puts a user into an existing team, spins up a brand new team with them as
  // the lead, or removes them from teams entirely — first taking them out of
  // whichever team currently has them, so this works for both first-time
  // assignment (Add User) and moving someone to a different team later (Edit).
  const assignUserToTeam = async (userName, teamChoice, newTeamName) => {
    const currentTeam = teams.find((t) => t.members.includes(userName));

    if (currentTeam && currentTeam.name !== teamChoice) {
      await request.update({
        entity: "team",
        id: currentTeam._id,
        jsonData: { members: currentTeam.members.filter((m) => m !== userName) },
      });
    }

    if (teamChoice === NEW_TEAM) {
      if (newTeamName) {
        await request.create({
          entity: "team",
          jsonData: {
            name: newTeamName,
            lead: userName,
            members: [userName],
            color: NEW_TEAM_COLORS[teams.length % NEW_TEAM_COLORS.length],
          },
        });
      }
    } else if (teamChoice !== NO_TEAM && teamChoice) {
      const target = teams.find((t) => t.name === teamChoice);
      if (target && !target.members.includes(userName)) {
        await request.update({
          entity: "team",
          id: target._id,
          jsonData: { members: [...target.members, userName] },
        });
      }
    }

    await loadTeams();
  };

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
          { key: "deleted", label: "Deleted Users", icon: <UsergroupDeleteOutlined /> },
          { key: "roles", label: "Roles & Permissions", icon: <SafetyCertificateOutlined /> },
          { key: "teams", label: "Team Management", icon: <TeamOutlined /> },
          { key: "shifts", label: "Shift Management", icon: <ClockCircleOutlined /> },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "users" && <Users teams={teams} onAssignTeam={assignUserToTeam} />}
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