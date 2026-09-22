import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { message, Select } from 'antd';
import { ApiOutlined, BarChartOutlined, TableOutlined, UsergroupAddOutlined, SyncOutlined, ReadOutlined, FilterOutlined } from '@ant-design/icons';

import CrudTab from '@/components/CrudTab';
import SectionOverview from '@/components/SectionOverview';
import { findFeatureTab } from '@/config/featureSections';
import DashboardShell from '@/components/dashboard/DashboardShell';
import { DASH_CONFIGS } from '@/components/dashboard/configs';
import BatchStudentsPanel from '@/pages/Lms/components/BatchStudentsPanel';
import CurriculumViewer from '@/pages/Lms/components/CurriculumViewer';
import AssignStudentModal from '@/pages/Lms/components/AssignStudentModal';
import lmsApi from '@/pages/Lms/api';
import { request } from '@/request';

// Messenger's "Team Chat" reuses the real-time chat from the Communication page.
const TeamChat = lazy(() =>
  import('@/pages/Communication').then((m) => ({ default: m.TeamChat }))
);
// Sales' Leads / Customers sub-tabs reuse the existing full pages.
const Leads = lazy(() => import('@/pages/Leads'));
const Customer = lazy(() => import('@/pages/Customer'));
// Sales' Pipeline tab — live funnel computed from the Deals (salesdeal) list.
const SalesPipeline = lazy(() => import('@/pages/SalesPipeline'));
const SalesDashboard = lazy(() => import('@/pages/SalesDashboard'));
const MarketingDashboard = lazy(() => import('@/pages/MarketingDashboard'));
const MarketingHub = lazy(() => import('@/pages/MarketingHub'));
// LMS "My Learning" tab — the student portal shell over Moodle (pages/Lms).
const LmsStudentPortal = lazy(() => import('@/pages/Lms/StudentPortal'));
// LMS "Live Classes" tab — auto meeting rooms per batch/course.
const LmsLiveClasses = lazy(() => import('@/pages/Lms/LiveClasses'));
const LmsRecordings = lazy(() => import('@/pages/Lms/Recordings'));
const LmsAttendance = lazy(() => import('@/pages/Lms/Attendance'));
const LmsCalendar = lazy(() => import('@/pages/Lms/Calendar'));
const LmsPolicies = lazy(() => import('@/pages/Lms/Policies'));
const LmsEligibility = lazy(() => import('@/pages/Lms/Eligibility'));
const LmsProjects = lazy(() => import('@/pages/Lms/Projects'));
const LmsSystemHealth = lazy(() => import('@/pages/Lms/SystemHealth'));
const LmsLearner360 = lazy(() => import('@/pages/Lms/Learner360'));
const LmsCurriculum = lazy(() => import('@/pages/Lms/Curriculum'));
const LmsAttemptsAdmin = lazy(() => import('@/pages/Lms/AttemptsAdmin'));
const LmsAssessmentDashboard = lazy(() => import('@/pages/Lms/AssessmentDashboard'));
// Basic/Major/Micro Test entries from the reference nav's dropdown picker.
const LmsBasicTest = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.BasicTest })));
const LmsMajorTestPythonSql = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.MajorTestPythonSql })));
const LmsMajorTestNlp = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.MajorTestNlp })));
const LmsMicroTestSqlDb = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.MicroTestSqlDb })));
const LmsMicroTestNlpSerp = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.MicroTestNlpSerp })));
// HRMS "Users" tab — same login-account list/creation flow as Settings' User
// Management, reachable without leaving HRMS (see frontend/src/pages/Hr/UsersTab.jsx).
const HrmsUsers = lazy(() => import('@/pages/Hr/UsersTab'));
// Sales' "Payments" tab — Razorpay fee-collection link + QR + email, then a
// post-payment KYC form (public, outside this shell — see pages/Payments).
const Payments = lazy(() => import('@/pages/Payments'));
const EMBED = {
  teamChat: TeamChat,
  leads: Leads,
  customer: Customer,
  salesPipeline: SalesPipeline,
  salesDashboard: SalesDashboard,
  marketingDashboard: MarketingDashboard,
  marketingHub: MarketingHub,
  lmsStudentPortal: LmsStudentPortal,
  lmsLiveClasses: LmsLiveClasses,
  lmsRecordings: LmsRecordings,
  lmsAttendance: LmsAttendance,
  lmsCalendar: LmsCalendar,
  lmsPolicies: LmsPolicies,
  lmsEligibility: LmsEligibility,
  lmsProjects: LmsProjects,
  lmsSystemHealth: LmsSystemHealth,
  lmsLearner360: LmsLearner360,
  lmsCurriculum: LmsCurriculum,
  lmsAttemptsAdmin: LmsAttemptsAdmin,
  lmsAssessmentDashboard: LmsAssessmentDashboard,
  lmsBasicTest: LmsBasicTest,
  lmsMajorTestPythonSql: LmsMajorTestPythonSql,
  lmsMajorTestNlp: LmsMajorTestNlp,
  lmsMicroTestSqlDb: LmsMicroTestSqlDb,
  lmsMicroTestNlpSerp: LmsMicroTestNlpSerp,
  hrmsUsers: HrmsUsers,
  payments: Payments,
};

/**
 * SectionHub — renders ONE sub-module of a feature section. Navigation between
 * sub-modules is the sidebar submenu (routes are /<section>/<tab>), so this
 * page has no tab bar of its own — just a header and the sub-module content:
 *   • data tab → <CrudTab>   • embed → existing component
 *   • overview → <SectionOverview> (live counts)   • readOnly → placeholder
 */
export default function SectionHub({ section: sectionProp, tab: tabProp }) {
  const location = useLocation();
  const resolved =
    sectionProp && tabProp ? { section: sectionProp, tab: tabProp } : findFeatureTab(location.pathname);

  if (!resolved) {
    return (
      <div className="hub-page">
        <div className="hub-header">
          <div>
            <h2>Not found</h2>
            <p>This screen has not been configured yet.</p>
          </div>
        </div>
      </div>
    );
  }

  const { section, tab } = resolved;
  const SectionIcon = section.Icon;
  const TabIcon = tab.Icon;

  // Analytics-shell tabs carry their own dark header card (<DashboardHeader>),
  // and every LMS embed renders its own <PageHeading>/`.lms-portal-head` —
  // so the section-head breadcrumb + generic section blurb would just be a
  // redundant second title stacked above it. Hide it there and let the
  // embed's own header be the top element (matches the standalone Executive
  // Overview at "/").
  const hasOwnHeader = !!tab.dashboard || tab.embed === 'salesDashboard' || (typeof tab.embed === 'string' && tab.embed.startsWith('lms'));

  return (
    <div className="hub-page" data-section={section.key}>
      {!hasOwnHeader && (
        <div className="section-head">
          <div className="section-head-icon">{SectionIcon ? <SectionIcon /> : null}</div>
          <div className="section-head-text">
            <div className="section-head-crumb">
              {section.label}
              <span className="section-head-sep">/</span>
              <span className="section-head-cur">
                {TabIcon ? <TabIcon /> : null}
                {tab.label}
              </span>
            </div>
            <h2>{tab.label}</h2>
            <p>{section.blurb}</p>
          </div>
        </div>
      )}

      <TabBody section={section} tab={tab} />
    </div>
  );
}

// One sub-module's content. A tab may carry a `dashboard` key (analytics
// shell) on its own or alongside an `embed` / `entity` — in the latter case an
// in-tab "Dashboard | Records" toggle switches between the two.
function TabBody({ section, tab }) {
  const hasRecords = !!(tab.entity || (tab.embed && EMBED[tab.embed]));
  const dashCfg = tab.dashboard ? DASH_CONFIGS[tab.dashboard] : null;
  const [view, setView] = useState('dashboard');
  // Batches only — "manage students" drawer, opened from a row's extra
  // action button (see renderRowExtra below).
  const [batchPanel, setBatchPanel] = useState(null); // { id, name } | null
  const [regenBusyId, setRegenBusyId] = useState(null);
  // Courses only — "view curriculum" modal, same row-extra pattern.
  const [curriculumPanel, setCurriculumPanel] = useState(null); // { id, title } | null
  // Students only — "assign to batch" modal. `true` = fresh search (opened
  // from the header button), a row object = pre-filled from that row's
  // extra action button. `studentsRefreshTick` forces the list to reload
  // after an assignment since CrudTab owns its own data with no exposed
  // refresh handle — remounting it (via key) is the simplest way in.
  const [assignStudent, setAssignStudent] = useState(null); // true | { name, email } | null
  const [studentsRefreshTick, setStudentsRefreshTick] = useState(0);
  // Students only — Course → Batch cascading filter bar above the list.
  // Only one of these is ever sent to the backend (CrudTab's fixedFilter
  // supports a single field/value pair) — Batch wins when both are set,
  // since a specific batch already implies its course.
  const [filterCourses, setFilterCourses] = useState([]);
  const [filterBatches, setFilterBatches] = useState([]);
  const [studentCourseFilter, setStudentCourseFilter] = useState(null);
  const [studentBatchFilter, setStudentBatchFilter] = useState(null);

  useEffect(() => {
    if (tab.entity !== 'student') return;
    request.listAll({ entity: 'course' }).then((res) => setFilterCourses(res?.success ? res.result : []));
    request.listAll({ entity: 'batch' }).then((res) => setFilterBatches(res?.success ? res.result : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.entity]);

  const batchOptionsForCourse = useMemo(
    () => filterBatches.filter((b) => !studentCourseFilter || b.course === studentCourseFilter),
    [filterBatches, studentCourseFilter]
  );

  const studentFixedFilter = useMemo(() => {
    if (studentBatchFilter) return { field: 'batch', value: studentBatchFilter };
    if (studentCourseFilter) return { field: 'course', value: studentCourseFilter };
    return undefined;
  }, [studentCourseFilter, studentBatchFilter]);

  const regenerateBatch = async (row) => {
    setRegenBusyId(row._id);
    try {
      const res = await lmsApi.liveClassRegenerate(row._id, row._id);
      if (res && res.success === false) {
        message.error(res.message || 'Could not regenerate the schedule.');
      } else {
        const created = res && res.result && res.result.created;
        message.success(
          created ? `Created ${created} live class session(s).` : 'Schedule is already up to date — nothing new to create.'
        );
      }
    } catch (e) {
      message.error('Could not regenerate the schedule.');
    } finally {
      setRegenBusyId(null);
    }
  };

  const records = tab.embed && EMBED[tab.embed] ? (
    <Suspense fallback={<div className="hub-card"><div className="hub-empty">Loading…</div></div>}>
      {React.createElement(EMBED[tab.embed])}
    </Suspense>
  ) : tab.entity ? (
    <>
      {tab.entity === 'student' && (
        <div className="hub-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
          <div className="hub-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <FilterOutlined style={{ color: 'var(--hub-muted)' }} />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Filter by course…"
              style={{ minWidth: 220 }}
              value={studentCourseFilter}
              onChange={(v) => {
                setStudentCourseFilter(v || null);
                setStudentBatchFilter(null);
              }}
              options={filterCourses.map((c) => ({ value: c.title, label: c.title }))}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={studentCourseFilter ? 'Filter by batch…' : 'Select a course first'}
              style={{ minWidth: 220 }}
              value={studentBatchFilter}
              disabled={!studentCourseFilter}
              onChange={(v) => setStudentBatchFilter(v || null)}
              options={batchOptionsForCourse.map((b) => ({ value: b.name, label: b.name }))}
            />
          </div>
          <button type="button" className="hub-btn hub-btn-primary" onClick={() => setAssignStudent(true)}>
            <UsergroupAddOutlined /> Assign to Batch
          </button>
        </div>
      )}
      <CrudTab
        key={tab.entity === 'student' ? `${section.key}/${tab.key}/${studentsRefreshTick}` : `${section.key}/${tab.key}`}
        entity={tab.entity}
        fields={tab.fields}
        fixedFilter={tab.entity === 'student' ? studentFixedFilter : tab.fixedFilter}
        title={tab.label}
        icon={tab.Icon}
        renderRowExtra={
          tab.entity === 'batch'
            ? (row) => (
                <>
                  <button
                    type="button"
                    className="hub-icon-btn"
                    title="Manage students"
                    onClick={() => setBatchPanel({ id: row._id, name: row.name })}
                  >
                    <UsergroupAddOutlined />
                  </button>
                  <button
                    type="button"
                    className="hub-icon-btn"
                    title="Regenerate live classes — use this if a batch's classes aren't showing up"
                    disabled={regenBusyId === row._id}
                    onClick={() => regenerateBatch(row)}
                  >
                    <SyncOutlined spin={regenBusyId === row._id} />
                  </button>
                </>
              )
            : tab.entity === 'course'
            ? (row) => (
                <button
                  type="button"
                  className="hub-icon-btn"
                  title="View full curriculum"
                  onClick={() => setCurriculumPanel({ id: row._id, title: row.title })}
                >
                  <ReadOutlined />
                </button>
              )
            : tab.entity === 'student'
            ? (row) => (
                <button
                  type="button"
                  className="hub-icon-btn"
                  title="Assign to another batch"
                  onClick={() => setAssignStudent({ name: row.name, email: row.email })}
                >
                  <UsergroupAddOutlined />
                </button>
              )
            : undefined
        }
      />
      {tab.entity === 'batch' && (
        <BatchStudentsPanel
          open={!!batchPanel}
          onClose={() => setBatchPanel(null)}
          batchId={batchPanel && batchPanel.id}
          batchName={batchPanel && batchPanel.name}
        />
      )}
      {tab.entity === 'course' && (
        <CurriculumViewer
          open={!!curriculumPanel}
          onClose={() => setCurriculumPanel(null)}
          courseId={curriculumPanel && curriculumPanel.id}
          courseTitle={curriculumPanel && curriculumPanel.title}
        />
      )}
      {tab.entity === 'student' && (
        <AssignStudentModal
          open={!!assignStudent}
          onClose={() => setAssignStudent(null)}
          presetStudent={assignStudent && assignStudent !== true ? assignStudent : null}
          onAssigned={() => setStudentsRefreshTick((n) => n + 1)}
        />
      )}
    </>
  ) : tab.stats ? (
    <SectionOverview key={`${section.key}/${tab.key}`} stats={tab.stats} note={tab.note} />
  ) : (
    <ReadOnlyTab tab={tab} />
  );

  if (dashCfg) {
    return (
      <>
        {hasRecords && (
          <div className="hub-pill-filter" style={{ marginBottom: 14 }}>
            <button
              type="button"
              className={`hub-pill-btn ${view === 'dashboard' ? 'active' : ''}`}
              onClick={() => setView('dashboard')}
            >
              <BarChartOutlined /> Dashboard
            </button>
            <button
              type="button"
              className={`hub-pill-btn ${view === 'records' ? 'active' : ''}`}
              onClick={() => setView('records')}
            >
              <TableOutlined /> Records
            </button>
          </div>
        )}
        {view === 'records' && hasRecords ? (
          records
        ) : (
          <DashboardShell
            module={tab.dashboard}
            config={dashCfg}
            onRecordEdit={hasRecords ? () => setView('records') : undefined}
          />
        )}
      </>
    );
  }

  return records;
}

function ReadOnlyTab({ tab }) {
  return (
    <div className="hub-stack">
      <div className="hub-notice">
        <ApiOutlined />
        <span>
          <strong>{tab.label}</strong> is a computed view — it rolls up from the other sub-modules.
          Live figures connect during backend wiring.
        </span>
      </div>

      <div className="hub-kpi-row">
        {(tab.kpis || []).map((label) => (
          <div className="hub-kpi" key={label}>
            <div className="hub-kpi-label">{label}</div>
            <div className="hub-kpi-value hub-kpi-pending">&mdash;</div>
          </div>
        ))}
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>{tab.label}</h3>
          <span className="hub-badge hub-badge-gray">preview</span>
        </div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                {(tab.columns || []).map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 4 }).map((_, r) => (
                <tr key={r} className="hub-skel-row" aria-hidden="true">
                  {(tab.columns || []).map((col) => (
                    <td key={col}>
                      <span className="hub-skel" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
