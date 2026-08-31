// Single source of truth for the permission system — shared between
// UserManagement (Roles & Permissions / per-user Permissions), the
// PermissionProvider (frontend/src/context/permissionContext), the sidebar
// (NavigationContainer.jsx) and route guards (router/routes.jsx).
//
// Mirrors the sidebar nav tabs — everything except Payment Mode, Taxes and Quote.
export const PERMISSION_MODULES = [
  // Overview
  'Dashboard',
  // Business sections (expandable sidebar submenus — see config/featureSections.js).
  // One permission module gates the whole section and all its scaffold sub-modules.
  'Sales',
  'Marketing',
  'Operations',
  'LMS',
  'HR',
  'Messenger',
  // Sales pipeline
  'Leads',
  'Customer',
  'Calls',
  'Communication',
  // Analytics
  'Performance',
  'Reports',
  // Billing & finance
  'Invoices',
  'Payments',
  'Finance',
  // Administration
  'User Management',
  'Support',
  'Git Management',
  'Vercel Management',
  'Settings',
  'About',
];

// The module list a ticket can be raised against — every module except
// Support itself (that's the ticketing feature, not something to file a
// ticket "about"). Single source of truth for the category dropdown
// (components/NewTicketModal) and the per-module tabs on the Support page.
export const TICKET_CATEGORY_MODULES = PERMISSION_MODULES.filter((m) => m !== 'Support');

// Maps a permission module name to the sidebar nav item key (NavigationContainer.jsx).
export const MODULE_NAV_KEY = {
  Dashboard: 'dashboard',
  Sales: 'sales',
  Marketing: 'marketing',
  Operations: 'operations',
  LMS: 'lms',
  HR: 'hr',
  Messenger: 'messenger',
  Leads: 'leads',
  Customer: 'customer',
  Calls: 'calls',
  Communication: 'communication',
  Performance: 'performance',
  Reports: 'reports',
  Invoices: 'invoice',
  Payments: 'payment',
  Finance: 'finance',
  'User Management': 'user-management',
  Support: 'support',
  'Git Management': 'git-management',
  'Vercel Management': 'vercel-management',
  Settings: 'generalSettings',
  About: 'about',
};

// Roles that bypass the permission matrix entirely and always see every module.
// 'owner' is the account created by the initial backend setup script.
export const FULL_ACCESS_ROLES = ['owner', 'Super Admin', 'Admin', 'Sales Manager'];
