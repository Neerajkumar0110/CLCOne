import { createContext, useContext } from 'react';

// Employee Portal shared state (today's attendance, reload, logout) — its own
// module so pages don't import the layout file (no circular import).
export const PortalCtx = createContext(null);
export const usePortal = () => useContext(PortalCtx) || {};
