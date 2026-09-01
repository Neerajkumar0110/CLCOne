import React, { useEffect, useState } from "react";
import { request } from "@/request";
import { HistoryOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { CALL_STATUS_BADGE, fmtDuration, fmtDateTime, useCallingMeta } from "./shared";

const STATUSES = ["All", "completed", "connected", "no-answer", "busy", "failed", "voicemail", "transferred"];

export default function CallHistory() {
  const meta = useCallingMeta();
  const [campaigns, setCampaigns] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [f, setF] = useState({ q: "", campaign: "", agent: "", status: "All", from: "", to: "" });

  useEffect(() => {
    request.get({ entity: "calling/campaigns?items=100" }).then((r) => r?.success && setCampaigns(r.result));
  }, []);

  const load = async (p = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), items: "20" });
    Object.entries(f).forEach(([k, v]) => v && v !== "All" && params.set(k, v));
    const r = await request.get({ entity: `calling/history?${params}` });
    setRows(r?.success ? r.result : []);
    setPages(r?.pagination?.pages || 1);
    setPage(p);
    setLoading(false);
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dispLabel = (code) => (meta.dispositions || []).find((d) => d.code === code)?.label || code || "—";

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header"><h3><HistoryOutlined /> Call History</h3></div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
          <input className="hub-input" placeholder="Search contact / number / agent" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && load(1)} />
          <select className="hub-select" value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
          <select className="hub-select" value={f.agent} onChange={(e) => setF({ ...f, agent: e.target.value })}>
            <option value="">All agents</option>
            {(meta.agents || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
          </select>
          <select className="hub-select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" className="hub-input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <input type="date" className="hub-input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <div className="hub-row" style={{ gap: 8, marginBottom: 10 }}>
          <button type="button" className="hub-btn hub-btn-primary" onClick={() => load(1)}>Apply</button>
          <button type="button" className="hub-btn" onClick={() => { setF({ q: "", campaign: "", agent: "", status: "All", from: "", to: "" }); setTimeout(() => load(1), 0); }}>Clear</button>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Number</th>
                <th>Agent</th>
                <th>Campaign</th>
                <th>Date / Time</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Disposition</th>
                <th>Recording</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10}><div className="hub-empty">Loading…</div></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={10}><div className="hub-empty">No calls found.</div></td></tr>}
              {!loading &&
                rows.map((r) => (
                  <tr key={r._id}>
                    <td>{r.contactName || "—"}</td>
                    <td>{r.phone}</td>
                    <td>{r.agentName || "—"}</td>
                    <td>{r.campaign?.name || "—"}</td>
                    <td>{fmtDateTime(r.endedAt || r.created)}</td>
                    <td>{r.duration ? fmtDuration(r.duration) : "—"}</td>
                    <td><span className={`hub-badge ${CALL_STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                    <td>{dispLabel(r.disposition)}</td>
                    <td>
                      {r.recording?.status === "available" ? (
                        <span className="hub-badge hub-badge-green">available</span>
                      ) : r.recording?.status === "processing" ? (
                        <span className="hub-badge hub-badge-yellow">processing</span>
                      ) : (
                        <span className="hub-badge hub-badge-gray">—</span>
                      )}
                    </td>
                    <td style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.notes || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="hub-row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => load(page - 1)}><LeftOutlined /> Prev</button>
            <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => load(page + 1)}>Next <RightOutlined /></button>
          </div>
        )}
      </div>
    </div>
  );
}
