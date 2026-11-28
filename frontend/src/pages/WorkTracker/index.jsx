import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { FieldTimeOutlined, RiseOutlined } from "@ant-design/icons";
// Shared modal look (lv-close, wm-modal, keyframes) + this page's styles — Sales 360° uses them.
import "@/components/Workday/workday.css";
import "./worktracker.css";
import Sales360 from "./Sales360";
// Attendance & Leave ERP — its whole admin side is this one tab (design A1–A14).
const AdminErp = React.lazy(() => import("@/pages/AttendanceErp/admin/AdminErp"));

// HRMS → Work & Leave Tracker. Two tabs (user asks 2026-11-28):
//   • 360° Performance — Sales only, unchanged.
//   • Attendance ERP   — everything else in one place: who is working, every
//     leave (applied from the header widget OR the /employee portal — the same
//     LeaveRequest data), calendar, reports, audit. The old "Day board" and
//     "Leave requests" tabs were removed; the ERP covers both.
// A header notification can deep-link: /hr/work-tracker?erp=leaves opens the ERP
// on that sub-tab.

const TABS = [
  ["360", "360° Performance", RiseOutlined, "Sales team · calls, targets, scores"],
  ["erp", "Attendance ERP", FieldTimeOutlined, "Everyone · attendance, leave, activity"],
];
const KEY = "workTracker.tab";

export default function WorkTracker() {
  const { search } = useLocation();
  const erpTab = new URLSearchParams(search).get("erp");
  const [tab, setTabState] = useState(() => {
    if (erpTab) return "erp";
    try {
      const saved = localStorage.getItem(KEY);
      return TABS.some(([k]) => k === saved) ? saved : "erp"; // old "board"/"leaves" → ERP
    } catch (e) {
      return "erp";
    }
  });
  const setTab = (t) => {
    setTabState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch (e) {
      /* private window */
    }
  };
  // A notification click while already on this page switches to the ERP too.
  const [lastDeepLink, setLastDeepLink] = useState(erpTab);
  if (erpTab && erpTab !== lastDeepLink) {
    setLastDeepLink(erpTab);
    setTabState("erp");
  }

  return (
    <div className="hub-stack">
      <div className="wt-seg" role="tablist" aria-label="Work & Leave Tracker">
        {TABS.map(([k, l, Icon, sub]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            <span className="wt-seg-ico"><Icon /></span>
            <span className="wt-seg-txt">
              <b>{l}</b>
              <small>{sub}</small>
            </span>
          </button>
        ))}
      </div>
      {tab === "360" && <Sales360 />}
      {tab === "erp" && (
        <React.Suspense fallback={<div style={{ padding: 24, color: "var(--hub-muted)" }}>Loading Attendance ERP…</div>}>
          <AdminErp initialTab={erpTab} />
        </React.Suspense>
      )}
    </div>
  );
}
