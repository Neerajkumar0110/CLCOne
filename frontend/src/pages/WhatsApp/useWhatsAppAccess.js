import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { getSocket } from '@/socket';
import waApi from './api';

// Does the logged-in user get WhatsApp? Drives the sidebar item and the page.
// Re-checks when an admin saves the Access screen (socket 'whatsapp:access').
export default function useWhatsAppAccess() {
  const current = useSelector(selectCurrentAdmin);
  const [state, setState] = useState({ loading: true, hasAccess: false, isAdmin: false, configured: false, device: null });

  useEffect(() => {
    if (!current?._id) {
      setState({ loading: false, hasAccess: false, isAdmin: false, configured: false, device: null });
      return undefined;
    }
    let alive = true;
    const load = async () => {
      const res = await waApi.me();
      if (!alive) return;
      if (res?.success) setState({ loading: false, ...res.result });
      else setState((s) => ({ ...s, loading: false }));
    };
    load();
    const socket = getSocket();
    socket?.on('whatsapp:access', load);
    return () => {
      alive = false;
      socket?.off('whatsapp:access', load);
    };
  }, [current?._id]);

  return state;
}
