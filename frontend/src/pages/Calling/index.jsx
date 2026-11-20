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
import Demos from "./Demos";
import { useSelector } from "react-redux";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { useCallingMeta } from "./shared";
import SalesTheme from "@/components/SalesTheme";

const BASE_TABS = [
  { key: "dashboard", label: "Dashboard", C: CallingDashboard },
  { key: "dial", label: "Dialer", C: Dialer },
  { key: "campaigns", label: "Campaigns", C: Campaigns },
  { key: "dialer", label: "Auto Dialer", C: AutoDialer },
  { key: "agent", label: "Agent Screen", C: AgentScreen },
  { key: "history", label: "Call History", C: CallHistory },
  { key: "callbacks", label: "Callbacks", C: Callbacks },
  { key: "recordings", label: "Recordings", C: Recordings },
  // Reports are admins-only (company-wide decision, 2026-10-23).
  { key: "reports", label: "Reports", C: Reports, adminOnly: true },
  { key: "demos", label: "Live Demos", C: Demos, adminOnly: true },
];
const ADMIN_ROLES = ["owner", "Super Admin", "Admin"];
// Sales One Place design: each Calls tab carries its own title + one line.
const TAB_HEAD = {
  dashboard: ["Calls Dashboard", "Live calls, call status and today’s numbers."],
  dial: ["Dialer", "Dial a number or a contact."],
  campaigns: ["Campaigns", "Auto-dialer campaigns and their lists."],
  dialer: ["Auto Dialer", "Start dialling, watch the live numbers, see every call."],
  agent: ["Agent Screen", "The live call. Answer, hold, mute, transfer, schedule callback."],
  history: ["Call History", "Every call, one row each. Play, read the response, send for verification."],
  callbacks: ["Callbacks", "Every promised call-back."],
  recordings: ["Recordings", "Listen to calls and check every talked call was recorded."],
  reports: ["Call Reports", "Every call number and chart, once, for the range you pick."],
  demos: ["Live Demos", "Today’s live demo and who joined."],
};

export default function Calling() {
  const [params] = useSearchParams();
  const meta = useCallingMeta();
  const isManager = meta.tier === "manager" || meta.tier === "admin";
  const me = useSelector(selectCurrentAdmin);
  const isAdmin = ADMIN_ROLES.includes(me?.role);
  const TABS = BASE_TABS.filter((t) => (!t.managerOnly || isManager) && (!t.adminOnly || isAdmin));
  // Team Manager / Sales Manager: "Join live demo" while today's demo is open.
  const [demoJoin, setDemoJoin] = useState(false);
  useEffect(() => {
    if (!["Team Manager", "Sales Manager"].includes(me?.role)) return undefined;
    const check = () =>
      request.get({ entity: "calling/demos/status" }).then((r) => setDemoJoin(!!(r?.success && r.result?.canJoin && r.result?.window === "open")));
    check();
    const t = setInterval(check, 120000);
    return () => clearInterval(t);
  }, [me?.role]);
  const joinDemo = async () => {
    const r = await request.get({ entity: "calling/demos/join" });
    if (r?.success && r.result?.url) window.open(r.result.url, "_blank", "noopener");
  };
  const initial = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "dashboard";
  const [tab, setTab] = useState(initial);
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    request.get({ entity: "calling/status" }).then((r) => r?.success && setProvider(r.result));
  }, []);

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
    <SalesTheme>
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <div className="section-head-crumb">Sales <span className="section-head-sep">›</span> <span className="section-head-cur">{(TAB_HEAD[tab] || TAB_HEAD.dashboard)[0]}</span></div>
          <h2>{(TAB_HEAD[tab] || TAB_HEAD.dashboard)[0]}</h2>
          <p>{(TAB_HEAD[tab] || TAB_HEAD.dashboard)[1]}</p>
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
        {demoJoin && (
          <button type="button" className="hub-btn hub-btn-primary" onClick={joinDemo}>
            🎥 Join live demo
          </button>
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
    </SalesTheme>
  );
}
