import React, { Suspense, lazy, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { message } from 'antd';
import { ApiOutlined, BarChartOutlined, TableOutlined, UsergroupAddOutlined, SyncOutlined } from '@ant-design/icons';

import CrudTab from '@/components/CrudTab';
import SectionOverview from '@/components/SectionOverview';
import { findFeatureTab } from '@/config/featureSections';
import DashboardShell from '@/components/dashboard/DashboardShell';
import { DASH_CONFIGS } from '@/components/dashboard/configs';
import BatchStudentsPanel from '@/pages/Lms/components/BatchStudentsPanel';
import lmsApi from '@/pages/Lms/api';

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
const LmsCurriculum = lazy(() => import('@/pages/Lms/Curriculum'));
const LmsAttemptsAdmin = lazy(() => import('@/pages/Lms/AttemptsAdmin'));
const LmsAssessmentDashboard = lazy(() => import('@/pages/Lms/AssessmentDashboard'));
// Basic/Major/Micro Test entries from the reference nav's dropdown picker.
const LmsBasicTest = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.BasicTest })));
const LmsMajorTestPythonSql = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.MajorTestPythonSql })));
const LmsMajorTestNlp = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.MajorTestNlp })));
const LmsMicroTestSqlDb = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.MicroTestSqlDb })));
const LmsMicroTestNlpSerp = lazy(() => import('@/pages/Lms/TestIntro/variants').then((m) => ({ default: m.MicroTestNlpSerp })));
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
  lmsCurriculum: LmsCurriculum,
  lmsAttemptsAdmin: LmsAttemptsAdmin,
  lmsAssessmentDashboard: LmsAssessmentDashboard,
  lmsBasicTest: LmsBasicTest,
  lmsMajorTestPythonSql: LmsMajorTestPythonSql,
  lmsMajorTestNlp: LmsMajorTestNlp,
  lmsMicroTestSqlDb: LmsMicroTestSqlDb,
  lmsMicroTestNlpSerp: LmsMicroTestNlpSerp,
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
      <CrudTab
        key={`${section.key}/${tab.key}`}
        entity={tab.entity}
        fields={tab.fields}
        fixedFilter={tab.fixedFilter}
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
