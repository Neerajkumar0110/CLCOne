import React, { useState } from "react";
import { request } from "@/request";
import { CalendarOutlined } from "@ant-design/icons";
import { fmtDateTime, usePoll } from "./shared";

export default function Callbacks() {
  const [data, setData] = useState(null);

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
              <tr><th>Contact</th><th>Phone</th><th>When</th><th>Campaign</th><th>Assigned</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((cb) => (
                <tr key={cb._id} style={tone === "red" ? { background: "#fef2f2" } : undefined}>
                  <td>{cb.contactName || "—"}</td>
                  <td>{cb.phone || "—"}</td>
                  <td style={tone === "red" ? { color: "#dc2626", fontWeight: 700 } : undefined}>{fmtDateTime(cb.scheduledAt)}</td>
                  <td>{cb.campaign?.name || "—"}</td>
                  <td>{cb.assignedAgentName || "—"}</td>
                  <td><span className="hub-badge hub-badge-gray">{cb.status}</span></td>
                  <td>
                    {cb.status === "Pending" && (
                      <div className="hub-row" style={{ gap: 6 }}>
                        <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} onClick={() => setStatus(cb, "Done")}>Done</button>
                        <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} onClick={() => setStatus(cb, "Missed")}>Missed</button>
                      </div>
                    )}
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
        <div style={{ fontSize: 12.5, color: "#8c8c8c" }}>Callbacks agents scheduled from the calling screen. Overdue ones are highlighted.</div>
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
