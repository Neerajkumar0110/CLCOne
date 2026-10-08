import React, { useState } from "react";
import { request } from "@/request";
import { message } from "antd";
import { CalendarOutlined, PhoneOutlined } from "@ant-design/icons";
import { usePoll, dialContact } from "./shared";

const IST = { timeZone: "Asia/Kolkata" };

const fmtCallbackDate = (v) => {
  const d = v && new Date(v);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { ...IST, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
};

const fmtCallbackTime = (v) => {
  const d = v && new Date(v);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", minute: "2-digit", hour12: true });
};

// "in 2h 10m" / "overdue by 3h" — the number an agent actually acts on.
const relativeToNow = (v) => {
  const d = v && new Date(v);
  if (!d || Number.isNaN(d.getTime())) return "";
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  const abs = Math.abs(mins);
  const span = abs < 60 ? `${abs}m` : abs < 1440 ? `${Math.floor(abs / 60)}h ${abs % 60}m` : `${Math.floor(abs / 1440)}d`;
  if (abs < 1) return "now";
  return mins > 0 ? `in ${span}` : `overdue by ${span}`;
};

// What the auto-dialer (jobs/callingCallbackTick.js) has done with this row,
// so a callback that is waiting on a busy agent doesn't look like one the
// system forgot.
const autoCallLabel = (cb) => {
  if (cb.status !== "Pending") return <span className="hub-badge hub-badge-gray">—</span>;
  if (cb.autoDialGaveUpAt) return <span className="hub-badge hub-badge-red">gave up — call by hand</span>;
  if (cb.dialAttempts) return <span className="hub-badge hub-badge-yellow">tried {cb.dialAttempts}×</span>;
  if (new Date(cb.scheduledAt) <= new Date()) return <span className="hub-badge hub-badge-blue">due — waiting for agent</span>;
  return <span className="hub-badge hub-badge-green">will auto-call</span>;
};

export default function Callbacks() {
  const [data, setData] = useState(null);
  const [dialingId, setDialingId] = useState(null);

  // Call the contact straight off the row — the whole point of this screen
  // is "these people are due a call back", so making the agent copy the
  // number into the Dialer is a pointless hop. The in-call modal opens by
  // itself once the call starts (see shared.dialContact).
  const callNow = async (cb) => {
    setDialingId(cb._id);
    const r = await dialContact({
      phone: cb.phone,
      contactName: cb.contactName,
      callLead: cb.callLead,
      campaign: cb.campaign?._id || cb.campaign,
    });
    setDialingId(null);
    if (r.ok) message.success(r.message || "Calling…");
    else message.error(r.message || "Could not start the call.");
  };

  const load = async () => {
    const r = await request.get({ entity: "calling/callbacks?scope=all" });
    if (r?.success) setData(r.result);
  };
  usePoll(load, 15000);

  const setStatus = async (cb, status) => {
    await request.patch({ entity: `calling/callbacks/${cb._id}`, jsonData: { status } });
    load();
  };

  const Group = ({ title, rows, tone }) => (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3>
          {title}{" "}
          <span className={`hub-badge ${tone === "red" ? "hub-badge-red" : tone === "amber" ? "hub-badge-yellow" : tone === "gray" ? "hub-badge-gray" : "hub-badge-blue"}`}>
            {rows.length}
          </span>
        </h3>
      </div>
      {rows.length === 0 ? (
        <div className="hub-empty">Nothing here.</div>
      ) : (
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr><th>Contact</th><th>Phone</th><th>Scheduled date</th><th>Time</th><th>Auto-call</th><th>Campaign</th><th>Assigned</th><th>Notes</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((cb) => (
                <tr key={cb._id} style={tone === "red" ? { background: "#fef2f2" } : undefined}>
                  <td>{cb.contactName || "—"}</td>
                  <td>{cb.phone || "—"}</td>
                  <td style={tone === "red" ? { color: "#dc2626", fontWeight: 700 } : undefined}>
                    {fmtCallbackDate(cb.scheduledAt)}
                  </td>
                  <td style={tone === "red" ? { color: "#dc2626", fontWeight: 700 } : { fontWeight: 600 }}>
                    {fmtCallbackTime(cb.scheduledAt)}
                    <div style={{ fontSize: 11, fontWeight: 400, color: "var(--hub-muted)" }}>
                      {relativeToNow(cb.scheduledAt)}
                    </div>
                  </td>
                  <td>{autoCallLabel(cb)}</td>
                  <td>{cb.campaign?.name || "—"}</td>
                  <td>{cb.assignedAgentName || "—"}</td>
                  <td style={{ maxWidth: 180, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {cb.notes || "—"}
                  </td>
                  <td><span className="hub-badge hub-badge-gray">{cb.status}</span></td>
                  <td>
                    <div className="hub-row" style={{ gap: 6 }}>
                      {cb.phone && (
                        <button
                          type="button"
                          className="hub-btn hub-btn-primary"
                          style={{ padding: "4px 10px" }}
                          disabled={dialingId === cb._id}
                          onClick={() => callNow(cb)}
                        >
                          <PhoneOutlined /> {dialingId === cb._id ? "Calling…" : "Call"}
                        </button>
                      )}
                      {cb.status === "Pending" && (
                        <>
                          <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} onClick={() => setStatus(cb, "Done")}>Done</button>
                          <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} onClick={() => setStatus(cb, "Missed")}>Missed</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><CalendarOutlined /> Callbacks</h3>
          <button type="button" className="hub-btn" onClick={load}>Refresh</button>
        </div>
        <div style={{ fontSize: 12.5, color: "#8c8c8c" }}>Callbacks agents scheduled, plus missed inbound calls logged automatically when no one was available. Each one is dialled on its own at the promised time, as soon as the agent who took it is free — overdue ones are highlighted, and you can always call from the row.</div>
      </div>

      {!data && <div className="hub-card"><div className="hub-empty">Loading…</div></div>}
      {data && (
        <>
          <Group title="Overdue" rows={data.overdue} tone="red" />
          <Group title="Today" rows={data.today} tone="amber" />
          <Group title="Upcoming" rows={data.upcoming} tone="blue" />
          <Group title="Completed" rows={data.completed} tone="gray" />
        </>
      )}
    </div>
  );
}
