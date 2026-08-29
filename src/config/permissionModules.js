// Single source of truth for the permission system — shared between
// UserManagement (Roles & Permissions / per-user Permissions), the
// PermissionProvider (frontend/src/context/permissionContext), the sidebar
// (NavigationContainer.jsx) and route guards (router/routes.jsx).
//
// Mirrors the sidebar nav tabs — everything except Payment Mode, Taxes and Quote.
export const PERMISSION_MODULES = [
  'Dashboard',
  'Customer',
  'Calls',
  'Performance',
  'Leads',
  'Invoices',
  'Payments',
  'Reports',
  'User Management',
  'Communication',
  'Finance',
  'Settings',
  'About',
  'Support',
  'Git Management',
  'Vercel Management',
];

// The module list a ticket can be raised against — every module except
// Support itself (that's the ticketing feature, not something to file a
// ticket "about"). Single source of truth for the category dropdown
// (components/NewTicketModal) and the per-module tabs on the Support page.
export const TICKET_CATEGORY_MODULES = PERMISSION_MODULES.filter((m) => m !== 'Support');

// Maps a permission module name to the sidebar nav item key (NavigationContainer.jsx).
export const MODULE_NAV_KEY = {
  Dashboard: 'dashboard',
  Customer: 'customer',
  Calls: 'calls',
  Performance: 'performance',
  Leads: 'leads',
  Invoices: 'invoice',
  Payments: 'payment',
  Reports: 'reports',
  'User Management': 'user-management',
  Communication: 'communication',
  Finance: 'finance',
  Settings: 'generalSettings',
  About: 'about',
  Support: 'support',
  'Git Management': 'git-management',
  'Vercel Management': 'vercel-management',
};

// Roles that bypass the permission matrix entirely and always see every module.
// 'owner' is the account created by the initial backend setup script.
export const FULL_ACCESS_ROLES = ['owner', 'Super Admin', 'Admin', 'Sales Manager'];
