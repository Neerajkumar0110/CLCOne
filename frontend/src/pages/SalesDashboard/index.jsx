import React, { useState } from "react";
import { SettingOutlined } from "@ant-design/icons";
import HubModal from "@/components/HubModal";
import Sales360 from "@/pages/WorkTracker/Sales360";
import SystemSettings from "./SystemSettings";
import useBusinessLock from "@/hooks/useBusinessLock";
import { useSelector } from "react-redux";
import { selectCurrentAdmin } from "@/redux/auth/selectors";

// The Sales › Dashboard tab: the Sales 360° report (every Sales user's login,
// calls, talk time, responses, leads, sales and recordings — management sees
// the team, everyone else themselves). It also took over everything the old
// "Leads Analytics" view showed (lead KPIs, source / stage / team charts,
// funnel, lead list). The Team-classification + monthly cost editors live
// behind "Systems & Costs" (they still power the ALL | B2B | B2C toggle and
// the legacy /sales-dashboard ratios).
export default function SalesDashboard() {
  const [showSettings, setShowSettings] = useState(false);
  // Team classification spans both segments — not for a B2B/B2C-locked user.
  const businessLock = useBusinessLock();
  // Agent side of the design: someone who only sees their own 360° gets "My Day".
  const me = useSelector(selectCurrentAdmin);
  const ownOnly = !["owner", "Super Admin", "Admin", "Sales Manager", "Team Manager"].includes(me?.role);

  return (
    <div className="sales-dashboard-ui">
      <div className="hub-stack">
        <div className="hub-card sd-head">
          <div>
            <div className="section-head-crumb">Sales <span className="section-head-sep">›</span> <span className="section-head-cur">{ownOnly ? "My Day" : "Dashboard"}</span></div>
            <h1>{ownOnly ? "My Day" : "Sales Dashboard"}</h1>
            <p>Calls, results, charts and ranking for the selected dates — attendance lives in Team &amp; Attendance, lead stages in Leads.</p>
          </div>
          {!businessLock && (
            <button type="button" className="hub-btn" onClick={() => setShowSettings(true)}>
              <SettingOutlined /> Systems &amp; Costs
            </button>
          )}
        </div>
        <Sales360 view="dashboard" />
      </div>
      <HubModal
        open={showSettings && !businessLock}
        onClose={() => setShowSettings(false)}
        title="Systems & Costs"
        subtitle="Classify teams into B2B / B2C systems and record monthly costs"
        width={720}
        footer={
          <button type="button" className="hub-btn hub-btn-primary" onClick={() => setShowSettings(false)}>
            Done
          </button>
        }
      >
        <SystemSettings />
      </HubModal>
    </div>
  );
}
