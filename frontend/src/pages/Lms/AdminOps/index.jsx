import React from 'react';
import OpsApprovals from './OpsApprovals';
import Mgmt from './Mgmt';
import Reports from './Reports';
import Automation from './Automation';
import Security from './Security';
import Evidence from './Evidence';
import AssessRules from './AssessRules';
import Finance from './Finance';
import Roles from './Roles';
import PolicyCentre from './PolicyCentre';
import SystemHealth from '../SystemHealth';
import './AdminOps.css';

// Admin & Ops — design canvas page 6 ("Ops, Finance, Admin & Management"),
// boards A1–A11. Its own section in the CRM sidebar (config/featureSections
// 'admin-ops'): one sub-tab per screen, in the board's sidebar order, each
// rendering <AdminOpsScreen screen=…/> in the board's look.
export const SCREENS = [
  { key: 'approvals', label: 'Ops approvals', C: OpsApprovals },
  { key: 'kpis', label: 'Management KPIs', C: Mgmt },
  { key: 'reports', label: 'Reports & exports', C: Reports },
  { key: 'automation', label: 'Automation', C: Automation, tight: true },
  { key: 'security', label: 'Security & audit', C: Security, tight: true },
  { key: 'evidence', label: 'Evidence repository', C: Evidence, tight: true },
  { key: 'rules', label: 'Assessment rules', C: AssessRules },
  { key: 'finance', label: 'Finance & payments', C: Finance },
  { key: 'roles', label: 'Roles & permissions', C: Roles },
  { key: 'policies', label: 'Policy centre', C: PolicyCentre },
  { key: 'health', label: 'System health', C: SystemHealth },
];

export default function AdminOpsScreen({ screen }) {
  const cur = SCREENS.find((s) => s.key === screen) || SCREENS[0];
  const Screen = cur.C;
  return (
    <div className="ao-root">
      <main className={`ao-main${cur.tight ? ' tight' : ''}`}>
        <Screen />
      </main>
    </div>
  );
}
