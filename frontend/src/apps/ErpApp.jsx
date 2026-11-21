import { useLayoutEffect } from 'react';
import { useEffect } from 'react';
import { selectAppSettings } from '@/redux/settings/selectors';
import { useDispatch, useSelector } from 'react-redux';

import { Layout } from 'antd';

import { useAppContext } from '@/context/appContext';

import Navigation from '@/apps/Navigation/NavigationContainer';

import HeaderContent from '@/apps/Header/HeaderContainer';
import PageLoader from '@/components/PageLoader';

import { settingsAction } from '@/redux/settings/actions';

import { selectSettings } from '@/redux/settings/selectors';

import AppRouter from '@/router/AppRouter';
import useResponsive from '@/hooks/useResponsive';
import storePersist from '@/redux/storePersist';
import ActiveCallModal from '@/components/ActiveCallModal';
import InstantLeadAlert from '@/components/InstantLeadAlert';
import BrowserPhone from '@/components/BrowserPhone';
import useActivityTracker from '@/hooks/useActivityTracker';
import usePhoneTab from '@/hooks/usePhoneTab';
import { lazy, Suspense } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { usePermission } from '@/context/permissionContext';
import { DEPARTMENT_ROLES } from '@/config/roles';
const SalesV3 = lazy(() => import('@/pages/SalesV3'));

// Sales agents use only the new Sales design (user ask 2026-11-20): any old Sales /
// Calls page sends them to the same screen in /sales-v3. Management keeps both.
const SALES_MANAGEMENT = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Team Manager'];
const V3_SALES = { dashboard: 'dashboard', leads: 'leads', 'team-360': 'team', payments: 'payments', pipeline: 'pipeline', deals: 'deals', quotes: 'quotes', customers: 'candidates' };
const V3_CALLS = { dashboard: 'callsdash', dial: 'dialer', campaigns: 'campaigns', dialer: 'auto', agent: 'agent', history: 'history', callbacks: 'callbacks', recordings: 'recordings', reports: 'reports', demos: 'demos' };
function v3Path(pathname, search) {
  if (pathname === '/sales' || pathname.startsWith('/sales/')) return `/sales-v3/${V3_SALES[pathname.split('/')[2]] || 'dashboard'}`;
  if (pathname === '/calling' || pathname.startsWith('/calling/')) return `/sales-v3/${V3_CALLS[new URLSearchParams(search).get('tab')] || 'auto'}`;
  return null;
}

export default function ErpCrmApp() {
  const { Content } = Layout;

  const { state: stateApp } = useAppContext();
  const { isNavMenuClose } = stateApp;

  const { isMobile } = useResponsive();

  const dispatch = useDispatch();

  useLayoutEffect(() => {
    dispatch(settingsAction.list({ entity: 'setting' }));
  }, []);

  // const appSettings = useSelector(selectAppSettings);

  const { isSuccess: settingIsloaded } = useSelector(selectSettings);

  // useEffect(() => {
  //   const { loadDefaultLang } = storePersist.get('firstVisit');
  //   if (appSettings.idurar_app_language && !loadDefaultLang) {
  //     window.localStorage.setItem('firstVisit', JSON.stringify({ loadDefaultLang: true }));
  //   }
  // }, [appSettings]);

  const sidebarGap = isNavMenuClose ? 80 : 256;
  // /sales-v3 = Sales One Place (v3 design): its own sidebar, no CRM chrome.
  const { pathname, search } = useLocation();
  const { canView, role } = usePermission();
  // Every Sales user's screens / clicks / idle time — Sales roles only: POST
  // /workday/track is salesOnly, so it answered 403 to admins on every send.
  useActivityTracker(DEPARTMENT_ROLES.Sales.includes(role));
  const salesAgent =canView('Sales') && !SALES_MANAGEMENT.includes(role);
  const v3Target = salesAgent ? v3Path(pathname, search) : null;
  const isSalesV3 = pathname === '/sales-v3' || pathname.startsWith('/sales-v3/');
  // Only one tab (CRM or Sales One Place) runs the phone + call popups.
  const phoneTab = usePhoneTab();
  const phone = phoneTab ? (
    <>
      <ActiveCallModal />
      <InstantLeadAlert />
      <BrowserPhone />
    </>
  ) : null;

  if (settingIsloaded && v3Target) return <Navigate to={v3Target} replace />;
  // Sales agents: the new Sales screens inside the normal CRM layout (CRM sidebar + header).
  const inCrmV3 = isSalesV3 && salesAgent;
  if (settingIsloaded && isSalesV3 && !inCrmV3)
    return (
      <Suspense fallback={<PageLoader />}>
        {phone}
        <SalesV3 />
      </Suspense>
    );
  if (settingIsloaded)
    return (
      <Layout hasSider>
        {/* Fixed overlay, rendered once outside the routed Content so a live
            call follows the agent across every page (and stays up as a
            floating pill while they work elsewhere in the CRM). */}
        {phone}

        <Navigation />

        {isMobile ? (
          <Layout
            style={{
              marginLeft: 0,
              height: '100vh',
              overflowY: 'auto',
            }}
          >
            <HeaderContent />
            <Content
              style={{
                margin: '10px',
                overflow: 'initial',
                width: 'calc(100% - 20px)',
                padding: 0,
                maxWidth: 'none',
              }}
            >
              {inCrmV3 ? (
                <Suspense fallback={<PageLoader />}>
                  <SalesV3 embedded />
                </Suspense>
              ) : (
                <AppRouter />
              )}
            </Content>
          </Layout>
        ) : (
          <Layout
            style={{
              marginLeft: sidebarGap,
              height: '100vh',
              overflowY: 'auto',
              transition: 'margin-left 0.3s ease-in-out',
            }}
          >
            <HeaderContent />
            <Content
              style={{
                margin: '10px',
                overflow: 'initial',
                width: 'calc(100% - 20px)',
                padding: 0,
                maxWidth: 'none',
              }}
            >
              {inCrmV3 ? (
                <Suspense fallback={<PageLoader />}>
                  <SalesV3 embedded />
                </Suspense>
              ) : (
                <AppRouter />
              )}
            </Content>
          </Layout>
        )}
      </Layout>
    );
  else return <PageLoader />;
}