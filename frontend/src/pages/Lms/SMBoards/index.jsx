import React, { lazy, Suspense } from 'react';
import { Skeleton } from 'antd';

// Support Manager section (design canvas page 5): one screen per CRM sidebar
// item, same pattern as Admin & Ops (pages/Lms/AdminOps). S8 Feedback centre
// is the existing FeedbackCentre page.
const SCREENS = {
  dashboard: lazy(() => import('./Dashboard')),
  attendance: lazy(() => import('./Attendance')),
  tickets: lazy(() => import('./Tickets')),
  comms: lazy(() => import('./Comms')),
  certificates: lazy(() => import('./Certificates')),
  learners: lazy(() => import('./Learners')),
  classes: lazy(() => import('./Scheduler')),
  recordings: lazy(() => import('./RecordingOps')),
  feedback: lazy(() => import('../Feedback/FeedbackCentre')),
};

export default function SupportManagerScreen({ screen = 'dashboard' }) {
  const Screen = SCREENS[screen] || SCREENS.dashboard;
  return (
    <Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />}>
      <Screen />
    </Suspense>
  );
}
