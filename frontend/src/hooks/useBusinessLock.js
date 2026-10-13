import { useEffect, useState } from 'react';
import { request } from '@/request';

// The B2B / B2C segment this user is locked to on dashboards ('B2B' | 'B2C'),
// or null when they see everything (Owner/Super Admin/Admin, or no Business
// Segment set). Asked from the server rather than read from the login
// payload, so a segment changed in User Management applies without
// re-login. The server enforces the same lock on every dashboard read
// (services/access/businessScope.js) — this only hides the controls.
export default function useBusinessLock() {
  const [locked, setLocked] = useState(null);
  useEffect(() => {
    let alive = true;
    request
      .get({ entity: 'business-scope' })
      .then((r) => alive && setLocked((r && r.success && r.result && r.result.locked) || null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return locked;
}
