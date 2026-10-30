import React, { useState, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import axios from "axios";
import { Tooltip, Collapse, ConfigProvider, message, Select } from "antd";
import HubTabs from "@/components/HubTabs";
import HubModal from "@/components/HubModal";
import TeamActivity from "./TeamActivity";
import LeadOwnerModal from "./LeadOwnerModal";
import LeadFullDetailModal from "@/components/LeadFullDetail";
import { request } from "@/request";
import { API_BASE_URL, BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { FULL_ACCESS_ROLES } from "@/config/permissionModules";
import { DEPARTMENT_ROLES } from "@/config/roles";
import dayjs from "dayjs";
import { DEMO_TIME_LABEL, disabledDemoDate, toDemoSlot } from "@/utils/demoDay";
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
  UserSwitchOutlined,
  EditOutlined,
  ImportOutlined,
  ExportOutlined,
  DownloadOutlined,
  TeamOutlined,
  UserOutlined,
  InboxOutlined,
  PhoneOutlined,
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

// Import/Export and Capture Form are management tooling (bulk-import,
// bulk-assign, ad-platform integrations) — mirrors backend/services/access/
// salesScope.js's FULL_ACCESS_ROLES (Team Manager added on top of the
// shared FULL_ACCESS_ROLES constant, same as Support's own tier).
const LEAD_ADMIN_TAB_ROLES = [...FULL_ACCESS_ROLES, "Team Manager"];
// Lead Stages bucket for leads a user called but never responded on
// (backend leadController/scope.js NOT_ENTERED).
const NOT_ENTERED = "Response Not Entered";
// Team Activity — mirrors backend FULL_ACCESS_ROLES (callingController/
// teamActivity.js), which also lets Sales Manager in.
const TEAM_ACTIVITY_ROLES = [...FULL_ACCESS_ROLES, "Sales Manager", "Team Manager"];


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
// Leads, called leads …) — the full picture in one modal: every field users
// filled in, every call with who talked and for how long, responses, stage
// history (components/LeadFullDetail).
export function LeadDetailModal({ lead, onClose }) {
  return <LeadFullDetailModal lead={lead} onClose={onClose} />;
}


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

// Where a hand-entered lead came from. Imports, ad-platform pollers and the
// website capture form set their own source — this list is for the manual
// "Add Lead" form only.
const MANUAL_LEAD_SOURCES = [
  "Manual",
  "Calling",
  "Website",
  "Facebook Ads",
  "Instagram",
  "Google Ads",
  "LinkedIn",
  "Referral",
  "Walk-in",
  "WhatsApp",
  "Other",
];

// onAdd(lead) resolves to { ok } — the modal stays open (form intact) on a
// validation error or a duplicate, and resets only after a real save.
function AddLeadModal({ open, onClose, onAdd, teamNames, admins }) {
  const blank = () => ({
    name: "",
    phone: "",
    email: "",
    source: "Manual",
    team: "",
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
  const [saving, setSaving] = useState(false);

  // Fresh form every time the modal opens.
  useEffect(() => {
    if (open) {
      setForm(blank());
      setErr("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    if (saving) return;
    if (!form.name.trim()) return setErr("Client name is required.");
    if (String(form.phone || "").replace(/\D/g, "").length < 10) return setErr("Enter a valid phone number (at least 10 digits).");
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setErr("Enter a valid email address.");
    const pErr = pipelineFormError(form);
    if (pErr) return setErr(pErr);

    setErr("");
    setSaving(true);
    const r = await onAdd({
      ...form,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    });
    setSaving(false);
    if (r?.ok) onClose();
    else if (r?.message) setErr(r.message);
  };

  const unassignedToPool = !form.assignedUser && form.stage === "New Lead";

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
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Adding…" : "Add Lead"}
          </button>
        </>
      }
    >
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Client Name <span style={{ color: "#ef4444" }}>*</span></label>
          <input className="hub-input" value={form.name} onChange={set("name")} placeholder="e.g. Rohan Malhotra" autoFocus />
        </div>
        <div className="hub-form-row">
          <label>Phone <span style={{ color: "#ef4444" }}>*</span></label>
          <input className="hub-input" type="tel" value={form.phone} onChange={set("phone")} placeholder="+91 90000 00000" />
        </div>
      </div>

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Email</label>
          <input className="hub-input" type="email" value={form.email} onChange={set("email")} placeholder="name@example.com" />
        </div>
        <div className="hub-form-row">
          <label>Source</label>
          <select className="hub-select" value={form.source} onChange={set("source")}>
            {MANUAL_LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="hub-form-row">
        <label>Team</label>
        <select className="hub-select" value={form.team} onChange={set("team")} disabled={teamNames.length === 0}>
          <option value="">{teamNames.length === 0 ? "No teams created yet" : "No team"}</option>
          {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <PipelineFields form={form} setForm={setForm} admins={admins} />

      {unassignedToPool && (
        <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: -4 }}>
          Left unassigned, a New Lead is picked up by the Instant Lead Pool and dialed automatically.
        </div>
      )}

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
  if (cfg.requiresCallBack && !form.callBackAt) return `Callback date & time are mandatory for “${form.stage}”.`;
  if (cfg.meetingSubStatuses && cfg.meetingSubStatuses.includes(form.subStatus) && !form.meetingAt)
    return `Meeting date & time are required for “${form.subStatus}”.`;
  return "";
}

// One reusable block: Stage + dependent Sub-Status + whatever extra
// date/link fields the chosen stage needs + assigned user, follow-up and
// remarks. Reads/writes `form` via `setForm`.
function PipelineFields({ form, setForm, admins = [], showChangeReason = false }) {
  // Assigned To lists only active Sales-department users — plus whoever the
  // lead is already assigned to, so editing an older lead never silently
  // drops a non-Sales owner from the picker.
  const assignableAdmins = admins.filter(
    (a) => (a.enabled !== false && DEPARTMENT_ROLES.Sales.includes(a.role)) || String(a._id) === String(form.assignedUser || "")
  );
  const cfg = stageConfig(form.stage) || {};
  const subs = subStatusesFor(form.stage);
  const patch = (p) => setForm((f) => ({ ...f, ...p }));

  const onStage = (e) => {
    const stage = e.target.value;
    const newCfg = stageConfig(stage) || {};
    patch({
      stage,
      subStatus: defaultSubStatus(stage),
      // drop stage-specific captures that no longer apply — flag-driven off
      // the NEW stage's config, not a hardcoded stage name (see
      // config/leadStages.js's requiresCallBack/meetingSubStatuses/capture/
      // linkSubStatuses).
      callBackAt: newCfg.requiresCallBack ? form.callBackAt : null,
      meetingAt: newCfg.meetingSubStatuses ? form.meetingAt : null,
      futureFollowUpAt: newCfg.capture === "futureFollowUp" ? form.futureFollowUpAt : null,
      enrolledAt: newCfg.capture === "enrolledAt" ? form.enrolledAt : null,
      registrationLink: newCfg.linkSubStatuses ? form.registrationLink : "",
    });
  };

  const needMeeting = cfg.meetingSubStatuses && cfg.meetingSubStatuses.includes(form.subStatus);
  const needLink = cfg.linkSubStatuses && cfg.linkSubStatuses.includes(form.subStatus);

  return (
    <>
      {/* Equal columns + minWidth 0 so a long sub-status (e.g. "Assigned to
          BDE After Connecting with Candidate (By Auto Dialer)") truncates
          inside its box instead of pushing out past the modal edge. */}
      <div className="hub-grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="hub-form-row" style={{ minWidth: 0 }}>
          <label>Lead Stage</label>
          <select className="hub-select" style={{ width: "100%" }} value={form.stage} onChange={onStage}>
            {STAGE_NAMES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="hub-form-row" style={{ minWidth: 0 }}>
          <label>Sub-Status</label>
          <select
            className="hub-select"
            style={{ width: "100%", minWidth: 0, textOverflow: "ellipsis" }}
            title={form.subStatus}
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
        <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: -4, marginBottom: 6 }}>
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

      {cfg.meetingSubStatuses && (
        <div className="hub-form-row">
          <label>
            Live Demo Day · {DEMO_TIME_LABEL} {needMeeting && <span style={{ color: "#ef4444" }}>*</span>}
          </label>
          {/* Demo runs Mon–Sat 6–7 PM: pick the day, the time is fixed. A
              Sunday or an already-finished day is pushed to the next demo
              day by the server (services/sales/demoBookings.js). */}
          <input
            type="date"
            className="hub-input"
            min={dayjs(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)).format("YYYY-MM-DD")}
            value={form.meetingAt ? dayjs(new Date(new Date(form.meetingAt).getTime() + 330 * 60000).toISOString().slice(0, 10)).format("YYYY-MM-DD") : ""}
            onChange={(e) => {
              const v = e.target.value ? dayjs(e.target.value) : null;
              const d = v && disabledDemoDate(v) && v.day() === 0 ? v.add(1, "day") : v;
              patch({ meetingAt: d ? toDemoSlot(d).toISOString() : null });
            }}
          />
          {needMeeting && (
            <div style={{ fontSize: 12, color: "var(--hub-muted)", marginTop: 4 }}>
              Mon–Sat only (Sunday moves to Monday). The join link is emailed to the customer, you and your Team Leader.
            </div>
          )}
        </div>
      )}

      {cfg.capture === "futureFollowUp" && (
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

      {cfg.capture === "enrolledAt" && (
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
            {assignableAdmins.map((a) => (
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
          <label>Email</label>
          <input className="hub-input" value={form.email || ""} onChange={set("email")} placeholder="name@example.com" />
        </div>
        <div className="hub-form-row">
          <label>Team</label>
          <select className="hub-select" value={form.team || ""} onChange={set("team")} disabled={teamNames.length === 0 && !form.team}>
            <option value="">{teamNames.length === 0 ? "No teams created yet" : "No team"}</option>
            {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
            {form.team && !teamNames.includes(form.team) && <option value={form.team}>{form.team}</option>}
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
          <div style={{ fontSize: 11, color: "var(--hub-muted)", textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700, marginBottom: 6 }}>
            Stage Change History
          </div>
          <div style={{ display: "grid", gap: 6, maxHeight: 160, overflowY: "auto" }}>
            {[...lead.stageHistory].reverse().map((h, i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--hub-text-soft)", display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: stageColor(h.toStage), flexShrink: 0, marginTop: 5 }} />
                <span style={{ flex: 1 }}>
                  <strong>{h.fromStage ? `${h.fromStage} → ` : ""}{h.toStage}</strong>
                  {h.toSubStatus ? ` · ${h.toSubStatus}` : ""}
                  {h.remarks ? <span style={{ color: "#64748b" }}> — {h.remarks}</span> : ""}
                  <span style={{ color: "var(--hub-muted)" }}>
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
              style={{ resize: "vertical", fontFamily: "inherit", background: "var(--hub-bg-soft)" }}
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
            <div className="hub-avatar" style={{ background: stageConfig(duplicate.stage)?.color || "#2563EB" }}>
              {String(duplicate.name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{duplicate.name}</div>
              <div style={{ fontSize: 12, color: "var(--hub-muted)" }}>
                {duplicate.phone}{duplicate.email ? ` · ${duplicate.email}` : ""}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--hub-muted)", display: "grid", gap: 4 }}>
            <div>
              Stage:{" "}
              <span className={`hub-badge ${STATUS_META[duplicate.stage] || "hub-badge-gray"}`} style={{ marginLeft: 2 }}>
                {duplicate.stage}
              </span>
              {duplicate.subStatus ? ` · ${duplicate.subStatus}` : ""}
            </div>
            <div>
              Assigned to: <strong style={{ color: "var(--hub-text)" }}>{duplicate.assignedUserName || "Unassigned"}</strong>
              {duplicate.team ? <> · Team: <strong style={{ color: "var(--hub-text)" }}>{duplicate.team}</strong></> : null}
            </div>
            <div>
              Source: <strong style={{ color: "var(--hub-text)" }}>{duplicate.source || "—"}</strong>
              {duplicate.created ? ` · added ${new Date(duplicate.created).toLocaleDateString("en-IN")}` : ""}
            </div>
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
// "Lead Quality" card under the donut — of the leads a user actually spoke
// to, how many turned Interested / Callback / Demo Booking / Enrolled; the
// hover card breaks it down with talk time. Data: lead/stage-stats?part=quality.
const QUALITY_ROWS = [
  ["Interested Leads", "Interested", "#f97316"],
  ["Callback", "Callback", "#ec4899"],
  ["Demo Booking", "Demo booked", "#6366f1"],
  ["Enrolled", "Enrolled", "#16a34a"],
];
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const pctOf = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function QualityBar({ value, color }) {
  return (
    <div style={{ height: 6, borderRadius: 99, background: "var(--hub-bg-soft, #f1f5f9)", overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, value)}%`, height: "100%", borderRadius: 99, background: color }} />
    </div>
  );
}

function LeadQualityBreakdown({ q }) {
  const row = { display: "grid", gridTemplateColumns: "1fr auto", alignItems: "baseline", gap: 10 };
  return (
    <div style={{ width: 300, padding: 4, color: "var(--hub-text)" }}>
      <div style={{ fontSize: 13.5, fontWeight: 800 }}>How the leads are doing</div>
      <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginBottom: 12 }}>Leads on this board, and the ones a user spoke to</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "var(--hub-bg-soft, #f1f5f9)", borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--hub-muted)" }}>Spoke to</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{q.contacted.toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>of {q.total.toLocaleString("en-IN")} leads · {q.contactedPct}%</div>
        </div>
        <div style={{ background: "var(--hub-bg-soft, #f1f5f9)", borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--hub-muted)" }}>Talk time</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{fmtMins(q.talkMinutes)}</div>
          <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>
            {q.contacted ? `~${(q.talkMinutes / q.contacted).toFixed(1)} min a lead` : "—"} · {q.talkCalls} calls
          </div>
        </div>
      </div>

      <div style={{ ...row, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--hub-muted)", marginBottom: 6 }}>
        <span>Of the leads spoken to</span>
        <span>Leads · ratio</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {QUALITY_ROWS.map(([stage, label, color]) => {
          const n = q.byStage[stage] || 0;
          const p = pctOf(n, q.contacted);
          return (
            <div key={stage}>
              <div style={{ ...row, fontSize: 12.5, marginBottom: 4 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 600 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
                  {label}
                </span>
                <span>
                  <b>{n.toLocaleString("en-IN")}</b> <span style={{ color: "var(--hub-muted)" }}>· {p}%</span>
                </span>
              </div>
              <QualityBar value={p} color={color} />
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--hub-border)", ...row, fontSize: 12.5 }}>
        <span style={{ fontWeight: 700 }}>Positive in total</span>
        <span>
          <b style={{ color: "var(--hub-purple)" }}>{q.positive.toLocaleString("en-IN")}</b>{" "}
          <span style={{ color: "var(--hub-muted)" }}>· {q.qualityPct}% of spoken</span>
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--hub-muted)", marginTop: 6 }}>
        Spoke to = an answered call a user took. Positive = Interested + Callback + Demo booked + Enrolled.
      </div>
    </div>
  );
}

function LeadQualityCard({ quality }) {
  const card = (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, background: "var(--hub-purple-soft)", borderRadius: 14,
        padding: "12px 14px", cursor: quality ? "help" : "default",
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--hub-surface)", display: "grid", placeItems: "center", color: "var(--hub-purple)", flexShrink: 0 }}>
        <RiseOutlined />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: "var(--hub-muted)" }}>Lead Quality</div>
        {quality ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--hub-purple)", lineHeight: 1.2 }}>{quality.qualityPct}%</div>
            <div style={{ fontSize: 11, color: "var(--hub-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {quality.positive.toLocaleString("en-IN")} positive of {quality.contacted.toLocaleString("en-IN")} spoken · {fmtMins(quality.talkMinutes)} talk
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--hub-muted)", marginTop: 2 }}>Calculating…</div>
        )}
      </div>
      <RightOutlined style={{ color: "var(--hub-muted)", fontSize: 12 }} />
    </div>
  );
  if (!quality) return card;
  return (
    <Tooltip
      title={<LeadQualityBreakdown q={quality} />}
      placement="rightBottom"
      color="var(--hub-surface, #fff)"
      overlayStyle={{ maxWidth: 360 }}
      overlayInnerStyle={{ borderRadius: 14, padding: 14, width: 330, boxShadow: "0 18px 40px rgba(15,23,42,.18)", border: "1px solid var(--hub-border)" }}
      mouseEnterDelay={0.15}
    >
      {card}
    </Tooltip>
  );
}

function LeadStageBoard({ stages, total, loading, activeStage, activeSub, onSelect, userOptions, viewUser, onViewUser, quality }) {
  const [expanded, setExpanded] = useState({});
  const pct = (n) => (total ? (n / total) * 100 : 0);
  const nonZero = stages.filter((s) => s.count > 0);
  const top2 = [...stages].sort((a, b) => b.count - a.count).slice(0, 2);

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
              background: "var(--hub-blue-soft)", color: "var(--hub-blue)", fontSize: 19, flexShrink: 0,
            }}
          >
            <FilterOutlined />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--hub-text)" }}>Lead Stages</h3>
            <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginTop: 2 }}>
              Track your leads&rsquo; progress across every stage
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {userOptions && (
            <div
              className="lead-user-pill"
              style={{
                display: "flex", alignItems: "center", gap: 10, borderRadius: 12, padding: "6px 6px 6px 12px",
                background: viewUser ? "var(--hub-blue-soft)" : "var(--hub-bg-soft)",
                border: `1px solid ${viewUser ? "var(--hub-blue)" : "transparent"}`, transition: "all .15s",
              }}
            >
              <div
                style={{
                  width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0,
                  background: viewUser ? "var(--hub-blue)" : "var(--hub-card, #fff)", color: viewUser ? "#fff" : "var(--hub-blue)", fontSize: 14,
                }}
              >
                <UserOutlined />
              </div>
              <div style={{ lineHeight: 1.1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "var(--hub-muted)", textTransform: "uppercase", letterSpacing: 0.4, paddingLeft: 1 }}>Viewing</div>
                <Select
                  showSearch
                  allowClear
                  variant="borderless"
                  bordered={false}
                  value={viewUser || undefined}
                  onChange={(v) => onViewUser(v || "")}
                  placeholder="All users"
                  optionFilterProp="label"
                  options={userOptions}
                  popupMatchSelectWidth={240}
                  style={{ width: 180, height: 22 }}
                />
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--hub-bg-soft)", borderRadius: 12, padding: "8px 14px" }}>
            <TeamOutlined style={{ color: "var(--hub-blue)" }} />
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--hub-text)" }}>{total}</div>
              <div style={{ fontSize: 10, color: "var(--hub-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                {viewUser && userOptions ? `${(userOptions.find((o) => o.value === viewUser) || {}).label || "User"}'s leads` : "Total Leads"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="hub-empty">Loading lead stages…</div>
      ) : (
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "0 0 280px", maxWidth: 320, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ flex: 1, background: "var(--hub-bg-soft)", borderRadius: 18, padding: 16, display: "grid", placeItems: "center" }}>
              <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: "100%", maxWidth: 188 }}>
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" style={{ stroke: "var(--hub-border)" }} strokeWidth={STROKE} />
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
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R - STROKE / 2 - 2} style={{ fill: "var(--hub-surface)" }} />
                <text
                  x="50%"
                  y="46%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 40, fontWeight: 800, fill: "var(--hub-text)" }}
                >
                  {total}
                </text>
                <text
                  x="50%"
                  y="59%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: 13, fontWeight: 600, fill: "var(--hub-muted)" }}
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
                    background: activeStage === s.stage ? "var(--hub-blue-soft)" : "var(--hub-bg-soft)",
                    border: `1.5px solid ${activeStage === s.stage ? s.color : "transparent"}`,
                    borderRadius: 14,
                    padding: "12px 13px 24px",
                    cursor: s.count ? "pointer" : "default",
                    font: "inherit",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 21, fontWeight: 800, color: "var(--hub-text)" }}>{s.count}</span>
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
                      color: s.count ? s.color : "var(--hub-muted)",
                    }}
                  >
                    {Math.round(pct(s.count))}%
                  </span>
                </button>
              ))}
            </div>

            <LeadQualityCard quality={quality} />
          </div>

          <div style={{ flex: "1 1 340px", minWidth: "min(300px, 100%)" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: COLS,
                gap: 10,
                padding: "0 6px 8px",
                fontSize: 9.5,
                fontWeight: 700,
                color: "var(--hub-muted)",
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
                      background: on && !activeSub ? "var(--hub-blue-soft)" : "transparent",
                      cursor: "pointer",
                      font: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      {subs.length > 1 ? (
                        <span style={{ fontSize: 8, color: "var(--hub-muted)", width: 8, flexShrink: 0 }}>
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
                          color: s.count ? "#1e293b" : "var(--hub-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.stage}
                      </span>
                    </span>
                    <span style={{ height: 6, borderRadius: 999, background: "var(--hub-border)", overflow: "hidden" }}>
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
                    <span style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: s.count ? "#0f172a" : "var(--hub-muted)" }}>
                      {s.count}
                    </span>
                    <span style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: s.count ? s.color : "var(--hub-muted)" }}>
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
                            background: sOn ? "var(--hub-blue-soft)" : "transparent",
                            cursor: "pointer",
                            font: "inherit",
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10.5,
                              color: ss.count ? "#475569" : "var(--hub-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {ss.subStatus}
                          </span>
                          <span style={{ height: 4, borderRadius: 999, background: "var(--hub-border)", overflow: "hidden" }}>
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
                          <span style={{ textAlign: "right", fontSize: 10.5, fontWeight: 600, color: ss.count ? "#334155" : "var(--hub-muted)" }}>
                            {ss.count}
                          </span>
                          <span style={{ textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--hub-muted)" }}>
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
  const currentAdmin = useSelector(selectCurrentAdmin);
  const isFullAccess = LEAD_ADMIN_TAB_ROLES.includes(currentAdmin?.role);
  // Lead Owner (assign / bulk-assign) — same management set as the backend
  // (leadController/assignOwner.js FULL_ACCESS_ROLES, incl. Sales Manager).
  const canAssignOwner = TEAM_ACTIVITY_ROLES.includes(currentAdmin?.role);
  const [selectedIds, setSelectedIds] = useState([]);
  const [ownerModal, setOwnerModal] = useState(null); // null | { single?: lead }
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
    team: "",
    teamView: "",
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
  const [pageSize, setPageSize] = useState(20);
  // "Assigned User" picks among Sales users only (same set Lead Owner can give leads to).
  const salesAdmins = admins.filter((a) => a.enabled !== false && DEPARTMENT_ROLES.Sales.includes(a.role));

  // teamView toggles the SAME stage-board view between self/team scope — it
  // shouldn't, on its own, switch the page into the flat drilled-down list
  // (same reason "quick" is excluded here).
  const listActive =
    !!drillStage ||
    !!filters.quick ||
    Object.entries(filters).some(([k, v]) => k !== "quick" && k !== "teamView" && v);


  // Lead Stages "User" filter (management): one user's own board — the leads
  // they responded on or called — and the stage lists drilled from it.
  const [boardUser, setBoardUser] = useState("");
  const [stageQuality, setStageQuality] = useState(null);
  const qualityKeyRef = useRef("");

  const loadStageStats = async (teamViewOverride, userOverride) => {
    setStageLoading(true);
    setStageError(false);
    const teamView = teamViewOverride !== undefined ? teamViewOverride : filters.teamView;
    const user = userOverride !== undefined ? userOverride : boardUser;
    const p = new URLSearchParams();
    if (teamView) p.set("teamView", teamView);
    if (user && (!teamView || teamView === "responses")) p.set("user", user);
    const qs = p.toString() ? `?${p.toString()}` : "";
    // Lead Quality is slower (it scans calls) — fetched alongside, filled in when ready.
    setStageQuality(null);
    const qp = new URLSearchParams(p);
    qp.set("part", "quality");
    const reqKey = qp.toString();
    qualityKeyRef.current = reqKey;
    request.get({ entity: `lead/stage-stats?${reqKey}` }).then((r) => {
      if (qualityKeyRef.current === reqKey && r?.success) setStageQuality(r.result.quality || null);
    });
    const res = await request.get({ entity: `lead/stage-stats${qs}` });
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
    // A different stage/filter is a different set of leads — drop the ticks.
    // Plain page-to-page navigation (no overrides) keeps them.
    if (Object.keys(over).length) setSelectedIds([]);
    setDrill((d) => ({ ...d, loading: true }));

    const size = over.size || pageSize;
    const params = new URLSearchParams({ page: String(targetPage), items: String(size) });
    if (stage) params.set("stage", stage);
    if (sub) params.set("subStatus", sub);
    Object.entries(f).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    // A stage drilled from the board lists the same leads it counted — the
    // caller's own responses (Team Leader: + team's), see stageStats.js.
    if (stage && !f.teamView && !f.team && !f.assignedUser) params.set("teamView", "responses");
    const viewUser = over.boardUser !== undefined ? over.boardUser : boardUser;
    if (viewUser && params.get("teamView") === "responses") params.set("user", viewUser);

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
    setDrillStage(qf.stage || (qf.quick ? "Callback" : null));
    setDrillSub(null);
    loadLeadList(1, { stage: qf.stage || (qf.quick ? "Callback" : null), sub: null, filters: nextFilters });
  };

  const changeBoardUser = (userId) => {
    setBoardUser(userId);
    loadStageStats(undefined, userId);
    if (drillStage) loadLeadList(1, { boardUser: userId });
  };

  const updateFilter = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    loadLeadList(1, { filters: next });
    // teamView also affects the top-level stage cards (not just the
    // drilled-down list), which loadLeadList alone doesn't refresh.
    if ("teamView" in patch) loadStageStats(patch.teamView);
  };

  // The Lead List's current by-stage params — "All in this list" in Lead
  // Owner sends exactly these, so the backend assigns the rows shown here.
  const listViewFilter = () => {
    const out = {};
    if (drillStage) out.stage = drillStage;
    if (drillSub) out.subStatus = drillSub;
    Object.entries(filters).forEach(([k, v]) => {
      if (v) out[k] = v;
    });
    return out;
  };
  const pageIds = drill.leads.map((l) => l._id);
  const allPageTicked = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const toggleTick = (id) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const togglePageTicks = () =>
    setSelectedIds((ids) => (allPageTicked ? ids.filter((x) => !pageIds.includes(x)) : [...new Set([...ids, ...pageIds])]));

  // "All Leads" — drop every stage/filter and list the whole pipeline.
  const clearList = () => {
    setSelectedIds([]);
    setDrillStage(null);
    setDrillSub(null);
    setFilters(BLANK_FILTERS);
    loadLeadList(1, { stage: null, sub: null, filters: BLANK_FILTERS });
  };

  const changePageSize = (size) => {
    setPageSize(size);
    loadLeadList(1, { size });
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
    loadLeadList(1);
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
    await loadLeadList(drill.page);
  };

  // Duplicate detection is server-side now (POST /api/lead/create answers
  // 409 + `duplicate` when the phone already exists) — the old version
  // downloaded every lead to compare phones in the browser.
  const handleAddLead = async (lead) => {
    const res = await request.create({ entity: "lead", jsonData: lead });
    if (res?.success) {
      await refreshAfterMutation();
      return { ok: true };
    }
    if (res?.duplicate) {
      setPendingLead(lead);
      setDuplicateOf(res.duplicate);
      return { ok: false };
    }
    return { ok: false, message: res?.message || "Could not add the lead." };
  };

  const confirmAddAnyway = async () => {
    const res = await request.create({ entity: "lead", jsonData: { ...pendingLead, allowDuplicate: true } });
    setPendingLead(null);
    setDuplicateOf(null);
    if (res?.success) {
      setAddOpen(false);
      await refreshAfterMutation();
    }
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
          userOptions={isFullAccess ? salesAdmins.map((a) => ({ value: a._id, label: `${a.name || ""} ${a.surname || ""}`.trim() || a.email })) : null}
          viewUser={boardUser}
          onViewUser={changeBoardUser}
          quality={stageQuality}
        />
      )}

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Lead List</h3>
          <div className="hub-row" style={{ gap: 8 }}>
            {canAssignOwner && (
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                onClick={() => setOwnerModal({})}
                disabled={!drill.count}
                title="Give the ticked leads — or every lead in this list — to one or more Sales users"
              >
                <UserSwitchOutlined /> Lead Owner{selectedIds.length ? ` (${selectedIds.length})` : ""}
              </button>
            )}
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
                  border: `1px solid ${on ? c : "var(--hub-border)"}`,
                  background: on ? c : "var(--hub-surface)",
                  color: on ? "#fff" : "var(--hub-text-soft)",
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
              border: "1px solid var(--hub-border)",
              borderRadius: 12,
              padding: 14,
              background: "var(--hub-bg-soft)",
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
            {/* Company-wide narrowing — only actually has any effect for
                Owner/Super Admin/Admin/Sales Manager/Team Manager (see
                leadController/scope.js); everyone else is force-scoped
                server-side regardless of these, so the fields are hidden
                for them to avoid implying a control that does nothing. */}
            {isFullAccess && (
              <div className="hub-form-row">
                <label>Assigned User</label>
                <select
                  className="hub-select"
                  value={filters.assignedUser}
                  onChange={(e) => updateFilter({ assignedUser: e.target.value })}
                >
                  <option value="">Anyone</option>
                  <option value="none">Unassigned (no owner)</option>
                  {salesAdmins.map((a) => (
                    <option key={a._id} value={a._id}>
                      {`${a.name || ""} ${a.surname || ""}`.trim() || a.email}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {isFullAccess && (
              <div className="hub-form-row">
                <label>Team</label>
                <select
                  className="hub-select"
                  value={filters.team}
                  onChange={(e) => updateFilter({ team: e.target.value })}
                >
                  <option value="">Any team</option>
                  {teamNames.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Non-full-access users see every lead by default (see
                leadController/scope.js); this narrows to their team's or
                their own. Full-access users get the Team/Agent pickers. */}
            {!isFullAccess && (
              <div className="hub-form-row">
                <label>Showing</label>
                <select
                  className="hub-select"
                  value={filters.teamView}
                  onChange={(e) => updateFilter({ teamView: e.target.value })}
                >
                  <option value="">All leads</option>
                  <option value="1">My team</option>
                  <option value="mine">My leads only</option>
                </select>
              </div>
            )}
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

        <>
            <div style={{ fontSize: 12, color: "var(--hub-muted)", marginBottom: 8 }}>
              {drill.loading ? "Loading…" : `${drill.count} lead${drill.count === 1 ? "" : "s"}`}
              {drillStage ? ` · ${drillStage}` : ""}
              {drillSub ? ` · ${drillSub}` : ""}
              {canAssignOwner && selectedIds.length > 0 && (
                <>
                  {" · "}
                  <b style={{ color: "var(--hub-text)" }}>{selectedIds.length} selected</b>{" "}
                  <button type="button" className="hub-link-btn" style={{ fontSize: 12 }} onClick={() => setSelectedIds([])}>
                    clear
                  </button>
                </>
              )}
            </div>
            <div className="hub-table-wrapper">
              <table className="hub-table">
                <thead>
                  <tr>
                    {canAssignOwner && (
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          aria-label="Select every lead on this page"
                          checked={allPageTicked}
                          onChange={togglePageTicks}
                          disabled={!pageIds.length}
                        />
                      </th>
                    )}
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
                    <tr><td colSpan={canAssignOwner ? 8 : 7}><div className="hub-empty">Loading…</div></td></tr>
                  )}
                  {!drill.loading && drill.leads.length === 0 && (
                    <tr><td colSpan={canAssignOwner ? 8 : 7}><div className="hub-empty">No leads match these filters.</div></td></tr>
                  )}
                  {!drill.loading &&
                    drill.leads.map((l) => {
                      const overdue =
                        l.stage === "Callback" && l.callBackAt && new Date(l.callBackAt) < new Date();
                      return (
                        <tr key={l._id}>
                          {canAssignOwner && (
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${l.name}`}
                                checked={selectedIds.includes(l._id)}
                                onChange={() => toggleTick(l._id)}
                              />
                            </td>
                          )}
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
                            {drillStage === NOT_ENTERED ? (
                              // Called, but this user never recorded a response — the stage on
                              // the lead was set by someone else or by the import, so say so.
                              (() => {
                                const last = [...(l.stageHistory || [])].reverse().find((h) => h.changedByName);
                                return (
                                  <>
                                    <span className="hub-badge hub-badge-gray">Response not entered</span>
                                    <div style={{ fontSize: 11, color: "var(--hub-muted)", marginTop: 3, lineHeight: 1.35 }}>
                                      Now: {l.stage || stageForStatus(l.status)}
                                      {l.subStatus ? ` · ${l.subStatus}` : ""}
                                      <br />
                                      set by {last ? last.changedByName : "lead import"}
                                    </div>
                                  </>
                                );
                              })()
                            ) : (
                              <>
                                <span className={`hub-badge ${STATUS_META[l.stage || l.status]}`}>
                                  {l.stage || stageForStatus(l.status)}
                                </span>
                                <div style={{ fontSize: 11, color: "var(--hub-muted)", marginTop: 2 }}>{l.subStatus || "—"}</div>
                              </>
                            )}
                          </td>
                          <td>
                            {l.assignedUserName || (l.assignedUser && l.assignedUser.name) || "—"}
                            {(() => {
                              // Who last worked it — most leads have no owner, only responses.
                              const last = [...(l.stageHistory || [])].reverse().find((h) => h.changedByName);
                              return last ? (
                                <div style={{ fontSize: 11, color: "var(--hub-muted)", marginTop: 2 }}>
                                  last response: {last.changedByName}
                                </div>
                              ) : null;
                            })()}
                          </td>
                          <td>{l.nextFollowUpAt ? new Date(l.nextFollowUpAt).toLocaleDateString() : "—"}</td>
                          <td>
                            {l.callBackAt ? (
                              <span style={{ color: overdue ? "#dc2626" : "var(--hub-text-soft)", fontWeight: overdue ? 700 : 400 }}>
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
                            {canAssignOwner && (
                              <button
                                type="button"
                                className="hub-btn"
                                style={{ padding: "5px 12px", marginLeft: 6 }}
                                title="Change this lead's owner"
                                onClick={() =>
                                  setOwnerModal({
                                    single: {
                                      _id: l._id,
                                      name: l.name,
                                      assignedUserName: l.assignedUserName || (l.assignedUser && l.assignedUser.name) || "",
                                    },
                                  })
                                }
                              >
                                <UserSwitchOutlined /> Owner
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {drill.count > 0 && (
              <div className="hub-row" style={{ justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>
                  Page {drill.page} of {drill.pages || 1} · {drill.count} total
                </span>
                <div className="hub-row" style={{ gap: 8 }}>
                  <select
                    className="hub-select"
                    style={{ width: "auto" }}
                    value={pageSize}
                    onChange={(e) => changePageSize(Number(e.target.value))}
                    aria-label="Leads per page"
                  >
                    {[10, 20, 50, 100, 200].map((n) => (
                      <option key={n} value={n}>{n} / page</option>
                    ))}
                  </select>
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
                  background: "var(--hub-surface)",
                  border: "1px solid var(--hub-border)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  position: "relative",
                  overflow: "hidden",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                }}
              >
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: t.color || "var(--hub-blue)" }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--hub-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.team}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: "var(--hub-text)" }}>{t.leadCount}</div>
                <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
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
                      <span style={{ fontSize: 11.5, color: "var(--hub-muted)", display: "flex", alignItems: "center", gap: 4 }}>
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
                                      <div style={{ fontSize: 11, color: "var(--hub-muted)", marginTop: 2 }}>{l.subStatus}</div>
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
                          <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>
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

      {canAssignOwner && (
        <LeadOwnerModal
          open={!!ownerModal}
          onClose={() => setOwnerModal(null)}
          onDone={async () => {
            setSelectedIds([]);
            await refreshAfterMutation();
          }}
          admins={admins}
          selectedIds={selectedIds}
          single={ownerModal?.single || null}
          viewCount={drill.count}
          viewFilter={listViewFilter()}
          viewLabel={[
            drillStage,
            drillSub,
            filters.assignedUser === "none"
              ? "Unassigned"
              : (() => {
                  const u = admins.find((a) => a._id === filters.assignedUser);
                  return u ? `${u.name || ""} ${u.surname || ""}`.trim() : "";
                })(),
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      )}

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
  const { teamNames, teams } = useTeams();
  const [admins, setAdmins] = useState([]);
  useEffect(() => {
    request.list({ entity: "admin", options: { items: 500 } }).then((r) => setAdmins(r?.success ? r.result : []));
  }, []);
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

  // Direct assign: teams and individuals, both multi-select — round-robins
  // the selected leads across every checked team + every checked person
  // together, as an alternative to the team-only round-robin flow above.
  const [assignTeamsDirect, setAssignTeamsDirect] = useState([]);
  const [assignPersonIds, setAssignPersonIds] = useState([]);
  const toggleAssignTeamDirect = (t) =>
    setAssignTeamsDirect((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const toggleAssignPerson = (id) =>
    setAssignPersonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  // Admins/owner/Super Admin manage the CRM, they aren't a salesperson a
  // lead gets handed to — keep them out of the individual-assign list.
  const assignablePeople = admins.filter((a) => !["owner", "Super Admin", "Admin"].includes(a.role));

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

  // Same display-name formula used everywhere else in this file
  // (assignSelectedDirect's person branch, teamStats' t.admin row) — Team.
  // members[] stores this exact string, not an _id, so matching one back to
  // an admin has to rebuild it the same way.
  const displayName = (a) => `${a.name || ""} ${a.surname || ""}`.trim() || a.email;

  // Next member of `teamName`, round-robin, advancing `cursors` (a plain
  // { teamName: nextIndex } object mutated in place across one bulk-assign
  // call) — so "assign to a team" actually splits the leads equally across
  // that team's real members instead of just tagging every lead with the
  // team name and leaving them all unassigned-within-the-team.
  const nextTeamMember = (teamName, cursors) => {
    const team = teams.find((t) => t.name === teamName);
    const members = team?.members?.length ? team.members : [];
    if (members.length === 0) return null;
    const idx = (cursors[teamName] || 0) % members.length;
    cursors[teamName] = idx + 1;
    const memberName = members[idx];
    const admin = assignablePeople.find((a) => displayName(a) === memberName);
    return { assignedUser: admin?._id, assignedUserName: memberName };
  };

  // Round-robins the selected leads across the checked teams, AND across
  // each team's actual members, so a team's share is itself split evenly
  // across its people rather than left as one shared team-wide pool.
  const assignSelectedEqually = async () => {
    if (selectedLeadIds.length === 0 || assignTeams.length === 0) return;
    setAssigning(true);
    const cursors = {};
    await Promise.all(
      selectedLeadIds.map((id, i) => {
        const team = assignTeams[i % assignTeams.length];
        const member = nextTeamMember(team, cursors);
        return request.update({
          entity: "lead",
          id,
          jsonData: { team, ...(member || {}) },
          notify: false,
        });
      })
    );
    setAssigning(false);
    setAssignTeams([]);
    setSelectedLeadIds([]);
    message.success(`${selectedLeadIds.length} lead${selectedLeadIds.length === 1 ? "" : "s"} assigned equally.`);
    loadUnassigned(1);
  };

  // One-click version of the same round-robin: every unassigned lead across
  // every page, split across every team (and, within each team, across its
  // members) — no manual selection needed.
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
    const cursors = {};
    await Promise.all(
      ids.map((id, i) => {
        const team = teamNames[i % teamNames.length];
        const member = nextTeamMember(team, cursors);
        return request.update({
          entity: "lead",
          id,
          jsonData: { team, ...(member || {}) },
          notify: false,
        });
      })
    );
    setAssigning(false);
    setAssignTeams([]);
    setSelectedLeadIds([]);
    message.success(`${ids.length} lead${ids.length === 1 ? "" : "s"} distributed equally.`);
    loadUnassigned(1);
  };

  // Assign every selected lead to one single team (no round-robin).
  // Round-robins the selected leads across every checked team AND every
  // checked individual together — a team target splits equally across that
  // team's real members (same as assignSelectedEqually above); a person
  // target sets `assignedUser` directly plus their team (looked up from
  // Team.members, since "unassigned" here is defined purely by an empty
  // team field).
  const assignSelectedDirect = async () => {
    const targets = [
      ...assignTeamsDirect.map((t) => ({ type: "team", team: t })),
      ...assignPersonIds.map((id) => {
        const admin = assignablePeople.find((a) => a._id === id);
        const matchedTeam = admin ? teams.find((t) => (t.members || []).includes(admin.name)) : null;
        return { type: "person", admin, team: matchedTeam?.name };
      }),
    ];
    if (selectedLeadIds.length === 0 || targets.length === 0) return;

    setAssigning(true);
    let missingTeam = 0;
    const cursors = {};
    await Promise.all(
      selectedLeadIds.map((id, i) => {
        const t = targets[i % targets.length];
        if (t.type === "team") {
          const member = nextTeamMember(t.team, cursors);
          return request.update({
            entity: "lead",
            id,
            jsonData: { team: t.team, ...(member || {}) },
            notify: false,
          });
        }
        if (!t.team) missingTeam += 1;
        const assignedUserName = `${t.admin.name || ""} ${t.admin.surname || ""}`.trim() || t.admin.email;
        return request.update({
          entity: "lead",
          id,
          jsonData: { assignedUser: t.admin._id, assignedUserName, ...(t.team ? { team: t.team } : {}) },
          notify: false,
        });
      })
    );
    setAssigning(false);
    setAssignTeamsDirect([]);
    setAssignPersonIds([]);
    setSelectedLeadIds([]);
    message.success(`${selectedLeadIds.length} lead${selectedLeadIds.length === 1 ? "" : "s"} assigned.`);
    loadUnassigned(1);
    if (missingTeam > 0) {
      message.warning(`${missingTeam} lead${missingTeam === 1 ? "" : "s"} went to a person without a team — they'll keep showing here until that person is on a team.`);
    }
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
      setImportResult({ ok: true, message: res.message, duplicates: res.result?.duplicates || [] });
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
              background: dragging ? "var(--hub-blue-soft)" : "var(--hub-bg-soft)",
              transition: "all 0.2s ease",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--hub-muted)", marginBottom: 10 }}>
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
              <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--hub-text)" }}>
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
                  border: "1px solid var(--hub-border)",
                  borderRadius: 12,
                  padding: 14,
                  background: "var(--hub-bg-soft)",
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
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--hub-muted)" }}>
                      {allocatedTotal}/{splitTotal}
                    </span>
                  </div>
                )}

                <div style={{ marginTop: 10, fontSize: 12, color: "var(--hub-muted)" }}>
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
              {importResult.duplicates?.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "#b45309", fontWeight: 600 }}>
                    {importResult.duplicates.length} duplicate lead{importResult.duplicates.length === 1 ? "" : "s"} skipped — view
                  </summary>
                  <div className="hub-table-wrapper" style={{ marginTop: 6, maxHeight: 220, overflowY: "auto" }}>
                    <table className="hub-table">
                      <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Email</th><th>Reason</th></tr></thead>
                      <tbody>
                        {importResult.duplicates.map((d, i) => (
                          <tr key={i}>
                            <td>{d.row || "—"}</td>
                            <td>{d.name}</td>
                            <td>{d.phone || "—"}</td>
                            <td>{d.email || "—"}</td>
                            <td><span className="hub-badge hub-badge-yellow">{d.reason}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
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

          <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 16 }}>
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
                <th>Duplicates</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading && (
                <tr>
                  <td colSpan={6}>
                    <div className="hub-empty">Loading import history…</div>
                  </td>
                </tr>
              )}
              {!historyLoading && history.length === 0 && (
                <tr>
                  <td colSpan={6}>
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
                      {h.duplicateCount > 0 ? (
                        <span className="hub-badge hub-badge-yellow">{h.duplicateCount} skipped</span>
                      ) : (
                        "—"
                      )}
                    </td>
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
            <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>
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

        <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 14 }}>
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
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--hub-text)" }}>
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
              border: "1px solid var(--hub-border)",
              borderRadius: 12,
              padding: 14,
              background: selectedLeadIds.length > 0 ? "var(--hub-blue-soft)" : "var(--hub-bg-soft)",
              transition: "background 0.2s ease",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--hub-text)" }}>
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
                    background: assignTeams.includes(t) ? "var(--hub-blue-soft)" : "var(--hub-surface)",
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
              <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>
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

        <div
          style={{
            marginTop: 16,
            border: "1px solid var(--hub-border)",
            borderRadius: 12,
            padding: 14,
            background: selectedLeadIds.length > 0 ? "var(--hub-blue-soft)" : "var(--hub-bg-soft)",
            transition: "background 0.2s ease",
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--hub-text)", marginBottom: 10 }}>
            Or split {selectedLeadIds.length > 0 ? `${selectedLeadIds.length} selected lead${selectedLeadIds.length === 1 ? "" : "s"}` : "selected leads"} across any mix of teams and individuals
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--hub-muted)", marginBottom: 6 }}>Teams</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {teamNames.length === 0 && <span style={{ fontSize: 12.5, color: "var(--hub-muted)" }}>No teams yet</span>}
                {teamNames.map((t) => (
                  <label
                    key={t}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: `1px solid ${assignTeamsDirect.includes(t) ? "var(--hub-blue)" : "#e3e9f5"}`,
                      background: assignTeamsDirect.includes(t) ? "var(--hub-blue-soft)" : "var(--hub-surface)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={assignTeamsDirect.includes(t)}
                      onChange={() => toggleAssignTeamDirect(t)}
                      style={{ width: 14, height: 14, accentColor: "var(--hub-blue)", cursor: "pointer" }}
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--hub-muted)", marginBottom: 6 }}>Individuals</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {assignablePeople.length === 0 && <span style={{ fontSize: 12.5, color: "var(--hub-muted)" }}>No people yet</span>}
                {assignablePeople.map((a) => {
                  const label = `${a.name || ""} ${a.surname || ""}`.trim() || a.email;
                  return (
                    <label
                      key={a._id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        borderRadius: 999,
                        border: `1px solid ${assignPersonIds.includes(a._id) ? "var(--hub-blue)" : "#e3e9f5"}`,
                        background: assignPersonIds.includes(a._id) ? "var(--hub-blue-soft)" : "var(--hub-surface)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={assignPersonIds.includes(a._id)}
                        onChange={() => toggleAssignPerson(a._id)}
                        style={{ width: 14, height: 14, accentColor: "var(--hub-blue)", cursor: "pointer" }}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="hub-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>
              {selectedLeadIds.length > 0 && assignTeamsDirect.length + assignPersonIds.length > 0
                ? `${selectedLeadIds.length} lead${selectedLeadIds.length === 1 ? "" : "s"} will be split equally across ${assignTeamsDirect.length + assignPersonIds.length} target${assignTeamsDirect.length + assignPersonIds.length === 1 ? "" : "s"}.`
                : "Select leads above and check one or more teams/individuals."}
            </span>
            <button
              type="button"
              className="hub-btn hub-btn-primary"
              disabled={selectedLeadIds.length === 0 || assignTeamsDirect.length + assignPersonIds.length === 0 || assigning}
              onClick={assignSelectedDirect}
            >
              <SwapOutlined /> {assigning ? "Assigning…" : "Assign"}
            </button>
          </div>
        </div>

        {!unassignedLoading && unassigned.length > 0 && (
          <div className="hub-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
            <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>
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



// Every lead that's already been used (dialled at least once, by hand or by
// the Instant Lead Pool auto-dialer) — one flat list instead of adding up
// several rows of the Lead Stages funnel by hand. Kept deliberately simple:
// just who it was, what happened, who called them.
// Sales-department roles — who can appear in Used Leads' "called by" picker.
const SALES_CALLER_ROLES = DEPARTMENT_ROLES.Sales;

function UsedLeadsBoard() {
  // Management-only (see the tabs in Leads below). Filter by which sales
  // user made the call (all of them together, or one), and by how their
  // last call on the lead went — backend leadController/usedLeads.js.
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [callers, setCallers] = useState([]);
  const [caller, setCaller] = useState("");
  const [outcome, setOutcome] = useState("");
  // Chart + table filters are client-side over the loaded rows.
  const [stageFilter, setStageFilter] = useState("");
  const [respFilter, setRespFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [ownerFilter, setOwnerFilter] = useState(""); // "" | unassigned | assigned
  const [viewLead, setViewLead] = useState(null); // row clicked → full detail modal
  const [showAllResp, setShowAllResp] = useState(false);
  // Bulk "Move to stage" for leads no user has (backend usedLeads.moveToStage).
  const [picked, setPicked] = useState([]);
  const [moveStage, setMoveStage] = useState("");
  const [moveSub, setMoveSub] = useState("");
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    request.list({ entity: "admin", options: { items: 500 } }).then((res) => {
      const sales = (res?.success ? res.result : []).filter((a) => SALES_CALLER_ROLES.includes(a.role));
      setCallers(
        sales
          .map((a) => ({ id: a._id, name: [a.name, a.surname].filter(Boolean).join(" ") }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    });
  }, []);

  const load = async () => {
    setLoading(true);
    setError(false);
    const qs = new URLSearchParams({ ...(caller ? { caller } : {}), ...(outcome ? { outcome } : {}) }).toString();
    const res = await request.get({ entity: `lead/used${qs ? `?${qs}` : ""}` });
    if (res?.success) setLeads(res.result);
    else setError(true);
    setLoading(false);
  };

  useEffect(() => {
    load();
    setStageFilter("");
    setRespFilter("");
    setPage(1);
    setPicked([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caller, outcome]);
  useEffect(() => setPicked([]), [ownerFilter]);

  const NOT_IN_CRM = "Not in CRM";
  const stageOf = (l) => (l.stage ? (STAGE_NAMES.includes(l.stage) ? l.stage : "Other") : NOT_IN_CRM);

  // "Not with any user" = no owner, no sales user connected, and not already
  // sent back to a stage (those are in Lead Stages again).
  const parked = (l) => !l.owned && !l.released;
  // Owner filter is client-side, so it narrows the charts as well as the table.
  const base = leads.filter((l) => (ownerFilter === "unassigned" ? parked(l) : ownerFilter === "assigned" ? l.owned : true));
  const total = base.length;
  const connected = base.filter((l) => l.outcome === "connected").length;
  const notPicked = total - connected;
  const noOwnerCount = leads.filter(parked).length;
  const autoOnlyCount = base.filter((l) => l.noUser).length;
  const stageCounts = {};
  const respCounts = {};
  for (const l of base) {
    stageCounts[stageOf(l)] = (stageCounts[stageOf(l)] || 0) + 1;
    respCounts[l.response] = (respCounts[l.response] || 0) + 1;
  }
  const stageBars = [...STAGE_NAMES, "Other", NOT_IN_CRM]
    .filter((s) => stageCounts[s])
    .map((s) => ({ key: s, count: stageCounts[s], color: s === NOT_IN_CRM || s === "Other" ? "#94a3b8" : stageColor(s) }));
  // Responses coloured by what they mean, not one flat blue.
  const RESP_GROUPS = [
    { color: "#f59e0b", match: /not picked|ringing|not reachable|switch off|busy/i },
    { color: "#ef4444", match: /not interested|do not call|price|joined|wrong number|language|did not inquire|invalid/i },
    { color: "#10b981", match: /demo|prospect|qualified|callback|future|enrol/i },
  ];
  const respColor = (k) => (RESP_GROUPS.find((g) => g.match.test(k)) || { color: "#3b82f6" }).color;
  const respBars = Object.entries(respCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, count]) => ({ key: k, count, color: respColor(k) }));

  const shown = base.filter((l) => (!stageFilter || stageOf(l) === stageFilter) && (!respFilter || l.response === respFilter));
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const pageRows = shown.slice((page - 1) * pageSize, page * pageSize);

  const pick = (setter, current, value) => {
    setter(current === value ? "" : value);
    setPage(1);
  };

  // Selection only applies in "Not with any user", and only to real CRM leads.
  const selectable = ownerFilter === "unassigned";
  const movable = (l) => l.isLead && parked(l);
  const pageIds = pageRows.filter(movable).map((l) => String(l._id));
  const shownIds = shown.filter(movable).map((l) => String(l._id));
  const allPagePicked = pageIds.length > 0 && pageIds.every((id) => picked.includes(id));
  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const togglePage = () =>
    setPicked((p) => (allPagePicked ? p.filter((x) => !pageIds.includes(x)) : [...new Set([...p, ...pageIds])]));

  const moveSelected = async () => {
    if (!picked.length || !moveStage) return;
    if (!window.confirm(`Move ${picked.length} lead${picked.length === 1 ? "" : "s"} to ${moveStage}${moveSub ? ` · ${moveSub}` : ""}? They'll show in Lead Stages again.`)) return;
    setMoving(true);
    const res = await request.post({ entity: "lead/used/move", jsonData: { leadIds: picked, stage: moveStage, subStatus: moveSub || undefined } });
    setMoving(false);
    if (res?.success) {
      message.success(res.message);
      setPicked([]);
      setMoveStage("");
      setMoveSub("");
      load();
    } else {
      message.error(res?.message || "Could not move the leads.");
    }
  };
  const pctOf = (n) => {
    if (!total || !n) return "0%";
    const p = (n / total) * 100;
    return p < 1 ? "<1%" : `${Math.round(p)}%`;
  };

  // One horizontal-bar breakdown panel; each row toggles that value as a
  // table filter. Long lists show the top `limit` rows until expanded.
  const BarList = ({ title, subtitle, bars, active, onPick, limit, expanded, onToggle, legend }) => {
    const max = Math.max(1, ...bars.map((b) => b.count));
    const visible = limit && !expanded ? bars.slice(0, limit) : bars;
    return (
      <div style={{ flex: "1 1 340px", minWidth: 0, background: "var(--hub-surface)", border: "1px solid var(--hub-border)", borderRadius: 14, padding: "16px 14px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, padding: "0 6px", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--hub-text)" }}>{title}</div>
            <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 2 }}>{subtitle}</div>
          </div>
          {legend && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {legend.map((g) => (
                <span key={g.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--hub-muted)", fontWeight: 600 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: g.color }} />
                  {g.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {visible.map((b) => {
            const on = active === b.key;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => onPick(b.key)}
                title={on ? "Click again to clear" : `Show only ${b.key}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(120px, 1.2fr) 2fr 48px 38px",
                  alignItems: "center",
                  gap: 12,
                  padding: "7px 8px",
                  borderRadius: 9,
                  border: `1px solid ${on ? b.color : "transparent"}`,
                  cursor: "pointer",
                  textAlign: "left",
                  background: on ? "var(--hub-bg-soft)" : "transparent",
                  opacity: active && !on ? 0.5 : 1,
                  transition: "background 0.15s, opacity 0.15s",
                }}
                onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--hub-bg-soft)"; }}
                onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: "var(--hub-text)", minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: b.color, flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.key}>{b.key}</span>
                </span>
                <span style={{ height: 10, borderRadius: 999, background: "var(--hub-border)", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.max(2, (b.count / max) * 100)}%`, background: b.color, borderRadius: 999 }} />
                </span>
                <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "var(--hub-text)", fontVariantNumeric: "tabular-nums" }}>{b.count}</span>
                <span style={{ textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--hub-muted)", fontVariantNumeric: "tabular-nums" }}>{pctOf(b.count)}</span>
              </button>
            );
          })}
        </div>
        {limit && bars.length > limit && (
          <button type="button" className="hub-link-btn" style={{ fontSize: 12, margin: "8px 8px 2px" }} onClick={onToggle}>
            {expanded ? "Show less" : `Show all ${bars.length}`}
          </button>
        )}
      </div>
    );
  };

  // KPI tile — clicking one applies the matching filter (click again to clear).
  const Tile = ({ label, value, color, sub, icon, active, onClick, hint }) => (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      style={{
        flex: "1 1 170px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        background: "var(--hub-surface)",
        border: `1px solid ${active ? color : "var(--hub-border)"}`,
        boxShadow: active ? `0 0 0 3px ${color}22` : "none",
        borderRadius: 14,
        padding: "14px 16px",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      <span style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", background: `${color}1a`, color, fontSize: 18, flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "var(--hub-text)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
          {sub && <span style={{ fontSize: 11.5, fontWeight: 700, color }}>{sub}</span>}
        </span>
        <span style={{ display: "block", fontSize: 12, color: "var(--hub-muted)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </span>
    </button>
  );

  return (
    <div className="hub-stack">
      <LeadDetailModal lead={viewLead} onClose={() => setViewLead(null)} />
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><PhoneOutlined /> Used Leads {!loading && !error && <span className="hub-badge hub-badge-blue">{total}</span>}</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="hub-select" style={{ width: 200 }} value={caller} onChange={(e) => setCaller(e.target.value)}>
              <option value="">All sales users</option>
              <option value="none">No user (auto-dialer only)</option>
              {callers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="hub-select" style={{ width: 160 }} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">All responses</option>
              <option value="connected">Connected</option>
              <option value="notpicked">Not picked up</option>
            </select>
            <select
              className="hub-select"
              style={{ width: 200 }}
              value={ownerFilter}
              onChange={(e) => { setOwnerFilter(e.target.value); setStageFilter(""); setRespFilter(""); setPage(1); }}
            >
              <option value="">Any owner</option>
              <option value="unassigned">Not with any user</option>
              <option value="assigned">With a user (owner / connected)</option>
            </select>
            <button type="button" className="hub-btn" onClick={load}>Refresh</button>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--hub-muted)" }}>
          Every lead whose number has already been called, who called it, and the response recorded for it.
        </div>
      </div>

      {loading && <div className="hub-card"><div className="hub-empty">Loading used leads…</div></div>}
      {error && !loading && (
        <div className="hub-card">
          <div className="hub-empty">
            Couldn&rsquo;t load used leads.
            <button type="button" className="hub-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
          </div>
        </div>
      )}

      {!loading && !error && leads.length > 0 && (
        <div className="hub-card">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Tile
              label="Used leads"
              value={total}
              color="#2563eb"
              icon={<PhoneOutlined />}
              hint="Show every used lead"
              onClick={() => { setOutcome(""); setCaller(""); setOwnerFilter(""); }}
            />
            <Tile
              label="Connected (spoke to customer)"
              value={connected}
              sub={pctOf(connected)}
              color="#16a34a"
              icon={<CheckCircleOutlined />}
              active={outcome === "connected"}
              onClick={() => setOutcome(outcome === "connected" ? "" : "connected")}
            />
            <Tile
              label="Not picked up"
              value={notPicked}
              sub={pctOf(notPicked)}
              color="#d97706"
              icon={<DisconnectOutlined />}
              active={outcome === "notpicked"}
              onClick={() => setOutcome(outcome === "notpicked" ? "" : "notpicked")}
            />
            <Tile
              label="Not with any user"
              value={noOwnerCount}
              color="#7c3aed"
              icon={<UserSwitchOutlined />}
              active={ownerFilter === "unassigned"}
              hint="No Lead Owner and no sales user has connected with them yet"
              onClick={() => { setOwnerFilter(ownerFilter === "unassigned" ? "" : "unassigned"); setStageFilter(""); setRespFilter(""); setPage(1); }}
            />
            <Tile
              label="Auto-dialer only (no sales user)"
              value={autoOnlyCount}
              color="#64748b"
              icon={<RocketOutlined />}
              active={caller === "none"}
              hint="Never went to a sales user — only the auto-dialer pool called them"
              onClick={() => setCaller(caller === "none" ? "" : "none")}
            />
          </div>

          {total > 0 && (
            <div style={{ margin: "18px 0 20px" }}>
              <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "var(--hub-border)" }}>
                <div style={{ width: `${(connected / total) * 100}%`, background: "#16a34a" }} title={`Connected: ${connected}`} />
                <div style={{ width: `${(notPicked / total) * 100}%`, background: "#f59e0b" }} title={`Not picked up: ${notPicked}`} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--hub-muted)", marginTop: 6, fontWeight: 600 }}>
                <span><span style={{ color: "#16a34a" }}>●</span> Connected {pctOf(connected)}</span>
                <span><span style={{ color: "#f59e0b" }}>●</span> Not picked up {pctOf(notPicked)}</span>
              </div>
            </div>
          )}

          {total > 0 ? (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <BarList
                title="Current stage"
                subtitle="Where these leads stand in the pipeline now"
                bars={stageBars}
                active={stageFilter}
                onPick={(v) => pick(setStageFilter, stageFilter, v)}
              />
              <BarList
                title="Response on last call"
                subtitle="What was recorded on the most recent call"
                bars={respBars}
                active={respFilter}
                onPick={(v) => pick(setRespFilter, respFilter, v)}
                limit={8}
                expanded={showAllResp}
                onToggle={() => setShowAllResp((v) => !v)}
                legend={[
                  { label: "Positive", color: "#10b981" },
                  { label: "Connected", color: "#3b82f6" },
                  { label: "No answer", color: "#f59e0b" },
                  { label: "Negative", color: "#ef4444" },
                ]}
              />
            </div>
          ) : (
            <div className="hub-empty" style={{ marginTop: 16 }}>No used leads match these filters.</div>
          )}
        </div>
      )}

      {!loading && !error && (
        <div className="hub-card">
          {(stageFilter || respFilter) && (
            <div style={{ fontSize: 12, color: "var(--hub-muted)", marginBottom: 8 }}>
              {shown.length} of {total} · {[stageFilter, respFilter].filter(Boolean).join(" · ")}{" "}
              <button type="button" className="hub-link-btn" style={{ fontSize: 12 }} onClick={() => { setStageFilter(""); setRespFilter(""); setPage(1); }}>
                clear
              </button>
            </div>
          )}
          {selectable && shownIds.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                marginBottom: 12,
                borderRadius: 12,
                border: `1px solid ${picked.length ? "#7c3aed" : "var(--hub-border)"}`,
                background: picked.length ? "#7c3aed0f" : "var(--hub-bg-soft)",
              }}
            >
              <b style={{ fontSize: 13, color: "var(--hub-text)" }}>
                {picked.length ? `${picked.length} selected` : "Tick leads to move them back into the pipeline"}
              </b>
              {picked.length < shownIds.length && (
                <button type="button" className="hub-link-btn" style={{ fontSize: 12 }} onClick={() => setPicked(shownIds)}>
                  Select all {shownIds.length}
                </button>
              )}
              {picked.length > 0 && (
                <button type="button" className="hub-link-btn" style={{ fontSize: 12 }} onClick={() => setPicked([])}>
                  clear
                </button>
              )}
              <span style={{ flex: 1 }} />
              <select
                className="hub-select"
                style={{ width: 190 }}
                value={moveStage}
                onChange={(e) => { setMoveStage(e.target.value); setMoveSub(""); }}
                aria-label="Move to stage"
              >
                <option value="">Move to stage…</option>
                {STAGE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {moveStage && subStatusesFor(moveStage).length > 0 && (
                <select className="hub-select" style={{ width: 220 }} value={moveSub} onChange={(e) => setMoveSub(e.target.value)} aria-label="Sub-status">
                  <option value="">Default sub-status</option>
                  {subStatusesFor(moveStage).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              <button type="button" className="hub-btn hub-btn-primary" disabled={!picked.length || !moveStage || moving} onClick={moveSelected}>
                {moving ? "Moving…" : "Move"}
              </button>
            </div>
          )}
          {shown.length === 0 ? (
            <div className="hub-empty">{caller || outcome || ownerFilter || stageFilter || respFilter ? "No leads match these filters." : "No leads have been called yet."}</div>
          ) : (
            <>
            <div className="hub-table-wrapper">
              <table className="hub-table">
                <thead>
                  <tr>
                    {selectable && (
                      <th style={{ width: 36 }}>
                        <input type="checkbox" aria-label="Select every lead on this page" checked={allPagePicked} onChange={togglePage} disabled={!pageIds.length} />
                      </th>
                    )}
                    <th>Client</th>
                    <th>Phone</th>
                    <th>Stage</th>
                    <th>Response</th>
                    <th>Called By</th>
                    <th>Assigned</th>
                    <th>Team</th>
                    <th>Last Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((l) => (
                    <tr key={l._id} style={{ cursor: "pointer" }} title="Click for full details" onClick={() => setViewLead(l)}>
                      {selectable && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${l.name}`}
                            checked={picked.includes(String(l._id))}
                            onChange={() => togglePick(String(l._id))}
                            disabled={!movable(l)}
                            title={movable(l) ? undefined : "Not a CRM lead — can't be moved to a stage"}
                          />
                        </td>
                      )}
                      <td>{l.name}</td>
                      <td>{l.phone || "—"}</td>
                      <td>
                        {l.stage ? (
                          <>
                            <span className={`hub-badge ${STATUS_META[l.stage] || "hub-badge-gray"}`}>{l.stage}</span>
                            {l.subStatus && <div style={{ fontSize: 11, color: "var(--hub-muted)", marginTop: 2 }}>{l.subStatus}</div>}
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>{NOT_IN_CRM}</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`hub-badge ${
                            l.outcome === "notpicked" ? "hub-badge-yellow" : l.outcome === "connected" ? "hub-badge-green" : STATUS_META[l.stage]
                          }`}
                        >
                          {l.response}
                        </span>
                      </td>
                      <td>{l.calledBy || (l.noUser ? "Auto-dialer" : "—")}</td>
                      <td title={l.assignedFromCall ? "No owner yet — this is who spoke to them" : undefined}>
                        {l.assignedUserName || (l.noUser ? <span style={{ color: "var(--hub-muted)" }}>No user</span> : "—")}
                        {l.assignedFromCall && <div style={{ fontSize: 11, color: "var(--hub-muted)", fontWeight: 500 }}>talked</div>}
                      </td>
                      <td>{l.team || "Unassigned"}</td>
                      <td>{l.lastContactAt ? new Date(l.lastContactAt).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hub-row" style={{ justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>
                Page {page} of {pages} · {shown.length} total
              </span>
              <div className="hub-row" style={{ gap: 8 }}>
                <select
                  className="hub-select"
                  style={{ width: "auto" }}
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  aria-label="Leads per page"
                >
                  {[10, 20, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
                <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <LeftOutlined /> Prev
                </button>
                <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next <RightOutlined />
                </button>
              </div>
            </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Leads() {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const isLeadAdmin = LEAD_ADMIN_TAB_ROLES.includes(currentAdmin?.role);
  const isTeamActivityAdmin = TEAM_ACTIVITY_ROLES.includes(currentAdmin?.role);
  const [tab, setTab] = useState("all");

  // Import/Export only ever shows for owner/Super Admin/Admin/Sales
  // Manager/Team Manager — everyone else never sees the tab, and can't land
  // on it via stale state either (see the guard below). Callbacks was
  // removed (its own dedicated view — every other stage already lives under
  // Lead Stages); Capture Form moved to Marketing (ad-platform lead capture
  // fits there, not Sales) — see pages/Leads/CaptureForm.jsx.
  // Used Leads is management-only too (backend usedLeads.js enforces it).
  const tabs = [
    { key: "all", label: "Lead Stages" },
    ...(isLeadAdmin ? [{ key: "used", label: "Used Leads" }, { key: "io", label: "Import / Export" }] : []),
    ...(isTeamActivityAdmin ? [{ key: "team", label: "Team Activity" }] : []),
  ];

  useEffect(() => {
    if (!isLeadAdmin && (tab === "io" || tab === "used")) setTab("all");
    if (!isTeamActivityAdmin && tab === "team") setTab("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeadAdmin]);

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Lead Management</h2>
          <p>Track lead stages &amp; sub-statuses, import/export and manage your leads</p>
        </div>
      </div>

      <HubTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "all" && <AllLeads />}
      {isLeadAdmin && tab === "used" && <UsedLeadsBoard />}
      {isLeadAdmin && tab === "io" && <ImportExport />}
      {isTeamActivityAdmin && tab === "team" && <TeamActivity />}
    </div>
  );
}