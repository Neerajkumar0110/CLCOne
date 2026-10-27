import React, { useState } from "react";
import { SettingOutlined } from "@ant-design/icons";
import HubModal from "@/components/HubModal";
import Sales360 from "@/pages/WorkTracker/Sales360";
import SystemSettings from "./SystemSettings";
import useBusinessLock from "@/hooks/useBusinessLock";

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

  return (
    <div className="sales-dashboard-ui">
      <div className="hub-stack">
        <div className="hub-card sd-head">
          <div>
            <h1>Sales 360° Performance</h1>
            <p>Login to logout — calls, talk time, leads, demos, enrolments, payments and recordings for every Sales user</p>
          </div>
          {!businessLock && (
            <button type="button" className="hub-btn" onClick={() => setShowSettings(true)}>
              <SettingOutlined /> Systems &amp; Costs
            </button>
          )}
        </div>
        <Sales360 />
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
