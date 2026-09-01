import React, { useState, useEffect } from "react";
import axios from "axios";
import { Tooltip, Collapse, ConfigProvider, message } from "antd";
import HubTabs from "@/components/HubTabs";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import { API_BASE_URL, BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";
import {
  STAGE_NAMES,
  QUICK_FILTERS,
  stageForStatus,
  stageConfig,
  stageColor,
  subStatusesFor,
  defaultSubStatus,
  isValidSubStatus,
  leadStageSub,
  badgeClassForStatus,
  toDatetimeLocal,
  toDateInput,
} from "@/config/leadStages";
import {
  UserAddOutlined,
  EditOutlined,
  ImportOutlined,
  ExportOutlined,
  DownloadOutlined,
  TeamOutlined,
  UserOutlined,
  InboxOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  SwapOutlined,
  ClearOutlined,
  PlusOutlined,
  LeftOutlined,
  RightOutlined,
  DeleteOutlined,
  CloseOutlined,
  FilterOutlined,
  RiseOutlined,
  FacebookOutlined,
  LinkOutlined,
  RocketOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  DisconnectOutlined,
  GoogleOutlined,
  LinkedinOutlined,
  GlobalOutlined,
} from "@ant-design/icons";

// Local token override so antd's Collapse/Tooltip pick up this page's blue
// accent instead of the app-wide teal primary color.
const HUB_ANTD_TOKENS = { colorPrimary: "var(--hub-blue)", borderRadius: 10 };

// Brand-colored icon badge per lead source, used on the "Where does this
// form run?" toggle and anywhere else a platform needs a quick visual tag.
const PLATFORM_ICON_META = {
  Website: { icon: <GlobalOutlined />, color: "#0ea5e9" },
  "Facebook Ads": { icon: <FacebookOutlined />, color: "#1877F2" },
  "Google Ads": { icon: <GoogleOutlined />, color: "#EA4335" },
  "LinkedIn Ads": { icon: <LinkedinOutlined />, color: "#0A66C2" },
};

// Shows up to `max` team badges, collapsing the rest into a "+N" badge whose
// tooltip lists everything that didn't fit.
function TeamBadgeList({ teams, max = 2 }) {
  if (!teams || teams.length === 0) return "—";
  const shown = teams.slice(0, max);
  const hidden = teams.slice(max);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {shown.map((t) => (
        <span key={t.team} className="hub-badge hub-badge-blue">
          {t.team} · {t.count}
        </span>
      ))}
      {hidden.length > 0 && (
        <Tooltip title={hidden.map((t) => `${t.team} · ${t.count}`).join(", ")}>
          <span className="hub-badge hub-badge-gray" style={{ cursor: "default" }}>
            +{hidden.length}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

// Back-compat shim: every call site does `STATUS_META[lead.status]` to get a
// hub-badge-* class. Statuses are now the ~28 combined pipeline values (see
// config/leadStages.js), so resolve the class through the stage lookup
// instead of a fixed 5-key map.
const STATUS_META = new Proxy(
  {},
  { get: (_t, key) => badgeClassForStatus(typeof key === "string" ? key : "") }
);

function DetailField({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, color: "#101828" }}>{value || "—"}</div>
    </div>
  );
}

// Extra detail that doesn't get its own table column (email + location +
// secondary phone) — rendered inside a Tooltip when the user hovers a
// lead's name in the Unassigned Leads table. Returns null when the lead
// has none of it, so no empty tooltip pops up.
function leadHoverDetail(lead) {
  const rows = [
    ["Email", lead.email],
    ["Alt. Phone", lead.alternatePhone],
    ["City", lead.city],
    ["State", lead.state],
    ["Country", lead.country],
    ["Zipcode", lead.zipcode],
  ].filter(([, v]) => v);
  if (rows.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 3, fontSize: 12, lineHeight: 1.5, padding: "2px 0" }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <span style={{ opacity: 0.6 }}>{k}:</span> {v}
        </div>
      ))}
    </div>
  );
}

// Shared across every lead table (Captured Leads, Unassigned Leads, All
// Leads) — the capture-form custom questions (budget/timeline/message) are
// saved on every Lead but don't fit any table's columns, so they only show
// here.
function LeadDetailModal({ lead, onClose }) {
  if (!lead) return null;
  return (
    <HubModal
      open={!!lead}
      onClose={onClose}
      title={lead.name}
      subtitle={lead.phone}
      width={480}
      footer={<button type="button" className="hub-btn hub-btn-primary" onClick={onClose}>Close</button>}
    >
      <div className="hub-stack" style={{ gap: 16 }}>
        <div className="hub-grid-2">
          <DetailField label="Email" value={lead.email} />
          <DetailField label="Phone" value={lead.phone} />
          <DetailField label="Source" value={lead.source} />
          <DetailField
            label="Stage"
            value={
              (lead.stage || lead.status) && (
                <span className={`hub-badge ${STATUS_META[lead.stage || lead.status]}`}>
                  {lead.stage || stageForStatus(lead.status)}
                </span>
              )
            }
          />
          <DetailField label="Sub-Status" value={lead.subStatus} />
          <DetailField label="Assigned To" value={lead.assignedUserName || (lead.assignedUser && lead.assignedUser.name)} />
          <DetailField label="Team" value={lead.team || "Unassigned"} />
          <DetailField label="Position" value={lead.position} />
          <DetailField label="Stage Updated" value={lead.stageUpdatedAt ? new Date(lead.stageUpdatedAt).toLocaleString() : null} />
          <DetailField label="Last Contact" value={lead.lastContactAt ? new Date(lead.lastContactAt).toLocaleString() : null} />
          <DetailField label="Next Follow-up" value={lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleString() : null} />
          {lead.callBackAt && (
            <DetailField label="Call Back On" value={new Date(lead.callBackAt).toLocaleString()} />
          )}
          {lead.meetingAt && (
            <DetailField label="Meeting On" value={new Date(lead.meetingAt).toLocaleString()} />
          )}
          {lead.futureFollowUpAt && (
            <DetailField label="Expected Follow-up" value={new Date(lead.futureFollowUpAt).toLocaleDateString()} />
          )}
          {lead.enrolledAt && (
            <DetailField label="Enrolled On" value={new Date(lead.enrolledAt).toLocaleDateString()} />
          )}
          {lead.registrationLink && <DetailField label="Registration Link" value={lead.registrationLink} />}
          <DetailField label="Alt. Phone" value={lead.alternatePhone} />
          <DetailField label="City" value={lead.city} />
          <DetailField label="State" value={lead.state} />
          <DetailField label="Country" value={lead.country} />
          <DetailField label="Zipcode" value={lead.zipcode} />
          <DetailField label="Budget Range" value={lead.budgetRange} />
          <DetailField label="How Soon to Start" value={lead.howSoonToStart} />
        </div>

        {lead.remarks && (
          <div>
            <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 600 }}>
              Remarks / Notes
            </div>
            <div style={{ fontSize: 13, color: "#101828", padding: "10px 12px", background: "#f8f9fc", border: "1px solid #f0f0f0", borderRadius: 8 }}>
              {lead.remarks}
            </div>
          </div>
        )}

        {Array.isArray(lead.stageHistory) && lead.stageHistory.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 600 }}>
              Stage Change History
            </div>
            <div style={{ display: "grid", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {[...lead.stageHistory].reverse().map((h, i) => (
                <div key={i} style={{ fontSize: 12, color: "#334155", display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: stageColor(h.toStage), flexShrink: 0, marginTop: 5 }} />
                  <span style={{ flex: 1 }}>
                    <strong>{h.fromStage ? `${h.fromStage} → ` : ""}{h.toStage}</strong>
                    {h.toSubStatus ? ` · ${h.toSubStatus}` : ""}
                    {h.remarks ? <span style={{ color: "#64748b" }}> — {h.remarks}</span> : ""}
                    <span style={{ color: "#94a3b8" }}>
                      {" "}· {h.changedByName || "system"} · {h.at ? new Date(h.at).toLocaleString() : ""}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 600 }}>
            Message
          </div>
          <div
            style={{
              fontSize: 13, color: "#101828", padding: "10px 12px",
              background: "#f8f9fc", border: "1px solid #f0f0f0", borderRadius: 8, minHeight: 44,
            }}
          >
            {lead.message || "—"}
          </div>
        </div>

        <div style={{ fontSize: 11.5, color: "#8c8c8c" }}>
          Captured {lead.created ? new Date(lead.created).toLocaleString() : "—"}
        </div>
      </div>
    </HubModal>
  );
}

const POSITIONS = ["SDR", "Account Executive", "Senior Agent", "Team Lead", "Manager"];

const AVATAR_COLORS = ["#2563EB", "#722ED1", "#13C2C2", "#FA8C16", "#EB2F96", "#52C41A"];

// All team-related data now comes from the real `team` API (backend/src/models/appModels/Team.js) —
// this hook is shared by every place in this page that needs the current team list.
function useTeams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await request.listAll({ entity: "team" });
      setTeams(res?.success ? res.result : []);
      setLoading(false);
    })();
  }, []);

  return { teams, teamNames: teams.map((t) => t.name), loading };
}

// GET /api/lead/export needs an auth header, so it can't be a plain <a href> —
// fetch it as a blob and trigger the browser's save dialog manually.
async function downloadLeadsExport(format, team) {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const params = new URLSearchParams({ format });
  if (team) params.set("team", team);

  const res = await axios.get(`${API_BASE_URL}lead/export?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    responseType: "blob",
  });

  const blob = new Blob([res.data]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = format === "excel" ? "leads-export.xlsx" : "leads-export.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function AddLeadModal({ open, onClose, onAdd, teamNames, admins }) {
  const blank = () => ({
    name: "",
    phone: "",
    email: "",
    source: "Website",
    team: teamNames[0] || "",
    position: POSITIONS[0],
    stage: "New Lead",
    subStatus: defaultSubStatus("New Lead"),
    callBackAt: null,
    meetingAt: null,
    futureFollowUpAt: null,
    enrolledAt: null,
    nextFollowUpAt: null,
    registrationLink: "",
    registrationLinkSharedAt: null,
    assignedUser: null,
    remarks: "",
  });
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState("");

  useEffect(() => {
    setForm((f) => ({ ...f, team: f.team || teamNames[0] || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamNames.length]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = () => {
    if (!form.name.trim()) {
      setErr("Client name is required.");
      return;
    }
    const pErr = pipelineFormError(form);
    if (pErr) {
      setErr(pErr);
      return;
    }
    onAdd({
      ...form,
      image: null,
      color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    });
    setForm(blank());
    setErr("");
    onClose();
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="Add New Lead"
      subtitle="Set the stage, sub-status and owner"
      width={520}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit}>
            Add Lead
          </button>
        </>
      }
    >
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Client Name</label>
          <input className="hub-input" value={form.name} onChange={set("name")} placeholder="e.g. Rohan Malhotra" />
        </div>
        <div className="hub-form-row">
          <label>Phone</label>
          <input className="hub-input" value={form.phone} onChange={set("phone")} placeholder="+91 90000 00000" />
        </div>
      </div>

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Email</label>
          <input className="hub-input" value={form.email} onChange={set("email")} placeholder="name@example.com" />
        </div>
        <div className="hub-form-row">
          <label>Source</label>
          <select className="hub-select" value={form.source} onChange={set("source")}>
            {["Website", "Facebook Ads", "Referral", "Cold Call", "WhatsApp", "Import", "Other"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Team</label>
          <select className="hub-select" value={form.team} onChange={set("team")}>
            {teamNames.length === 0 && <option value="">No teams yet</option>}
            {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Position</label>
          <select className="hub-select" value={form.position} onChange={set("position")}>
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <PipelineFields form={form} setForm={setForm} admins={admins} />

      {err && (
        <div style={{ marginTop: 8 }}>
          <span className="hub-badge hub-badge-red">{err}</span>
        </div>
      )}
    </HubModal>
  );
}

// Returns the client-side validation error for a lead form's pipeline
// selection, or "" when valid. Mirrors the backend rules in
// leadController/stageValidation.js.
function pipelineFormError(form) {
  const cfg = stageConfig(form.stage);
  if (!cfg) return "Pick a lead stage.";
  if (!isValidSubStatus(form.stage, form.subStatus)) return "Pick a sub-status for this stage.";
  if (cfg.requiresCallBack && !form.callBackAt) return "Callback date & time are mandatory for “Call Back”.";
  if (cfg.meetingSubStatuses && cfg.meetingSubStatuses.includes(form.subStatus) && !form.meetingAt)
    return `Meeting date & time are required for “${form.subStatus}”.`;
  return "";
}

// One reusable block: Stage + dependent Sub-Status + whatever extra
// date/link fields the chosen stage needs + assigned user, follow-up and
// remarks. Reads/writes `form` via `setForm`.
function PipelineFields({ form, setForm, admins = [], showChangeReason = false }) {
  const cfg = stageConfig(form.stage) || {};
  const subs = subStatusesFor(form.stage);
  const patch = (p) => setForm((f) => ({ ...f, ...p }));

  const onStage = (e) => {
    const stage = e.target.value;
    patch({
      stage,
      subStatus: defaultSubStatus(stage),
      // drop stage-specific captures that no longer apply
      callBackAt: stage === "Call Back" ? form.callBackAt : null,
      meetingAt: stage === "Sales Meeting" ? form.meetingAt : null,
      futureFollowUpAt: stage === "Future Prospects" ? form.futureFollowUpAt : null,
      enrolledAt: stage === "Enrolled" ? form.enrolledAt : null,
      registrationLink: stage === "Opportunity" ? form.registrationLink : "",
    });
  };

  const needMeeting = cfg.meetingSubStatuses && cfg.meetingSubStatuses.includes(form.subStatus);
  const needLink = cfg.linkSubStatuses && cfg.linkSubStatuses.includes(form.subStatus);

  return (
    <>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Lead Stage</label>
          <select className="hub-select" value={form.stage} onChange={onStage}>
            {STAGE_NAMES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Sub-Status</label>
          <select
            className="hub-select"
            value={form.subStatus}
            onChange={(e) => patch({ subStatus: e.target.value })}
          >
            {subs.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {cfg.description && (
        <div style={{ fontSize: 11.5, color: "#8c8c8c", marginTop: -4, marginBottom: 6 }}>
          {cfg.description}
        </div>
      )}

      {cfg.requiresCallBack && (
        <div className="hub-form-row">
          <label>
            Callback Date &amp; Time <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <input
            type="datetime-local"
            className="hub-input"
            value={toDatetimeLocal(form.callBackAt)}
            onChange={(e) =>
              patch({ callBackAt: e.target.value ? new Date(e.target.value).toISOString() : null })
            }
          />
        </div>
      )}

      {form.stage === "Sales Meeting" && (
        <div className="hub-form-row">
          <label>
            Meeting Date &amp; Time {needMeeting && <span style={{ color: "#ef4444" }}>*</span>}
          </label>
          <input
            type="datetime-local"
            className="hub-input"
            value={toDatetimeLocal(form.meetingAt)}
            onChange={(e) =>
              patch({ meetingAt: e.target.value ? new Date(e.target.value).toISOString() : null })
            }
          />
        </div>
      )}

      {form.stage === "Future Prospects" && (
        <div className="hub-form-row">
          <label>Expected Follow-up Date</label>
          <input
            type="date"
            className="hub-input"
            value={toDateInput(form.futureFollowUpAt)}
            onChange={(e) =>
              patch({ futureFollowUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })
            }
          />
        </div>
      )}

      {form.stage === "Enrolled" && (
        <div className="hub-form-row">
          <label>Registration / Enrollment Date</label>
          <input
            type="date"
            className="hub-input"
            value={toDateInput(form.enrolledAt)}
            onChange={(e) =>
              patch({ enrolledAt: e.target.value ? new Date(e.target.value).toISOString() : null })
            }
          />
        </div>
      )}

      {needLink && (
        <div className="hub-grid-2">
          <div className="hub-form-row">
            <label>Registration Link</label>
            <input
              className="hub-input"
              placeholder="https://…"
              value={form.registrationLink || ""}
              onChange={(e) => patch({ registrationLink: e.target.value })}
            />
          </div>
          <div className="hub-form-row">
            <label>Link Shared On</label>
            <input
              type="date"
              className="hub-input"
              value={toDateInput(form.registrationLinkSharedAt)}
              onChange={(e) =>
                patch({
                  registrationLinkSharedAt: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                })
              }
            />
          </div>
        </div>
      )}

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Assigned To</label>
          <select
            className="hub-select"
            value={form.assignedUser || ""}
            onChange={(e) => patch({ assignedUser: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {admins.map((a) => (
              <option key={a._id} value={a._id}>
                {`${a.name || ""} ${a.surname || ""}`.trim() || a.email}
              </option>
            ))}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Next Follow-up</label>
          <input
            type="datetime-local"
            className="hub-input"
            value={toDatetimeLocal(form.nextFollowUpAt)}
            onChange={(e) =>
              patch({ nextFollowUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })
            }
          />
        </div>
      </div>

      <div className="hub-form-row">
        <label>Remarks / Notes</label>
        <textarea
          className="hub-input"
          rows={2}
          value={form.remarks || ""}
          onChange={(e) => patch({ remarks: e.target.value })}
        />
      </div>

      {showChangeReason && (
        <div className="hub-form-row">
          <label>Reason for this stage change (optional)</label>
          <input
            className="hub-input"
            placeholder="e.g. Customer asked to be contacted next week"
            value={form.stageRemarks || ""}
            onChange={(e) => patch({ stageRemarks: e.target.value })}
          />
        </div>
      )}
    </>
  );
}


function EditLeadModal({ lead, onClose, onSave, teamNames, admins }) {
  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!lead) return;
    const { stage, subStatus } = leadStageSub(lead);
    setForm({
      ...lead,
      stage,
      subStatus,
      assignedUser:
        lead.assignedUser && typeof lead.assignedUser === "object"
          ? lead.assignedUser._id
          : lead.assignedUser || null,
      stageRemarks: "",
    });
    setErr("");
  }, [lead]);

  if (!lead || !form) return null;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const origin = leadStageSub(lead);
  const stageChanged = form.stage !== origin.stage || form.subStatus !== origin.subStatus;

  const submit = () => {
    if (!form.name.trim()) {
      setErr("Client name is required.");
      return;
    }
    const pErr = pipelineFormError(form);
    if (pErr) {
      setErr(pErr);
      return;
    }
    onSave(form);
  };

  return (
    <HubModal
      open={!!lead}
      onClose={onClose}
      title={`Edit — ${lead.name}`}
      subtitle="Stage, sub-status, schedule, owner & notes"
      width={540}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit}>
            Save Changes
          </button>
        </>
      }
    >
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Client Name</label>
          <input className="hub-input" value={form.name} onChange={set("name")} />
        </div>
        <div className="hub-form-row">
          <label>Phone</label>
          <input className="hub-input" value={form.phone} onChange={set("phone")} />
        </div>
      </div>

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Team</label>
          <select className="hub-select" value={form.team || ""} onChange={set("team")}>
            {teamNames.length === 0 && <option value="">No teams yet</option>}
            <option value="">Unassigned</option>
            {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Position</label>
          <select className="hub-select" value={form.position || POSITIONS[0]} onChange={set("position")}>
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <PipelineFields
        form={form}
        setForm={setForm}
        admins={admins}
        showChangeReason={stageChanged}
      />

      {err && (
        <div style={{ marginTop: 8 }}>
          <span className="hub-badge hub-badge-red">{err}</span>
        </div>
      )}

      {Array.isArray(lead.stageHistory) && lead.stageHistory.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700, marginBottom: 6 }}>
            Stage Change History
          </div>
          <div style={{ display: "grid", gap: 6, maxHeight: 160, overflowY: "auto" }}>
            {[...lead.stageHistory].reverse().map((h, i) => (
              <div key={i} style={{ fontSize: 12, color: "#334155", display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: stageColor(h.toStage), flexShrink: 0, marginTop: 5 }} />
                <span style={{ flex: 1 }}>
                  <strong>{h.fromStage ? `${h.fromStage} → ` : ""}{h.toStage}</strong>
                  {h.toSubStatus ? ` · ${h.toSubStatus}` : ""}
                  {h.remarks ? <span style={{ color: "#64748b" }}> — {h.remarks}</span> : ""}
                  <span style={{ color: "#94a3b8" }}>
                    {" "}· {h.changedByName || "system"} · {h.at ? new Date(h.at).toLocaleString() : ""}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </HubModal>
  );
}

const FOLLOWUP_TEMPLATES = {
  WhatsApp: [
    { name: "Quick Check-in", body: "Hi {{name}}, just checking in — do you have a few minutes to chat about your career goals?" },
    { name: "Resource Share", body: "Hi {{name}}, sharing a resource that might help with your search. Let me know if you have questions!" },
  ],
  Email: [
    { name: "Introduction", body: "Hi {{name}},\n\nThanks for your interest in Career Lab Consulting. I'd love to schedule a quick call to understand your goals.\n\nBest,\nTeam" },
    { name: "Follow-up Reminder", body: "Hi {{name}},\n\nJust following up on our last conversation — would you like to move forward?\n\nBest,\nTeam" },
  ],
};

function FollowUpModal({ lead, onClose }) {
  const [channel, setChannel] = useState("WhatsApp");
  const [templateIdx, setTemplateIdx] = useState(0);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setTemplateIdx(0);
    setSent(false);
  }, [lead, channel]);

  if (!lead) return null;

  const templates = FOLLOWUP_TEMPLATES[channel];
  const message = templates[templateIdx].body.replace("{{name}}", lead.name.split(" ")[0]);

  return (
    <HubModal
      open={!!lead}
      onClose={onClose}
      title={`Follow Up — ${lead.name}`}
      subtitle={lead.phone}
      width={440}
      footer={
        sent ? (
          <button type="button" className="hub-btn hub-btn-primary" onClick={onClose}>Close</button>
        ) : (
          <>
            <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setSent(true)}>
              Send via {channel}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <div className="hub-empty" style={{ color: "#16a34a" }}>
          ✓ Message sent to {lead.name} via {channel}.
        </div>
      ) : (
        <>
          <div className="hub-btn-group" style={{ marginBottom: 16 }}>
            {["WhatsApp", "Email"].map((c) => (
              <button
                key={c}
                type="button"
                className="hub-btn"
                style={
                  channel === c
                    ? { background: "var(--hub-blue)", color: "#fff", borderColor: "var(--hub-blue)" }
                    : {}
                }
                onClick={() => setChannel(c)}
              >
                {c === "WhatsApp" ? "💬" : "📧"} {c}
              </button>
            ))}
          </div>

          <div className="hub-form-row">
            <label>Template</label>
            <select
              className="hub-select"
              value={templateIdx}
              onChange={(e) => setTemplateIdx(Number(e.target.value))}
            >
              {templates.map((t, i) => (
                <option key={t.name} value={i}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="hub-form-row">
            <label>Message Preview</label>
            <textarea
              className="hub-input"
              rows={5}
              value={message}
              readOnly
              style={{ resize: "vertical", fontFamily: "inherit", background: "#f8f9fc" }}
            />
          </div>
        </>
      )}
    </HubModal>
  );
}

function DuplicateWarningModal({ duplicate, onCancel, onAddAnyway }) {
  return (
    <HubModal
      open={!!duplicate}
      onClose={onCancel}
      title="Possible Duplicate Lead"
      subtitle="A lead with this phone number already exists"
      width={420}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={onAddAnyway}>
            Add Anyway
          </button>
        </>
      }
    >
      {duplicate && (
        <div className="hub-card" style={{ boxShadow: "none", padding: 14 }}>
          <div className="hub-person" style={{ marginBottom: 10 }}>
            <div className="hub-avatar" style={{ background: duplicate.color }}>
              {duplicate.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{duplicate.name}</div>
              <div style={{ fontSize: 12, color: "#667085" }}>{duplicate.phone}</div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "#667085" }}>
            Team: <strong style={{ color: "#101828" }}>{duplicate.team}</strong> · Position:{" "}
            <strong style={{ color: "#101828" }}>{duplicate.position}</strong> · Status:{" "}
            <span className={`hub-badge ${STATUS_META[duplicate.status]}`} style={{ marginLeft: 2 }}>
              {duplicate.status}
            </span>
          </div>
        </div>
      )}
    </HubModal>
  );
}

// "Lead Stages" dashboard card — donut + summary tiles on the left, a
// proportional-bar breakdown table on the right. No chart lib: the donut is
// stroke-dasharray arcs on one circle, which stay crisp and keep an exact
// click target. Every stage (donut arc, tile, or row) is a drill-in
// trigger via onSelect.
function LeadStageBoard({ stages, total, loading, activeStage, activeSub, onSelect }) {
  const [expanded, setExpanded] = useState({});
  const pct = (n) => (total ? (n / total) * 100 : 0);
  const nonZero = stages.filter((s) => s.count > 0);
  const top2 = [...stages].sort((a, b) => b.count - a.count).slice(0, 2);
  const newLead = stages.find((s) => s.stage === "New Lead")?.count || 0;
  // "Converted" = anything that has moved past the New Lead stage.
  const convRate = total ? ((total - newLead) / total) * 100 : 0;

  const SIZE = 260;
  const STROKE = 34;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;
  let dashAccum = 0;

  const COLS = "minmax(96px,1.1fr) 2fr 40px 48px";

  return (
    <div className="hub-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 14 }}>
          <div
            style={{
              width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center",
              background: "linear-gradient(135deg,#eef2ff,#e0e7ff)", color: "#6366f1", fontSize: 19, flexShrink: 0,
            }}
          >
            <FilterOutlined />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>Lead Stages</h3>
            <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 2 }}>
              Track your leads&rsquo; progress across every stage
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f6f7fb", borderRadius: 12, padding: "8px 14px" }}>
          <TeamOutlined style={{ color: "#6366f1" }} />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{total}</div>
            <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 }}>Total Leads</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="hub-empty">Loading lead stages…</div>
      ) : (
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "0 0 280px", maxWidth: 320, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ flex: 1, background: "#f8fafc", borderRadius: 18, padding: 16, display: "grid", placeItems: "center" }}>
              <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: "100%", maxWidth: 188 }}>
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#eceef3" strokeWidth={STROKE} />
                {total > 0 &&
                  nonZero.map((s) => {
                    const len = (pct(s.count) / 100) * CIRC;
                    const gap = nonZero.length > 1 ? 2.5 : 0;
                    const shown = Math.max(0, len - gap);
                    const node = (
                      <circle
                        key={s.stage}
                        cx={SIZE / 2}
                        cy={SIZE / 2}
                        r={R}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={STROKE}
                        strokeDasharray={`${shown} ${CIRC - shown}`}
                        strokeDashoffset={-dashAccum}
                        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                        style={{ cursor: "pointer" }}
                        onClick={() => onSelect(s.stage)}
                      >
                        <title>{`${s.stage}: ${s.count} (${Math.round(pct(s.count))}%)`}</title>
                      </circle>
                    );
                    dashAccum += len;
                    return node;
                  })}
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R - STROKE / 2 - 2} fill="#fff" />
                <text
                  x="50%"
                  y="46%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 40, fontWeight: 800, fill: "#0f172a" }}
                >
                  {total}
                </text>
                <text
                  x="50%"
                  y="59%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 13, fontWeight: 600, fill: "#94a3b8" }}
                >
                  Total Leads
                </text>
              </svg>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              {top2.map((s) => (
                <button
                  key={s.stage}
                  type="button"
                  onClick={() => s.count && onSelect(s.stage)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    position: "relative",
                    background: activeStage === s.stage ? "#eef2ff" : "#f8fafc",
                    border: `1.5px solid ${activeStage === s.stage ? s.color : "transparent"}`,
                    borderRadius: 14,
                    padding: "12px 13px 24px",
                    cursor: s.count ? "pointer" : "default",
                    font: "inherit",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 21, fontWeight: 800, color: "#0f172a" }}>{s.count}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.stage}
                  </div>
                  <span
                    style={{
                      position: "absolute",
                      right: 12,
                      bottom: 9,
                      fontSize: 12,
                      fontWeight: 700,
                      color: s.count ? s.color : "#94a3b8",
                    }}
                  >
                    {Math.round(pct(s.count))}%
                  </span>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#f1effe", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "#fff", display: "grid", placeItems: "center", color: "#7c3aed", flexShrink: 0 }}>
                <RiseOutlined />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "#8578b3" }}>Lead Conversion Rate</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#6d28d9" }}>{convRate.toFixed(2)}%</div>
              </div>
              <RightOutlined style={{ color: "#b4a9d6", fontSize: 12 }} />
            </div>
          </div>

          <div style={{ flex: "1 1 340px", minWidth: 300 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: COLS,
                gap: 10,
                padding: "0 6px 8px",
                fontSize: 9.5,
                fontWeight: 700,
                color: "#94a3b8",
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              <span>Stage</span>
              <span />
              <span style={{ textAlign: "right" }}>Leads</span>
              <span style={{ textAlign: "right" }}>%</span>
            </div>

            {stages.map((s) => {
              const p = pct(s.count);
              const on = activeStage === s.stage;
              const isOpen = !!expanded[s.stage];
              const subs = s.subStatuses || [];
              return (
                <div key={s.stage}>
                  <button
                    type="button"
                    onClick={() => {
                      if (subs.length > 1) setExpanded((e) => ({ ...e, [s.stage]: !e[s.stage] }));
                      onSelect(s.stage);
                    }}
                    style={{
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns: COLS,
                      gap: 10,
                      alignItems: "center",
                      padding: "7px 6px",
                      border: "none",
                      borderRadius: 6,
                      background: on && !activeSub ? "#eef2ff" : "transparent",
                      cursor: "pointer",
                      font: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      {subs.length > 1 ? (
                        <span style={{ fontSize: 8, color: "#94a3b8", width: 8, flexShrink: 0 }}>
                          {isOpen ? "▼" : "▶"}
                        </span>
                      ) : (
                        <span style={{ width: 8, flexShrink: 0 }} />
                      )}
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: s.count ? "#1e293b" : "#94a3b8",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.stage}
                      </span>
                    </span>
                    <span style={{ height: 6, borderRadius: 999, background: "#eef0f4", overflow: "hidden" }}>
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: `${s.count ? Math.max(p, 2) : 0}%`,
                          background: s.color,
                          borderRadius: 999,
                          transition: "width 0.35s ease",
                        }}
                      />
                    </span>
                    <span style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: s.count ? "#0f172a" : "#cbd5e1" }}>
                      {s.count}
                    </span>
                    <span style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: s.count ? s.color : "#cbd5e1" }}>
                      {Math.round(p)}%
                    </span>
                  </button>

                  {isOpen &&
                    subs.map((ss) => {
                      const sp = pct(ss.count);
                      const sOn = activeStage === s.stage && activeSub === ss.subStatus;
                      return (
                        <button
                          key={ss.subStatus}
                          type="button"
                          onClick={() => onSelect(s.stage, ss.subStatus)}
                          style={{
                            width: "100%",
                            display: "grid",
                            gridTemplateColumns: COLS,
                            gap: 10,
                            alignItems: "center",
                            padding: "5px 6px 5px 22px",
                            border: "none",
                            borderRadius: 6,
                            background: sOn ? "#eef2ff" : "transparent",
                            cursor: "pointer",
                            font: "inherit",
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10.5,
                              color: ss.count ? "#475569" : "#a8b0bd",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {ss.subStatus}
                          </span>
                          <span style={{ height: 4, borderRadius: 999, background: "#f1f5f9", overflow: "hidden" }}>
                            <span
                              style={{
                                display: "block",
                                height: "100%",
                                width: `${ss.count ? Math.max(sp, 2) : 0}%`,
                                background: s.color,
                                opacity: 0.7,
                                borderRadius: 999,
                              }}
                            />
                          </span>
                          <span style={{ textAlign: "right", fontSize: 10.5, fontWeight: 600, color: ss.count ? "#334155" : "#cbd5e1" }}>
                            {ss.count}
                          </span>
                          <span style={{ textAlign: "right", fontSize: 10, fontWeight: 600, color: "#94a3b8" }}>
                            {Math.round(sp)}%
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AllLeads() {
  const { teamNames } = useTeams();
  const [teamStats, setTeamStats] = useState([]);
  const [teamStatsLoading, setTeamStatsLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [followUpLead, setFollowUpLead] = useState(null);
  const [pendingLead, setPendingLead] = useState(null);
  const [duplicateOf, setDuplicateOf] = useState(null);
  const [editLead, setEditLead] = useState(null);
  const [viewLead, setViewLead] = useState(null);

  // Which team's accordion panel is open, and a per-team cache of its leads
  // so switching panels back and forth doesn't refetch every time.
  const [activeTeam, setActiveTeam] = useState(null);
  const [teamLeads, setTeamLeads] = useState({});

  // Lead Stages dashboard + the filtered Lead List it drills into.
  const [stageData, setStageData] = useState({ stages: [], total: 0 });
  const [stageLoading, setStageLoading] = useState(true);
  const [stageError, setStageError] = useState(false);
  const [admins, setAdmins] = useState([]);

  const [drillStage, setDrillStage] = useState(null); // stage name | "Other" | null
  const [drillSub, setDrillSub] = useState(null);
  const BLANK_FILTERS = {
    quick: "",
    subStatus: "",
    assignedUser: "",
    source: "",
    q: "",
    callbackFrom: "",
    callbackTo: "",
    followUpFrom: "",
    followUpTo: "",
    createdFrom: "",
    createdTo: "",
  };
  const [filters, setFilters] = useState(BLANK_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [drill, setDrill] = useState({ leads: [], page: 1, pages: 1, count: 0, loading: false });

  const listActive =
    !!drillStage || !!filters.quick || Object.entries(filters).some(([k, v]) => k !== "quick" && v);

  const normalizePhone = (p) => (p || "").replace(/\D/g, "");

  const loadStageStats = async () => {
    setStageLoading(true);
    setStageError(false);
    const res = await request.get({ entity: "lead/stage-stats" });
    if (res?.success) setStageData(res.result);
    else setStageError(true);
    setStageLoading(false);
  };

  const loadAdmins = async () => {
    const res = await request.list({ entity: "admin", options: { items: 500 } });
    setAdmins(res?.success ? res.result : []);
  };

  const loadLeadList = async (targetPage = 1, over = {}) => {
    const stage = over.stage !== undefined ? over.stage : drillStage;
    const sub = over.sub !== undefined ? over.sub : drillSub;
    const f = { ...filters, ...(over.filters || {}) };
    setDrill((d) => ({ ...d, loading: true }));

    const params = new URLSearchParams({ page: String(targetPage), items: "12" });
    if (stage) params.set("stage", stage);
    if (sub) params.set("subStatus", sub);
    Object.entries(f).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });

    const res = await request.get({ entity: `lead/by-stage?${params.toString()}` });
    setDrill({
      leads: res?.success ? res.result : [],
      page: targetPage,
      pages: res?.pagination?.pages || 1,
      count: res?.pagination?.count || 0,
      loading: false,
    });
  };

  const selectStage = (stage, sub = null) => {
    // Re-clicking the exact same selection closes the list.
    if (drillStage === stage && drillSub === (sub || null) && !filters.quick) {
      setDrillStage(null);
      setDrillSub(null);
      return;
    }
    setDrillStage(stage);
    setDrillSub(sub || null);
    setFilters((f) => ({ ...f, quick: "", subStatus: sub || "" }));
    loadLeadList(1, { stage, sub, filters: { ...filters, quick: "", subStatus: sub || "" } });
  };

  const applyQuickFilter = (qf) => {
    if (filters.quick === qf.key && drillStage === (qf.stage || null)) {
      setFilters((f) => ({ ...f, quick: "" }));
      setDrillStage(null);
      setDrillSub(null);
      return;
    }
    const nextFilters = { ...BLANK_FILTERS, quick: qf.quick || "" };
    setFilters(nextFilters);
    setDrillStage(qf.stage || (qf.quick ? "Call Back" : null));
    setDrillSub(null);
    loadLeadList(1, { stage: qf.stage || (qf.quick ? "Call Back" : null), sub: null, filters: nextFilters });
  };

  const updateFilter = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    loadLeadList(1, { filters: next });
  };

  const clearList = () => {
    setDrillStage(null);
    setDrillSub(null);
    setFilters(BLANK_FILTERS);
  };

  const loadTeamStats = async () => {
    setTeamStatsLoading(true);
    const res = await request.get({ entity: "lead/team-stats" });
    setTeamStats(res?.success ? res.result : []);
    setTeamStatsLoading(false);
  };

  const loadTeamLeads = async (team, targetPage = 1) => {
    setTeamLeads((prev) => ({ ...prev, [team]: { ...(prev[team] || {}), loading: true } }));
    const options = { page: targetPage, items: 50, filter: "team", equal: team };
    const res = await request.list({ entity: "lead", options });
    setTeamLeads((prev) => ({
      ...prev,
      [team]: {
        leads: res?.success ? res.result : [],
        pages: res?.pagination?.pages || 1,
        count: res?.pagination?.count || 0,
        page: targetPage,
        loading: false,
      },
    }));
  };

  useEffect(() => {
    loadTeamStats();
    loadStageStats();
    loadAdmins();
  }, []);

  const handlePanelChange = (key) => {
    const nextTeam = Array.isArray(key) ? key[key.length - 1] : key;
    setActiveTeam(nextTeam || null);
    if (nextTeam && !teamLeads[nextTeam]) {
      loadTeamLeads(nextTeam, 1);
    }
  };

  // A create/edit can change which team a lead belongs to, so the safest
  // refresh is: drop every cached panel, reload stats, and re-fetch whichever
  // panel is currently open.
  const refreshAfterMutation = async () => {
    setTeamLeads({});
    await loadTeamStats();
    await loadStageStats();
    if (activeTeam) await loadTeamLeads(activeTeam, 1);
    if (listActive) await loadLeadList(drill.page);
  };

  const createLead = async (lead) => {
    const res = await request.create({ entity: "lead", jsonData: lead });
    if (res?.success) await refreshAfterMutation();
  };

  const handleAddLead = async (lead) => {
    const allRes = await request.listAll({ entity: "lead" });
    const all = allRes?.success ? allRes.result : [];
    const existing = all.find(
      (l) => normalizePhone(l.phone) === normalizePhone(lead.phone) && normalizePhone(lead.phone)
    );
    if (existing) {
      setPendingLead(lead);
      setDuplicateOf(existing);
    } else {
      await createLead(lead);
    }
  };

  const confirmAddAnyway = async () => {
    await createLead(pendingLead);
    setPendingLead(null);
    setDuplicateOf(null);
  };

  const cancelDuplicate = () => {
    setPendingLead(null);
    setDuplicateOf(null);
  };

  const saveLeadEdit = async (leadId, updates) => {
    const res = await request.update({ entity: "lead", id: leadId, jsonData: updates });
    if (res?.success) await refreshAfterMutation();
  };

  return (
    <div className="hub-stack">
      {stageError ? (
        <div className="hub-card">
          <div className="hub-card-header"><h3>Lead Stages</h3></div>
          <div className="hub-empty">
            Couldn&rsquo;t load lead stages.{" "}
            <button type="button" className="hub-btn" style={{ marginLeft: 8 }} onClick={loadStageStats}>
              Retry
            </button>
          </div>
        </div>
      ) : (
        <LeadStageBoard
          stages={stageData.stages}
          total={stageData.total}
          loading={stageLoading}
          activeStage={drillStage}
          activeSub={drillSub}
          onSelect={selectStage}
        />
      )}

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Lead List</h3>
          <div className="hub-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="hub-btn"
              onClick={() => setShowFilters((v) => !v)}
              style={showFilters ? { background: "var(--hub-blue)", color: "#fff", borderColor: "var(--hub-blue)" } : undefined}
            >
              <FilterOutlined /> Filters
            </button>
            {listActive && (
              <button type="button" className="hub-btn" onClick={clearList}>
                <CloseOutlined /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Quick filters */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {QUICK_FILTERS.map((qf) => {
            const on =
              qf.key === "all"
                ? !listActive
                : filters.quick === qf.key || (qf.stage && drillStage === qf.stage && !drillSub && !filters.quick);
            const c = qf.stage ? stageColor(qf.stage) : qf.key === "callback-overdue" ? "#ef4444" : "#2563eb";
            return (
              <button
                key={qf.key}
                type="button"
                onClick={() => (qf.key === "all" ? clearList() : applyQuickFilter(qf))}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${on ? c : "#e2e8f0"}`,
                  background: on ? c : "#fff",
                  color: on ? "#fff" : "#475569",
                }}
              >
                {qf.stage && (
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#fff" : c }} />
                )}
                {qf.label}
              </button>
            );
          })}
        </div>

        {/* Advanced filters */}
        {showFilters && (
          <div
            style={{
              border: "1px solid #eef0f4",
              borderRadius: 12,
              padding: 14,
              background: "#fafbfd",
              marginBottom: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
            }}
          >
            <div className="hub-form-row">
              <label>Stage</label>
              <select
                className="hub-select"
                value={drillStage || ""}
                onChange={(e) => selectStage(e.target.value || null)}
              >
                <option value="">All stages</option>
                {STAGE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="hub-form-row">
              <label>Sub-Status</label>
              <select
                className="hub-select"
                value={filters.subStatus}
                disabled={!drillStage}
                onChange={(e) => {
                  setDrillSub(e.target.value || null);
                  updateFilter({ subStatus: e.target.value });
                }}
              >
                <option value="">All</option>
                {(drillStage ? subStatusesFor(drillStage) : []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="hub-form-row">
              <label>Assigned User</label>
              <select
                className="hub-select"
                value={filters.assignedUser}
                onChange={(e) => updateFilter({ assignedUser: e.target.value })}
              >
                <option value="">Anyone</option>
                {admins.map((a) => (
                  <option key={a._id} value={a._id}>
                    {`${a.name || ""} ${a.surname || ""}`.trim() || a.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="hub-form-row">
              <label>Source</label>
              <select
                className="hub-select"
                value={filters.source}
                onChange={(e) => updateFilter({ source: e.target.value })}
              >
                <option value="">Any</option>
                {["Website", "Facebook Ads", "Google Ads", "LinkedIn Ads", "Referral", "Cold Call", "WhatsApp", "Import", "Other"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="hub-form-row">
              <label>Search (name / phone / email)</label>
              <input
                className="hub-input"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && loadLeadList(1)}
                placeholder="Type & press Enter"
              />
            </div>
            <div className="hub-form-row">
              <label>Callback from → to</label>
              <div className="hub-row" style={{ gap: 6 }}>
                <input type="date" className="hub-input" value={filters.callbackFrom} onChange={(e) => updateFilter({ callbackFrom: e.target.value })} />
                <input type="date" className="hub-input" value={filters.callbackTo} onChange={(e) => updateFilter({ callbackTo: e.target.value })} />
              </div>
            </div>
            <div className="hub-form-row">
              <label>Follow-up from → to</label>
              <div className="hub-row" style={{ gap: 6 }}>
                <input type="date" className="hub-input" value={filters.followUpFrom} onChange={(e) => updateFilter({ followUpFrom: e.target.value })} />
                <input type="date" className="hub-input" value={filters.followUpTo} onChange={(e) => updateFilter({ followUpTo: e.target.value })} />
              </div>
            </div>
            <div className="hub-form-row">
              <label>Created from → to</label>
              <div className="hub-row" style={{ gap: 6 }}>
                <input type="date" className="hub-input" value={filters.createdFrom} onChange={(e) => updateFilter({ createdFrom: e.target.value })} />
                <input type="date" className="hub-input" value={filters.createdTo} onChange={(e) => updateFilter({ createdTo: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        {!listActive ? (
          <div className="hub-empty">
            Pick a stage above, a quick filter, or open Filters to browse the lead list.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 8 }}>
              {drill.loading ? "Loading…" : `${drill.count} lead${drill.count === 1 ? "" : "s"}`}
              {drillStage ? ` · ${drillStage}` : ""}
              {drillSub ? ` · ${drillSub}` : ""}
            </div>
            <div className="hub-table-wrapper">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th>Client Name</th>
                    <th>Phone</th>
                    <th>Stage / Sub-Status</th>
                    <th>Assigned</th>
                    <th>Next Follow-up</th>
                    <th>Call Back</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drill.loading && (
                    <tr><td colSpan={7}><div className="hub-empty">Loading…</div></td></tr>
                  )}
                  {!drill.loading && drill.leads.length === 0 && (
                    <tr><td colSpan={7}><div className="hub-empty">No leads match these filters.</div></td></tr>
                  )}
                  {!drill.loading &&
                    drill.leads.map((l) => {
                      const overdue =
                        l.stage === "Call Back" && l.callBackAt && new Date(l.callBackAt) < new Date();
                      return (
                        <tr key={l._id}>
                          <td>
                            <div className="hub-person" style={{ cursor: "pointer" }} onClick={() => setViewLead(l)}>
                              <div className="hub-avatar" style={{ background: l.color || "#8c8c8c" }}>
                                {l.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                              </div>
                              {l.name}
                            </div>
                          </td>
                          <td>{l.phone || "—"}</td>
                          <td>
                            <span className={`hub-badge ${STATUS_META[l.stage || l.status]}`}>
                              {l.stage || stageForStatus(l.status)}
                            </span>
                            <div style={{ fontSize: 11, color: "#8c8c8c", marginTop: 2 }}>{l.subStatus || "—"}</div>
                          </td>
                          <td>{l.assignedUserName || (l.assignedUser && l.assignedUser.name) || "—"}</td>
                          <td>{l.nextFollowUpAt ? new Date(l.nextFollowUpAt).toLocaleDateString() : "—"}</td>
                          <td>
                            {l.callBackAt ? (
                              <span style={{ color: overdue ? "#dc2626" : "#334155", fontWeight: overdue ? 700 : 400 }}>
                                {new Date(l.callBackAt).toLocaleString()}
                                {overdue ? " · overdue" : ""}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="hub-btn"
                              style={{ padding: "5px 12px" }}
                              onClick={() => setEditLead(l)}
                            >
                              <EditOutlined /> Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {drill.pages > 1 && (
              <div className="hub-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
                <span style={{ fontSize: 12, color: "#8c8c8c" }}>
                  Page {drill.page} of {drill.pages} · {drill.count} total
                </span>
                <div className="hub-row" style={{ gap: 8 }}>
                  <button type="button" className="hub-btn" disabled={drill.page <= 1} onClick={() => loadLeadList(drill.page - 1)}>
                    <LeftOutlined /> Prev
                  </button>
                  <button type="button" className="hub-btn" disabled={drill.page >= drill.pages} onClick={() => loadLeadList(drill.page + 1)}>
                    Next <RightOutlined />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {teamStats.length > 0 && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><TeamOutlined /> Leads by Team</h3>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {teamStats.map((t) => (
              <div
                key={t.team}
                style={{
                  flex: "1 1 150px",
                  minWidth: 150,
                  maxWidth: 220,
                  background: "#fff",
                  border: "1px solid var(--hub-border, #eef0f4)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  position: "relative",
                  overflow: "hidden",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                }}
              >
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: t.color || "var(--hub-blue)" }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: "#667085", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.team}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: "#101828" }}>{t.leadCount}</div>
                <div style={{ fontSize: 11.5, color: "#8c8c8c", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                  <UserOutlined /> {t.memberCount} member{t.memberCount === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="hub-card">
        <div className="hub-card-header">
          <h3><TeamOutlined /> Browse by Team</h3>
          <button
            type="button"
            className="hub-btn hub-btn-primary"
            onClick={() => setAddOpen(true)}
          >
            <UserAddOutlined /> Add Lead
          </button>
        </div>

        {teamStatsLoading && <div className="hub-empty">Loading teams…</div>}
        {!teamStatsLoading && teamStats.length === 0 && (
          <div className="hub-empty">No teams yet — create one in User Management first.</div>
        )}

        {!teamStatsLoading && teamStats.length > 0 && (
          <ConfigProvider theme={{ token: HUB_ANTD_TOKENS }}>
            <Collapse
              accordion
              activeKey={activeTeam ? [activeTeam] : []}
              onChange={handlePanelChange}
              expandIconPosition="end"
              items={teamStats.map((t) => {
                const cache = teamLeads[t.team];
                const rows = cache?.leads || [];
                return {
                  key: t.team,
                  label: (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.color || "var(--hub-blue)", flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t.team}</span>
                      <span className="hub-badge hub-badge-blue">{t.leadCount} lead{t.leadCount === 1 ? "" : "s"}</span>
                      <span style={{ fontSize: 11.5, color: "#8c8c8c", display: "flex", alignItems: "center", gap: 4 }}>
                        <UserOutlined /> {t.memberCount}
                      </span>
                    </div>
                  ),
                  children: (
                    <>
                      <div className="hub-table-wrapper">
                        <table className="hub-table">
                          <thead>
                            <tr>
                              <th>Client Name</th>
                              <th>Phone</th>
                              <th>Position</th>
                              <th>Status</th>
                              <th>Follow Up</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(!cache || cache.loading) && (
                              <tr>
                                <td colSpan={6}>
                                  <div className="hub-empty">Loading leads…</div>
                                </td>
                              </tr>
                            )}
                            {cache && !cache.loading && rows.length === 0 && (
                              <tr>
                                <td colSpan={6}>
                                  <div className="hub-empty">No leads in this team yet.</div>
                                </td>
                              </tr>
                            )}
                            {cache &&
                              !cache.loading &&
                              rows.map((l) => (
                                <tr key={l._id}>
                                  <td>
                                    <div
                                      className="hub-person"
                                      style={{ cursor: "pointer" }}
                                      onClick={() => setViewLead(l)}
                                    >
                                      {l.image ? (
                                        <div className="hub-avatar" style={{ padding: 0, overflow: "hidden" }}>
                                          <img src={l.image} alt={l.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        </div>
                                      ) : (
                                        <div className="hub-avatar" style={{ background: l.color }}>
                                          {l.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                                        </div>
                                      )}
                                      {l.name}
                                    </div>
                                  </td>
                                  <td>{l.phone}</td>
                                  <td>{l.position}</td>
                                  <td>
                                    <span className={`hub-badge ${STATUS_META[l.stage || l.status]}`}>
                                      {l.stage || stageForStatus(l.status)}
                                    </span>
                                    {l.subStatus && (
                                      <div style={{ fontSize: 11, color: "#8c8c8c", marginTop: 2 }}>{l.subStatus}</div>
                                    )}
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="hub-btn"
                                      style={{ padding: "5px 12px" }}
                                      onClick={() => setFollowUpLead(l)}
                                    >
                                      💬 Follow Up
                                    </button>
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="hub-btn"
                                      style={{ padding: "5px 12px" }}
                                      onClick={() => setEditLead(l)}
                                    >
                                      <EditOutlined /> Edit
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>

                      {cache && cache.pages > 1 && (
                        <div className="hub-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
                          <span style={{ fontSize: 12, color: "#8c8c8c" }}>
                            Page {cache.page} of {cache.pages} · {cache.count} leads total
                          </span>
                          <div className="hub-row" style={{ gap: 8 }}>
                            <button
                              type="button"
                              className="hub-btn"
                              disabled={cache.page <= 1}
                              onClick={() => loadTeamLeads(t.team, cache.page - 1)}
                            >
                              <LeftOutlined /> Prev
                            </button>
                            <button
                              type="button"
                              className="hub-btn"
                              disabled={cache.page >= cache.pages}
                              onClick={() => loadTeamLeads(t.team, cache.page + 1)}
                            >
                              Next <RightOutlined />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ),
                };
              })}
            />
          </ConfigProvider>
        )}
      </div>

      <AddLeadModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={handleAddLead}
        teamNames={teamNames}
        admins={admins}
      />

      <DuplicateWarningModal
        duplicate={duplicateOf}
        onCancel={cancelDuplicate}
        onAddAnyway={confirmAddAnyway}
      />

      <FollowUpModal lead={followUpLead} onClose={() => setFollowUpLead(null)} />

      <EditLeadModal
        lead={editLead}
        onClose={() => setEditLead(null)}
        teamNames={teamNames}
        admins={admins}
        onSave={async (updates) => {
          await saveLeadEdit(editLead._id, updates);
          setEditLead(null);
        }}
      />

      <LeadDetailModal lead={viewLead} onClose={() => setViewLead(null)} />
    </div>
  );
}

function ImportExport() {
  const { teamNames } = useTeams();
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [viewLead, setViewLead] = useState(null);

  const [exportTeam, setExportTeam] = useState("All");
  const [exportFormat, setExportFormat] = useState("csv");
  const [exporting, setExporting] = useState(false);

  // Manual per-team split for the file being imported: { "Team Name": count }
  const [distribution, setDistribution] = useState({});
  const [splitTotal, setSplitTotal] = useState("");
  const [addTeamSelect, setAddTeamSelect] = useState("");
  const [addTeamCount, setAddTeamCount] = useState("");

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPages, setHistoryPages] = useState(1);
  const [historyCount, setHistoryCount] = useState(0);

  // Leads left with no team — either imported with a distribution that
  // under-allocated the file, or imported/added with no team at all.
  const [unassigned, setUnassigned] = useState([]);
  const [unassignedLoading, setUnassignedLoading] = useState(true);
  const [unassignedPage, setUnassignedPage] = useState(1);
  const [unassignedPages, setUnassignedPages] = useState(1);
  const [unassignedCount, setUnassignedCount] = useState(0);

  // Bulk-assign: which unassigned leads are checked (kept across pages, so
  // "select all" can cover the full pagination, not just the visible page)
  // and which teams are checked, so "Assign Equally" can round-robin the
  // selected leads across the selected teams.
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [assignTeams, setAssignTeams] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Keep the distribution map in sync as teams are added/removed elsewhere.
  useEffect(() => {
    setDistribution((prev) => {
      const next = {};
      teamNames.forEach((t) => (next[t] = prev[t] || 0));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamNames.length]);

  const loadHistory = async (targetPage = 1) => {
    setHistoryLoading(true);
    const res = await request.list({
      entity: "leadimportbatch",
      options: { page: targetPage, items: 10, sortBy: "created", sortValue: -1 },
    });
    setHistory(res?.success ? res.result : []);
    setHistoryPages(res?.pagination?.pages || 1);
    setHistoryCount(res?.pagination?.count || 0);
    setHistoryPage(targetPage);
    setHistoryLoading(false);
  };

  const loadUnassigned = async (targetPage = 1) => {
    setUnassignedLoading(true);
    const options = { page: targetPage, items: 10, filter: "team", equal: "" };
    const res = await request.list({ entity: "lead", options });
    setUnassigned(res?.success ? res.result : []);
    setUnassignedPages(res?.pagination?.pages || 1);
    setUnassignedCount(res?.pagination?.count || 0);
    setUnassignedPage(targetPage);
    setUnassignedLoading(false);
  };

  useEffect(() => {
    loadHistory(1);
    loadUnassigned(1);
  }, []);

  const toggleLeadSelected = (id) => {
    setSelectedLeadIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // "Select all" covers every unassigned lead across all pages, not just the
  // ones currently on screen — fetched in one shot via a high page size.
  const allSelected = unassignedCount > 0 && selectedLeadIds.length === unassignedCount;

  const toggleSelectAll = async () => {
    if (allSelected) {
      setSelectedLeadIds([]);
      return;
    }
    setSelectAllLoading(true);
    const res = await request.list({
      entity: "lead",
      options: { page: 1, items: 100000, filter: "team", equal: "" },
    });
    setSelectedLeadIds(res?.success ? res.result.map((l) => l._id) : []);
    setSelectAllLoading(false);
  };

  const toggleAssignTeam = (team) => {
    setAssignTeams((prev) => (prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team]));
  };

  // Round-robins the selected leads across the checked teams so each team
  // gets as close to an equal share as possible.
  const assignSelectedEqually = async () => {
    if (selectedLeadIds.length === 0 || assignTeams.length === 0) return;
    setAssigning(true);
    await Promise.all(
      selectedLeadIds.map((id, i) =>
        request.update({ entity: "lead", id, jsonData: { team: assignTeams[i % assignTeams.length] } })
      )
    );
    setAssigning(false);
    setAssignTeams([]);
    setSelectedLeadIds([]);
    loadUnassigned(1);
  };

  // One-click version of the same round-robin: every unassigned lead across
  // every page, split across every team — no manual selection needed.
  const distributeAllToAllTeams = async () => {
    if (teamNames.length === 0 || unassignedCount === 0) return;
    setSelectAllLoading(true);
    const res = await request.list({
      entity: "lead",
      options: { page: 1, items: 100000, filter: "team", equal: "" },
    });
    const ids = res?.success ? res.result.map((l) => l._id) : [];
    setSelectAllLoading(false);
    if (ids.length === 0) return;

    setAssigning(true);
    await Promise.all(
      ids.map((id, i) => request.update({ entity: "lead", id, jsonData: { team: teamNames[i % teamNames.length] } }))
    );
    setAssigning(false);
    setAssignTeams([]);
    setSelectedLeadIds([]);
    loadUnassigned(1);
  };

  // Permanently remove unassigned leads — one row, or every checked row.
  // After a delete the current page can end up empty, so step back a page
  // when that happens.
  const reloadAfterDelete = () => {
    const nextPage = unassigned.length <= 1 && unassignedPage > 1 ? unassignedPage - 1 : unassignedPage;
    loadUnassigned(nextPage);
  };

  const deleteOneUnassigned = async (lead) => {
    if (deleting) return;
    if (!window.confirm(`Delete lead "${lead.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    // deleteLeadRaw skips request.js's per-call toast — we show one summary
    // message ourselves so a bulk delete pops a single notice, not N.
    await deleteLeadRaw(lead._id);
    setSelectedLeadIds((prev) => prev.filter((x) => x !== lead._id));
    setDeleting(false);
    message.success("1 lead deleted");
    reloadAfterDelete();
  };

  const deleteSelectedUnassigned = async () => {
    if (deleting || selectedLeadIds.length === 0) return;
    const total = selectedLeadIds.length;
    if (!window.confirm(`Delete ${total} selected lead${total === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setDeleting(true);
    const results = await Promise.allSettled(selectedLeadIds.map((id) => deleteLeadRaw(id)));
    const ok = results.filter((r) => r.status === "fulfilled" && r.value?.success !== false).length;
    const failed = total - ok;
    setSelectedLeadIds([]);
    setDeleting(false);
    // One message at the top, whatever the count.
    if (failed > 0) message.warning(`${ok} lead${ok === 1 ? "" : "s"} deleted · ${failed} failed`);
    else message.success(`${ok} lead${ok === 1 ? "" : "s"} deleted`);
    loadUnassigned(1);
  };

  const pickFile = (f) => {
    if (!f) return;
    setFile(f);
    setImportResult(null);
  };

  const allocatedTotal = Object.values(distribution).reduce((s, n) => s + (Number(n) || 0), 0);
  const addedTeams = Object.entries(distribution).filter(([, n]) => Number(n) > 0);
  const allocatedTeams = addedTeams.length;
  const availableTeams = teamNames.filter((t) => !(Number(distribution[t]) > 0));

  const addAllocation = () => {
    if (!addTeamSelect || !addTeamCount) return;
    setDistribution((d) => ({ ...d, [addTeamSelect]: Number(addTeamCount) }));
    setAddTeamSelect("");
    setAddTeamCount("");
  };

  const splitEqually = () => {
    const n = Number(splitTotal);
    if (!n || teamNames.length === 0) return;
    const base = Math.floor(n / teamNames.length);
    let remainder = n % teamNames.length;
    const next = {};
    teamNames.forEach((t) => {
      next[t] = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    });
    setDistribution(next);
  };

  const clearDistribution = () => {
    const next = {};
    teamNames.forEach((t) => (next[t] = 0));
    setDistribution(next);
    setSplitTotal("");
    setAddTeamSelect("");
    setAddTeamCount("");
  };

  const startImport = async () => {
    if (!file) return;
    setImporting(true);
    setImportResult(null);

    const formData = new FormData();
    formData.append("file", file);

    const activeDistribution = Object.entries(distribution)
      .filter(([, count]) => Number(count) > 0)
      .map(([team, count]) => ({ team, count: Number(count) }));

    if (activeDistribution.length === 1) {
      formData.append("team", activeDistribution[0].team);
    } else if (activeDistribution.length > 1) {
      formData.append("distribution", JSON.stringify(activeDistribution));
    }

    const res = await request.post({ entity: "lead/import", jsonData: formData });
    setImporting(false);

    if (res?.success) {
      setImportResult({ ok: true, message: res.message });
      setFile(null);
      clearDistribution();
      loadHistory(1);
      loadUnassigned(1);
    } else {
      setImportResult({ ok: false, message: res?.message || "Import failed." });
    }
  };

  const runExport = async () => {
    setExporting(true);
    try {
      await downloadLeadsExport(exportFormat, exportTeam === "All" ? "" : exportTeam);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="hub-stack">
      <div className="hub-grid-2">
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><ImportOutlined /> Import Leads</h3>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            style={{
              border: `2px dashed ${dragging ? "var(--hub-blue)" : "#e3e9f5"}`,
              borderRadius: 10,
              padding: "32px 20px",
              textAlign: "center",
              background: dragging ? "var(--hub-blue-soft)" : "#fafbfd",
              transition: "all 0.2s ease",
            }}
          >
            <div style={{ fontSize: 13, color: "#8c8c8c", marginBottom: 10 }}>
              Drag &amp; drop a CSV or Excel file here, or
            </div>

            <label className="hub-btn hub-btn-primary" style={{ cursor: "pointer" }}>
              Choose File
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: "none" }}
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </label>

            {file && (
              <div style={{ marginTop: 14, fontSize: 12.5, color: "#1f1f1f" }}>
                <FileTextOutlined /> {file.name} — ready to import
              </div>
            )}
          </div>

          <div className="hub-form-row" style={{ marginTop: 16 }}>
            <label>Distribute Rows to Teams</label>

            {teamNames.length === 0 ? (
              <div className="hub-empty">No teams yet — create one in User Management first.</div>
            ) : (
              <div
                style={{
                  border: "1px solid #eef0f4",
                  borderRadius: 12,
                  padding: 14,
                  background: "#fafbfd",
                }}
              >
                <div className="hub-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <select
                    className="hub-select"
                    style={{ flex: "2 1 160px" }}
                    value={addTeamSelect}
                    onChange={(e) => setAddTeamSelect(e.target.value)}
                  >
                    <option value="">Select a team…</option>
                    {availableTeams.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>

                  <input
                    className="hub-input"
                    style={{ flex: "1 1 90px" }}
                    placeholder="Leads"
                    value={addTeamCount}
                    disabled={!addTeamSelect}
                    onChange={(e) => setAddTeamCount(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && addAllocation()}
                  />

                  <button
                    type="button"
                    className="hub-btn hub-btn-primary"
                    disabled={!addTeamSelect || !addTeamCount}
                    onClick={addAllocation}
                  >
                    <PlusOutlined /> Add
                  </button>

                  {addedTeams.length > 0 && (
                    <Tooltip title={addedTeams.map(([t, c]) => `${t} · ${c}`).join(", ")}>
                      <span className="hub-badge hub-badge-blue" style={{ cursor: "default" }}>
                        +{addedTeams.length}
                      </span>
                    </Tooltip>
                  )}
                </div>

                <div className="hub-row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    className="hub-input"
                    style={{ width: 120 }}
                    placeholder="Total rows"
                    value={splitTotal}
                    onChange={(e) => setSplitTotal(e.target.value.replace(/\D/g, ""))}
                  />
                  <button type="button" className="hub-btn" onClick={splitEqually}>
                    <SwapOutlined /> Split Equally
                  </button>
                  {addedTeams.length > 0 && (
                    <button type="button" className="hub-btn" onClick={clearDistribution}>
                      <ClearOutlined /> Clear All
                    </button>
                  )}
                </div>

                {splitTotal && Number(splitTotal) > 0 && (
                  <div className="hub-progress" style={{ width: "100%", marginTop: 12 }}>
                    <div className="hub-progress-track">
                      <div
                        className="hub-progress-fill"
                        style={{
                          width: `${Math.min(100, (allocatedTotal / Number(splitTotal)) * 100)}%`,
                          background:
                            allocatedTotal >= Number(splitTotal)
                              ? "var(--hub-green, #16a34a)"
                              : "linear-gradient(90deg, var(--hub-blue), #6d9bff)",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "#667085" }}>
                      {allocatedTotal}/{splitTotal}
                    </span>
                  </div>
                )}

                <div style={{ marginTop: 10, fontSize: 12, color: "#8c8c8c" }}>
                  {allocatedTotal > 0
                    ? `${allocatedTotal} lead${allocatedTotal === 1 ? "" : "s"} allocated across ${allocatedTeams} team${allocatedTeams === 1 ? "" : "s"}. Rows beyond this count import unassigned.`
                    : "No counts set — every row will import without a team."}
                </div>
              </div>
            )}
          </div>

          {importResult && (
            <div style={{ marginTop: 10 }}>
              <span className={`hub-badge ${importResult.ok ? "hub-badge-green" : "hub-badge-red"}`}>
                {importResult.message}
              </span>
            </div>
          )}

          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button className="hub-btn hub-btn-primary" type="button" disabled={!file || importing} onClick={startImport}>
              {importing ? "Importing…" : "Start Import"}
            </button>
          </div>
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3><ExportOutlined /> Export Leads</h3>
          </div>

          <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 16 }}>
            Downloads leads (name, phone, source, team, position, status) — optionally filtered to one team.
          </div>

          <div className="hub-form-row">
            <label>Team</label>
            <select className="hub-select" value={exportTeam} onChange={(e) => setExportTeam(e.target.value)}>
              <option value="All">All Teams</option>
              {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="hub-form-row">
            <label>Format</label>
            <div className="hub-row" style={{ gap: 10 }}>
              {[
                { key: "csv", label: "CSV", icon: <FileTextOutlined /> },
                { key: "excel", label: "Excel", icon: <FileExcelOutlined /> },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="hub-btn"
                  style={
                    exportFormat === f.key
                      ? { background: "var(--hub-blue)", color: "#fff", borderColor: "var(--hub-blue)", flex: 1 }
                      : { flex: 1 }
                  }
                  onClick={() => setExportFormat(f.key)}
                >
                  {f.icon} {f.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button className="hub-btn hub-btn-primary" type="button" disabled={exporting} onClick={runExport}>
              <DownloadOutlined /> {exporting ? "Exporting…" : `Export ${exportFormat === "excel" ? "Excel" : "CSV"}`}
            </button>
          </div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Recent Import History</h3>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Teams</th>
                <th>Rows</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">Loading import history…</div>
                  </td>
                </tr>
              )}
              {!historyLoading && history.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">No imports yet.</div>
                  </td>
                </tr>
              )}
              {!historyLoading &&
                history.map((h) => (
                  <tr key={h._id}>
                    <td>{h.fileName}</td>
                    <td>
                      {h.teams && h.teams.length > 0 ? (
                        <TeamBadgeList teams={h.teams} max={2} />
                      ) : (
                        h.team || "—"
                      )}
                    </td>
                    <td>{h.successCount} / {h.totalRows}</td>
                    <td>
                      <span className={`hub-badge ${h.failedCount > 0 ? "hub-badge-red" : "hub-badge-green"}`}>
                        {h.failedCount > 0 ? `${h.failedCount} row${h.failedCount === 1 ? "" : "s"} failed` : "Completed"}
                      </span>
                    </td>
                    <td>{new Date(h.created).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!historyLoading && history.length > 0 && (
          <div className="hub-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
            <span style={{ fontSize: 12, color: "#8c8c8c" }}>
              Page {historyPage} of {historyPages} · {historyCount} import{historyCount === 1 ? "" : "s"} total
            </span>
            <div className="hub-row" style={{ gap: 8 }}>
              <button
                type="button"
                className="hub-btn"
                disabled={historyPage <= 1}
                onClick={() => loadHistory(historyPage - 1)}
              >
                <LeftOutlined /> Prev
              </button>
              <button
                type="button"
                className="hub-btn"
                disabled={historyPage >= historyPages}
                onClick={() => loadHistory(historyPage + 1)}
              >
                Next <RightOutlined />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3><InboxOutlined /> Unassigned Leads</h3>
          {unassignedCount > 0 && <span className="hub-badge hub-badge-yellow">{unassignedCount}</span>}
        </div>

        <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 14 }}>
          Leads that haven't been given to any team yet — import rows left over after a manual split, or added without a team.
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  {unassignedCount > 0 && (
                    <Tooltip title={allSelected ? "Clear selection" : `Select all ${unassignedCount} across all pages`}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        disabled={selectAllLoading}
                        onChange={toggleSelectAll}
                        style={{ width: 16, height: 16, accentColor: "var(--hub-blue)", cursor: selectAllLoading ? "wait" : "pointer" }}
                      />
                    </Tooltip>
                  )}
                </th>
                <th>Client Name</th>
                <th>Phone</th>
                <th>Source</th>
                <th>Status</th>
                <th>Imported</th>
                <th style={{ width: 60, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {unassignedLoading && (
                <tr>
                  <td colSpan={7}>
                    <div className="hub-empty">Loading unassigned leads…</div>
                  </td>
                </tr>
              )}
              {!unassignedLoading && unassigned.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="hub-empty">Every lead has been given to a team. 🎉</div>
                  </td>
                </tr>
              )}
              {!unassignedLoading &&
                unassigned.map((l) => (
                  <tr key={l._id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.includes(l._id)}
                        onChange={() => toggleLeadSelected(l._id)}
                        style={{ width: 16, height: 16, accentColor: "var(--hub-blue)", cursor: "pointer" }}
                      />
                    </td>
                    <td>
                      <Tooltip title={leadHoverDetail(l)} placement="right">
                        <div
                          className="hub-person"
                          style={{ cursor: "pointer" }}
                          onClick={() => setViewLead(l)}
                        >
                          <div className="hub-avatar" style={{ background: l.color || "#8c8c8c" }}>
                            {l.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                          </div>
                          {l.name}
                        </div>
                      </Tooltip>
                    </td>
                    <td>{l.phone || "—"}</td>
                    <td>{l.source || "—"}</td>
                    <td>
                      <span className={`hub-badge ${STATUS_META[l.status]}`}>{l.status}</span>
                    </td>
                    <td>{new Date(l.created).toLocaleDateString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <Tooltip title="Delete this lead">
                        <button
                          type="button"
                          className="hub-btn"
                          disabled={deleting}
                          onClick={() => deleteOneUnassigned(l)}
                          style={{ color: "#dc2626", borderColor: "#f3c9c9", padding: "4px 10px" }}
                        >
                          <DeleteOutlined />
                        </button>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {selectedLeadIds.length > 0 && (
          <div
            className="hub-row"
            style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 12 }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#101828" }}>
              {selectedLeadIds.length} lead{selectedLeadIds.length === 1 ? "" : "s"} selected
            </span>
            <button
              type="button"
              className="hub-btn"
              disabled={deleting}
              onClick={deleteSelectedUnassigned}
              style={{ color: "#dc2626", borderColor: "#f3c9c9" }}
            >
              <DeleteOutlined /> {deleting ? "Deleting…" : `Delete Selected (${selectedLeadIds.length})`}
            </button>
          </div>
        )}

        {teamNames.length > 0 && (
          <div
            style={{
              marginTop: 16,
              border: "1px solid #eef0f4",
              borderRadius: 12,
              padding: 14,
              background: selectedLeadIds.length > 0 ? "var(--hub-blue-soft)" : "#fafbfd",
              transition: "background 0.2s ease",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#101828" }}>
                Assign {selectedLeadIds.length > 0 ? `${selectedLeadIds.length} selected lead${selectedLeadIds.length === 1 ? "" : "s"}` : "selected leads"} to teams
              </div>

              {teamNames.length > 0 && (
                <Tooltip title={`Splits every unassigned lead equally across all ${teamNames.length} teams`}>
                  <button
                    type="button"
                    className="hub-btn"
                    disabled={unassignedCount === 0 || assigning || selectAllLoading}
                    onClick={distributeAllToAllTeams}
                  >
                    <SwapOutlined /> Distribute All to All Teams
                  </button>
                </Tooltip>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {teamNames.map((t) => (
                <label
                  key={t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: `1px solid ${assignTeams.includes(t) ? "var(--hub-blue)" : "#e3e9f5"}`,
                    background: assignTeams.includes(t) ? "var(--hub-blue-soft)" : "#fff",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={assignTeams.includes(t)}
                    onChange={() => toggleAssignTeam(t)}
                    style={{ width: 14, height: 14, accentColor: "var(--hub-blue)", cursor: "pointer" }}
                  />
                  {t}
                </label>
              ))}
            </div>

            <div className="hub-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <span style={{ fontSize: 12, color: "#8c8c8c" }}>
                {selectedLeadIds.length > 0 && assignTeams.length > 0
                  ? `${selectedLeadIds.length} lead${selectedLeadIds.length === 1 ? "" : "s"} will be split equally across ${assignTeams.length} team${assignTeams.length === 1 ? "" : "s"}.`
                  : "Select leads above and check one or more teams."}
              </span>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={selectedLeadIds.length === 0 || assignTeams.length === 0 || assigning}
                onClick={assignSelectedEqually}
              >
                <SwapOutlined /> {assigning ? "Assigning…" : "Assign Equally"}
              </button>
            </div>
          </div>
        )}

        {!unassignedLoading && unassigned.length > 0 && (
          <div className="hub-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
            <span style={{ fontSize: 12, color: "#8c8c8c" }}>
              Page {unassignedPage} of {unassignedPages} · {unassignedCount} unassigned total
            </span>
            <div className="hub-row" style={{ gap: 8 }}>
              <button
                type="button"
                className="hub-btn"
                disabled={unassignedPage <= 1}
                onClick={() => loadUnassigned(unassignedPage - 1)}
              >
                <LeftOutlined /> Prev
              </button>
              <button
                type="button"
                className="hub-btn"
                disabled={unassignedPage >= unassignedPages}
                onClick={() => loadUnassigned(unassignedPage + 1)}
              >
                Next <RightOutlined />
              </button>
            </div>
          </div>
        )}
      </div>

      <LeadDetailModal lead={viewLead} onClose={() => setViewLead(null)} />
    </div>
  );
}

const FIELD_LIBRARY = [
  { key: "name", label: "Full Name", type: "Text" },
  { key: "email", label: "Email Address", type: "Email" },
  { key: "whatsapp", label: "WhatsApp Number", type: "WhatsApp" },
  { key: "source", label: "How did you hear about us?", type: "Dropdown", options: ["Facebook", "Instagram", "Google Search", "Referral", "Other"] },
  { key: "budget", label: "Budget Range", type: "Dropdown", options: ["Under ₹10,000", "₹10,000 – ₹25,000", "₹25,000 – ₹50,000", "₹50,000+"] },
  { key: "howSoon", label: "How Soon to Start?", type: "Dropdown", options: ["Immediate", "1 Week", "7 Days", "15 Days", "30 Days"] },
  { key: "message", label: "Message", type: "Textarea" },
];

const DEFAULT_ENABLED = {
  name: true,
  email: true,
  whatsapp: true,
  source: true,
  budget: false,
  howSoon: false,
  message: false,
};

const CTA_OPTIONS = ["LEARN_MORE", "SIGN_UP", "APPLY_NOW", "GET_QUOTE", "CONTACT_US", "SUBSCRIBE"];

// Maps the "Where does this form run?" toggle value to the `source` value
// captured leads are filtered by (see loadCapturedLeads below) — kept as a
// lookup rather than a growing ternary now that there are four platforms.
const PLATFORM_SOURCE_MAP = {
  "Facebook Ads": "Facebook Ads",
  "Google Ads": "Google Ads",
  "LinkedIn Ads": "LinkedIn Ads",
  Website: "Website",
};

// DELETE a lead without request.js's automatic per-call success toast, so
// a bulk delete can show a single summary message instead of one toast
// per row. Same auth-header pattern as the disconnect helpers below.
async function deleteLeadRaw(id) {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.delete(`${API_BASE_URL}lead/delete/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// Raw axios call for the one action request.js's helpers don't fit — DELETE
// with no id suffix. Mirrors downloadLeadsExport's auth-header pattern above.
async function disconnectFacebookConnection() {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.delete(`${API_BASE_URL}facebook/connection`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// Same shape as disconnectFacebookConnection above, for Google Ads.
async function disconnectGoogleConnection() {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.delete(`${API_BASE_URL}google/connection`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// Same shape as disconnectFacebookConnection above, for LinkedIn Ads.
async function disconnectLinkedinConnection() {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.delete(`${API_BASE_URL}linkedin/connection`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

function CaptureForm() {
  const [enabled, setEnabled] = useState(DEFAULT_ENABLED);
  const [platform, setPlatform] = useState("Website");
  const [configId, setConfigId] = useState(null);
  const [metaFormId, setMetaFormId] = useState(null);
  const [formStatus, setFormStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [viewLead, setViewLead] = useState(null);

  // Real Facebook connection state — never a hard-coded boolean.
  const [connection, setConnection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [pages, setPages] = useState([]);
  const [adAccounts, setAdAccounts] = useState([]);
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState("");
  const [creatingForm, setCreatingForm] = useState(false);

  // Real Google Ads connection state — mirrors the Facebook state above.
  // Google's webhook has no subscribe step (see the connection card below).
  const [googleConnection, setGoogleConnection] = useState(null);
  const [googleConnectionLoading, setGoogleConnectionLoading] = useState(true);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleConnectionMessage, setGoogleConnectionMessage] = useState("");
  const [googleAccounts, setGoogleAccounts] = useState([]);
  const [googleCopyMessage, setGoogleCopyMessage] = useState("");

  // Real LinkedIn Ads connection state — mirrors the Facebook state above.
  // There's no Organization-listing endpoint (only ad-accounts is exposed —
  // see linkedinApi.js), so Organization is a typed ID, not a <select>.
  const [linkedinConnection, setLinkedinConnection] = useState(null);
  const [linkedinConnectionLoading, setLinkedinConnectionLoading] = useState(true);
  const [linkedinConnecting, setLinkedinConnecting] = useState(false);
  const [linkedinConnectionMessage, setLinkedinConnectionMessage] = useState("");
  const [linkedinAdAccounts, setLinkedinAdAccounts] = useState([]);
  const [orgIdInput, setOrgIdInput] = useState("");
  const [orgNameInput, setOrgNameInput] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);

  const [capturedLeads, setCapturedLeads] = useState([]);
  const [capturedLoading, setCapturedLoading] = useState(true);
  const [capturedPage, setCapturedPage] = useState(1);
  const [capturedPages, setCapturedPages] = useState(1);
  const [capturedCount, setCapturedCount] = useState(0);

  const activeFields = FIELD_LIBRARY.filter((f) => enabled[f.key]);

  const loadConfig = async (plat) => {
    const res = await request.listAll({ entity: "captureformconfig" });
    const all = res?.success ? res.result : [];
    const found = all.find((c) => c.platform === plat && !c.removed);
    if (found) {
      setConfigId(found._id);
      const map = { ...DEFAULT_ENABLED };
      Object.keys(map).forEach((k) => (map[k] = false));
      (found.fields || []).forEach((f) => {
        map[f.key] = !!f.enabled;
      });
      setEnabled(map);
      setMetaFormId(found.metaFormId || null);
      setFormStatus(found.status || "draft");
    } else {
      setConfigId(null);
      setEnabled(DEFAULT_ENABLED);
      setMetaFormId(null);
      setFormStatus("draft");
    }
  };

  const loadConnection = async () => {
    setConnectionLoading(true);
    const res = await request.get({ entity: "facebook/connection" });
    setConnection(res?.success ? res.result : null);
    setConnectionLoading(false);
  };

  const loadPagesAndAdAccounts = async () => {
    const [pagesRes, adAccRes] = await Promise.all([
      request.get({ entity: "facebook/pages" }),
      request.get({ entity: "facebook/ad-accounts" }),
    ]);
    setPages(pagesRes?.success ? pagesRes.result : []);
    setAdAccounts(adAccRes?.success ? adAccRes.result : []);
  };

  const loadGoogleConnection = async () => {
    setGoogleConnectionLoading(true);
    const res = await request.get({ entity: "google/connection" });
    setGoogleConnection(res?.success ? res.result : null);
    setGoogleConnectionLoading(false);
  };

  const loadGoogleAccounts = async () => {
    const res = await request.get({ entity: "google/customer-accounts" });
    setGoogleAccounts(res?.success ? res.result : []);
  };

  const loadLinkedinConnection = async () => {
    setLinkedinConnectionLoading(true);
    const res = await request.get({ entity: "linkedin/connection" });
    setLinkedinConnection(res?.success ? res.result : null);
    setLinkedinConnectionLoading(false);
  };

  const loadLinkedinAdAccounts = async () => {
    const res = await request.get({ entity: "linkedin/ad-accounts" });
    setLinkedinAdAccounts(res?.success ? res.result : []);
  };

  const loadCapturedLeads = async (targetPage = 1) => {
    setCapturedLoading(true);
    const options = {
      page: targetPage,
      items: 10,
      filter: "source",
      equal: PLATFORM_SOURCE_MAP[platform] || "Website",
    };
    const res = await request.list({ entity: "lead", options });
    setCapturedLeads(res?.success ? res.result : []);
    setCapturedPages(res?.pagination?.pages || 1);
    setCapturedCount(res?.pagination?.count || 0);
    setCapturedPage(targetPage);
    setCapturedLoading(false);
  };

  useEffect(() => {
    loadConfig(platform);
    loadCapturedLeads(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  useEffect(() => {
    loadConnection();
  }, []);

  useEffect(() => {
    if (connection?.connected) loadPagesAndAdAccounts();
  }, [connection?.connected]);

  // Listens for the OAuth popup's postMessage (see backend facebookController
  // /callback.js) — no full-page navigation away from the app.
  useEffect(() => {
    const handler = (event) => {
      if (!event.data || !String(event.data.type || "").startsWith("fb-oauth-")) return;
      if (event.data.type === "fb-oauth-success") {
        loadConnection();
      } else {
        setConnectionMessage(event.data.message || "Facebook connection failed.");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    loadGoogleConnection();
    loadLinkedinConnection();
  }, []);

  useEffect(() => {
    if (googleConnection?.connected) loadGoogleAccounts();
  }, [googleConnection?.connected]);

  useEffect(() => {
    if (linkedinConnection?.connected) loadLinkedinAdAccounts();
  }, [linkedinConnection?.connected]);

  // Listens for the Google OAuth popup's postMessage (see backend
  // googleController/callback.js) — mirrors the Facebook listener above.
  useEffect(() => {
    const handler = (event) => {
      if (!event.data || !String(event.data.type || "").startsWith("google-oauth-")) return;
      if (event.data.type === "google-oauth-success") {
        loadGoogleConnection();
      } else {
        setGoogleConnectionMessage(event.data.message || "Google Ads connection failed.");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Listens for the LinkedIn OAuth popup's postMessage (see backend
  // linkedinController/callback.js) — mirrors the Facebook listener above.
  useEffect(() => {
    const handler = (event) => {
      if (!event.data || !String(event.data.type || "").startsWith("li-oauth-")) return;
      if (event.data.type === "li-oauth-success") {
        loadLinkedinConnection();
      } else {
        setLinkedinConnectionMessage(event.data.message || "LinkedIn connection failed.");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const connectFacebook = async () => {
    setConnecting(true);
    setConnectionMessage("");
    // Opened synchronously, before the await below, so browsers still treat
    // it as a direct result of the click — window.open() called after an
    // await falls outside the click's "user activation" window and gets
    // silently popup-blocked (looked like "nothing happens on connect").
    const popup = window.open("", "fb-oauth", "width=620,height=720");
    const res = await request.get({ entity: "facebook/connect" });
    setConnecting(false);
    if (!res?.success) {
      setConnectionMessage(res?.message || "Could not start the Facebook connection.");
      popup?.close();
      return;
    }
    if (popup) popup.location.href = res.result.url;
    else window.open(res.result.url, "fb-oauth", "width=620,height=720");
  };

  const disconnectFacebook = async () => {
    const res = await disconnectFacebookConnection();
    if (res?.success) {
      setConnection(res.result);
      setPages([]);
      setAdAccounts([]);
    }
  };

  const selectPage = async (pageId) => {
    const res = await request.patch({ entity: "facebook/connection", jsonData: { pageId } });
    if (res?.success) setConnection(res.result);
  };

  const selectAdAccount = async (adAccountId) => {
    const acc = adAccounts.find((a) => a.id === adAccountId);
    const res = await request.patch({
      entity: "facebook/connection",
      jsonData: { adAccountId, adAccountName: acc?.name },
    });
    if (res?.success) setConnection(res.result);
  };

  const connectGoogle = async () => {
    setGoogleConnecting(true);
    setGoogleConnectionMessage("");
    // See the comment in connectFacebook — same popup-blocked-by-await fix.
    const popup = window.open("", "google-oauth", "width=620,height=720");
    const res = await request.get({ entity: "google/connect" });
    setGoogleConnecting(false);
    if (!res?.success) {
      setGoogleConnectionMessage(res?.message || "Could not start the Google Ads connection.");
      popup?.close();
      return;
    }
    if (popup) popup.location.href = res.result.url;
    else window.open(res.result.url, "google-oauth", "width=620,height=720");
  };

  const disconnectGoogle = async () => {
    const res = await disconnectGoogleConnection();
    if (res?.success) {
      setGoogleConnection(res.result);
      setGoogleAccounts([]);
    }
  };

  const selectGoogleCustomer = async (customerId) => {
    const acc = googleAccounts.find((a) => a.id === customerId);
    const res = await request.patch({
      entity: "google/connection",
      jsonData: { customerId, customerName: acc?.name },
    });
    if (res?.success) setGoogleConnection(res.result);
  };

  const copyGoogleValue = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setGoogleCopyMessage("Copied to clipboard.");
    } catch (e) {
      setGoogleCopyMessage("Could not copy automatically — select and copy manually.");
    }
  };

  const connectLinkedin = async () => {
    setLinkedinConnecting(true);
    setLinkedinConnectionMessage("");
    // See the comment in connectFacebook — same popup-blocked-by-await fix.
    const popup = window.open("", "linkedin-oauth", "width=620,height=720");
    const res = await request.get({ entity: "linkedin/connect" });
    setLinkedinConnecting(false);
    if (!res?.success) {
      setLinkedinConnectionMessage(res?.message || "Could not start the LinkedIn connection.");
      popup?.close();
      return;
    }
    if (popup) popup.location.href = res.result.url;
    else window.open(res.result.url, "linkedin-oauth", "width=620,height=720");
  };

  const disconnectLinkedin = async () => {
    const res = await disconnectLinkedinConnection();
    if (res?.success) {
      setLinkedinConnection(res.result);
      setLinkedinAdAccounts([]);
    }
  };

  const saveOrganization = async () => {
    if (!orgIdInput.trim()) return;
    setSavingOrg(true);
    const res = await request.patch({
      entity: "linkedin/connection",
      jsonData: { organizationId: orgIdInput.trim(), organizationName: orgNameInput.trim() },
    });
    setSavingOrg(false);
    if (res?.success) {
      setLinkedinConnection(res.result);
      setOrgIdInput("");
      setOrgNameInput("");
    }
  };

  const selectLinkedinAdAccount = async (adAccountId) => {
    const acc = linkedinAdAccounts.find((a) => a.id === adAccountId);
    const res = await request.patch({
      entity: "linkedin/connection",
      jsonData: { adAccountId, adAccountName: acc?.name },
    });
    if (res?.success) setLinkedinConnection(res.result);
  };

  const saveForm = async () => {
    setSaving(true);
    setSaveMessage("");
    const fields = FIELD_LIBRARY.map((f, i) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      enabled: !!enabled[f.key],
      required: false,
      sortOrder: i,
    }));

    const res = configId
      ? await request.update({ entity: "captureformconfig", id: configId, jsonData: { fields } })
      : await request.create({ entity: "captureformconfig", jsonData: { platform, fields } });

    setSaving(false);
    if (res?.success) {
      if (!configId) setConfigId(res.result._id);
      setSaveMessage("Form saved.");
    } else {
      setSaveMessage(res?.message || "Could not save the form.");
    }
  };

  const copyEmbedCode = async () => {
    const fieldHtml = activeFields
      .map((f) => {
        if (f.type === "Textarea") {
          return `<textarea name="${f.key}" placeholder="${f.label}"></textarea>`;
        }
        if (f.type === "Dropdown") {
          const opts = f.options.map((o) => `<option value="${o}">${o}</option>`).join("");
          return `<select name="${f.key}"><option value="">${f.label}</option>${opts}</select>`;
        }
        const type = f.type === "Email" ? "email" : "text";
        return `<input type="${type}" name="${f.key}" placeholder="${f.label}"${f.key === "name" ? " required" : ""} />`;
      })
      .join("\n    ");

    const endpoint = `${BASE_URL}public/leads/website`;

    const snippet = `<form id="clc-lead-form">
    ${fieldHtml}
    <button type="submit">Submit</button>
  </form>
  <script>
    document.getElementById('clc-lead-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(e.target).forEach(function (v, k) { data[k] = v; });
      fetch('${endpoint}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          alert(res.message || 'Thanks!');
          e.target.reset();
        })
        .catch(function () { alert('Something went wrong — please try again.'); });
    });
  </script>`;

    try {
      await navigator.clipboard.writeText(snippet);
      setCopyMessage("Embed code copied to clipboard.");
    } catch (e) {
      setCopyMessage("Could not copy automatically — select and copy the code manually.");
    }
  };

  const createMetaForm = async () => {
    if (!privacyPolicyUrl.trim()) return;
    setCreatingForm(true);
    const res = await request.post({
      entity: "facebook/forms",
      jsonData: { name: "Website Lead Form", privacyPolicyUrl: privacyPolicyUrl.trim() },
    });
    setCreatingForm(false);
    if (res?.success) {
      setMetaFormId(res.result.metaFormId);
      setFormStatus(res.result.status);
      setSaveMessage("Meta Lead Form created.");
    } else {
      setSaveMessage(res?.message || "Could not create the Meta Lead Form.");
    }
  };

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header" style={{ marginBottom: 12 }}>
          <h3>Where does this form run?</h3>
        </div>
        <div className="hub-btn-group">
          {["Website", "Facebook Ads", "Google Ads", "LinkedIn Ads"].map((p) => {
            const meta = PLATFORM_ICON_META[p];
            return (
              <button
                key={p}
                type="button"
                className="hub-btn"
                style={
                  platform === p
                    ? { background: "var(--hub-blue)", color: "#fff", borderColor: "var(--hub-blue)" }
                    : {}
                }
                onClick={() => setPlatform(p)}
              >
                <span
                  className="platform-icon-badge"
                  style={{ background: meta.color, color: meta.iconColor || "#fff" }}
                >
                  {meta.icon}
                </span>
                {p}
              </button>
            );
          })}
        </div>
      </div>

      {platform === "Facebook Ads" && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><FacebookOutlined /> Facebook Lead Ads Connection</h3>
            <span className={`hub-badge ${connection?.connected ? "hub-badge-green" : "hub-badge-gray"}`}>
              {connectionLoading ? "Checking…" : connection?.connected ? <><CheckCircleOutlined /> Connected</> : "Not Connected"}
            </span>
          </div>

          <div style={{ fontSize: 12.5, color: "#667085", marginBottom: 16 }}>
            Connect a real Facebook account, then pick the Page and Ad Account leads from
            your Facebook ads should flow into — no manual entry, no hard-coded IDs.
          </div>

          {!connection?.connected ? (
            <>
              <button type="button" className="hub-btn hub-btn-primary" disabled={connecting} onClick={connectFacebook}>
                <LinkOutlined /> {connecting ? "Opening Facebook…" : "Connect Facebook"}
              </button>
              {connectionMessage && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{connectionMessage}</div>
              )}
            </>
          ) : (
            <>
              <div className="hub-grid-2" style={{ marginBottom: 16 }}>
                <div className="hub-form-row">
                  <label>Facebook Page</label>
                  <select
                    className="hub-select"
                    value={connection.page?.id || ""}
                    onChange={(e) => selectPage(e.target.value)}
                  >
                    <option value="" disabled>{pages.length ? "Select a Page…" : "Loading Pages…"}</option>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Account</label>
                  <select
                    className="hub-select"
                    value={connection.adAccount?.id || ""}
                    onChange={(e) => selectAdAccount(e.target.value)}
                  >
                    <option value="" disabled>{adAccounts.length ? "Select an Ad Account…" : "Loading Ad Accounts…"}</option>
                    {adAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} · {a.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: "#8c8c8c", marginBottom: 14 }}>
                {connection.webhookSubscribed ? (
                  <span className="hub-badge hub-badge-green">Webhook subscribed — new leads arrive automatically</span>
                ) : connection.page ? (
                  <span className="hub-badge hub-badge-yellow">Webhook not subscribed yet</span>
                ) : (
                  "Select a Page to subscribe its lead webhook."
                )}
                {connection.lastError && (
                  <div style={{ marginTop: 6, color: "#dc2626" }}>{connection.lastError}</div>
                )}
              </div>

              <button type="button" className="hub-btn" onClick={disconnectFacebook}>
                <DisconnectOutlined /> Disconnect Facebook
              </button>
            </>
          )}
        </div>
      )}

      {platform === "Google Ads" && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><GoogleOutlined /> Google Ads Connection</h3>
            <span className={`hub-badge ${googleConnection?.connected ? "hub-badge-green" : "hub-badge-gray"}`}>
              {googleConnectionLoading ? "Checking…" : googleConnection?.connected ? <><CheckCircleOutlined /> Connected</> : "Not Connected"}
            </span>
          </div>

          <div style={{ fontSize: 12.5, color: "#667085", marginBottom: 16 }}>
            Connect a real Google Ads account, then pick the account leads from your
            Google Ads Lead Form campaigns should flow into.
          </div>

          {!googleConnection?.connected ? (
            <>
              <button type="button" className="hub-btn hub-btn-primary" disabled={googleConnecting} onClick={connectGoogle}>
                <LinkOutlined /> {googleConnecting ? "Opening Google…" : "Connect Google Ads"}
              </button>
              {googleConnectionMessage && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{googleConnectionMessage}</div>
              )}
            </>
          ) : (
            <>
              <div className="hub-grid-2" style={{ marginBottom: 16 }}>
                <div className="hub-form-row">
                  <label>Google Ads Account</label>
                  <select
                    className="hub-select"
                    value={googleConnection.customer?.id || ""}
                    onChange={(e) => selectGoogleCustomer(e.target.value)}
                  >
                    <option value="" disabled>{googleAccounts.length ? "Select an account…" : "Loading accounts…"}</option>
                    {googleAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} · {a.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              {googleConnection.customer ? (
                <div style={{ paddingTop: 14, borderTop: "1px solid var(--hub-border)", marginBottom: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Connect leads from Google Ads</div>
                  <div style={{ fontSize: 11.5, color: "#8c8c8c", marginBottom: 10 }}>
                    In Google Ads, open your Lead Form asset → Connect to a CRM using webhook integration →
                    paste the URL and key below.
                  </div>
                  <div className="hub-form-row" style={{ marginBottom: 10 }}>
                    <label>Webhook URL</label>
                    <div className="hub-row" style={{ gap: 8 }}>
                      <input className="hub-input" readOnly style={{ flex: 1 }} value={googleConnection.webhookUrl || ""} />
                      <button type="button" className="hub-btn" onClick={() => copyGoogleValue(googleConnection.webhookUrl)}>
                        <CopyOutlined /> Copy
                      </button>
                    </div>
                  </div>
                  <div className="hub-form-row">
                    <label>Webhook Key</label>
                    <div className="hub-row" style={{ gap: 8 }}>
                      <input className="hub-input" readOnly style={{ flex: 1 }} value={googleConnection.webhookKey || ""} />
                      <button type="button" className="hub-btn" onClick={() => copyGoogleValue(googleConnection.webhookKey)}>
                        <CopyOutlined /> Copy
                      </button>
                    </div>
                  </div>
                  {googleCopyMessage && (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--hub-blue)" }}>{googleCopyMessage}</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: "#8c8c8c", marginBottom: 14 }}>
                  Select a Google Ads account to see the webhook URL and key to paste into Google Ads.
                </div>
              )}

              {googleConnection.lastError && (
                <div style={{ marginBottom: 14, fontSize: 11.5, color: "#dc2626" }}>{googleConnection.lastError}</div>
              )}

              <button type="button" className="hub-btn" onClick={disconnectGoogle}>
                <DisconnectOutlined /> Disconnect Google Ads
              </button>
            </>
          )}
        </div>
      )}

      {platform === "LinkedIn Ads" && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><LinkedinOutlined /> LinkedIn Ads Connection</h3>
            <span
              className={`hub-badge ${
                linkedinConnection?.connected
                  ? "hub-badge-green"
                  : linkedinConnection?.status === "expired"
                  ? "hub-badge-yellow"
                  : "hub-badge-gray"
              }`}
            >
              {linkedinConnectionLoading ? (
                "Checking…"
              ) : linkedinConnection?.connected ? (
                <><CheckCircleOutlined /> Connected</>
              ) : linkedinConnection?.status === "expired" ? (
                "Expired"
              ) : (
                "Not Connected"
              )}
            </span>
          </div>

          <div style={{ fontSize: 12.5, color: "#667085", marginBottom: 16 }}>
            Connect a real LinkedIn account, then set the Organization and Ad Account leads from
            your LinkedIn ads should flow into.
          </div>

          {linkedinConnection?.status === "expired" && (
            <div className="hub-badge hub-badge-yellow" style={{ marginBottom: 12 }}>
              Your LinkedIn connection expired — LinkedIn issues no refresh token, so reconnect below.
            </div>
          )}

          {!linkedinConnection?.connected ? (
            <>
              <button type="button" className="hub-btn hub-btn-primary" disabled={linkedinConnecting} onClick={connectLinkedin}>
                <LinkOutlined /> {linkedinConnecting ? "Opening LinkedIn…" : "Connect LinkedIn"}
              </button>
              {linkedinConnectionMessage && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{linkedinConnectionMessage}</div>
              )}
            </>
          ) : (
            <>
              <div className="hub-grid-2" style={{ marginBottom: 16 }}>
                <div className="hub-form-row">
                  <label>Organization (no listing API — type the ID)</label>
                  <div className="hub-row" style={{ gap: 8 }}>
                    <input
                      className="hub-input"
                      style={{ flex: 1 }}
                      placeholder="Organization ID"
                      value={orgIdInput}
                      onChange={(e) => setOrgIdInput(e.target.value)}
                    />
                    <input
                      className="hub-input"
                      style={{ flex: 1 }}
                      placeholder="Organization Name"
                      value={orgNameInput}
                      onChange={(e) => setOrgNameInput(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="hub-btn"
                    style={{ marginTop: 8 }}
                    disabled={!orgIdInput.trim() || savingOrg}
                    onClick={saveOrganization}
                  >
                    {savingOrg ? "Saving…" : "Save Organization"}
                  </button>
                  {linkedinConnection.organization && (
                    <div style={{ fontSize: 11.5, color: "#8c8c8c", marginTop: 6 }}>
                      Current: {linkedinConnection.organization.name} · {linkedinConnection.organization.id}
                    </div>
                  )}
                </div>
                <div className="hub-form-row">
                  <label>Ad Account</label>
                  <select
                    className="hub-select"
                    value={linkedinConnection.adAccount?.id || ""}
                    onChange={(e) => selectLinkedinAdAccount(e.target.value)}
                  >
                    <option value="" disabled>{linkedinAdAccounts.length ? "Select an Ad Account…" : "Loading Ad Accounts…"}</option>
                    {linkedinAdAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} · {a.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: "#8c8c8c", marginBottom: 14 }}>
                <span className="hub-badge hub-badge-blue">
                  LinkedIn has no live webhook — new leads are pulled by a background sync every few minutes
                </span>
                <div style={{ marginTop: 6 }}>
                  Last synced: {linkedinConnection.lastPolledAt ? new Date(linkedinConnection.lastPolledAt).toLocaleString() : "never yet"}
                </div>
                {linkedinConnection.lastError && (
                  <div style={{ marginTop: 6, color: "#dc2626" }}>{linkedinConnection.lastError}</div>
                )}
              </div>

              <button type="button" className="hub-btn" onClick={disconnectLinkedin}>
                <DisconnectOutlined /> Disconnect LinkedIn
              </button>
            </>
          )}
        </div>
      )}

      <div className="hub-grid-2">
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Form Fields</h3>
          </div>

          <div className="hub-stack" style={{ gap: 10 }}>
            {FIELD_LIBRARY.map((f) => (
              <div
                key={f.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  border: "1px solid #f0f0f0",
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: "#8c8c8c" }}>{f.type} field</div>
                </div>

                <button
                  type="button"
                  className={`hub-switch ${enabled[f.key] ? "on" : ""}`}
                  onClick={() =>
                    setEnabled((prev) => ({ ...prev, [f.key]: !prev[f.key] }))
                  }
                />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="hub-btn hub-btn-primary" type="button" disabled={saving} onClick={saveForm}>
              {saving ? "Saving…" : "Save Form"}
            </button>
            <button className="hub-btn" type="button" onClick={copyEmbedCode}>
              <CopyOutlined /> Copy Embed Code
            </button>
            {(saveMessage || copyMessage) && (
              <span className="hub-badge hub-badge-blue">{saveMessage || copyMessage}</span>
            )}
          </div>

          {platform === "Facebook Ads" && (
            <div className="hub-form-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <label>Meta Lead Form</label>
              {metaFormId ? (
                <span className="hub-badge hub-badge-green">
                  <CheckCircleOutlined /> Created — Meta form ID {metaFormId}
                </span>
              ) : (
                <>
                  <input
                    className="hub-input"
                    style={{ marginBottom: 8 }}
                    placeholder="Privacy policy URL (required by Meta)"
                    value={privacyPolicyUrl}
                    onChange={(e) => setPrivacyPolicyUrl(e.target.value)}
                  />
                  <button
                    type="button"
                    className="hub-btn"
                    disabled={!connection?.connected || !connection?.page || !privacyPolicyUrl.trim() || creatingForm}
                    onClick={createMetaForm}
                  >
                    {creatingForm ? "Creating…" : "Create Meta Lead Form"}
                  </button>
                  {!connection?.connected && (
                    <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>Connect Facebook and select a Page first.</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Live Preview</h3>
            <span className="hub-badge hub-badge-blue">
              {platform === "Facebook Ads"
                ? "Facebook Lead Ad"
                : platform === "Google Ads"
                ? "Google Lead Form"
                : platform === "LinkedIn Ads"
                ? "LinkedIn Lead Gen Form"
                : "Website Form"}
            </span>
          </div>

          <div
            style={{
              border: "1px solid #f0f0f0",
              borderRadius: 10,
              padding: 20,
              background: "#fafbfd",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              Get in touch with us
            </div>
            <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 16 }}>
              Fill this form and our team will reach out within 24 hours.
            </div>

            <div className="hub-stack" style={{ gap: 12 }}>
              {activeFields.length === 0 && (
                <div className="hub-empty">Turn on a field to preview it here.</div>
              )}

              {activeFields.map((f) => (
                <div key={f.key}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>
                    {f.label}
                  </div>
                  {f.type === "Textarea" ? (
                    <div
                      style={{
                        height: 60,
                        border: "1px solid #e3e9f5",
                        borderRadius: 6,
                        background: "#fff",
                      }}
                    />
                  ) : f.type === "Dropdown" ? (
                    <select className="hub-select" style={{ width: "100%" }} defaultValue="">
                      <option value="" disabled>Select…</option>
                      {f.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <div
                      style={{
                        height: 32,
                        border: "1px solid #e3e9f5",
                        borderRadius: 6,
                        background: "#fff",
                      }}
                    />
                  )}
                </div>
              ))}

              {activeFields.length > 0 && (
                <button
                  className="hub-btn hub-btn-primary"
                  type="button"
                  style={{ marginTop: 4, alignSelf: "flex-start" }}
                >
                  Submit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Captured Leads from {platform}</h3>
          <span className="hub-badge hub-badge-blue">{capturedCount} lead{capturedCount === 1 ? "" : "s"}</span>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Captured</th>
              </tr>
            </thead>
            <tbody>
              {capturedLoading && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">Loading captured leads…</div>
                  </td>
                </tr>
              )}
              {!capturedLoading && capturedLeads.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">No leads captured from {platform} yet.</div>
                  </td>
                </tr>
              )}
              {!capturedLoading &&
                capturedLeads.map((l) => (
                  <tr key={l._id} style={{ cursor: "pointer" }} onClick={() => setViewLead(l)}>
                    <td>{l.name}</td>
                    <td>{l.email || "—"}</td>
                    <td>{l.phone || "—"}</td>
                    <td>
                      <span className={`hub-badge ${STATUS_META[l.status]}`}>{l.status}</span>
                    </td>
                    <td>{new Date(l.created).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {capturedPages > 1 && (
          <div className="hub-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
            <span style={{ fontSize: 12, color: "#8c8c8c" }}>
              Page {capturedPage} of {capturedPages} · {capturedCount} leads total
            </span>
            <div className="hub-row" style={{ gap: 8 }}>
              <button type="button" className="hub-btn" disabled={capturedPage <= 1} onClick={() => loadCapturedLeads(capturedPage - 1)}>
                <LeftOutlined /> Prev
              </button>
              <button type="button" className="hub-btn" disabled={capturedPage >= capturedPages} onClick={() => loadCapturedLeads(capturedPage + 1)}>
                Next <RightOutlined />
              </button>
            </div>
          </div>
        )}
      </div>

      {platform === "Facebook Ads" && <CampaignSetup connection={connection} metaFormId={metaFormId} />}
      {platform === "Google Ads" && <GoogleCampaignSetup connection={googleConnection} />}
      {platform === "LinkedIn Ads" && <LinkedInCampaignSetup connection={linkedinConnection} />}

      <LeadDetailModal lead={viewLead} onClose={() => setViewLead(null)} />
    </div>
  );
}

// Raw axios call for creative media upload — multipart, doesn't fit any
// request.js helper's fixed URL suffix convention (see disconnectFacebookConnection above).
async function createFacebookCreative(formData) {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.post(`${API_BASE_URL}facebook/creatives`, formData, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// Same shape as createFacebookCreative above, for LinkedIn Creatives (a
// LinkedIn Creative absorbs both FacebookAdCreative's and FacebookAd's roles
// — see linkedinController/creatives.js).
async function createLinkedinCreative(formData) {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.post(`${API_BASE_URL}linkedin/creatives`, formData, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// New, additive UI — Campaign -> Ad Set -> Ad Creative -> Ad, each created
// PAUSED on Meta and only flipped ACTIVE by an explicit Publish click.
function CampaignSetup({ connection, metaFormId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [adSets, setAdSets] = useState([]);
  const [creatives, setCreatives] = useState([]);
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [newCampaignName, setNewCampaignName] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  const [adSetCampaignId, setAdSetCampaignId] = useState("");
  const [newAdSetName, setNewAdSetName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [countries, setCountries] = useState("IN");
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [creatingAdSet, setCreatingAdSet] = useState(false);

  const [creativeCampaignId, setCreativeCampaignId] = useState("");
  const [newCreativeName, setNewCreativeName] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [cta, setCta] = useState(CTA_OPTIONS[0]);
  const [mediaFile, setMediaFile] = useState(null);
  const [creatingCreative, setCreatingCreative] = useState(false);

  const [adCampaignId, setAdCampaignId] = useState("");
  const [adSetIdForAd, setAdSetIdForAd] = useState("");
  const [creativeIdForAd, setCreativeIdForAd] = useState("");
  const [newAdName, setNewAdName] = useState("");
  const [creatingAd, setCreatingAd] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [c, a, cr, ad] = await Promise.all([
      request.get({ entity: "facebook/campaigns" }),
      request.get({ entity: "facebook/adsets" }),
      request.get({ entity: "facebook/creatives" }),
      request.get({ entity: "facebook/ads" }),
    ]);
    setCampaigns(c?.success ? c.result : []);
    setAdSets(a?.success ? a.result : []);
    setCreatives(cr?.success ? cr.result : []);
    setAds(ad?.success ? ad.result : []);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const ready = connection?.connected && connection?.page && connection?.adAccount;

  const createCampaign = async () => {
    if (!newCampaignName.trim()) return;
    setCreatingCampaign(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "facebook/campaigns",
      jsonData: { name: newCampaignName.trim(), objective: "OUTCOME_LEADS" },
    });
    setCreatingCampaign(false);
    if (res?.success) {
      setNewCampaignName("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the campaign.");
    }
  };

  const createAdSet = async () => {
    if (!newAdSetName.trim() || !adSetCampaignId || !dailyBudget) return;
    setCreatingAdSet(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "facebook/adsets",
      jsonData: {
        name: newAdSetName.trim(),
        campaignId: adSetCampaignId,
        dailyBudget: Number(dailyBudget),
        countries: countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
        ageMin: Number(ageMin),
        ageMax: Number(ageMax),
      },
    });
    setCreatingAdSet(false);
    if (res?.success) {
      setNewAdSetName("");
      setDailyBudget("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad set.");
    }
  };

  const createCreative = async () => {
    if (!newCreativeName.trim() || !mediaFile || !metaFormId) return;
    setCreatingCreative(true);
    setErrorMsg("");

    const formData = new FormData();
    formData.append("file", mediaFile);
    formData.append("name", newCreativeName.trim());
    formData.append("campaignId", creativeCampaignId);
    formData.append("primaryText", primaryText);
    formData.append("headline", headline);
    formData.append("callToAction", cta);
    formData.append("metaFormId", metaFormId);
    formData.append("mediaType", mediaFile.type.startsWith("video/") ? "video" : "image");

    const res = await createFacebookCreative(formData);
    setCreatingCreative(false);
    if (res?.success) {
      setNewCreativeName("");
      setPrimaryText("");
      setHeadline("");
      setMediaFile(null);
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad creative.");
    }
  };

  const createAd = async () => {
    if (!newAdName.trim() || !adCampaignId || !adSetIdForAd || !creativeIdForAd) return;
    setCreatingAd(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "facebook/ads",
      jsonData: { name: newAdName.trim(), campaignId: adCampaignId, adSetId: adSetIdForAd, creativeId: creativeIdForAd },
    });
    setCreatingAd(false);
    if (res?.success) {
      setNewAdName("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad.");
    }
  };

  const publish = async (kind, id) => {
    setBusyId(id);
    setErrorMsg("");
    const res = await request.post({ entity: `facebook/${kind}/${id}/publish`, jsonData: {} });
    setBusyId(null);
    if (res?.success) {
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not publish.");
    }
  };

  const STATUS_BADGE = { PAUSED: "hub-badge-gray", ACTIVE: "hub-badge-green", ARCHIVED: "hub-badge-red" };

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><RocketOutlined /> Campaign Setup</h3>
          {errorMsg && <span className="hub-badge hub-badge-red">{errorMsg}</span>}
        </div>

        {!ready && (
          <div className="hub-empty">
            Connect Facebook, select a Page and an Ad Account above before creating campaigns.
          </div>
        )}

        {ready && (
          <div className="hub-stack" style={{ gap: 20 }}>
            {/* CAMPAIGN */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>1. Campaign</div>
              <div className="hub-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  className="hub-input"
                  style={{ flex: "1 1 220px" }}
                  placeholder="Campaign name"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                />
                <button type="button" className="hub-btn hub-btn-primary" disabled={!newCampaignName.trim() || creatingCampaign} onClick={createCampaign}>
                  <PlusOutlined /> {creatingCampaign ? "Creating…" : "Create Campaign (PAUSED)"}
                </button>
              </div>
              {campaigns.length > 0 && (
                <div className="hub-table-wrapper">
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Objective</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr key={c._id}>
                          <td>{c.name}</td>
                          <td>{c.objective}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                          <td>
                            {c.status === "PAUSED" && c.metaCampaignId && (
                              <button type="button" className="hub-btn" disabled={busyId === c._id} onClick={() => publish("campaigns", c._id)}>
                                <RocketOutlined /> {busyId === c._id ? "Publishing…" : "Publish"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* AD SET */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>2. Ad Set</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={adSetCampaignId} onChange={(e) => setAdSetCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.metaCampaignId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Set Name</label>
                  <input className="hub-input" value={newAdSetName} onChange={(e) => setNewAdSetName(e.target.value)} placeholder="e.g. Delhi NCR — 25-45" />
                </div>
                <div className="hub-form-row">
                  <label>Daily Budget (smallest currency unit, e.g. paise)</label>
                  <input className="hub-input" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 50000" />
                </div>
                <div className="hub-form-row">
                  <label>Countries (comma-separated)</label>
                  <input className="hub-input" value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="IN" />
                </div>
                <div className="hub-form-row">
                  <label>Age Min</label>
                  <input className="hub-input" value={ageMin} onChange={(e) => setAgeMin(e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="hub-form-row">
                  <label>Age Max</label>
                  <input className="hub-input" value={ageMax} onChange={(e) => setAgeMax(e.target.value.replace(/\D/g, ""))} />
                </div>
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newAdSetName.trim() || !adSetCampaignId || !dailyBudget || creatingAdSet}
                onClick={createAdSet}
              >
                <PlusOutlined /> {creatingAdSet ? "Creating…" : "Create Ad Set (PAUSED)"}
              </button>
              {adSets.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Daily Budget</th><th>Status</th></tr></thead>
                    <tbody>
                      {adSets.map((a) => (
                        <tr key={a._id}>
                          <td>{a.name}</td>
                          <td>{a.dailyBudget}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* AD CREATIVE */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>3. Ad Creative</div>
              {!metaFormId ? (
                <div className="hub-empty">Create the Meta Lead Form above first — creatives need it to attach the lead form.</div>
              ) : (
                <>
                  <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                    <div className="hub-form-row">
                      <label>Campaign</label>
                      <select className="hub-select" value={creativeCampaignId} onChange={(e) => setCreativeCampaignId(e.target.value)}>
                        <option value="">Select a campaign…</option>
                        {campaigns.filter((c) => c.metaCampaignId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="hub-form-row">
                      <label>Creative Name</label>
                      <input className="hub-input" value={newCreativeName} onChange={(e) => setNewCreativeName(e.target.value)} />
                    </div>
                    <div className="hub-form-row">
                      <label>Headline</label>
                      <input className="hub-input" value={headline} onChange={(e) => setHeadline(e.target.value)} />
                    </div>
                    <div className="hub-form-row">
                      <label>Call To Action</label>
                      <select className="hub-select" value={cta} onChange={(e) => setCta(e.target.value)}>
                        {CTA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="hub-form-row">
                    <label>Primary Text</label>
                    <textarea className="hub-input" rows={2} value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} />
                  </div>
                  <div className="hub-form-row">
                    <label>Image or Video</label>
                    <input type="file" accept="image/*,video/*" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} />
                  </div>
                  <button
                    type="button"
                    className="hub-btn hub-btn-primary"
                    disabled={!newCreativeName.trim() || !mediaFile || creatingCreative}
                    onClick={createCreative}
                  >
                    <PlusOutlined /> {creatingCreative ? "Uploading…" : "Create Ad Creative"}
                  </button>
                  {creatives.length > 0 && (
                    <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                      <table className="hub-table">
                        <thead><tr><th>Name</th><th>Media</th><th>Status</th></tr></thead>
                        <tbody>
                          {creatives.map((c) => (
                            <tr key={c._id}>
                              <td>{c.name}</td>
                              <td>{c.mediaType}</td>
                              <td><span className={`hub-badge ${c.status === "created" ? "hub-badge-green" : c.status === "error" ? "hub-badge-red" : "hub-badge-gray"}`}>{c.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* AD */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>4. Ad — Review &amp; Publish</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={adCampaignId} onChange={(e) => setAdCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.metaCampaignId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Name</label>
                  <input className="hub-input" value={newAdName} onChange={(e) => setNewAdName(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Ad Set</label>
                  <select className="hub-select" value={adSetIdForAd} onChange={(e) => setAdSetIdForAd(e.target.value)}>
                    <option value="">Select an ad set…</option>
                    {adSets.filter((a) => a.metaAdSetId).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Creative</label>
                  <select className="hub-select" value={creativeIdForAd} onChange={(e) => setCreativeIdForAd(e.target.value)}>
                    <option value="">Select a creative…</option>
                    {creatives.filter((c) => c.metaCreativeId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newAdName.trim() || !adCampaignId || !adSetIdForAd || !creativeIdForAd || creatingAd}
                onClick={createAd}
              >
                <PlusOutlined /> {creatingAd ? "Creating…" : "Create Ad (PAUSED)"}
              </button>
              {ads.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {ads.map((a) => (
                        <tr key={a._id}>
                          <td>{a.name}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                          <td>
                            {a.status === "PAUSED" && a.metaAdId && (
                              <button type="button" className="hub-btn hub-btn-primary" disabled={busyId === a._id} onClick={() => publish("ads", a._id)}>
                                <RocketOutlined /> {busyId === a._id ? "Publishing…" : "Publish Campaign"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// New, additive UI — Campaign -> Ad Group -> Ad, each created PAUSED on
// Google Ads and only flipped ENABLED by an explicit Publish click. Google
// has no separate "Ad Creative" object the way Meta does — headlines,
// descriptions and final URLs live directly on the Ad (see
// googleController/ads.js) — so this is a 3-step flow, not 4 like
// CampaignSetup above. Mirrors CampaignSetup's structure exactly.
function GoogleCampaignSetup({ connection }) {
  const [campaigns, setCampaigns] = useState([]);
  const [adGroups, setAdGroups] = useState([]);
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [newCampaignName, setNewCampaignName] = useState("");
  const [dailyBudgetMicros, setDailyBudgetMicros] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  const [adGroupCampaignId, setAdGroupCampaignId] = useState("");
  const [newAdGroupName, setNewAdGroupName] = useState("");
  const [cpcBidMicros, setCpcBidMicros] = useState("");
  const [creatingAdGroup, setCreatingAdGroup] = useState(false);

  const [adCampaignId, setAdCampaignId] = useState("");
  const [adGroupIdForAd, setAdGroupIdForAd] = useState("");
  const [newAdName, setNewAdName] = useState("");
  const [headline1, setHeadline1] = useState("");
  const [headline2, setHeadline2] = useState("");
  const [headline3, setHeadline3] = useState("");
  const [description1, setDescription1] = useState("");
  const [description2, setDescription2] = useState("");
  const [finalUrl, setFinalUrl] = useState("");
  const [creatingAd, setCreatingAd] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [c, ag, ad] = await Promise.all([
      request.get({ entity: "google/campaigns" }),
      request.get({ entity: "google/adgroups" }),
      request.get({ entity: "google/ads" }),
    ]);
    setCampaigns(c?.success ? c.result : []);
    setAdGroups(ag?.success ? ag.result : []);
    setAds(ad?.success ? ad.result : []);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const ready = connection?.connected && connection?.customer;

  const createCampaign = async () => {
    if (!newCampaignName.trim() || !dailyBudgetMicros) return;
    setCreatingCampaign(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "google/campaigns",
      jsonData: { name: newCampaignName.trim(), dailyBudgetMicros: Number(dailyBudgetMicros) },
    });
    setCreatingCampaign(false);
    if (res?.success) {
      setNewCampaignName("");
      setDailyBudgetMicros("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the campaign.");
    }
  };

  const createAdGroup = async () => {
    if (!newAdGroupName.trim() || !adGroupCampaignId) return;
    setCreatingAdGroup(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "google/adgroups",
      jsonData: {
        name: newAdGroupName.trim(),
        campaignId: adGroupCampaignId,
        cpcBidMicros: cpcBidMicros ? Number(cpcBidMicros) : undefined,
      },
    });
    setCreatingAdGroup(false);
    if (res?.success) {
      setNewAdGroupName("");
      setCpcBidMicros("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad group.");
    }
  };

  const createAd = async () => {
    const headlines = [headline1, headline2, headline3].map((h) => h.trim()).filter(Boolean);
    const descriptions = [description1, description2].map((d) => d.trim()).filter(Boolean);
    if (!adCampaignId || !adGroupIdForAd || headlines.length < 3 || descriptions.length < 2 || !finalUrl.trim()) return;
    setCreatingAd(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "google/ads",
      jsonData: {
        name: newAdName.trim() || undefined,
        campaignId: adCampaignId,
        adGroupId: adGroupIdForAd,
        headlines,
        descriptions,
        finalUrls: [finalUrl.trim()],
      },
    });
    setCreatingAd(false);
    if (res?.success) {
      setNewAdName("");
      setHeadline1("");
      setHeadline2("");
      setHeadline3("");
      setDescription1("");
      setDescription2("");
      setFinalUrl("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad.");
    }
  };

  const publish = async (kind, id) => {
    setBusyId(id);
    setErrorMsg("");
    const res = await request.post({ entity: `google/${kind}/${id}/publish`, jsonData: {} });
    setBusyId(null);
    if (res?.success) {
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not publish.");
    }
  };

  const STATUS_BADGE = { PAUSED: "hub-badge-gray", ENABLED: "hub-badge-green", REMOVED: "hub-badge-red" };

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><RocketOutlined /> Google Ads Campaign Setup</h3>
          {errorMsg && <span className="hub-badge hub-badge-red">{errorMsg}</span>}
        </div>

        {!ready && (
          <div className="hub-empty">
            Connect Google Ads and select an account above before creating campaigns.
          </div>
        )}

        {ready && (
          <div className="hub-stack" style={{ gap: 20 }}>
            {/* CAMPAIGN */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>1. Campaign</div>
              <div className="hub-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  className="hub-input"
                  style={{ flex: "1 1 220px" }}
                  placeholder="Campaign name"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                />
                <input
                  className="hub-input"
                  style={{ flex: "1 1 260px" }}
                  placeholder="Daily budget (micros — 1,000,000 = 1 currency unit)"
                  value={dailyBudgetMicros}
                  onChange={(e) => setDailyBudgetMicros(e.target.value.replace(/\D/g, ""))}
                />
                <button
                  type="button"
                  className="hub-btn hub-btn-primary"
                  disabled={!newCampaignName.trim() || !dailyBudgetMicros || creatingCampaign}
                  onClick={createCampaign}
                >
                  <PlusOutlined /> {creatingCampaign ? "Creating…" : "Create Campaign (PAUSED)"}
                </button>
              </div>
              {campaigns.length > 0 && (
                <div className="hub-table-wrapper">
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Channel</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr key={c._id}>
                          <td>{c.name}</td>
                          <td>{c.advertisingChannelType}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                          <td>
                            {c.status === "PAUSED" && c.googleCampaignResourceName && (
                              <button type="button" className="hub-btn" disabled={busyId === c._id} onClick={() => publish("campaigns", c._id)}>
                                <RocketOutlined /> {busyId === c._id ? "Publishing…" : "Publish"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* AD GROUP */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>2. Ad Group</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={adGroupCampaignId} onChange={(e) => setAdGroupCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.googleCampaignResourceName).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Group Name</label>
                  <input className="hub-input" value={newAdGroupName} onChange={(e) => setNewAdGroupName(e.target.value)} placeholder="e.g. Career Coaching — Broad" />
                </div>
                <div className="hub-form-row">
                  <label>CPC Bid (micros, optional)</label>
                  <input className="hub-input" value={cpcBidMicros} onChange={(e) => setCpcBidMicros(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1000000" />
                </div>
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newAdGroupName.trim() || !adGroupCampaignId || creatingAdGroup}
                onClick={createAdGroup}
              >
                <PlusOutlined /> {creatingAdGroup ? "Creating…" : "Create Ad Group (PAUSED)"}
              </button>
              {adGroups.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>CPC Bid</th><th>Status</th></tr></thead>
                    <tbody>
                      {adGroups.map((a) => (
                        <tr key={a._id}>
                          <td>{a.name}</td>
                          <td>{a.cpcBidMicros || "—"}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* AD */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>3. Ad — Responsive Search Ad</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={adCampaignId} onChange={(e) => setAdCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.googleCampaignResourceName).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Group</label>
                  <select className="hub-select" value={adGroupIdForAd} onChange={(e) => setAdGroupIdForAd(e.target.value)}>
                    <option value="">Select an ad group…</option>
                    {adGroups.filter((a) => a.googleAdGroupResourceName).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Name (internal label)</label>
                  <input className="hub-input" value={newAdName} onChange={(e) => setNewAdName(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Final URL</label>
                  <input className="hub-input" value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} placeholder="https://example.com/landing" />
                </div>
                <div className="hub-form-row">
                  <label>Headline 1</label>
                  <input className="hub-input" value={headline1} onChange={(e) => setHeadline1(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Headline 2</label>
                  <input className="hub-input" value={headline2} onChange={(e) => setHeadline2(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Headline 3</label>
                  <input className="hub-input" value={headline3} onChange={(e) => setHeadline3(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Description 1</label>
                  <input className="hub-input" value={description1} onChange={(e) => setDescription1(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Description 2</label>
                  <input className="hub-input" value={description2} onChange={(e) => setDescription2(e.target.value)} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 10 }}>
                Google requires at least 3 headlines and 2 descriptions for a Responsive Search Ad.
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={
                  !adCampaignId ||
                  !adGroupIdForAd ||
                  !finalUrl.trim() ||
                  [headline1, headline2, headline3].filter((h) => h.trim()).length < 3 ||
                  [description1, description2].filter((d) => d.trim()).length < 2 ||
                  creatingAd
                }
                onClick={createAd}
              >
                <PlusOutlined /> {creatingAd ? "Creating…" : "Create Ad (PAUSED)"}
              </button>
              {ads.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {ads.map((a) => (
                        <tr key={a._id}>
                          <td>{a.name}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                          <td>
                            {a.status === "PAUSED" && a.googleAdResourceName && (
                              <button type="button" className="hub-btn hub-btn-primary" disabled={busyId === a._id} onClick={() => publish("ads", a._id)}>
                                <RocketOutlined /> {busyId === a._id ? "Publishing…" : "Publish Campaign"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// New, additive UI — Campaign Group -> Campaign -> Creative, each created
// PAUSED/DRAFT on LinkedIn and only flipped ACTIVE by an explicit Publish
// click. LinkedIn has no separate "Ad" object — a LinkedInCreative absorbs
// both FacebookAdCreative's and FacebookAd's roles (see
// linkedinController/creatives.js), so this is a 3-step flow, not 4 like
// CampaignSetup above. Mirrors CampaignSetup's structure exactly.
function LinkedInCampaignSetup({ connection }) {
  const [campaignGroups, setCampaignGroups] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [groupTotalBudget, setGroupTotalBudget] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);

  const [campaignGroupIdSel, setCampaignGroupIdSel] = useState("");
  const [newCampaignName, setNewCampaignName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [locations, setLocations] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  const [creativeCampaignId, setCreativeCampaignId] = useState("");
  const [newCreativeName, setNewCreativeName] = useState("");
  const [commentary, setCommentary] = useState("");
  const [headlineC, setHeadlineC] = useState("");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [cta, setCta] = useState("Submit");
  const [leadGenFormId, setLeadGenFormId] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [creatingCreative, setCreatingCreative] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [g, c, cr] = await Promise.all([
      request.get({ entity: "linkedin/campaign-groups" }),
      request.get({ entity: "linkedin/campaigns" }),
      request.get({ entity: "linkedin/creatives" }),
    ]);
    setCampaignGroups(g?.success ? g.result : []);
    setCampaigns(c?.success ? c.result : []);
    setCreatives(cr?.success ? cr.result : []);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const ready = connection?.connected && connection?.organization && connection?.adAccount;

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "linkedin/campaign-groups",
      jsonData: {
        name: newGroupName.trim(),
        totalBudget: groupTotalBudget ? Number(groupTotalBudget) : undefined,
      },
    });
    setCreatingGroup(false);
    if (res?.success) {
      setNewGroupName("");
      setGroupTotalBudget("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the campaign group.");
    }
  };

  const createCampaign = async () => {
    if (!newCampaignName.trim() || !campaignGroupIdSel || !dailyBudget) return;
    setCreatingCampaign(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "linkedin/campaigns",
      jsonData: {
        name: newCampaignName.trim(),
        campaignGroupId: campaignGroupIdSel,
        dailyBudget: Number(dailyBudget),
        locations: locations.split(",").map((l) => l.trim()).filter(Boolean),
      },
    });
    setCreatingCampaign(false);
    if (res?.success) {
      setNewCampaignName("");
      setDailyBudget("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the campaign.");
    }
  };

  const createCreative = async () => {
    if (!newCreativeName.trim() || !creativeCampaignId || !leadGenFormId.trim() || !mediaFile) return;
    setCreatingCreative(true);
    setErrorMsg("");

    const formData = new FormData();
    formData.append("file", mediaFile);
    formData.append("name", newCreativeName.trim());
    formData.append("campaignId", creativeCampaignId);
    formData.append("commentary", commentary);
    formData.append("headline", headlineC);
    formData.append("landingPageUrl", landingPageUrl);
    formData.append("callToAction", cta || "Submit");
    formData.append("leadGenFormId", leadGenFormId.trim());

    const res = await createLinkedinCreative(formData);
    setCreatingCreative(false);
    if (res?.success) {
      setNewCreativeName("");
      setCommentary("");
      setHeadlineC("");
      setLandingPageUrl("");
      setLeadGenFormId("");
      setMediaFile(null);
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the creative.");
    }
  };

  const publish = async (kind, id) => {
    setBusyId(id);
    setErrorMsg("");
    const res = await request.post({ entity: `linkedin/${kind}/${id}/publish`, jsonData: {} });
    setBusyId(null);
    if (res?.success) {
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not publish.");
    }
  };

  const STATUS_BADGE = {
    DRAFT: "hub-badge-gray",
    PAUSED: "hub-badge-gray",
    ACTIVE: "hub-badge-green",
    ARCHIVED: "hub-badge-red",
    COMPLETED: "hub-badge-blue",
    CANCELED: "hub-badge-red",
  };

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><RocketOutlined /> LinkedIn Ads Campaign Setup</h3>
          {errorMsg && <span className="hub-badge hub-badge-red">{errorMsg}</span>}
        </div>

        {!ready && (
          <div className="hub-empty">
            Connect LinkedIn and select an Organization and Ad Account above before creating campaigns.
          </div>
        )}

        {ready && (
          <div className="hub-stack" style={{ gap: 20 }}>
            {/* CAMPAIGN GROUP */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>1. Campaign Group</div>
              <div className="hub-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  className="hub-input"
                  style={{ flex: "1 1 220px" }}
                  placeholder="Campaign Group name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
                <input
                  className="hub-input"
                  style={{ flex: "1 1 220px" }}
                  placeholder="Total budget (major currency units, optional)"
                  value={groupTotalBudget}
                  onChange={(e) => setGroupTotalBudget(e.target.value.replace(/\D/g, ""))}
                />
                <button
                  type="button"
                  className="hub-btn hub-btn-primary"
                  disabled={!newGroupName.trim() || creatingGroup}
                  onClick={createGroup}
                >
                  <PlusOutlined /> {creatingGroup ? "Creating…" : "Create Campaign Group (PAUSED)"}
                </button>
              </div>
              {campaignGroups.length > 0 && (
                <div className="hub-table-wrapper">
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Total Budget</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {campaignGroups.map((g) => (
                        <tr key={g._id}>
                          <td>{g.name}</td>
                          <td>{g.totalBudget || "—"}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[g.status]}`}>{g.status}</span></td>
                          <td>
                            {g.status === "PAUSED" && g.linkedinCampaignGroupId && (
                              <button type="button" className="hub-btn" disabled={busyId === g._id} onClick={() => publish("campaign-groups", g._id)}>
                                <RocketOutlined /> {busyId === g._id ? "Publishing…" : "Publish"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* CAMPAIGN */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>2. Campaign</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign Group</label>
                  <select className="hub-select" value={campaignGroupIdSel} onChange={(e) => setCampaignGroupIdSel(e.target.value)}>
                    <option value="">Select a campaign group…</option>
                    {campaignGroups.filter((g) => g.linkedinCampaignGroupId).map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Campaign Name</label>
                  <input className="hub-input" value={newCampaignName} onChange={(e) => setNewCampaignName(e.target.value)} placeholder="e.g. Career Coaching — Decision Makers" />
                </div>
                <div className="hub-form-row">
                  <label>Daily Budget (major currency units)</label>
                  <input className="hub-input" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 500" />
                </div>
                <div className="hub-form-row">
                  <label>Locations (comma-separated LinkedIn geo URNs, optional)</label>
                  <input className="hub-input" value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="urn:li:geo:103644278" />
                </div>
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newCampaignName.trim() || !campaignGroupIdSel || !dailyBudget || creatingCampaign}
                onClick={createCampaign}
              >
                <PlusOutlined /> {creatingCampaign ? "Creating…" : "Create Campaign (PAUSED)"}
              </button>
              {campaigns.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Daily Budget</th><th>Status</th></tr></thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr key={c._id}>
                          <td>{c.name}</td>
                          <td>{c.dailyBudget || "—"}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* CREATIVE */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>3. Creative — Review &amp; Publish</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={creativeCampaignId} onChange={(e) => setCreativeCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.linkedinCampaignId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Creative Name</label>
                  <input className="hub-input" value={newCreativeName} onChange={(e) => setNewCreativeName(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Headline</label>
                  <input className="hub-input" value={headlineC} onChange={(e) => setHeadlineC(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Call To Action</label>
                  <input className="hub-input" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Submit" />
                </div>
                <div className="hub-form-row">
                  <label>Landing Page URL</label>
                  <input className="hub-input" value={landingPageUrl} onChange={(e) => setLandingPageUrl(e.target.value)} placeholder="https://example.com/landing" />
                </div>
                <div className="hub-form-row">
                  <label>Lead Gen Form ID</label>
                  <input className="hub-input" value={leadGenFormId} onChange={(e) => setLeadGenFormId(e.target.value)} placeholder="Numeric ID from your LinkedIn Lead Gen Form" />
                </div>
              </div>
              <div className="hub-form-row">
                <label>Commentary (primary text)</label>
                <textarea className="hub-input" rows={2} value={commentary} onChange={(e) => setCommentary(e.target.value)} />
              </div>
              <div className="hub-form-row">
                <label>Image</label>
                <input type="file" accept="image/*" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} />
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newCreativeName.trim() || !creativeCampaignId || !leadGenFormId.trim() || !mediaFile || creatingCreative}
                onClick={createCreative}
              >
                <PlusOutlined /> {creatingCreative ? "Uploading…" : "Create Creative (PAUSED)"}
              </button>
              {creatives.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {creatives.map((c) => (
                        <tr key={c._id}>
                          <td>{c.name}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                          <td>
                            {(c.status === "PAUSED" || c.status === "DRAFT") && c.linkedinCreativeId && (
                              <button type="button" className="hub-btn hub-btn-primary" disabled={busyId === c._id} onClick={() => publish("creatives", c._id)}>
                                <RocketOutlined /> {busyId === c._id ? "Publishing…" : "Publish Creative"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Dedicated Callbacks / task view — every lead in the "Call Back" stage
// with a scheduled time, split into Overdue / Today / Upcoming. Overdue
// rows are highlighted. Click a row to open the lead and reschedule /
// advance its stage.
function CallbacksBoard() {
  const { teamNames } = useTeams();
  const [data, setData] = useState({ overdue: [], today: [], upcoming: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [admins, setAdmins] = useState([]);
  const [editLead, setEditLead] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(false);
    const res = await request.get({ entity: "lead/callbacks?days=45" });
    if (res?.success) setData(res.result);
    else setError(true);
    setLoading(false);
  };

  useEffect(() => {
    load();
    request.list({ entity: "admin", options: { items: 500 } }).then((r) => setAdmins(r?.success ? r.result : []));
  }, []);

  const saveLeadEdit = async (leadId, updates) => {
    const res = await request.update({ entity: "lead", id: leadId, jsonData: updates });
    if (res?.success) {
      setEditLead(null);
      load();
    }
  };

  const Group = ({ title, leads, tone }) => (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3>
          {title}{" "}
          <span className={`hub-badge ${tone === "red" ? "hub-badge-red" : tone === "amber" ? "hub-badge-yellow" : "hub-badge-blue"}`}>
            {leads.length}
          </span>
        </h3>
      </div>
      {leads.length === 0 ? (
        <div className="hub-empty">Nothing here.</div>
      ) : (
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Phone</th>
                <th>Callback At</th>
                <th>Assigned</th>
                <th>Team</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l._id} style={tone === "red" ? { background: "#fef2f2" } : undefined}>
                  <td>
                    <div className="hub-person" style={{ cursor: "pointer" }} onClick={() => setEditLead(l)}>
                      <div className="hub-avatar" style={{ background: l.color || "#8c8c8c" }}>
                        {l.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      {l.name}
                    </div>
                  </td>
                  <td>{l.phone || "—"}</td>
                  <td style={tone === "red" ? { color: "#dc2626", fontWeight: 700 } : undefined}>
                    {l.callBackAt ? new Date(l.callBackAt).toLocaleString() : "—"}
                  </td>
                  <td>{l.assignedUserName || (l.assignedUser && l.assignedUser.name) || "—"}</td>
                  <td>{l.team || "Unassigned"}</td>
                  <td>
                    <button type="button" className="hub-btn" style={{ padding: "5px 12px" }} onClick={() => setEditLead(l)}>
                      <EditOutlined /> Open
                    </button>
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
          <h3><InboxOutlined /> Callbacks</h3>
          <button type="button" className="hub-btn" onClick={load}>Refresh</button>
        </div>
        <div style={{ fontSize: 12.5, color: "#8c8c8c" }}>
          Leads in the “Call Back” stage. Overdue callbacks are highlighted so nothing slips.
        </div>
      </div>

      {loading && <div className="hub-card"><div className="hub-empty">Loading callbacks…</div></div>}
      {error && !loading && (
        <div className="hub-card">
          <div className="hub-empty">
            Couldn&rsquo;t load callbacks.
            <button type="button" className="hub-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          <Group title="Overdue" leads={data.overdue} tone="red" />
          <Group title="Today" leads={data.today} tone="amber" />
          <Group title="Upcoming" leads={data.upcoming} tone="blue" />
        </>
      )}

      <EditLeadModal
        lead={editLead}
        onClose={() => setEditLead(null)}
        teamNames={teamNames}
        admins={admins}
        onSave={async (updates) => {
          await saveLeadEdit(editLead._id, updates);
        }}
      />
    </div>
  );
}

export default function Leads() {
  const [tab, setTab] = useState("all");

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Lead Management</h2>
          <p>Track lead stages &amp; sub-statuses, work callbacks, import/export and manage the capture form</p>
        </div>
      </div>

      <HubTabs
        tabs={[
          { key: "all", label: "Lead Stages" },
          { key: "callbacks", label: "Callbacks" },
          { key: "io", label: "Import / Export" },
          { key: "form", label: "Capture Form" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "all" && <AllLeads />}
      {tab === "callbacks" && <CallbacksBoard />}
      {tab === "io" && <ImportExport />}
      {tab === "form" && <CaptureForm />}
    </div>
  );
}