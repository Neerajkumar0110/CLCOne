import { usePermission } from '@/context/permissionContext';

// Guards a routed page behind the logged-in user's permission matrix.
// Renders nothing while permissions are still loading (avoids a flash of the
// "restricted" message for users who actually do have access), and a plain
// inline message on denial — never a redirect, so a Dashboard-denied user
// can't end up in a redirect loop back to "/".
export default function RequirePermission({ module, children }) {
  const { canView, loading } = usePermission();

  if (loading) return null;

  if (!canView(module)) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#667085' }}>
        <h2 style={{ color: '#101828', marginBottom: 8 }}>Access Restricted</h2>
        <p>You don't have permission to view this page. Contact your administrator if you think this is a mistake.</p>
      </div>
    );
  }

  return children;
}
