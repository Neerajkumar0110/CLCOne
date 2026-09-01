import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import HubTabs from "@/components/HubTabs";
import { request } from "@/request";
import { ExperimentOutlined } from "@ant-design/icons";

import CallingDashboard from "./Dashboard";
import Campaigns from "./Campaigns";
import AutoDialer from "./AutoDialer";
import AgentScreen from "./AgentScreen";
import CallHistory from "./CallHistory";
import Callbacks from "./Callbacks";
import Recordings from "./Recordings";
import Reports from "./Reports";

const TABS = [
  { key: "dashboard", label: "Dashboard", C: CallingDashboard },
  { key: "campaigns", label: "Campaigns", C: Campaigns },
  { key: "dialer", label: "Auto Dialer", C: AutoDialer },
  { key: "agent", label: "Agent Screen", C: AgentScreen },
  { key: "history", label: "Call History", C: CallHistory },
  { key: "callbacks", label: "Callbacks", C: Callbacks },
  { key: "recordings", label: "Recordings", C: Recordings },
  { key: "reports", label: "Reports", C: Reports },
];

export default function Calling() {
  const [params, setParams] = useSearchParams();
  const initial = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "dashboard";
  const [tab, setTab] = useState(initial);
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    request.get({ entity: "calling/status" }).then((r) => r?.success && setProvider(r.result));
  }, []);

  const changeTab = (k) => {
    setTab(k);
    const next = new URLSearchParams(params);
    next.set("tab", k);
    setParams(next, { replace: true });
  };

  const Active = TABS.find((t) => t.key === tab)?.C || CallingDashboard;

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Calls</h2>
          <p>Manage live calls, call status, recordings and auto-dialer campaigns</p>
        </div>
        {provider && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: provider.testMode ? "#fff7ed" : "#ecfdf5",
              color: provider.testMode ? "#c2410c" : "#047857",
              border: `1px solid ${provider.testMode ? "#fed7aa" : "#a7f3d0"}`,
            }}
          >
            <ExperimentOutlined />
            {provider.testMode ? "TEST MODE — simulated calls" : "VICIdial connected"}
            <span style={{ opacity: 0.7, fontWeight: 500 }}>· {provider.label}</span>
          </div>
        )}
      </div>

      {provider && provider.testMode && (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#9a3412",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 12.5,
            marginBottom: 12,
          }}
        >
          Calling is running with the <strong>mock provider</strong>. No real calls are placed. Set{" "}
          <code>CALLING_PROVIDER=vicidial</code> and the VICIDIAL_* / SIP_* environment variables to go live —
          the rest of the CRM is unaffected.
        </div>
      )}

      <HubTabs tabs={TABS.map(({ key, label }) => ({ key, label }))} active={tab} onChange={changeTab} />

      <Active />
    </div>
  );
}
