import React, { useEffect, useState } from "react";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import {
  SafetyCertificateOutlined,
  ReloadOutlined,
  UserAddOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { PERMISSION_MODULES } from "@/config/permissionModules";
import { buildDefaultMatrix, fillMatrixDefaults } from "@/config/defaultPermissionMatrix";
import {
  ROLES,
  KNOWN_NON_SELECTABLE_ROLES,
  FINANCE_SUB_ROLES,
  DEPARTMENT_ROLES,
  ROLE_DEPARTMENT,
  MANAGER_TEAM_ROLES,
  NO_TEAM_FIELD_ROLES,
  NO_EDIT_ROLES,
  BELOW_TEAM_MANAGER_ROLES,
  ROLE_ALIASES,
  DEFAULT_FALLBACK_ROLE,
} from "@/config/roles";

// Shared by UserManagement (Settings) and the HRMS "Users" tab — same
// creation flow (POST /api/admin/create) and the same list, just mounted in
// two places so HR doesn't have to leave the HRMS module to add someone.

const AVATAR_COLORS = ["#2563EB", "#722ED1", "#13C2C2", "#FA8C16", "#EB2F96", "#52C41A"];

export function initialsOf(name) {
  return name.trim().split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

export function colorFor(email) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export const roles = ROLES;

// Given whatever role list a modal is allowed to offer (HR's tab excludes
// "Admin", most callers get the full list), groups it into
// { Department: [roles...] } — a department only appears if at least one of
// its roles survived the filter. Shared by AddUserModal/EditUserModal below.
function departmentsFor(roleOptions) {
  const allowed = new Set(roleOptions);
  const out = {};
  for (const [dept, list] of Object.entries(DEPARTMENT_ROLES)) {
    const filtered = list.filter((r) => allowed.has(r));
    if (filtered.length) out[dept] = filtered;
  }
  return out;
}

// Same module list the sidebar and route guards use — kept in one shared file
// (frontend/src/config/permissionModules.js) so they can never drift apart.
export const modules = PERMISSION_MODULES;

// Includes the non-selectable Super Admin/owner tier too, so a matrix entry
// always exists for whatever role a loaded user actually has.
const matrixRoles = [...KNOWN_NON_SELECTABLE_ROLES, ...roles];

export function defaultMatrix() {
  return buildDefaultMatrix(matrixRoles);
}

// Backed by the real `permission` API (backend/src/models/appModels/Permission.js).
// scope: 'role' rows are the shared defaults, 'user' rows override a single person.
export async function fetchPermissionRecords(scope) {
  const res = await request.listAll({ entity: "permission" });
  const all = res?.success ? res.result : [];
  return all.filter((p) => p.scope === scope);
}

export async function savePermissionRecord({ id, scope, key, matrix }) {
  if (id) {
    return request.update({ entity: "permission", id, jsonData: { matrix } });
  }
  return request.create({ entity: "permission", jsonData: { scope, key, matrix } });
}

export const NO_TEAM = "__none__";
export const NEW_TEAM = "__new__";

export const NEW_TEAM_COLORS = ["#2563EB", "#7C3AED", "#0891B2", "#D97706", "#E11D48", "#16A34A"];

// Teams are backed by the real `team` API (backend/src/models/appModels/Team.js).
// Shared by UserManagement (Settings) and the HRMS "Users" tab so both can
// add someone to a team from their own Add/Edit User modal.
export function useTeams() {
  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

  const loadTeams = async () => {
    const res = await request.listAll({ entity: "team" });
    setTeams(res?.success ? res.result : []);
    setTeamsLoading(false);
  };

  useEffect(() => {
    loadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return { teams, teamsLoading, loadTeams, assignUserToTeam };
}

function AddUserModal({ open, onClose, onAdd, teams, initialRole, roleOptions = roles }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Defaults to the lowest-privilege role — Super Admin/Admin creation is
  // gated server-side to Super Admin requesters, so it shouldn't be the
  // default pick — unless opened from a role-filtered tab (e.g. Students),
  // which pins it to that role instead.
  const [role, setRole] = useState(initialRole || "Executive");
  const depts = departmentsFor(roleOptions);
  const [department, setDepartment] = useState(() => {
    const d = ROLE_DEPARTMENT[initialRole || "Executive"];
    return depts[d] ? d : Object.keys(depts)[0];
  });
  const [subRole, setSubRole] = useState(FINANCE_SUB_ROLES[0]);
  const [teamChoice, setTeamChoice] = useState(NO_TEAM);
  const [newTeamName, setNewTeamName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Only roles that lead a team get to spin up a brand new one here.
  const isManagerRole = MANAGER_TEAM_ROLES.includes(role);

  useEffect(() => {
    if (open) {
      const r = initialRole || "Executive";
      const d = ROLE_DEPARTMENT[r];
      setRole(r);
      setDepartment(depts[d] ? d : Object.keys(depts)[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRole]);

  useEffect(() => {
    if (NO_TEAM_FIELD_ROLES.includes(role) || (!isManagerRole && teamChoice === NEW_TEAM)) {
      setTeamChoice(NO_TEAM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Picking a Department auto-selects its first Position — for a
  // single-role department (Support, Admin) that's the only choice anyway,
  // so no separate Position dropdown even needs to show.
  const onDepartmentChange = (d) => {
    setDepartment(d);
    setRole((depts[d] || [])[0] || role);
  };

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
    // (OTP-only), so no password is collected here. Who is actually allowed
    // to create a user of the chosen role is enforced server-side (see
    // backend/src/controllers/middlewaresControllers/createUserController/create.js),
    // so a rejected request surfaces here as formError rather than silently succeeding.
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
        <label>Department</label>
        <select className="hub-select" value={department} onChange={(e) => onDepartmentChange(e.target.value)}>
          {Object.keys(depts).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {(depts[department] || []).length > 1 && (
        <div className="hub-form-row">
          <label>Position</label>
          <select className="hub-select" value={role} onChange={(e) => setRole(e.target.value)}>
            {depts[department].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

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
function EditUserModal({ open, onClose, onSave, user, teams, allUsers, onAssignTeam, roleOptions = roles }) {
  const [role, setRole] = useState(roles[0]);
  const depts = departmentsFor(roleOptions);
  const [department, setDepartment] = useState(Object.keys(depts)[0]);
  const [subRole, setSubRole] = useState(FINANCE_SUB_ROLES[0]);
  const [teamChoice, setTeamChoice] = useState(NO_TEAM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [assignEmail, setAssignEmail] = useState("");
  const [assignedNote, setAssignedNote] = useState("");

  useEffect(() => {
    if (!user) return;
    setRole(user.role);
    const d = ROLE_DEPARTMENT[user.role];
    setDepartment(depts[d] ? d : Object.keys(depts)[0]);
    setSubRole(user.subRole || FINANCE_SUB_ROLES[0]);
    const currentTeam = teams.find((t) => t.members.includes(user.name));
    setTeamChoice(currentTeam ? currentTeam.name : NO_TEAM);
    setFormError("");
    setAssignEmail("");
    setAssignedNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, open]);

  if (!open || !user) return null;

  const onDepartmentChange = (d) => {
    setDepartment(d);
    setRole((depts[d] || [])[0] || role);
  };

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
        <label>Department</label>
        {isProtectedRole ? (
          <>
            <div className="hub-input" style={{ background: "#f5f5f5", color: "#8c8c8c" }}>{user.role}</div>
            <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>
              Super Admin's role can't be changed here.
            </span>
          </>
        ) : (
          <select className="hub-select" value={department} onChange={(e) => onDepartmentChange(e.target.value)}>
            {Object.keys(depts).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </div>

      {!isProtectedRole && (depts[department] || []).length > 1 && (
        <div className="hub-form-row">
          <label>Position</label>
          <select className="hub-select" value={role} onChange={(e) => setRole(e.target.value)}>
            {depts[department].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      {!isProtectedRole && role !== user.role && (
        <div className="hub-form-row">
          <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>
            Their permissions will reset to the "{role}" role's default.
          </span>
        </div>
      )}

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

// canCreate controls only the "Add User" button — who is actually allowed to
// create a user of a given role is enforced server-side regardless of this
// flag (see AddUserModal's comment above); this just keeps the button from
// being offered to people the backend would reject anyway.
export default function Users({ teams, onAssignTeam, roleFilter, canCreate = true, excludeRoles, roleOptions }) {
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

  const visibleUsers = users
    .filter((u) => !roleFilter || u.role === roleFilter)
    .filter((u) => !excludeRoles || !excludeRoles.includes(u.role));

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
          <h3>{roleFilter ? `${roleFilter}s` : "All Users"}</h3>
          {canCreate && (
            <button
              className="hub-btn hub-btn-primary"
              type="button"
              onClick={() => setAddOpen(true)}
            >
              <UserAddOutlined /> Add {roleFilter || "User"}
            </button>
          )}
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
              {visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">
                      {roleFilter === "Student"
                        ? "No students yet — students added from the LMS Students tab show up here automatically, or add one directly."
                        : roleFilter
                        ? `No ${roleFilter.toLowerCase()}s yet — add one to get started.`
                        : "No users yet — add one to get started."}
                    </div>
                  </td>
                </tr>
              )}
              {visibleUsers.map((u) => (
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

      {canCreate && (
        <AddUserModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          teams={teams}
          initialRole={roleFilter}
          roleOptions={roleOptions}
          onAdd={async (u, teamInfo) => {
            await loadUsers();
            onAssignTeam(u.name, teamInfo.teamChoice, teamInfo.newTeamName);
          }}
        />
      )}

      <EditUserModal
        open={!!editUserEmail}
        user={editUser}
        teams={teams}
        allUsers={users}
        onAssignTeam={onAssignTeam}
        onClose={() => setEditUserEmail(null)}
        onSave={saveUserEdit}
        roleOptions={roleOptions}
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
