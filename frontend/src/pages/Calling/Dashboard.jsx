import React from "react";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { DASH_CONFIGS } from "@/components/dashboard/configs";

// Calling › Dashboard — the shared analytics shell on the `calls` module
// (CallRecord + legacy Call). `live` keeps it polling while a preset range
// is selected.
export default function CallingDashboard() {
  return <DashboardShell module="calls" config={DASH_CONFIGS.calls} live />;
}
