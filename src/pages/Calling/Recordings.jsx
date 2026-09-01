import React, { useEffect, useState } from "react";
import { request } from "@/request";
import HubModal from "@/components/HubModal";
import { PlayCircleOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { fmtDuration, fmtDateTime } from "./shared";

export default function Recordings() {
  const [campaigns, setCampaigns] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [f, setF] = useState({ campaign: "", status: "All" });
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    request.get({ entity: "calling/campaigns?items=100" }).then((r) => r?.success && setCampaigns(r.result));
  }, []);

  const load = async (p = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), items: "20" });
    if (f.campaign) params.set("campaign", f.campaign);
    if (f.status !== "All") params.set("status", f.status);
    const r = await request.get({ entity: `calling/recordings?${params}` });
    setRows(r?.success ? r.result : []);
    setPages(r?.pagination?.pages || 1);
    setPage(p);
    setLoading(false);
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const openDetail = async (row) => {
    const r = await request.get({ entity: `calling/recordings/${row._id}` });
    setDetail({ row, info: r?.success ? r.result : null });
  };

  const badge = (s) =>
    s === "available" ? "hub-badge-green" : s === "processing" ? "hub-badge-yellow" : "hub-badge-gray";

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header"><h3><PlayCircleOutlined /> Call Recordings</h3></div>

        <div className="hub-row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <select className="hub-select" style={{ maxWidth: 240 }} value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
          <select className="hub-select" style={{ maxWidth: 170 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {["All", "available", "processing", "unavailable"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr><th>Contact</th><th>Number</th><th>Agent</th><th>Campaign</th><th>Date / Time</th><th>Duration</th><th>Recording</th><th></th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="hub-empty">Loading…</div></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={8}><div className="hub-empty">No recordings.</div></td></tr>}
              {!loading &&
                rows.map((r) => (
                  <tr key={r._id}>
                    <td>{r.contactName || "—"}</td>
                    <td>{r.phone}</td>
                    <td>{r.agentName || "—"}</td>
                    <td>{r.campaign || "—"}</td>
                    <td>{fmtDateTime(r.at)}</td>
                    <td>{r.durationSec ? fmtDuration(r.durationSec) : "—"}</td>
                    <td><span className={`hub-badge ${badge(r.recordingStatus)}`}>{r.recordingStatus}</span></td>
                    <td>
                      <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} onClick={() => openDetail(r)}>Open</button>
                    </td>
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

      {detail && (
        <HubModal
          open
          onClose={() => setDetail(null)}
          title="Recording"
          subtitle={`${detail.row.contactName || "—"} · ${detail.row.phone}`}
          width={440}
          footer={<button type="button" className="hub-btn hub-btn-primary" onClick={() => setDetail(null)}>Close</button>}
        >
          <div className="hub-grid-2" style={{ gap: 12 }}>
            <Field label="Agent" value={detail.row.agentName} />
            <Field label="Campaign" value={detail.row.campaign} />
            <Field label="Date / Time" value={fmtDateTime(detail.row.at)} />
            <Field label="Duration" value={detail.info?.durationSec ? fmtDuration(detail.info.durationSec) : "—"} />
            <Field label="Status" value={detail.info?.status || detail.row.recordingStatus} />
          </div>
          <div style={{ marginTop: 14, background: "#f8fafc", border: "1px solid #eef0f4", borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "#475569" }}>
            {detail.info?.url ? (
              <audio controls src={detail.info.url} style={{ width: "100%" }} />
            ) : (
              detail.info?.testNote || "No audio available in test mode."
            )}
          </div>
        </HubModal>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13.5 }}>{value || "—"}</div>
    </div>
  );
}
