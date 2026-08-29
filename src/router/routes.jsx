import { lazy } from 'react';

import { Navigate } from 'react-router-dom';
import RequirePermission from './RequirePermission';

const Logout = lazy(() => import('@/pages/Logout.jsx'));
const NotFound = lazy(() => import('@/pages/NotFound.jsx'));

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Customer = lazy(() => import('@/pages/Customer'));
const Invoice = lazy(() => import('@/pages/Invoice'));


const Payment = lazy(() => import('@/pages/Payment/index'));

const Settings = lazy(() => import('@/pages/Settings/Settings'));
const Calls = lazy(() => import('@/pages/Calls'));

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
    {
      path: '/customer',
      element: (
        <RequirePermission module="Customer">
          <Customer />
        </RequirePermission>
      ),
    },
{
  path: '/calls',
  element: (
    <RequirePermission module="Calls">
      <Calls />
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
        <RequirePermission module="Leads">
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
    {
      path: '*',
      element: <NotFound />,
    },
  ],
};

export default routes;
