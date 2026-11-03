import React from 'react';
import { useSearchParams } from 'react-router-dom';
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

// LMS → Admin & Ops — design canvas page 6 ("Ops, Finance, Admin &
// Management"), boards A1–A11, with the board's own sidebar in the same
// order. The open screen lives in ?screen= so a link / refresh keeps it.
const SCREENS = [
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

export default function AdminOps() {
  const [params, setParams] = useSearchParams();
  const cur = SCREENS.find((s) => s.key === params.get('screen')) || SCREENS[0];
  const Screen = cur.C;
  return (
    <div className="ao-root">
      <nav className="ao-side" aria-label="Admin & Ops">
        <div className="ao-brand">Career Lab · <span>Admin &amp; Ops</span></div>
        {SCREENS.map((s) => (
          <button key={s.key} type="button" className={`ao-nav${s.key === cur.key ? ' on' : ''}`} aria-current={s.key === cur.key ? 'page' : undefined} onClick={() => setParams({ screen: s.key })}>
            {s.label}
          </button>
        ))}
      </nav>
      <main className={`ao-main${cur.tight ? ' tight' : ''}`}>
        <Screen key={cur.key} />
      </main>
    </div>
  );
}
