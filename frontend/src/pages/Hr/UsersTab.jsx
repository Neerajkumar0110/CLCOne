import React, { useState } from "react";
import { useSelector } from "react-redux";
import Users, { roles, useTeams } from "@/pages/UserManagement/Users";
import { selectCurrentAdmin } from "@/redux/auth/selectors";

// Who is allowed to create a user from here mirrors the backend's own gate —
// STAFF_CREATOR_ROLES in backend/src/config/roles.js — so this is display-only:
// even if someone bypassed this check, POST /api/admin/create would still
// reject them. Kept in sync by hand, same as the rest of roles.js.
const CAN_CREATE_ROLES = ["owner", "Super Admin", "Admin"];

// HRMS' own "Users" tab never shows or creates Admin/Super Admin/owner
// accounts — those stay managed from Settings → User Management only.
// "roles" (from @/config/roles) already excludes owner/Super Admin (they're
// never selectable anywhere), so only "Admin" needs stripping out here.
const HR_EXCLUDED_ROLES = ["owner", "Super Admin", "Admin"];
const hrRoleOptions = roles.filter((r) => r !== "Admin");

// HRMS' own "Users" tab — same login-account list and the same Add User flow
// as Settings → User Management, just reachable without leaving HRMS.
// Admin/Super Admin/owner accounts are hidden here entirely (list and Add
// User's role picker both exclude them); everyone else who can see this tab
// gets the list plus a role filter, but (per HR's request) only owner/Super
// Admin/Admin get the "Add User" button.
export default function HrUsersTab() {
  const current = useSelector(selectCurrentAdmin);
  const { teams, assignUserToTeam } = useTeams();
  const [roleFilter, setRoleFilter] = useState("");

  const canCreate = !!current && CAN_CREATE_ROLES.includes(current.role);

  return (
    <div className="hub-stack">
      <div className="hub-card" style={{ padding: "14px 20px" }}>
        <div className="hub-form-row" style={{ maxWidth: 260, margin: 0 }}>
          <label>Filter by role</label>
          <select className="hub-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {hrRoleOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      <Users
        teams={teams}
        onAssignTeam={assignUserToTeam}
        roleFilter={roleFilter || undefined}
        canCreate={canCreate}
        excludeRoles={HR_EXCLUDED_ROLES}
        roleOptions={hrRoleOptions}
      />
    </div>
  );
}
