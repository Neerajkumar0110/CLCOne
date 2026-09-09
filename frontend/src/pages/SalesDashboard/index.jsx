import React, { useState } from "react";
import { SettingOutlined } from "@ant-design/icons";
import HubModal from "@/components/HubModal";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { DASH_CONFIGS } from "@/components/dashboard/configs";
import SystemSettings from "./SystemSettings";

// The Sales › "B2B / B2C Dashboard" tab — now the shared analytics shell
// pointed at the `leads` module. The old Team-classification + monthly cost
// editors live behind the "Systems & Costs" button (they still power the
// ALL | B2B | B2C toggle and the legacy /sales-dashboard ratios).
export default function SalesDashboard() {
  const [showSettings, setShowSettings] = useState(false);
  return (
    <>cd
      <DashboardShell
        module="leads"
        config={DASH_CONFIGS.leads}
        extraActions={
          <button type="button" className="hub-btn" onClick={() => setShowSettings(true)}>
            <SettingOutlined /> Systems &amp; Costs
          </button>
        }
      />
      <HubModal
        open={showSettings}
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
    </>
  );
}
