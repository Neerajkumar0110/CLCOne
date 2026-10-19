import React, { useCallback, useEffect, useMemo, useState } from "react";
import { message } from "antd";
import dayjs from "dayjs";
import { request } from "@/request";

// Live demo (Mon–Sat, 6–7 PM IST) — Admin / Super Admin only. Today's room
// (join as host any time on a demo day) + every booking by day with its
// status. Backend: GET /api/calling/demos, /api/calling/demos/join.
const STATUS = {
  booked: { label: "Booked", cls: "hub-badge-blue" },
  attended: { label: "Joined", cls: "hub-badge-green" },
  missed: { label: "Missed twice", cls: "hub-badge-red" },
  cancelled: { label: "Cancelled", cls: "hub-badge-gray" },
};
const WINDOW_TEXT = {
  early: "Opens for customers at 5:50 PM",
  open: "Open now — customers can join",
  over: "Today's demo is over",
  none: "No demo today (Sunday)",
};
const fmtDay = (d) => dayjs(d).format("ddd, DD MMM YYYY");

export default function Demos() {
  const [data, setData] = useState(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(() => {
    request.get({ entity: "calling/demos" }).then((r) => r?.success && setData(r.result));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const b of data?.items || []) {
      if (!m.has(b.date)) m.set(b.date, []);
      m.get(b.date).push(b);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [data]);

  const joinHost = async () => {
    setJoining(true);
    const r = await request.get({ entity: "calling/demos/join" });
    setJoining(false);
    if (r?.success && r.result?.url) window.open(r.result.url, "_blank", "noopener");
  };
  const copy = (link) => {
    navigator.clipboard?.writeText(link).then(() => message.success("Customer link copied"));
  };

  if (!data) return <div className="hub-empty">Loading…</div>;
  const todayCount = (data.items || []).filter((b) => b.date === data.today && b.status !== "cancelled").length;

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>🎥 Live Demo — Mon–Sat, 6:00–7:00 PM</h3>
            <div style={{ color: "var(--hub-muted)", fontSize: 13, marginTop: 4 }}>
              Today ({fmtDay(data.today)}): <b>{WINDOW_TEXT[data.todayWindow] || ""}</b>
              {data.todayLive && <span className="hub-badge hub-badge-green" style={{ marginLeft: 8 }}>● Live</span>}
              {" · "}
              {todayCount} booked today
            </div>
          </div>
          {data.todayIsDemoDay && (
            <button type="button" className="hub-btn hub-btn-primary" onClick={joinHost} disabled={joining}>
              {joining ? "Opening…" : "Join as host"}
            </button>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--hub-muted)" }}>
          Each customer, their agent and the agent's Team Leader get their own link by email. A customer's link works only on
          their booked day, from 5:50 PM while the demo is live. A customer who doesn't join is moved once to the next demo day
          with a fresh email; a second miss marks the lead "Demo Not Attended".
        </div>
      </div>

      {!byDay.length && <div className="hub-card hub-empty">No demo bookings in the last 7 / next 14 days.</div>}

      {byDay.map(([day, rows]) => (
        <div key={day} className="hub-card">
          <div className="hub-card-header">
            <h3 style={{ margin: 0 }}>
              {fmtDay(day)}
              {day === data.today && <span className="hub-badge hub-badge-blue" style={{ marginLeft: 8 }}>Today</span>}
            </h3>
            <span className="hub-badge hub-badge-gray">{rows.length}</span>
          </div>
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Booked by</th>
                  <th>Team Leader</th>
                  <th>Email sent</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const st = STATUS[b.status] || STATUS.booked;
                  const mailed = (b.emails || []).filter((e) => e.sent).map((e) => e.kind.replace("-rebooked", ""));
                  return (
                    <tr key={b._id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{b.name || "—"}</div>
                        <div style={{ fontSize: 12, color: "var(--hub-muted)" }}>
                          {b.phone} {b.email ? `· ${b.email}` : "· no email"}
                        </div>
                      </td>
                      <td>
                        <span className={`hub-badge ${st.cls}`}>{st.label}</span>
                        {b.rebookCount > 0 && (
                          <div style={{ fontSize: 11.5, color: "#b45309", marginTop: 3 }}>
                            Moved from {b.missedDates.map((d) => dayjs(d).format("DD MMM")).join(", ")}
                          </div>
                        )}
                        {b.attendedAt && (
                          <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 3 }}>
                            {dayjs(b.attendedAt).format("hh:mm A")}
                          </div>
                        )}
                      </td>
                      <td>{b.agentName || "—"}</td>
                      <td>{b.teamLeaderName || "—"}</td>
                      <td style={{ fontSize: 12.5 }}>{mailed.length ? [...new Set(mailed)].join(", ") : "—"}</td>
                      <td>
                        {b.customerLink && (
                          <button type="button" className="hub-btn" onClick={() => copy(b.customerLink)}>
                            Copy link
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
