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
  EyeOutlined,
  EditOutlined,
  ImportOutlined,
  ExportOutlined,
  DownloadOutlined,
  TeamOutlined,
  UserOutlined,
  InboxOutlined,
  HistoryOutlined,
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
  SearchOutlined,
  ClockCircleOutlined,
  RiseOutlined,
  FacebookOutlined,
  LinkOutlined,
  CopyOutlined,
  GoogleOutlined,
  LinkedinOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import "./leadListFilters.css";
import SuPager from "@/components/SalesTheme/SuPager";
import AgentLink from "@/components/SalesTheme/AgentLink";

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

// The board's "all leads" selection — the backend's by-stage treats
// stage=All as "no stage filter", so the list is exactly the board total.
const ALL_STAGES = "All";
// The board's tabs: which set of leads the whole board (donut, stages, list) shows.
const POOL_TABS = [
  { key: "board", label: "On Board", all: "All leads on board", color: "var(--hub-blue)", soft: "var(--hub-blue-soft)", Icon: TeamOutlined },
  { key: "used", label: "Used Leads", all: "All used leads", color: "#d97706", soft: "#fef3c7", Icon: HistoryOutlined },
  { key: "all", label: "Total Received", all: "All leads received", color: "#16a34a", soft: "#dcfce7", Icon: InboxOutlined },
];
const poolTab = (k) => POOL_TABS.find((p) => p.key === k) || POOL_TABS[0];

function LeadStageBoard({ stages, total, pools = null, pool = "board", onPool, loading, activeStage, activeSub, onSelect, userOptions, viewUser, onViewUser, quality }) {
  // Company-wide view: tabs On Board / Used Leads / Total Received switch the whole board.
  // A one-user view has no such split — it shows that user's leads.
  const hasPools = !!pools && !viewUser;
  const tab = poolTab(hasPools ? pool : "board");
  const allLabel = hasPools ? tab.all : "Total Leads";
  const centerLabel = hasPools ? tab.label : "Total Leads";
  const [expanded, setExpanded] = useState({});
  const pct = (n) => (total ? (n / total) * 100 : 0);
  const nonZero = stages.filter((s) => s.count > 0);

  // Sales One Place design (Leads › Lead Stages): pool switch + "Viewing" on
  // top, then two cards — Lead status donut + Lead quality, and All stages.
  // Same props and clicks as before: a slice / row / sub-status picks the
  // stage for the Lead List; the centre or "All …" picks every lead.
  const SIZE = 42;
  const R = 15.915;
  let dashAccum = 0;
  const activeRow = stages.find((s) => s.stage === activeStage);
  const centerN = activeRow ? activeRow.count : total;
  const centerL = activeRow ? activeRow.stage : centerLabel;
  const maxCount = Math.max(1, ...stages.map((s) => s.count));
  const viewingName = viewUser && userOptions ? (userOptions.find((o) => o.value === viewUser) || {}).label || "User" : "";
  const poolHelp = {
    board: "Leads still being worked — used leads no user has are in Used Leads.",
    used: "Every lead that has been called (CRM leads), stage-wise.",
    all: "Every lead received so far, whether called or not.",
  };

  return (
    <div className="lsb">
      <section className="lsb-top">
        <div className="lsb-top-row">
          {hasPools ? (
            <div className="lsb-seg" role="tablist" aria-label="Which leads">
              {POOL_TABS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={pool === p.key}
                  className={pool === p.key ? "on" : ""}
                  onClick={() => onPool(p.key)}
                  title={poolHelp[p.key]}
                >
                  <p.Icon /> {p.label} · {(pools[p.key] ?? 0).toLocaleString("en-IN")}
                </button>
              ))}
            </div>
          ) : (
            <div className="lsb-seg" role="group" aria-label="Leads">
              <button
                type="button"
                className={activeStage === ALL_STAGES ? "on" : ""}
                onClick={() => total && onSelect(ALL_STAGES)}
                title="Show every lead on this board in the Lead List"
              >
                <TeamOutlined /> {viewingName ? `${viewingName}'s leads` : "Total Leads"} · {total.toLocaleString("en-IN")}
              </button>
            </div>
          )}
          <span className="su-sp" />
          {userOptions && (
            <label className="lsb-viewing">
              Viewing
              <Select
                showSearch
                allowClear
                value={viewUser || undefined}
                onChange={(v) => onViewUser(v || "")}
                placeholder="Everyone"
                optionFilterProp="label"
                options={userOptions}
                popupMatchSelectWidth={240}
                style={{ width: 200 }}
                aria-label="Viewing user"
              />
            </label>
          )}
        </div>
        <p className="lsb-help">
          {hasPools ? poolHelp[pool] || poolHelp.board : "Every lead on this board, stage-wise."}
          {viewingName ? ` Showing ${viewingName}'s leads only.` : ""}
        </p>
      </section>

      {loading ? (
        <div className="lsb-grid">
          <div className="hub-card"><div className="hub-skel" style={{ height: 300 }} /></div>
          <div className="hub-card"><div className="hub-skel" style={{ height: 300 }} /></div>
        </div>
      ) : (
        <div className="lsb-grid">
          <div className="hub-card">
            <div className="lsb-ch">
              <div>
                <h3>Lead status</h3>
                <p>Count and share · click a slice</p>
              </div>
            </div>
            {total > 0 ? (
              <div className="lsb-donut">
                <svg width="250" height="250" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Leads by stage">
                  <circle cx="21" cy="21" r={R} fill="none" stroke="var(--hub-bg-soft, #EEF2F6)" strokeWidth="6" />
                  {nonZero.map((s) => {
                    const p = pct(s.count);
                    const node = (
                      <circle
                        key={s.stage}
                        cx="21"
                        cy="21"
                        r={R}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={activeStage === s.stage ? 8 : 6}
                        strokeDasharray={`${p} ${100 - p}`}
                        strokeDashoffset={25 - dashAccum}
                        style={{ cursor: "pointer" }}
                        onClick={() => onSelect(s.stage)}
                      >
                        <title>{`${s.stage}: ${s.count} (${Math.round(p)}%)`}</title>
                      </circle>
                    );
                    dashAccum += p;
                    return node;
                  })}
                  <circle cx="21" cy="21" r="12" fill="transparent" style={{ cursor: "pointer" }} onClick={() => total && onSelect(ALL_STAGES)}>
                    <title>Show all {total} leads</title>
                  </circle>
                  <text x="21" y="20.5" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="currentColor" fontFamily="Space Grotesk, Inter, sans-serif" style={{ pointerEvents: "none" }}>
                    {centerN.toLocaleString("en-IN")}
                  </text>
                  <text x="21" y="25.5" textAnchor="middle" fontSize="2.6" fill="var(--hub-muted, #5B6B79)" style={{ pointerEvents: "none" }}>
                    {centerL}
                  </text>
                </svg>
              </div>
            ) : (
              <div className="hub-empty"><b>No data available for the selected filters.</b></div>
            )}

            <div className="lsb-quality">
              <div className="lsb-ch" style={{ marginBottom: 8 }}>
                <div>
                  <h3>Lead quality</h3>
                  <p>Of the leads someone actually spoke to</p>
                </div>
              </div>
              {quality ? (
                <>
                  <div className="lsb-qsum">
                    <span>Spoke to <b>{quality.contacted.toLocaleString("en-IN")}</b> of {quality.total.toLocaleString("en-IN")} · {quality.contactedPct}%</span>
                    <span>Talk <b>{fmtMins(quality.talkMinutes)}</b> · {quality.talkCalls} calls{quality.contacted ? ` · ~${(quality.talkMinutes / quality.contacted).toFixed(1)} min a lead` : ""}</span>
                  </div>
                  {QUALITY_ROWS.map(([stage, label, color]) => {
                    const n = quality.byStage[stage] || 0;
                    const p = pctOf(n, quality.contacted);
                    return (
                      <div key={stage} className="lsb-hb">
                        <span>{label}</span>
                        <span className="t"><b style={{ width: `${Math.min(100, p)}%`, background: color }} /></span>
                        <span className="n">{n.toLocaleString("en-IN")} <em>{p}%</em></span>
                      </div>
                    );
                  })}
                  <div className="lsb-qtotal">
                    <span>Positive in total</span>
                    <span><b>{quality.positive.toLocaleString("en-IN")}</b> · {quality.qualityPct}% of spoken</span>
                  </div>
                  <div className="lsb-qnote">Spoke to = an answered call a user took. Positive = Interested + Callback + Demo booked + Enrolled.</div>
                </>
              ) : (
                <div className="hub-skel" style={{ height: 90 }} />
              )}
            </div>
          </div>

          <div className="hub-card">
            <div className="lsb-ch">
              <div>
                <h3>All stages</h3>
                <p>Click a row to list it · ▸ to see sub-statuses</p>
              </div>
              <button
                type="button"
                className={`hub-btn su-sm${activeStage === ALL_STAGES ? " hub-btn-primary" : ""}`}
                onClick={() => total && onSelect(ALL_STAGES)}
                title="Show every lead on this board in the Lead List"
              >
                {allLabel} · {total.toLocaleString("en-IN")}
              </button>
            </div>
            {stages.map((s) => {
              const p = pct(s.count);
              const on = activeStage === s.stage && !activeSub;
              const isOpen = !!expanded[s.stage];
              const subs = s.subStatuses || [];
              const canOpen = subs.length > 1;
              return (
                <div key={s.stage}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={`lsb-row${on ? " on" : ""}${s.count ? "" : " zero"}`}
                    onClick={() => {
                      if (canOpen) setExpanded((e) => ({ ...e, [s.stage]: !e[s.stage] }));
                      onSelect(s.stage);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (canOpen) setExpanded((x) => ({ ...x, [s.stage]: !x[s.stage] }));
                        onSelect(s.stage);
                      }
                    }}
                  >
                    {canOpen ? (
                      <button
                        type="button"
                        className="lsb-xb"
                        aria-label={isOpen ? `Hide ${s.stage} sub-statuses` : `Show ${s.stage} sub-statuses`}
                        aria-expanded={isOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded((x) => ({ ...x, [s.stage]: !x[s.stage] }));
                        }}
                      >
                        {isOpen ? "▾" : "▸"}
                      </button>
                    ) : (
                      <span />
                    )}
                    <span className="lsb-name"><i style={{ background: s.color }} />{s.stage}</span>
                    <span className="t"><b style={{ width: `${s.count ? Math.max((s.count / maxCount) * 100, 2) : 0}%`, background: s.color }} /></span>
                    <span className="n">{s.count.toLocaleString("en-IN")}</span>
                    <span className="p">{Math.round(p)}%</span>
                  </div>
                  {isOpen &&
                    subs.map((ss) => {
                      const sOn = activeStage === s.stage && activeSub === ss.subStatus;
                      return (
                        <button
                          key={ss.subStatus}
                          type="button"
                          className={`lsb-sub${sOn ? " on" : ""}`}
                          onClick={() => onSelect(s.stage, ss.subStatus)}
                        >
                          <span />
                          <span>↳ {ss.subStatus}</span>
                          <span className="t"><b style={{ width: `${ss.count ? Math.max(pct(ss.count), 2) : 0}%`, background: s.color }} /></span>
                          <span className="n">{ss.count.toLocaleString("en-IN")}</span>
                          <span className="p">{Math.round(pct(ss.count))}%</span>
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

// ── "Came in" — when each lead arrived (user ask 2026-11-17) ──────────────
// Dates are IST calendar days "YYYY-MM-DD" (the backend reads them as whole IST days).
const istDay = (offset = 0) => new Date(Date.now() + 5.5 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
const cameDay = (d) => {
  const k = new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  if (k === istDay(0)) return "Today";
  if (k === istDay(-1)) return "Yesterday";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: k.slice(0, 4) === istDay(0).slice(0, 4) ? undefined : "numeric" });
};

// Chips above the Lead List: All · Today · Yesterday · Last 7 days · Custom (one day or a span).
// They drive the same createdFrom / createdTo as the Filters panel's "Created" dates.
function CameInBar({ filters, arrivals, onPick }) {
  const f = filters.createdFrom || "";
  const t = filters.createdTo || "";
  const today = istDay(0);
  const yest = istDay(-1);
  const week = istDay(-6);
  const preset = !f && !t ? "all" : f === today && t === today ? "today" : f === yest && t === yest ? "yesterday" : f === week && t === today ? "7d" : "custom";
  const [custom, setCustom] = useState(preset === "custom");
  useEffect(() => {
    if (preset === "custom") setCustom(true);
  }, [preset]);
  const chip = (key, label, count, from, to) => (
    <button
      type="button"
      className={`ll-cchip${preset === key && !(custom && key !== "custom") ? " on" : ""}`}
      onClick={() => {
        setCustom(false);
        onPick(from, to);
      }}
    >
      {label}
      {count !== undefined && count !== null && <i>{count}</i>}
    </button>
  );
  return (
    <div className="ll-camebar" role="group" aria-label="Came in">
      <span className="ll-camelabel">Came in</span>
      {chip("all", "All", undefined, "", "")}
      {chip("today", "Today", arrivals?.today, today, today)}
      {chip("yesterday", "Yesterday", arrivals?.yesterday, yest, yest)}
      {chip("7d", "Last 7 days", arrivals?.last7, week, today)}
      <button type="button" className={`ll-cchip${custom || preset === "custom" ? " on" : ""}`} onClick={() => setCustom(true)}>
        Custom
      </button>
      {(custom || preset === "custom") && (
        <span className="ll-ccustom">
          <input
            type="date"
            className="hub-input"
            aria-label="Came in from"
            value={f}
            max={t || today}
            onChange={(e) => onPick(e.target.value, t && t >= e.target.value ? t : e.target.value)}
          />
          <span className="ll-arrow" aria-hidden="true">→</span>
          <input type="date" className="hub-input" aria-label="Came in to" value={t} min={f || undefined} max={today} onChange={(e) => onPick(f || e.target.value, e.target.value)} />
          <em>{f ? (f === t || !t ? `Only ${cameDay(`${f}T12:00:00+05:30`)}` : `${cameDay(`${f}T12:00:00+05:30`)} – ${cameDay(`${t}T12:00:00+05:30`)}`) : "Pick a day"}</em>
        </span>
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
  // Board tab (company-wide only): board | used | all — see POOL_TABS
  const [pool, setPool] = useState("board");
  const [stageQuality, setStageQuality] = useState(null);
  const qualityKeyRef = useRef("");

  const loadStageStats = async (teamViewOverride, userOverride, poolOverride) => {
    setStageLoading(true);
    setStageError(false);
    const teamView = teamViewOverride !== undefined ? teamViewOverride : filters.teamView;
    const user = userOverride !== undefined ? userOverride : boardUser;
    const p = new URLSearchParams();
    if (teamView) p.set("teamView", teamView);
    if (user && (!teamView || teamView === "responses")) p.set("user", user);
    const pl = poolOverride !== undefined ? poolOverride : pool;
    if (!user && pl !== "board") p.set("pool", pl);
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
    const pl = over.pool !== undefined ? over.pool : pool;
    const userForPool = over.boardUser !== undefined ? over.boardUser : boardUser;
    if (pl !== "board" && !userForPool) params.set("pool", pl);
    if (sub) params.set("subStatus", sub);
    Object.entries(f).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    // A stage drilled from the board lists the same leads it counted — the
    // caller's own responses (Team Leader: + team's), see stageStats.js.
    if (stage && !f.teamView && !f.team && !f.assignedUser) params.set("teamView", "responses");
    const viewUser = over.boardUser !== undefined ? over.boardUser : boardUser;
    if (viewUser && params.get("teamView") === "responses") params.set("user", viewUser);

    params.set("withArrivals", "1");
    const res = await request.get({ entity: `lead/by-stage?${params.toString()}` });
    setDrill({
      leads: res?.success ? res.result : [],
      page: targetPage,
      pages: res?.pagination?.pages || 1,
      count: res?.pagination?.count || 0,
      arrivals: res?.arrivals || null,
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

  // Board tab: the whole board (donut + stages) and the Lead List switch to that set of leads.
  const changePool = (p) => {
    if (p === pool) return;
    setPool(p);
    setSelectedIds([]);
    loadStageStats(undefined, undefined, p);
    const stage = drillStage || ALL_STAGES;
    setDrillStage(stage);
    loadLeadList(1, { pool: p, stage, sub: drillSub });
  };

  // header search: the list follows as you type (0.4 s pause), Enter / clear at once
  const searchTimer = useRef(null);
  const onSearchType = (value, now = false) => {
    const next = { ...filters, q: value };
    setFilters(next);
    clearTimeout(searchTimer.current);
    if (now) loadLeadList(1, { filters: next });
    else searchTimer.current = setTimeout(() => loadLeadList(1, { filters: next }), 400);
  };
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  // how many advanced filters are on (Filters button badge); the search box shows itself
  const activeFilterCount =
    (drillStage ? 1 : 0) +
    ["subStatus", "assignedUser", "team", "source", "teamView"].filter((k) => filters[k]).length +
    [["callbackFrom", "callbackTo"], ["followUpFrom", "followUpTo"], ["createdFrom", "createdTo"]].filter(([a, b]) => filters[a] || filters[b]).length;

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
    if (pool !== "board" && !boardUser) out.pool = pool;
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

  // Applied-filter pills (Sales One Place design): each one removes just that filter.
  const userLabel = (id) => {
    if (id === "none") return "Unassigned";
    const a = salesAdmins.find((x) => String(x._id) === String(id));
    return a ? `${a.name || ""} ${a.surname || ""}`.trim() || a.email : "User";
  };
  const dropStage = () => {
    const next = { ...filters, quick: "", subStatus: "" };
    setDrillStage(null);
    setDrillSub(null);
    setFilters(next);
    loadLeadList(1, { stage: null, sub: null, filters: next });
  };
  const appliedPills = [];
  const quickOn = QUICK_FILTERS.find((qf) => qf.key === filters.quick);
  if (quickOn) appliedPills.push({ key: "quick", label: quickOn.label, remove: dropStage });
  else if (drillStage) appliedPills.push({ key: "stage", label: `Stage: ${drillStage === ALL_STAGES ? poolTab(pool).all : drillStage}`, remove: dropStage });
  if (filters.subStatus) {
    appliedPills.push({
      key: "sub",
      label: `Sub-status: ${filters.subStatus}`,
      remove: () => {
        const next = { ...filters, subStatus: "" };
        setDrillSub(null);
        setFilters(next);
        loadLeadList(1, { sub: null, filters: next });
      },
    });
  }
  if (filters.q) appliedPills.push({ key: "q", label: `Search: ${filters.q}`, remove: () => onSearchType("", true) });
  if (filters.assignedUser) appliedPills.push({ key: "assignedUser", label: `Sales user: ${userLabel(filters.assignedUser)}`, remove: () => updateFilter({ assignedUser: "" }) });
  if (filters.team) appliedPills.push({ key: "team", label: `Team: ${filters.team}`, remove: () => updateFilter({ team: "" }) });
  if (filters.teamView) appliedPills.push({ key: "teamView", label: filters.teamView === "mine" ? "My leads only" : "My team", remove: () => updateFilter({ teamView: "" }) });
  if (filters.source) appliedPills.push({ key: "source", label: `Source: ${filters.source}`, remove: () => updateFilter({ source: "" }) });
  [["Callback", "callbackFrom", "callbackTo"], ["Follow-up", "followUpFrom", "followUpTo"], ["Came in", "createdFrom", "createdTo"]].forEach(([label, fk, tk]) => {
    if (filters[fk] || filters[tk]) {
      appliedPills.push({
        key: fk,
        label: `${label}: ${filters[fk] || "…"}${filters[tk] && filters[tk] !== filters[fk] ? ` → ${filters[tk]}` : ""}`,
        remove: () => updateFilter({ [fk]: "", [tk]: "" }),
      });
    }
  });

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
          pools={stageData.pools || null}
          pool={pool}
          onPool={changePool}
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

      <div className="hub-card ll-card">
        {/* Sales One Place design: title + owner action, stage chips with counts, an always-open filter panel */}
        <div className="lsb-ch">
          <div>
            <h3>
              {drillStage && drillStage !== ALL_STAGES ? drillStage : !boardUser && pool !== "board" ? poolTab(pool).all : "Lead List"}
              {drillSub ? ` · ${drillSub}` : ""}
            </h3>
            <p>Click a name or number for everything about that lead</p>
          </div>
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
        </div>

        <div className="ll-stg" role="group" aria-label="Stages — click to filter">
          {QUICK_FILTERS.map((qf) => {
            const on =
              qf.key === "all"
                ? !listActive
                : filters.quick === qf.key || (qf.stage && drillStage === qf.stage && !drillSub && !filters.quick);
            const c = qf.stage ? stageColor(qf.stage) : qf.key === "callback-overdue" ? "#B42318" : "#0F766E";
            const n =
              qf.key === "all"
                ? stageData.total
                : qf.stage
                ? ((stageData.stages || []).find((s) => s.stage === qf.stage) || {}).count
                : null;
            return (
              <button
                key={qf.key}
                type="button"
                className={on ? "on" : ""}
                style={{ "--ll-c": c }}
                onClick={() => (qf.key === "all" ? clearList() : applyQuickFilter(qf))}
              >
                <span>
                  <i aria-hidden="true" />
                  {qf.label}
                </span>
                <b>{n === null || n === undefined ? <ClockCircleOutlined /> : Number(n).toLocaleString("en-IN")}</b>
              </button>
            );
          })}
        </div>

        <section className="ll-fp" aria-label="Filters">
          <div className="ll-fp-row">
            {/* search (user ask 2026-11-17): type a number / name — the list follows as you type */}
            <label className="ll-search" title="Search by name, phone number or email">
              <SearchOutlined />
              <input
                value={filters.q}
                onChange={(e) => onSearchType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSearchType(e.currentTarget.value, true);
                  if (e.key === "Escape") onSearchType("", true);
                }}
                placeholder="Search number, name or email…"
                aria-label="Search leads by number, name or email"
                inputMode="search"
              />
              {filters.q && (
                <button type="button" className="ll-search-x" onClick={() => onSearchType("", true)} aria-label="Clear search">
                  <CloseOutlined />
                </button>
              )}
            </label>
          </div>

          <div className="ll-fgrid">
            <label className="ll-field">
              <span>Stage</span>
              <select className="hub-select" value={drillStage || ""} onChange={(e) => selectStage(e.target.value || null)}>
                <option value="">All stages</option>
                <option value={ALL_STAGES}>{poolTab(pool).all}</option>
                {STAGE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="ll-field">
              <span>Sub-status</span>
              <select
                className="hub-select"
                value={filters.subStatus}
                disabled={!drillStage}
                title={drillStage ? undefined : "Pick a stage first"}
                onChange={(e) => {
                  setDrillSub(e.target.value || null);
                  updateFilter({ subStatus: e.target.value });
                }}
              >
                <option value="">{drillStage ? "All" : "Pick a stage first"}</option>
                {(drillStage ? subStatusesFor(drillStage) : []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {/* Company-wide narrowing — only has an effect for Owner/Super Admin/Admin/
                Sales Manager/Team Manager (leadController/scope.js); hidden for everyone else. */}
            {isFullAccess && (
              <label className="ll-field">
                <span>Sales user</span>
                <select className="hub-select" value={filters.assignedUser} onChange={(e) => updateFilter({ assignedUser: e.target.value })}>
                  <option value="">Anyone</option>
                  <option value="none">Unassigned (no owner)</option>
                  {salesAdmins.map((a) => (
                    <option key={a._id} value={a._id}>{`${a.name || ""} ${a.surname || ""}`.trim() || a.email}</option>
                  ))}
                </select>
              </label>
            )}
            {isFullAccess && (
              <label className="ll-field">
                <span>Team</span>
                <select className="hub-select" value={filters.team} onChange={(e) => updateFilter({ team: e.target.value })}>
                  <option value="">Any team</option>
                  {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            )}
            {/* Non-full-access users see every lead by default; this narrows to their team's or their own. */}
            {!isFullAccess && (
              <label className="ll-field">
                <span>Showing</span>
                <select className="hub-select" value={filters.teamView} onChange={(e) => updateFilter({ teamView: e.target.value })}>
                  <option value="">All leads</option>
                  <option value="1">My team</option>
                  <option value="mine">My leads only</option>
                </select>
              </label>
            )}
            <label className="ll-field">
              <span>Source</span>
              <select className="hub-select" value={filters.source} onChange={(e) => updateFilter({ source: e.target.value })}>
                <option value="">Any source</option>
                {["Website", "Facebook Ads", "Google Ads", "LinkedIn Ads", "Referral", "Cold Call", "WhatsApp", "Import", "Other"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          {showFilters && (
            <div className="ll-fsec">
              <div className="ll-fsec-h"><span>Dates</span><em>Leave “to” empty for a single day onwards</em></div>
              <div className="ll-dgrid">
                {[
                  ["Callback", "callbackFrom", "callbackTo"],
                  ["Follow-up", "followUpFrom", "followUpTo"],
                  ["Created", "createdFrom", "createdTo"],
                ].map(([label, fk, tk]) => (
                  <div key={label} className={`ll-drange${filters[fk] || filters[tk] ? " on" : ""}`}>
                    <span className="ll-dlabel">{label}</span>
                    <div className="ll-dinputs">
                      <input type="date" className="hub-input" aria-label={`${label} from`} value={filters[fk]} max={filters[tk] || undefined} onChange={(e) => updateFilter({ [fk]: e.target.value })} />
                      <span className="ll-arrow" aria-hidden="true">→</span>
                      <input type="date" className="hub-input" aria-label={`${label} to`} value={filters[tk]} min={filters[fk] || undefined} onChange={(e) => updateFilter({ [tk]: e.target.value })} />
                      {(filters[fk] || filters[tk]) && (
                        <button type="button" className="ll-dclear" aria-label={`Clear ${label} dates`} onClick={() => updateFilter({ [fk]: "", [tk]: "" })}>
                          <CloseOutlined />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="ll-factions">
            <div className="ll-applied">
              {appliedPills.map((p) => (
                <button key={p.key} type="button" className="ll-pill" onClick={p.remove} title="Remove this filter">
                  {p.label} <CloseOutlined />
                </button>
              ))}
            </div>
            <div className="hub-row" style={{ gap: 8 }}>
              <button type="button" className="hub-btn su-sm" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
                <FilterOutlined /> {showFilters ? "Hide dates" : "Callback / follow-up / created dates"}
              </button>
              {listActive && (
                <button type="button" className="hub-btn su-sm" onClick={clearList}>
                  Reset
                </button>
              )}
            </div>
          </div>
        </section>

        <>
            <div style={{ fontSize: 12, color: "var(--hub-muted)", marginBottom: 8 }}>
              {drill.loading ? "Loading…" : `${drill.count} lead${drill.count === 1 ? "" : "s"}`}
              {!boardUser && pool !== "board" ? ` · ${poolTab(pool).label}` : ""}
              {drillStage ? ` · ${drillStage === ALL_STAGES ? "All stages" : drillStage}` : ""}
              {drillSub ? ` · ${drillSub}` : ""}
            </div>
            {canAssignOwner && selectedIds.length > 0 && (
              <div className="su-bulk" role="region" aria-label="Selected leads">
                <b>{selectedIds.length} selected</b>
                <button type="button" className="hub-btn su-sm" onClick={() => setOwnerModal({})}>
                  <UserSwitchOutlined /> Change owner
                </button>
                <span className="su-sp" />
                <button type="button" className="su-bulk-x" onClick={() => setSelectedIds([])}>
                  Clear
                </button>
              </div>
            )}
            <CameInBar filters={filters} arrivals={drill.arrivals} onPick={(createdFrom, createdTo) => updateFilter({ createdFrom, createdTo })} />
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
                    <th>Lead</th>
                    <th>Number</th>
                    <th>Source</th>
                    <th>Stage / Sub-status</th>
                    <th>Owner</th>
                    <th>Came in</th>
                    <th>Next follow-up</th>
                    <th>Call back</th>
                    <th><span className="su-sr">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {drill.loading && (
                    <tr><td colSpan={canAssignOwner ? 10 : 9}><div className="hub-empty">Loading…</div></td></tr>
                  )}
                  {!drill.loading && drill.leads.length === 0 && (
                    <tr><td colSpan={canAssignOwner ? 10 : 9}><div className="hub-empty"><b>No data available for the selected filters.</b>{listActive && <button type="button" className="hub-btn su-sm" onClick={clearList}>Reset filters</button>}</div></td></tr>
                  )}
                  {!drill.loading &&
                    drill.leads.map((l) => {
                      const overdue =
                        l.stage === "Callback" && l.callBackAt && new Date(l.callBackAt) < new Date();
                      return (
                        <tr
                          key={l._id}
                          // click anywhere on the row → full lead detail (same modal as everywhere else);
                          // the tick box and the Edit / Owner buttons keep their own action
                          onClick={(e) => {
                            if (e.target.closest("button, input, a, select, label")) return;
                            setViewLead(l);
                          }}
                          style={{ cursor: "pointer" }}
                          title="Open full lead details"
                        >
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
                              <button type="button" className="su-lnk su-ink" title="Click for full details" onClick={() => setViewLead(l)}>{l.name}</button>
                            </div>
                          </td>
                          <td>{l.phone ? <button type="button" className="su-lnk" title="Click for full details" onClick={() => setViewLead(l)}>{l.phone}</button> : "—"}</td>
                          <td>{l.source || "—"}</td>
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
                            {l.assignedUserName || (l.assignedUser && l.assignedUser.name) ? (
                              <AgentLink
                                adminId={(l.assignedUser && l.assignedUser._id) || (typeof l.assignedUser === "string" ? l.assignedUser : "")}
                                name={l.assignedUserName || (l.assignedUser && l.assignedUser.name)}
                              />
                            ) : "—"}
                            {(() => {
                              // Who last worked it — most leads have no owner, only responses.
                              const last = [...(l.stageHistory || [])].reverse().find((h) => h.changedByName);
                              return last ? (
                                <div style={{ fontSize: 11, color: "var(--hub-muted)", marginTop: 2 }}>
                                  last response: <AgentLink name={last.changedByName} />
                                </div>
                              ) : null;
                            })()}
                          </td>
                          <td className="ll-came">
                            {l.created ? (
                              <>
                                <b>{cameDay(l.created)}</b>
                                <span>{new Date(l.created).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
                              </>
                            ) : "—"}
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
                            {/* row actions: icons in one line, name on hover (user ask 2026-11-17) */}
                            <span className="ll-acts">
                              <Tooltip title="View details">
                                <button type="button" className="ll-act" aria-label={`View ${l.name || "lead"}`} onClick={() => setViewLead(l)}>
                                  <EyeOutlined />
                                </button>
                              </Tooltip>
                              <Tooltip title="Edit lead">
                                <button type="button" className="ll-act" aria-label={`Edit ${l.name || "lead"}`} onClick={() => setEditLead(l)}>
                                  <EditOutlined />
                                </button>
                              </Tooltip>
                              {canAssignOwner && (
                                <Tooltip title="Change owner">
                                  <button
                                    type="button"
                                    className="ll-act"
                                    aria-label={`Change owner of ${l.name || "lead"}`}
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
                                    <UserSwitchOutlined />
                                  </button>
                                </Tooltip>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {drill.count > 0 && (
              <SuPager
                page={drill.page}
                pages={drill.pages || 1}
                count={drill.count}
                size={pageSize}
                sizes={[10, 20, 50, 100, 200]}
                onSize={changePageSize}
                onPage={loadLeadList}
                noun="leads"
              />
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
                                    <Tooltip title="Edit lead">
                                      <button type="button" className="ll-act" aria-label={`Edit ${l.name || "lead"}`} onClick={() => setEditLead(l)}>
                                        <EditOutlined />
                                      </button>
                                    </Tooltip>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>

                      {cache && cache.pages > 1 && (
                        <SuPager page={cache.page} pages={cache.pages} count={cache.count} onPage={(p) => loadTeamLeads(t.team, p)} noun="leads" />
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
            <h3><span className="ie-step">1</span> Import a file</h3>
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
            <label><span className="ie-step">2</span> Split across teams</label>

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
            <h3><ExportOutlined /> Export leads</h3>
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
          <h3><InboxOutlined /> Leads with no team</h3>
          {unassignedCount > 0 && <span className="hub-badge hub-badge-yellow">{unassignedCount} waiting</span>}
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
          <SuPager page={unassignedPage} pages={unassignedPages} count={unassignedCount} onPage={loadUnassigned} noun="unassigned leads" />
        )}
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Recent import history</h3>
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
          <SuPager page={historyPage} pages={historyPages} count={historyCount} onPage={loadHistory} noun="imports" />
        )}
      </div>

      <LeadDetailModal lead={viewLead} onClose={() => setViewLead(null)} />
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
  const tabs = [
    { key: "all", label: "Lead Stages" },
    ...(isLeadAdmin ? [{ key: "io", label: "Import / Export" }] : []),
    ...(isTeamActivityAdmin ? [{ key: "team", label: "Team Activity" }] : []),
  ];

  useEffect(() => {
    if (!isLeadAdmin && tab === "io") setTab("all");
    if (!isTeamActivityAdmin && tab === "team") setTab("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeadAdmin]);

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <div className="section-head-crumb">Sales <span className="section-head-sep">›</span> <span className="section-head-cur">Leads</span></div>
          <h2>Leads</h2>
          <p>Find, assign and work every lead.</p>
        </div>
        {isLeadAdmin && tab !== "io" && (
          <button type="button" className="hub-btn" onClick={() => setTab("io")}>
            Import / Export
          </button>
        )}
      </div>

      <HubTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "all" && <AllLeads />}
      {isLeadAdmin && tab === "io" && <ImportExport />}
      {isTeamActivityAdmin && tab === "team" && <TeamActivity />}
    </div>
  );
}