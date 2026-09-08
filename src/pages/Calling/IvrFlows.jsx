import React, { useEffect, useState } from "react";
import { request } from "@/request";
import HubModal from "@/components/HubModal";
import { PlusOutlined, DeleteOutlined, ApartmentOutlined } from "@ant-design/icons";
import { useCallingMeta } from "./shared";

const BLANK = {
  name: "",
  description: "",
  direction: "Inbound",
  greeting: "Thank you for calling. Press 1 for Sales, 2 for Support.",
  promptKey: "main",
  options: [
    { digit: "1", label: "Sales", action: "route_team", targetTeam: "", targetAgent: "", targetNumber: "" },
    { digit: "2", label: "Support", action: "route_team", targetTeam: "", targetAgent: "", targetNumber: "" },
  ],
  noInputAction: "repeat",
  invalidAction: "repeat",
  fallbackTeam: "",
  fallbackNumber: "",
  providerFlowId: "",
  enabled: true,
};

const ACTIONS = [
  { v: "route_team", l: "Route to team" },
  { v: "route_agent", l: "Route to agent" },
  { v: "route_number", l: "Route to number" },
  { v: "voicemail", l: "Voicemail" },
  { v: "hangup", l: "Hang up" },
  { v: "capture", l: "Capture only (survey)" },
];

export default function IvrFlows() {
  const meta = useCallingMeta();
  const canManage = meta.tier === "admin" || meta.tier === "manager";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    const r = await request.get({ entity: "calling/ivr-flows" });
    setRows(r?.success ? r.result : []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async (form) => {
    const r = form._id
      ? await request.patch({ entity: `calling/ivr-flows/${form._id}`, jsonData: form })
      : await request.post({ entity: "calling/ivr-flows", jsonData: form });
    if (r?.success) {
      setEditing(null);
      load();
    } else {
      window.alert(r?.message || "Could not save IVR flow.");
    }
  };

  const del = async (row) => {
    if (!window.confirm(`Delete IVR flow "${row.name}"?`)) return;
    const r = await request.delete({ entity: `calling/ivr-flows/${row._id}` });
    if (r?.success) load();
    else window.alert(r?.message || "Delete failed.");
  };

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>
            <ApartmentOutlined /> IVR Flows
          </h3>
          {canManage && (
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setEditing({ ...BLANK })}>
              <PlusOutlined /> New IVR Flow
            </button>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 10 }}>
          The menu callers hear and where each keypress routes. Audio &amp; digit gathering run on the Edesy voice-agent;
          this is the CRM copy that labels pressed digits in Call History and drives the transfer.
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Direction</th>
                <th>Options</th>
                <th>Provider Flow ID</th>
                <th>Status</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6}>
                    <div className="hub-empty">Loading…</div>
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="hub-empty">No IVR flows yet.</div>
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => (
                  <tr key={r._id}>
                    <td style={{ fontWeight: 600 }}>
                      {canManage ? (
                        <button
                          type="button"
                          className="hub-link"
                          style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "#2563eb", cursor: "pointer", fontWeight: 600 }}
                          onClick={() => setEditing({ ...BLANK, ...r, options: (r.options || []).map((o) => ({ ...o, targetAgent: o.targetAgent?._id || o.targetAgent || "" })) })}
                        >
                          {r.name}
                        </button>
                      ) : (
                        r.name
                      )}
                      {r.description && <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>{r.description}</div>}
                    </td>
                    <td>{r.direction}</td>
                    <td style={{ fontSize: 12 }}>
                      {(r.options || []).map((o) => `${o.digit}=${o.label}`).join("  ·  ") || "—"}
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{r.providerFlowId || "—"}</td>
                    <td>
                      <span className={`hub-badge ${r.enabled === false ? "hub-badge-gray" : "hub-badge-green"}`}>
                        {r.enabled === false ? "Disabled" : "Enabled"}
                      </span>
                    </td>
                    {canManage && (
                      <td>
                        <button type="button" className="hub-btn" style={{ padding: "4px 10px", color: "#dc2626" }} onClick={() => del(r)}>
                          <DeleteOutlined />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <IvrForm flow={editing} meta={meta} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function IvrForm({ flow, meta, onClose, onSave }) {
  const [f, setF] = useState(flow);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const setOpt = (i, k, v) =>
    setF((s) => ({ ...s, options: s.options.map((o, idx) => (idx === i ? { ...o, [k]: v } : o)) }));
  const addOpt = () =>
    setF((s) => ({
      ...s,
      options: [...s.options, { digit: "", label: "", action: "route_team", targetTeam: "", targetAgent: "", targetNumber: "" }],
    }));
  const rmOpt = (i) => setF((s) => ({ ...s, options: s.options.filter((_, idx) => idx !== i) }));

  const submit = () => {
    if (!f.name.trim()) return setErr("Name is required.");
    const clean = f.options.filter((o) => String(o.digit).trim() && String(o.label).trim());
    if (clean.length === 0) return setErr("Add at least one menu option (digit + label).");
    onSave({ ...f, options: clean });
  };

  return (
    <HubModal
      open
      onClose={onClose}
      title={f._id ? `Edit — ${flow.name}` : "New IVR Flow"}
      subtitle="Greeting, menu options, routing & fallbacks"
      width={640}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit}>
            Save
          </button>
        </>
      }
    >
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Name</label>
          <input className="hub-input" value={f.name} onChange={set("name")} />
        </div>
        <div className="hub-form-row">
          <label>Direction</label>
          <select className="hub-select" value={f.direction} onChange={set("direction")}>
            <option value="Inbound">Inbound</option>
            <option value="Outbound">Outbound (survey)</option>
          </select>
        </div>
      </div>
      <div className="hub-form-row">
        <label>Description</label>
        <input className="hub-input" value={f.description || ""} onChange={set("description")} />
      </div>
      <div className="hub-form-row">
        <label>Greeting (TTS)</label>
        <textarea className="hub-input" rows={2} value={f.greeting} onChange={set("greeting")} />
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Prompt key (provider gather node)</label>
          <input className="hub-input" value={f.promptKey} onChange={set("promptKey")} />
        </div>
        <div className="hub-form-row">
          <label>Provider Flow ID (Edesy agentId)</label>
          <input className="hub-input" value={f.providerFlowId || ""} onChange={set("providerFlowId")} />
        </div>
      </div>

      <div className="hub-form-row">
        <label>Menu Options</label>
        <div style={{ border: "1px solid #eef0f4", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {f.options.map((o, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 1fr 1fr 1fr 32px", gap: 6, alignItems: "center" }}>
              <input className="hub-input" style={{ padding: "6px 8px" }} placeholder="1" value={o.digit} onChange={(e) => setOpt(i, "digit", e.target.value)} />
              <input className="hub-input" style={{ padding: "6px 8px" }} placeholder="Label (e.g. Sales)" value={o.label} onChange={(e) => setOpt(i, "label", e.target.value)} />
              <select className="hub-select" style={{ padding: "6px 8px" }} value={o.action} onChange={(e) => setOpt(i, "action", e.target.value)}>
                {ACTIONS.map((a) => (
                  <option key={a.v} value={a.v}>
                    {a.l}
                  </option>
                ))}
              </select>
              {o.action === "route_team" && (
                <select className="hub-select" style={{ padding: "6px 8px" }} value={o.targetTeam || ""} onChange={(e) => setOpt(i, "targetTeam", e.target.value)}>
                  <option value="">— team —</option>
                  {(meta.teams || []).map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              {o.action === "route_agent" && (
                <select className="hub-select" style={{ padding: "6px 8px" }} value={o.targetAgent || ""} onChange={(e) => setOpt(i, "targetAgent", e.target.value)}>
                  <option value="">— agent —</option>
                  {(meta.agents || []).map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              {o.action === "route_number" && (
                <input className="hub-input" style={{ padding: "6px 8px" }} placeholder="+91…" value={o.targetNumber || ""} onChange={(e) => setOpt(i, "targetNumber", e.target.value)} />
              )}
              {["voicemail", "hangup", "capture"].includes(o.action) && <span style={{ fontSize: 11, color: "var(--hub-muted)" }}>—</span>}
              <button type="button" className="hub-btn" style={{ padding: "4px 8px", color: "#dc2626" }} onClick={() => rmOpt(i)}>
                <DeleteOutlined />
              </button>
            </div>
          ))}
          <button type="button" className="hub-btn" style={{ alignSelf: "flex-start", padding: "4px 10px" }} onClick={addOpt}>
            <PlusOutlined /> Add option
          </button>
        </div>
      </div>

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>No-input action</label>
          <select className="hub-select" value={f.noInputAction} onChange={set("noInputAction")}>
            {["repeat", "route_team", "route_number", "voicemail", "hangup"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Invalid-key action</label>
          <select className="hub-select" value={f.invalidAction} onChange={set("invalidAction")}>
            {["repeat", "route_team", "route_number", "voicemail", "hangup"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Fallback team</label>
          <select className="hub-select" value={f.fallbackTeam || ""} onChange={set("fallbackTeam")}>
            <option value="">— none —</option>
            {(meta.teams || []).map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Fallback number</label>
          <input className="hub-input" value={f.fallbackNumber || ""} onChange={set("fallbackNumber")} placeholder="+91…" />
        </div>
      </div>
      <div className="hub-form-row">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={f.enabled !== false} onChange={(e) => setF((s) => ({ ...s, enabled: e.target.checked }))} />
          Enabled
        </label>
      </div>

      {err && <span className="hub-badge hub-badge-red">{err}</span>}
    </HubModal>
  );
}
