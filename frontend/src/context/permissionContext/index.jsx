import React, { createContext, useContext, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { request } from '@/request';
import { PERMISSION_MODULES, FULL_ACCESS_ROLES } from '@/config/permissionModules';
import { defaultMatrixForRole, fillMatrixDefaults } from '@/config/defaultPermissionMatrix';

const PermissionContext = createContext(null);

function emptyMatrix() {
  const m = {};
  PERMISSION_MODULES.forEach((mod) => {
    m[mod] = { view: false, edit: false, delete: false };
  });
  return m;
}

function fullAccessMatrix() {
  const m = {};
  PERMISSION_MODULES.forEach((mod) => {
    // Code Editor is carved out of the blanket full-access bypass below —
    // see fetchMatrix's FULL_ACCESS_ROLES branch, which overlays this one
    // module from a real Permission record instead of granting it here.
    m[mod] = mod === 'Code Editor' ? { view: false, edit: false, delete: false } : { view: true, edit: true, delete: true };
  });
  return m;
}

// Resolves the logged-in user's effective permission matrix: their own
// per-user override (Permission scope:'user', key:email) if one exists,
// otherwise their role's saved default (scope:'role', key:role), otherwise
// the role's computed default (seeded on the fly — see below).
export function PermissionProvider({ children }) {
  const current = useSelector(selectCurrentAdmin);
  const [matrix, setMatrix] = useState(emptyMatrix);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!current?.role) {
        if (!cancelled) {
          setMatrix(emptyMatrix());
          setLoading(false);
        }
        return;
      }

      if (FULL_ACCESS_ROLES.includes(current.role)) {
        setLoading(true);
        // Full-access roles still bypass every module EXCEPT Code Editor —
        // that one requires an explicit grant even for owner/Admin (it opens
        // a real VS Code session on this CRM's own source), so look up a
        // real Permission record just for it instead of short-circuiting.
        const res = await request.listAll({ entity: 'permission' });
        const all = res?.success ? res.result : [];
        const userRecord = all.find((p) => p.scope === 'user' && p.key === current.email);
        const roleRecord = all.find((p) => p.scope === 'role' && p.key === current.role);
        const codeEditorGrant =
          userRecord?.matrix?.['Code Editor'] || roleRecord?.matrix?.['Code Editor'] || {
            view: false,
            edit: false,
            delete: false,
          };
        if (!cancelled) {
          setMatrix({ ...fullAccessMatrix(), 'Code Editor': codeEditorGrant });
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const res = await request.listAll({ entity: 'permission' });
      const all = res?.success ? res.result : [];

      const userRecord = all.find((p) => p.scope === 'user' && p.key === current.email);
      const roleRecord = all.find((p) => p.scope === 'role' && p.key === current.role);
      const found = userRecord || roleRecord;

      if (found) {
        // A module added after this record was first saved (e.g. Finance,
        // Support) is missing from it — backfill so canView() sees it too.
        const { matrix: filled, changed } = fillMatrixDefaults(found.matrix, current.role);
        if (!cancelled) {
          setMatrix(filled);
          setLoading(false);
        }
        if (changed) {
          request.update({ entity: 'permission', id: found._id, jsonData: { matrix: filled } });
        }
        return;
      }

      // No admin has ever seeded this role's defaults (e.g. a brand-new user
      // logging in before anyone opened Roles & Permissions) — compute them
      // now so this user sees their role's real permissions, not nothing,
      // and save it so it's there next time too.
      const computed = defaultMatrixForRole(current.role);
      if (!cancelled) {
        setMatrix(computed);
        setLoading(false);
      }
      request.create({ entity: 'permission', jsonData: { scope: 'role', key: current.role, matrix: computed } });
    })();

    return () => {
      cancelled = true;
    };
  }, [current?.email, current?.role]);

  const canView = (moduleName) => matrix?.[moduleName]?.view ?? false;
  const canEdit = (moduleName) => matrix?.[moduleName]?.edit ?? false;
  const canDelete = (moduleName) => matrix?.[moduleName]?.delete ?? false;

  return (
    <PermissionContext.Provider value={{ matrix, loading, role: current?.role, canView, canEdit, canDelete }}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermission() {
  const ctx = useContext(PermissionContext);
  if (!ctx) {
    throw new Error('usePermission must be used within a PermissionProvider');
  }
  return ctx;
}
