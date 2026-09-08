import React, { Suspense, lazy, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiOutlined, BarChartOutlined, TableOutlined } from '@ant-design/icons';

import CrudTab from '@/components/CrudTab';
import SectionOverview from '@/components/SectionOverview';
import { findFeatureTab } from '@/config/featureSections';
import DashboardShell from '@/components/dashboard/DashboardShell';
import { DASH_CONFIGS } from '@/components/dashboard/configs';

// Messenger's "Team Chat" reuses the real-time chat from the Communication page.
const TeamChat = lazy(() =>
  import('@/pages/Communication').then((m) => ({ default: m.TeamChat }))
);
// Sales' Leads / Customers / Calls sub-tabs reuse the existing full pages.
const Leads = lazy(() => import('@/pages/Leads'));
const Customer = lazy(() => import('@/pages/Customer'));
const Calls = lazy(() => import('@/pages/Calls'));
// Sales' Pipeline tab — live funnel computed from the Deals (salesdeal) list.
const SalesPipeline = lazy(() => import('@/pages/SalesPipeline'));
const SalesDashboard = lazy(() => import('@/pages/SalesDashboard'));
const MarketingDashboard = lazy(() => import('@/pages/MarketingDashboard'));
const MarketingHub = lazy(() => import('@/pages/MarketingHub'));
const EMBED = {
  teamChat: TeamChat,
  leads: Leads,
  customer: Customer,
  calls: Calls,
  salesPipeline: SalesPipeline,
  salesDashboard: SalesDashboard,
  marketingDashboard: MarketingDashboard,
  marketingHub: MarketingHub,
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
  // so the section-head breadcrumb would just be a redundant second title —
  // hide it there and let the dashboard be the top element (matches the
  // standalone Executive Overview at "/").
  const isDashboardTab = !!tab.dashboard || tab.embed === 'salesDashboard';

  return (
    <div className="hub-page" data-section={section.key}>
      {!isDashboardTab && (
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

  const records = tab.embed && EMBED[tab.embed] ? (
    <Suspense fallback={<div className="hub-card"><div className="hub-empty">Loading…</div></div>}>
      {React.createElement(EMBED[tab.embed])}
    </Suspense>
  ) : tab.entity ? (
    <CrudTab
      key={`${section.key}/${tab.key}`}
      entity={tab.entity}
      fields={tab.fields}
      fixedFilter={tab.fixedFilter}
      title={tab.label}
      icon={tab.Icon}
    />
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
