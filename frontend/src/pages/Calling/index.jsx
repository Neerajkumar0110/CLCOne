import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { request } from "@/request";
import { ExperimentOutlined } from "@ant-design/icons";

import CallingDashboard from "./Dashboard";
import Dialer from "./Dialer";
import Campaigns from "./Campaigns";
import AutoDialer from "./AutoDialer";
import AgentScreen from "./AgentScreen";
import CallHistory from "./CallHistory";
import Callbacks from "./Callbacks";
import Recordings from "./Recordings";
import Reports from "./Reports";
import TeamOverview from "./TeamOverview";
import { useCallingMeta } from "./shared";

const BASE_TABS = [
  { key: "dashboard", label: "Dashboard", C: CallingDashboard },
  { key: "team", label: "Team Overview", C: TeamOverview, managerOnly: true },
  { key: "dial", label: "Dialer", C: Dialer },
  { key: "campaigns", label: "Campaigns", C: Campaigns },
  { key: "dialer", label: "Auto Dialer", C: AutoDialer },
  { key: "agent", label: "Agent Screen", C: AgentScreen },
  { key: "history", label: "Call History", C: CallHistory },
  { key: "callbacks", label: "Callbacks", C: Callbacks },
  { key: "recordings", label: "Recordings", C: Recordings },
  { key: "reports", label: "Reports", C: Reports },
];

export default function Calling() {
  const [params] = useSearchParams();
  const meta = useCallingMeta();
  const isManager = meta.tier === "manager" || meta.tier === "admin";
  const TABS = BASE_TABS.filter((t) => !t.managerOnly || isManager);
  const initial = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "dashboard";
  const [tab, setTab] = useState(initial);
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    request.get({ entity: "calling/status" }).then((r) => r?.success && setProvider(r.result));
  }, []);

  useEffect(() => {
    if (!isManager && tab === "team") setTab("dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);

  // Sidebar links to /calling?tab=<key> without remounting this page (same
  // route, just a new query param) — pick that up whenever it changes, not
  // only on first mount.
  useEffect(() => {
    const urlTab = params.get("tab");
    if (urlTab && urlTab !== tab && TABS.some((t) => t.key === urlTab)) {
      setTab(urlTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

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
            {provider.testMode ? "TEST MODE — simulated calls" : "Live calling"}
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
          <code>CALLING_PROVIDER=cloud</code> + the <code>PLIVO_*</code> keys (Plivo) to go live —
          the rest of the CRM is unaffected.
        </div>
      )}

      <Active />
    </div>
  );
}
