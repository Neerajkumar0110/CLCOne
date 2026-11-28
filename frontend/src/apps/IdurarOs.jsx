import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { useSelector } from 'react-redux';
import { selectAuth, selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_PANEL_ROLES } from '@/config/roles';
import { AppContextProvider } from '@/context/appContext';
import { TicketsProvider } from '@/context/ticketsContext';
import { SocketProvider } from '@/context/socketContext';
import { MessagesProvider } from '@/context/messagesContext';
import { NotificationsProvider } from '@/context/notificationsContext';
import { PermissionProvider } from '@/context/permissionContext';
import PageLoader from '@/components/PageLoader';
import AuthRouter from '@/router/AuthRouter';
import Localization from '@/locale/Localization';
import { notification } from 'antd';

const ErpApp = lazy(() => import('./ErpApp'));
const LmsPanelApp = lazy(() => import('./LmsPanelApp'));
// Attendance ERP — the Employee Portal (/employee/*), its own layout.
const EmployeePortal = lazy(() => import('@/pages/AttendanceErp/portal/EmployeePortal'));
// Public post-payment KYC form (/kyc/:token) — reached by a student straight
// off the payment email/QR, never through a CRM login. Bypasses the
// isLoggedIn branch below entirely, the one architectural spot that can
// render something regardless of auth state.
const PublicKycForm = lazy(() => import('@/pages/Payments/PublicKycForm'));
const VerifyCertificate = lazy(() => import('@/pages/Lms/VerifyCertificate'));
const FinanceKycForm = lazy(() => import('@/pages/Payments/FinanceKycForm'));
const PublicProfile = lazy(() => import('@/pages/Lms/Growth/PublicProfile'));
const Verify360Page = lazy(() => import('@/pages/Lms/Growth/PublicProfile').then((m) => ({ default: m.Verify360 })));

const DefaultApp = () => {
  const current = useSelector(selectCurrentAdmin);
  const location = useLocation();
  // Teacher / Student accounts get their own LMS panel — never the CRM shell.
  const isLmsPanel = !!current && LMS_PANEL_ROLES.includes(current.role);
  // /employee is the Employee Portal for anyone signed in — Candidates / Teachers
  // sent the ERP login email too (the portal itself checks access).
  const isEmployeePortal = location.pathname.startsWith('/employee');
  // Attendance ERP: presence heartbeat (mouse / keyboard used yes-no only)
  // from every CRM and portal tab of a staff account.
  // Staff roles may be in the ERP (Sales always; others once sent the ERP login
  // email). The tracker stops itself when the server says this user isn't tracked.
  const erpTracked = !!current && !['owner', 'Super Admin'].includes(current.role);
  useEffect(() => {
    if (erpTracked) import('@/pages/AttendanceErp/tracker').then((m) => m.startErpTracker()).catch(() => {});
  }, [erpTracked]);

  return (
    <Localization>
      <AppContextProvider>
        <PermissionProvider>
          <SocketProvider>
            <MessagesProvider>
              <NotificationsProvider>
                <TicketsProvider>
                  <Suspense fallback={<PageLoader />}>
                    {isEmployeePortal ? (
                      <Routes>
                        <Route path="/employee/*" element={<EmployeePortal />} />
                      </Routes>
                    ) : isLmsPanel ? (
                      <LmsPanelApp />
                    ) : (
                      <ErpApp />
                    )}
                  </Suspense>
                </TicketsProvider>
              </NotificationsProvider>
            </MessagesProvider>
          </SocketProvider>
        </PermissionProvider>
      </AppContextProvider>
    </Localization>
  );
};

export default function IdurarOs() {
  const { isLoggedIn } = useSelector(selectAuth);
  const location = useLocation();

  console.log(
    '🚀 Welcome to IDURAR ERP CRM! Did you know that we also offer commercial customization services? Contact us at hello@idurarapp.com for more information.'
  );

  // // Online state
  // const [isOnline, setIsOnline] = useState(navigator.onLine);

  // useEffect(() => {
  //   // Update network status
  //   const handleStatusChange = () => {
  //     setIsOnline(navigator.onLine);
  //     if (!isOnline) {
  //       console.log('🚀 ~ useEffect ~ navigator.onLine:', navigator.onLine);
  //       notification.config({
  //         duration: 20,
  //         maxCount: 1,
  //       });
  //       // Code to execute when there is internet connection
  //       notification.error({
  //         message: 'No internet connection',
  //         description: 'Cannot connect to the Internet, Check your internet network',
  //       });
  //     }
  //   };

  //   // Listen to the online status
  //   window.addEventListener('online', handleStatusChange);

  //   // Listen to the offline status
  //   window.addEventListener('offline', handleStatusChange);

  //   // Specify how to clean up after this effect for performance improvment
  //   return () => {
  //     window.removeEventListener('online', handleStatusChange);
  //     window.removeEventListener('offline', handleStatusChange);
  //   };
  // }, [navigator.onLine]);

  // Public certificate verification — no login. Certificates already issued
  // carry a "/#/verify/<id>" link from before this route existed; send those
  // to the same page.
  const legacyVerify = location.pathname === '/' && /^#\/verify\/([^/?#]+)/.exec(location.hash || '');
  if (legacyVerify || location.pathname === '/verify' || location.pathname.startsWith('/verify/')) {
    return (
      <Localization>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/verify" element={<VerifyCertificate />} />
            <Route path="/verify/:certificateId" element={<VerifyCertificate />} />
            <Route path="*" element={<Navigate to={legacyVerify ? `/verify/${legacyVerify[1]}` : '/verify'} replace />} />
          </Routes>
        </Suspense>
      </Localization>
    );
  }

  // Recruiter profile link + 360° PDF verification (LMS Figma 1D / 1F) — no login.
  if (location.pathname.startsWith('/p/') || location.pathname.startsWith('/verify-360/')) {
    return (
      <Localization>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/p/:token" element={<PublicProfile />} />
            <Route path="/verify-360/:code" element={<Verify360Page />} />
          </Routes>
        </Suspense>
      </Localization>
    );
  }

  if (location.pathname.startsWith('/kyc/') || location.pathname.startsWith('/finance-kyc/')) {
    return (
      <Localization>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/kyc/:token" element={<PublicKycForm />} />
            <Route path="/finance-kyc/:token" element={<FinanceKycForm />} />
          </Routes>
        </Suspense>
      </Localization>
    );
  }

  if (!isLoggedIn)
    return (
      <Localization>
        <AuthRouter />
      </Localization>
    );
  else {
    return <DefaultApp />;
  }
}
