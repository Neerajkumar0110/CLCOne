import { lazy } from 'react';

import { Navigate } from 'react-router-dom';
import RequirePermission from './RequirePermission';
import { FEATURE_SECTIONS, FEATURE_ROUTES } from '@/config/featureSections';

const SectionHub = lazy(() => import('@/pages/ModuleScaffold'));

// One route per sub-tab (/sales/deals, /hr/leave, …) — the sidebar submenu
// links straight to these. Plus a /<section> → first-tab redirect. Every
// route is gated behind its section's permission module.
const featureRoutes = [
  ...FEATURE_SECTIONS.map((section) => ({
    path: section.route,
    element: <Navigate to={`${section.route}/${section.tabs[0].key}`} replace />,
  })),
  ...FEATURE_ROUTES.map(({ path, section, tab }) => ({
    path,
    element: (
      <RequirePermission module={section.module}>
        <SectionHub section={section} tab={tab} />
      </RequirePermission>
    ),
  })),
];

const Logout = lazy(() => import('@/pages/Logout.jsx'));
const NotFound = lazy(() => import('@/pages/NotFound.jsx'));

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Customer = lazy(() => import('@/pages/Customer'));
const Invoice = lazy(() => import('@/pages/Invoice'));


const Payment = lazy(() => import('@/pages/Payment/index'));

const Settings = lazy(() => import('@/pages/Settings/Settings'));
const Calls = lazy(() => import('@/pages/Calls'));
const Calling = lazy(() => import('@/pages/Calling'));

const Performance = lazy(() => import('@/pages/Performance'));
const Leads = lazy(() => import('@/pages/Leads'));
const Reports = lazy(() => import('@/pages/Reports'));
const UserManagement = lazy(() => import('@/pages/UserManagement'));
const Communication = lazy(() => import('@/pages/Communication'));
const Finance = lazy(() => import('@/pages/Finance'));
const Support = lazy(() => import('@/pages/Support'));
const GitManagement = lazy(() => import('@/pages/GitManagement'));
const VercelManagement = lazy(() => import('@/pages/VercelManagement'));

const Profile = lazy(() => import('@/pages/Profile'));

const About = lazy(() => import('@/pages/About'));

let routes = {
  expense: [],
  default: [
    {
      path: '/login',
      element: <Navigate to="/" />,
    },
    {
      path: '/logout',
      element: <Logout />,
    },
    {
      path: '/about',
      element: (
        <RequirePermission module="About">
          <About />
        </RequirePermission>
      ),
    },
    {
      path: '/',
      element: (
        <RequirePermission module="Dashboard">
          <Dashboard />
        </RequirePermission>
      ),
    },
    // Leads / Customers / Calls moved under Sales (rendered as sub-tabs at
    // /sales/*). These top-level paths stay for old links; all gated by Sales.
    {
      path: '/customer',
      element: (
        <RequirePermission module="Sales">
          <Customer />
        </RequirePermission>
      ),
    },
    {
      path: '/calls',
      element: (
        <RequirePermission module="Sales">
          <Calls />
        </RequirePermission>
      ),
    },
    {
      path: '/calling',
      element: (
        <RequirePermission module="Calling">
          <Calling />
        </RequirePermission>
      ),
    },
    {
      path: '/performance',
      element: (
        <RequirePermission module="Performance">
          <Performance />
        </RequirePermission>
      ),
    },
    {
      path: '/leads',
      element: (
        <RequirePermission module="Sales">
          <Leads />
        </RequirePermission>
      ),
    },
    {
      path: '/reports',
      element: (
        <RequirePermission module="Reports">
          <Reports />
        </RequirePermission>
      ),
    },
    {
      path: '/user-management',
      element: (
        <RequirePermission module="User Management">
          <UserManagement />
        </RequirePermission>
      ),
    },
    {
      path: '/communication',
      element: (
        <RequirePermission module="Communication">
          <Communication />
        </RequirePermission>
      ),
    },
    {
      path: '/finance',
      element: (
        <RequirePermission module="Finance">
          <Finance />
        </RequirePermission>
      ),
    },
    {
      path: '/support',
      element: (
        <RequirePermission module="Support">
          <Support />
        </RequirePermission>
      ),
    },
    {
      path: '/git-management',
      element: (
        <RequirePermission module="Git Management">
          <GitManagement />
        </RequirePermission>
      ),
    },
    {
      path: '/vercel-management',
      element: (
        <RequirePermission module="Vercel Management">
          <VercelManagement />
        </RequirePermission>
      ),
    },
    {
      path: '/invoice',
      element: (
        <RequirePermission module="Invoices">
          <Invoice />
        </RequirePermission>
      ),
    },
    // {
    //   path: '/quote',
    //   element: <Quote />,
    // },
    // {
    //   path: '/quote/create',
    //   element: <QuoteCreate />,
    // },
    // {
    //   path: '/quote/read/:id',
    //   element: <QuoteRead />,
    // },
    // {
    //   path: '/quote/update/:id',
    //   element: <QuoteUpdate />,
    // },
    {
      path: '/payment',
      element: (
        <RequirePermission module="Payments">
          <Payment />
        </RequirePermission>
      ),
    },

    {
      path: '/settings',
      element: (
        <RequirePermission module="Settings">
          <Settings />
        </RequirePermission>
      ),
    },
    {
      path: '/settings/edit/:settingsKey',
      element: (
        <RequirePermission module="Settings">
          <Settings />
        </RequirePermission>
      ),
    },
    // {
    //   path: '/payment/mode',
    //   element: <PaymentMode />,
    // },
    // {
    //   path: '/taxes',
    //   element: <Taxes />,
    // },

    {
      path: '/profile',
      element: <Profile />,
    },

    ...featureRoutes,

    {
      path: '*',
      element: <NotFound />,
    },
  ],
};

export default routes;
