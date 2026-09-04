import React, { useEffect, useState } from "react";
import { request } from "@/request";
import HubModal from "@/components/HubModal";
import {
  PlusOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  StopOutlined,
  UploadOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  CAMPAIGN_STATUS_BADGE,
  CAMPAIGN_TYPES,
  PRIORITIES,
  fmtDate,
  useCallingMeta,
  openTel,
} from "./shared";
import { PhoneOutlined } from "@ant-design/icons";

const BLANK = {
  name: "",
  description: "",
  campaignType: "Outbound",
  team: "",
  agents: [],
  startDate: "",
  endDate: "",
  callingHoursStart: "09:00",
  callingHoursEnd: "18:00",
  priority: "Normal",
  callerId: "",
  dialRatio: 1,
};

export default function Campaigns() {
  const meta = useCallingMeta();
  const canManage = meta.tier === "admin" || meta.tier === "manager";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusF, setStatusF] = useState("All");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const [editing, setEditing] = useState(null); // null | {} | campaign
  const [detail, setDetail] = useState(null); // campaign for the detail view

  const load = async (p = page) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), items: "20" });
    if (statusF !== "All") params.set("status", statusF);
    if (q) params.set("q", q);
    const r = await request.get({ entity: `calling/campaigns?${params}` });
    setRows(r?.success ? r.result : []);
    setPages(r?.pagination?.pages || 1);
    setPage(p);
    setLoading(false);
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusF]);

  const save = async (form) => {
    const payload = { ...form, dialRatio: Number(form.dialRatio) || 1 };
    const r = form._id
      ? await request.patch({ entity: `calling/campaigns/${form._id}`, jsonData: payload })
      : await request.post({ entity: "calling/campaigns", jsonData: payload });
    if (r?.success) {
      setEditing(null);
      load();
    }
  };

  const act = async (c, action) => {
    if ((action === "complete" || action === "cancel") && !window.confirm(`Mark "${c.name}" as ${action}?`)) return;
    const r = await request.post({ entity: `calling/campaigns/${c._id}/action`, jsonData: { action } });
    if (r?.success) {
      load();
      if (detail && detail._id === c._id) setDetail(r.result);
    }
  };

  if (detail) {
    return (
      <CampaignDetail
        campaign={detail}
        meta={meta}
        onBack={() => {
          setDetail(null);
          load();
        }}
        onAction={act}
      />
    );
  }

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Call Campaigns</h3>
          {canManage && (
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setEditing({ ...BLANK })}>
              <PlusOutlined /> New Campaign
            </button>
          )}
        </div>

        <div className="hub-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <select className="hub-select" style={{ maxWidth: 160 }} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            {["All", "Draft", "Scheduled", "Active", "Paused", "Completed", "Cancelled"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            className="hub-input"
            style={{ maxWidth: 220 }}
            placeholder="Search name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(1)}
          />
          <button type="button" className="hub-btn" onClick={() => load(1)}>Search</button>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Type</th>
                <th>Status</th>
                <th>Leads</th>
                <th>Dialed</th>
                <th>Connected</th>
                <th>Agents</th>
                <th>Window</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9}><div className="hub-empty">Loading…</div></td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9}><div className="hub-empty">No campaigns yet.</div></td></tr>
              )}
              {!loading &&
                rows.map((c) => (
                  <tr key={c._id}>
                    <td>
                      <button
                        type="button"
                        className="hub-link"
                        style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "#2563eb", cursor: "pointer", fontWeight: 600 }}
                        onClick={() => setDetail(c)}
                      >
                        {c.name}
                      </button>
                      {c.priority && c.priority !== "Normal" && (
                        <span className="hub-badge hub-badge-yellow" style={{ marginLeft: 6 }}>{c.priority}</span>
                      )}
                    </td>
                    <td>{c.campaignType}</td>
                    <td><span className={`hub-badge ${CAMPAIGN_STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                    <td>{c.stats?.totalLeads ?? 0}</td>
                    <td>{c.stats?.dialed ?? 0}</td>
                    <td>{c.stats?.connected ?? 0}</td>
                    <td>{(c.agents || []).length}</td>
                    <td style={{ fontSize: 12 }}>
                      {c.callingHoursStart}–{c.callingHoursEnd}
                      <div style={{ color: "#94a3b8" }}>{fmtDate(c.startDate)}</div>
                    </td>
                    <td>
                      <div className="hub-row" style={{ gap: 6 }}>
                        {canManage && ["Draft", "Scheduled", "Paused"].includes(c.status) && (
                          <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} title="Start" onClick={() => act(c, "start")}>
                            <PlayCircleOutlined />
                          </button>
                        )}
                        {canManage && c.status === "Active" && (
                          <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} title="Pause" onClick={() => act(c, "pause")}>
                            <PauseCircleOutlined />
                          </button>
                        )}
                        {canManage && ["Active", "Paused"].includes(c.status) && (
                          <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} title="Complete" onClick={() => act(c, "complete")}>
                            <CheckCircleOutlined />
                          </button>
                        )}
                        {canManage && !["Completed", "Cancelled"].includes(c.status) && (
                          <button type="button" className="hub-btn" style={{ padding: "4px 10px", color: "#dc2626" }} title="Cancel" onClick={() => act(c, "cancel")}>
                            <StopOutlined />
                          </button>
                        )}
                        {canManage && (
                          <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} onClick={() => setEditing({ ...c, agents: (c.agents || []).map((a) => a._id || a) })}>
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="hub-row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => load(page - 1)}>
              <LeftOutlined /> Prev
            </button>
            <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => load(page + 1)}>
              Next <RightOutlined />
            </button>
          </div>
        )}
      </div>

      {editing && (
        <CampaignForm campaign={editing} meta={meta} onClose={() => setEditing(null)} onSave={save} />
      )}
    </div>
  );
}

// ── create / edit modal ───────────────────────────────────────────────
function CampaignForm({ campaign, meta, onClose, onSave }) {
  const [f, setF] = useState(campaign);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toggleAgent = (id) =>
    setF((s) => ({ ...s, agents: s.agents.includes(id) ? s.agents.filter((x) => x !== id) : [...s.agents, id] }));

  const submit = () => {
    if (!f.name.trim()) return setErr("Campaign name is required.");
    onSave(f);
  };

  return (
    <HubModal
      open
      onClose={onClose}
      title={f._id ? `Edit — ${campaign.name}` : "New Campaign"}
      subtitle="Fields, team, agents, calling window"
      width={560}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit}>Save</button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Campaign Name</label>
        <input className="hub-input" value={f.name} onChange={set("name")} />
      </div>
      <div className="hub-form-row">
        <label>Description</label>
        <textarea className="hub-input" rows={2} value={f.description} onChange={set("description")} />
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Type</label>
          <select className="hub-select" value={f.campaignType} onChange={set("campaignType")}>
            {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Priority</label>
          <select className="hub-select" value={f.priority} onChange={set("priority")}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Team</label>
          <select className="hub-select" value={f.team} onChange={set("team")}>
            <option value="">— none —</option>
            {(meta.teams || []).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Caller ID</label>
          <input className="hub-input" value={f.callerId} onChange={set("callerId")} placeholder="+91…" />
        </div>
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Start Date</label>
          <input type="date" className="hub-input" value={(f.startDate || "").slice(0, 10)} onChange={set("startDate")} />
        </div>
        <div className="hub-form-row">
          <label>End Date</label>
          <input type="date" className="hub-input" value={(f.endDate || "").slice(0, 10)} onChange={set("endDate")} />
        </div>
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Calling Hours Start</label>
          <input type="time" className="hub-input" value={f.callingHoursStart} onChange={set("callingHoursStart")} />
        </div>
        <div className="hub-form-row">
          <label>Calling Hours End</label>
          <input type="time" className="hub-input" value={f.callingHoursEnd} onChange={set("callingHoursEnd")} />
        </div>
      </div>
      <div className="hub-form-row">
        <label>Dial Ratio (lines per available agent)</label>
        <input type="number" min={1} max={5} className="hub-input" value={f.dialRatio} onChange={set("dialRatio")} />
      </div>
      <div className="hub-form-row">
        <label>Assigned Agents</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto", border: "1px solid #eef0f4", borderRadius: 8, padding: 8 }}>
          {(meta.agents || []).map((a) => (
            <label
              key={a._id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${f.agents.includes(a._id) ? "var(--hub-blue)" : "#e2e8f0"}`,
                background: f.agents.includes(a._id) ? "var(--hub-blue-soft, #eef4ff)" : "#fff",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={f.agents.includes(a._id)} onChange={() => toggleAgent(a._id)} />
              {a.name}
            </label>
          ))}
        </div>
      </div>
      {err && <span className="hub-badge hub-badge-red">{err}</span>}
    </HubModal>
  );
}

// ── campaign detail: leads + import + lifecycle ────────────────────────
function CampaignDetail({ campaign, meta, onBack, onAction }) {
  const canManage = meta.tier === "admin" || meta.tier === "manager";
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [statusF, setStatusF] = useState("All");
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  const load = async (p = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), items: "25" });
    if (statusF !== "All") params.set("status", statusF);
    if (q) params.set("q", q);
    const r = await request.get({ entity: `calling/campaigns/${campaign._id}/leads?${params}` });
    setLeads(r?.success ? r.result : []);
    setPages(r?.pagination?.pages || 1);
    setPage(p);
    setLoading(false);
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusF]);

  const doImport = async (file) => {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await request.post({ entity: `calling/campaigns/${campaign._id}/leads/import`, jsonData: fd });
    setImporting(false);
    setImportResult(r?.success ? r.result : { error: r?.message || "Import failed" });
    if (r?.success) load(1);
  };

  const s = campaign.stats || {};

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>
            <button type="button" className="hub-btn" style={{ marginRight: 10 }} onClick={onBack}>
              <LeftOutlined /> Campaigns
            </button>
            {campaign.name}{" "}
            <span className={`hub-badge ${CAMPAIGN_STATUS_BADGE[campaign.status]}`}>{campaign.status}</span>
          </h3>
          {canManage && (
            <div className="hub-row" style={{ gap: 6 }}>
              {["Draft", "Scheduled", "Paused"].includes(campaign.status) && (
                <button type="button" className="hub-btn hub-btn-primary" onClick={() => onAction(campaign, "start")}>
                  <PlayCircleOutlined /> Start
                </button>
              )}
              {campaign.status === "Active" && (
                <button type="button" className="hub-btn" onClick={() => onAction(campaign, "pause")}>
                  <PauseCircleOutlined /> Pause
                </button>
              )}
              {["Active", "Paused"].includes(campaign.status) && (
                <button type="button" className="hub-btn" onClick={() => onAction(campaign, "complete")}>
                  <CheckCircleOutlined /> Complete
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {[
            ["Total", s.totalLeads],
            ["Pending", s.pending],
            ["Dialed", s.dialed],
            ["Connected", s.connected],
            ["Failed", s.failed],
            ["Callbacks", s.callbacks],
          ].map(([l, v]) => (
            <div key={l} style={{ flex: "1 1 100px", background: "#f8fafc", border: "1px solid #eef0f4", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{v ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Leads</h3>
          {canManage && (
            <div className="hub-row" style={{ gap: 8 }}>
              <label className="hub-btn" style={{ cursor: "pointer" }}>
                <UploadOutlined /> {importing ? "Importing…" : "Import CSV / Excel"}
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={(e) => doImport(e.target.files?.[0])}
                />
              </label>
              <button type="button" className="hub-btn hub-btn-primary" onClick={() => setAddOpen(true)}>
                <PlusOutlined /> Add Lead
              </button>
            </div>
          )}
        </div>

        {importResult && (
          <div style={{ marginBottom: 10 }}>
            <span className={`hub-badge ${importResult.error ? "hub-badge-red" : "hub-badge-green"}`}>
              {importResult.error
                ? importResult.error
                : `Imported ${importResult.inserted} · ${importResult.duplicates} duplicates · ${importResult.invalid} invalid`}
            </span>
          </div>
        )}

        <div className="hub-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <select className="hub-select" style={{ maxWidth: 150 }} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            {["All", "New", "Queued", "Dialing", "Connected", "No Answer", "Busy", "Failed", "Completed", "Callback", "DNC"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <input className="hub-input" style={{ maxWidth: 220 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(1)} />
          <button type="button" className="hub-btn" onClick={() => load(1)}>Search</button>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Company</th>
                <th>Source</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Call</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7}><div className="hub-empty">Loading…</div></td></tr>}
              {!loading && leads.length === 0 && (
                <tr><td colSpan={7}><div className="hub-empty">No leads. Import a file or add one.</div></td></tr>
              )}
              {!loading &&
                leads.map((l) => (
                  <tr key={l._id}>
                    <td style={{ fontWeight: 600 }}>{l.name}</td>
                    <td>{l.phone}</td>
                    <td>{l.company || "—"}</td>
                    <td>{l.source || "—"}</td>
                    <td><span className="hub-badge hub-badge-gray">{l.status}</span></td>
                    <td>{l.attempts || 0}</td>
                    <td>
                      <button
                        type="button"
                        className="hub-btn"
                        style={{ padding: "4px 10px" }}
                        title="Call from your phone"
                        onClick={async () => {
                          let agentPhone;
                          try { agentPhone = localStorage.getItem("calling.agentPhone") || undefined; } catch { /* ignore */ }
                          const r = await request.post({
                            entity: "calling/manual/dial",
                            jsonData: { phone: l.phone, contactName: l.name, callLead: l._id, campaign: campaign._id, agentPhone },
                          });
                          if (r?.success) {
                            if (r.result?.tel) openTel(r.result.tel);
                            // bridged (cloud provider): the provider rings the agent's phone — nothing to open.
                            load(page);
                          } else {
                            window.alert(r?.message || "Could not start the call.");
                          }
                        }}
                      >
                        <PhoneOutlined /> Call
                      </button>
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

      {addOpen && (
        <AddLeadModal
          campaignId={campaign._id}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            load(1);
          }}
        />
      )}
    </div>
  );
}

function AddLeadModal({ campaignId, onClose, onDone }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", company: "", source: "Manual", notes: "" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    if (!f.name.trim()) return setErr("Name is required.");
    if (f.phone.replace(/\D/g, "").length < 8) return setErr("Enter a valid phone number.");
    const r = await request.post({ entity: `calling/campaigns/${campaignId}/leads`, jsonData: f });
    if (r?.success) onDone();
    else setErr(r?.message || "Could not add lead.");
  };
  return (
    <HubModal
      open
      onClose={onClose}
      title="Add Lead"
      width={440}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit}>Add</button>
        </>
      }
    >
      <div className="hub-grid-2">
        <div className="hub-form-row"><label>Name</label><input className="hub-input" value={f.name} onChange={set("name")} /></div>
        <div className="hub-form-row"><label>Phone</label><input className="hub-input" value={f.phone} onChange={set("phone")} /></div>
        <div className="hub-form-row"><label>Email</label><input className="hub-input" value={f.email} onChange={set("email")} /></div>
        <div className="hub-form-row"><label>Company</label><input className="hub-input" value={f.company} onChange={set("company")} /></div>
      </div>
      <div className="hub-form-row"><label>Source</label><input className="hub-input" value={f.source} onChange={set("source")} /></div>
      <div className="hub-form-row"><label>Notes</label><textarea className="hub-input" rows={2} value={f.notes} onChange={set("notes")} /></div>
      {err && <span className="hub-badge hub-badge-red">{err}</span>}
    </HubModal>
  );
}
