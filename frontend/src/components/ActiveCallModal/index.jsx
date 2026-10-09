import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  PhoneOutlined,
  UserOutlined,
  MailOutlined,
  EnvironmentOutlined,
  DollarOutlined,
  BookOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  AudioMutedOutlined,
  PauseOutlined,
  CloseCircleOutlined,
  MinusOutlined,
  FullscreenOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  SendOutlined,
  TagOutlined,
  CustomerServiceOutlined,
} from "@ant-design/icons";
import {
  Input,
  Select,
  DatePicker,
  Tag,
  Tooltip,
  message,
} from "antd";
import dayjs from "dayjs";
import { request } from "@/request";
import { silentGet } from "@/request/silent";
import { getSocket } from "@/socket";
import { startPoll } from "@/utils/poll";
import { usePermission } from "@/context/permissionContext";
import { STAGE_NAMES, subStatusesFor, defaultSubStatus, stageConfig } from "@/config/leadStages";
import {
  PERSONAS,
  EDUCATION_BY_PERSONA,
  HIGHEST_QUALIFICATIONS,
  GENDERS,
  PROFILES,
  PAIN_POINTS,
  PAIN_POINT_BY_PERSONA,
  PREFERRED_LANGUAGES,
  COUNTRIES,
} from "@/config/leadPersonas";
import "./ActiveCallModal.css";

const { TextArea } = Input;

// Dispositions come from GET /api/calling/meta — services/calling/
// dispositions.js is the only source of truth for the codes the backend
// will accept, and for which pipeline stage each one maps onto (crmStage).
// Never hardcode the list here: an unknown code saves a disposition no
// report can group on. Until meta lands, render nothing in the grid.
const DISPOSITIONS_PLACEHOLDER = [];

// Quick-pick programs for the Requirements field
const POPULAR_COURSES = [
  "Full Stack AI & Python Development",
  "Data Science & Machine Learning",
  "Generative AI & LLM Engineering",
  "Cloud Computing & DevOps",
  "Placement Readiness & Mentorship",
  "Data Analytics & SQL",
];

// Quick budget choices
const BUDGET_OPTIONS = [
  "< ₹35,000",
  "₹35,000 - ₹50,000",
  "₹50,000 - ₹75,000",
  "₹75,000 - ₹1,00,000",
  "₹1,00,000+",
];

// The follow-up times agents actually pick, as one tap each. `at()` is a
// function, not a value, so "in 1 hour" means an hour from the tap rather
// than an hour from when this module was first imported.
const CALLBACK_PRESETS = [
  { label: "In 1 hour", at: () => dayjs().add(1, "hour").second(0).millisecond(0) },
  { label: "In 3 hours", at: () => dayjs().add(3, "hour").second(0).millisecond(0) },
  { label: "Tomorrow 11:00 AM", at: () => dayjs().add(1, "day").hour(11).minute(0).second(0).millisecond(0) },
  { label: "Tomorrow 5:00 PM", at: () => dayjs().add(1, "day").hour(17).minute(0).second(0).millisecond(0) },
  { label: "In 3 days", at: () => dayjs().add(3, "day").hour(11).minute(0).second(0).millisecond(0) },
];

// Quick start timeline
const TIMELINES = [
  "Immediate (This Week)",
  "Within 15 Days",
  "Next Month",
  "Exploring Options",
];

// Format duration seconds to MM:SS
function fmtDuration(totalSecs) {
  const s = Math.max(0, Math.floor(totalSecs || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// Gentle pleasant ring chime using Web Audio API
function playCallChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now); // C5
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(783.99, now + 0.15); // G5
    gain2.gain.setValueAtTime(0.25, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.6);
  } catch (e) {
    // Audio autoplay policy guard
  }
}

export default function ActiveCallModal() {
  // This component is mounted on every CRM page for every signed-in user,
  // but only someone who can actually take calls will ever have one — so
  // everything that costs a request stays behind their Calling access.
  const { canView } = usePermission();
  const hasCalling = canView("Calling");

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [callData, setCallData] = useState(null);
  const [leadData, setLeadData] = useState(null);
  const [crmLeadData, setCrmLeadData] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);

  // Form states
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [zipcode, setZipcode] = useState("");
  const [country, setCountry] = useState("India");
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [requirement, setRequirement] = useState("");
  const [budget, setBudget] = useState("");
  const [howSoonToStart, setHowSoonToStart] = useState("");
  const [disposition, setDisposition] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState("Connected Leads");
  const [subStatus, setSubStatus] = useState(defaultSubStatus("Connected Leads"));
  const [scheduledCallback, setScheduledCallback] = useState(null);
  const [meetingAt, setMeetingAt] = useState(null);
  const [futureFollowUpAt, setFutureFollowUpAt] = useState(null);

  // Persona detail (see config/leadPersonas.js)
  const [persona, setPersona] = useState("");
  const [age, setAge] = useState("");
  const [education, setEducation] = useState("");
  const [highestQualification, setHighestQualification] = useState("");
  const [gender, setGender] = useState("");
  const [profile, setProfile] = useState("");
  const [currentCtc, setCurrentCtc] = useState("");
  const [painPoint, setPainPoint] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("");

  // Disposition catalogue (code + label + category + crmStage) from the API.
  const [dispositions, setDispositions] = useState(DISPOSITIONS_PLACEHOLDER);

  // In-call audio control states
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);

  // Ref tracking whether form has been initialized for this call ID
  const activeCallIdRef = useRef(null);

  // Live timer interval
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // One-shot disposition catalogue. silentGet so a failed fetch never pops
  // an error toast over whatever page the user is actually on.
  useEffect(() => {
    if (!hasCalling) return undefined;
    let mounted = true;
    silentGet("calling/meta").then((r) => {
      if (mounted && r?.success && Array.isArray(r.result?.dispositions)) {
        setDispositions(r.result.dispositions);
      }
    });
    return () => {
      mounted = false;
    };
  }, [hasCalling]);

  // Populate form from call/lead/crmLead
  const initForm = useCallback((call, lead, crm) => {
    if (!call) return;
    activeCallIdRef.current = String(call._id);

    setContactName(call.contactName || lead?.name || crm?.name || "");
    setPhone(call.phone || lead?.phone || crm?.phone || "");
    setEmail(lead?.email || crm?.email || "");
    setCity(crm?.city || lead?.city || "");
    setStateName(crm?.state || "");
    setZipcode(crm?.zipcode || "");
    setCountry(crm?.country || "India");

    setRequirement(crm?.message || crm?.requirement || lead?.notes || "");
    setBudget(crm?.budgetRange || "");
    setHowSoonToStart(crm?.howSoonToStart || "");

    setDisposition(call.disposition || lead?.lastDisposition || "");
    setNotes(call.notes || "");
    const s = crm?.stage || "Connected Leads";
    setStage(s);
    setSubStatus(crm?.subStatus || defaultSubStatus(s));

    setScheduledCallback(crm?.callBackAt ? dayjs(crm.callBackAt) : null);
    setMeetingAt(crm?.meetingAt ? dayjs(crm.meetingAt) : null);
    setFutureFollowUpAt(crm?.futureFollowUpAt ? dayjs(crm.futureFollowUpAt) : null);

    setPersona(crm?.persona || "");
    setAge(crm?.age ? String(crm.age) : "");
    setEducation(crm?.education || "");
    setHighestQualification(crm?.highestQualification || "");
    setGender(crm?.gender || "");
    setProfile(crm?.profile || "");
    setCurrentCtc(crm?.currentCtc || "");
    setPainPoint(crm?.painPoint || "");
    setPreferredLanguage(crm?.preferredLanguage || "");

    setMuted(!!call.muted);
    setOnHold(!!call.onHold);
  }, []);

  // Pin Code -> City/State auto-fill (backend proxy, see
  // controllers/appControllers/core/utilsController/pincode.js) — fires
  // once the agent has typed a full 6-digit code, debounced so it doesn't
  // fire on every keystroke. The agent can still edit City/State by hand
  // afterwards; this only pre-fills them.
  useEffect(() => {
    const code = zipcode.trim();
    if (!/^\d{6}$/.test(code)) return undefined;
    let cancelled = false;
    setPincodeLoading(true);
    const t = setTimeout(async () => {
      const res = await silentGet(`utils/pincode/${code}`);
      if (!cancelled) {
        if (res?.success && res.result) {
          if (res.result.city) setCity(res.result.city);
          if (res.result.state) setStateName(res.result.state);
          if (res.result.country) setCountry(res.result.country);
        }
        setPincodeLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [zipcode]);

  // Picking a Persona resets Education (its options depend on the Persona)
  // and suggests a Pain Point — the agent can still override either.
  const onPersonaChange = (val) => {
    setPersona(val);
    setEducation("");
    setPainPoint(PAIN_POINT_BY_PERSONA[val] || "");
  };

  // Handler when a call connects or updates
  const handleCallConnected = useCallback(
    (payload) => {
      if (!payload || !payload.call) return;
      const { call, lead, crmLead } = payload;
      setCallData(call);
      setLeadData(lead || null);
      setCrmLeadData(crmLead || null);

      if (activeCallIdRef.current !== String(call._id)) {
        initForm(call, lead, crmLead);
        playCallChime();
        setIsOpen(true);
        setIsMinimized(false);
      }
    },
    [initForm]
  );

  // Handler when a call ends
  const handleCallEnded = useCallback((payload) => {
    if (!payload || !payload.call) return;
    setCallData((prev) => (prev ? { ...prev, ...payload.call, status: "completed" } : payload.call));
  }, []);

  // A call that was routed to THIS agent and never got picked up — see
  // backend's plivoAnswer.js leg=agent-hangup branch. Purely informational;
  // doesn't touch the in-call modal state since there was never a live call
  // here to begin with.
  const handleCallMissed = useCallback((payload) => {
    if (!payload || !payload.call) return;
    const who = payload.call.contactName || payload.lead?.name || payload.call.phone || "a customer";
    message.warning(`Missed call from ${who} — you didn't pick up in time.`, 6);
  }, []);

  // Handler when a call updates
  const handleCallUpdated = useCallback((payload) => {
    if (!payload || !payload.call) return;
    setCallData((prev) => (prev ? { ...prev, ...payload.call } : payload.call));
    if (payload.call.muted !== undefined) setMuted(!!payload.call.muted);
    if (payload.call.onHold !== undefined) setOnHold(!!payload.call.onHold);
  }, []);

  // Setup WebSocket listeners
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.on("call:connected", handleCallConnected);
    socket.on("call:ringing", handleCallConnected);
    socket.on("call:updated", handleCallUpdated);
    socket.on("call:ended", handleCallEnded);
    socket.on("call:missed", handleCallMissed);

    return () => {
      socket.off("call:connected", handleCallConnected);
      socket.off("call:ringing", handleCallConnected);
      socket.off("call:updated", handleCallUpdated);
      socket.off("call:ended", handleCallEnded);
      socket.off("call:missed", handleCallMissed);
    };
  }, [handleCallConnected, handleCallUpdated, handleCallEnded, handleCallMissed]);

  // Socket events are the primary trigger; this poll is the fallback for
  // the serverless deploy (backend/src/socket.js is a no-op there, so no
  // event ever arrives) and for a socket that dropped mid-call.
  //
  // It runs on every page for the whole shift, so it has to stay quiet and
  // cheap: silentGet (request.get pops an error toast on every single tick
  // the endpoint is unhappy) and startPoll (pauses while the tab is
  // hidden). Reading the open state through a ref keeps the interval from
  // being torn down and recreated each time the modal opens.
  const isOpenRef = useRef(false);
  isOpenRef.current = isOpen;

  useEffect(() => {
    if (!hasCalling) return undefined;

    const checkActive = async () => {
      const res = await silentGet("calling/agent/active");
      if (!res?.success || !res.result?.call) return;

      const { call, lead, crmLead } = res.result;
      setCallData(call);
      setLeadData(lead || null);
      setCrmLeadData(crmLead || null);

      if (
        !isOpenRef.current &&
        ["connected", "onhold", "ringing", "dialing"].includes(call.status)
      ) {
        initForm(call, lead, crmLead);
        setIsOpen(true);
        playCallChime();
      }
    };

    return startPoll(checkActive, 5000);
  }, [initForm, hasCalling]);

  // Save in-call log details
  const saveDetails = async ({ hangup = false, closeAfter = false } = {}) => {
    if (!callData) return;

    // A callback outcome without a time is a promise with no date on it —
    // it would never surface in the Callbacks queue and the auto-dialer
    // would have nothing to fire on. Ask here rather than guess.
    if (selectedDisposition?.category === "callback" && !scheduledCallback) {
      message.warning("Pick the callback date and time you promised the customer.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        contactName,
        email,
        phone,
        city,
        state: stateName,
        zipcode,
        country,
        requirement,
        budget,
        howSoonToStart,
        disposition,
        notes,
        stage,
        subStatus,
        scheduledCallback: scheduledCallback ? scheduledCallback.toISOString() : undefined,
        meetingAt: meetingAt ? meetingAt.toISOString() : undefined,
        futureFollowUpAt: futureFollowUpAt ? futureFollowUpAt.toISOString() : undefined,
        persona,
        age: age || undefined,
        highestQualification,
        gender,
        education,
        profile,
        currentCtc,
        painPoint,
        preferredLanguage,
        hangupCall: hangup,
      };

      const res = await request.post({
        entity: `calling/agent/call/${callData._id}/log-details`,
        jsonData: payload,
      });

      if (res?.success) {
        message.success(res.message || "Lead details saved successfully!");
        if (res.result?.call) setCallData(res.result.call);
        if (res.result?.lead) setLeadData(res.result.lead);
        if (res.result?.crmLead) setCrmLeadData(res.result.crmLead);

        if (closeAfter) {
          setIsOpen(false);
          setIsMinimized(false);
          activeCallIdRef.current = null;
        }
      } else {
        message.error(res?.message || "Failed to save details");
      }
    } catch (err) {
      message.error(err?.message || "An error occurred while saving");
    } finally {
      setSaving(false);
    }
  };

  // In-call audio actions
  const toggleMute = async () => {
    if (!callData) return;
    const next = !muted;
    setMuted(next);
    await request.post({
      entity: `calling/agent/call/${callData._id}/mute`,
      jsonData: { on: next },
    });
  };

  const toggleHold = async () => {
    if (!callData) return;
    const next = !onHold;
    setOnHold(next);
    await request.post({
      entity: `calling/agent/call/${callData._id}/hold`,
      jsonData: { on: next },
    });
  };

  const hangupCallOnly = async () => {
    if (!callData) return;
    await request.post({
      entity: `calling/agent/call/${callData._id}/hangup`,
      jsonData: { disposition: disposition || undefined, notes },
    });
    setCallData((prev) => (prev ? { ...prev, status: "completed" } : null));
    message.info("Call ended. Please review & submit lead details.");
  };

  const selectedDisposition = dispositions.find((d) => d.code === disposition) || null;

  // Compute live duration
  const isCallLive = callData && ["connected", "onhold", "ringing", "dialing"].includes(callData.status);
  const isConnected = callData && callData.status === "connected";
  const isOnHold = callData && callData.status === "onhold";
  const isEnded = !isCallLive;

  const talkSeconds = callData?.answeredAt
    ? isCallLive
      ? (now - new Date(callData.answeredAt).getTime()) / 1000
      : (new Date(callData.endedAt || now).getTime() - new Date(callData.answeredAt).getTime()) / 1000
    : 0;

  const timerText = callData
    ? callData.answeredAt
      ? fmtDuration(talkSeconds)
      : callData.status === "ringing"
      ? "Ringing…"
      : "Dialing…"
    : "00:00";

  // If closed or no active call, return null
  if (!isOpen && !isCallLive) return null;

  // Minimized floating pill widget
  if (isMinimized) {
    return (
      <div
        className="incall-minimized-pill"
        onClick={() => setIsMinimized(false)}
        title="Click to expand In-Call modal"
      >
        <span
          className={`incall-pulse-dot ${
            isConnected ? "pulse-green" : isOnHold ? "pulse-amber" : "pulse-red"
          }`}
          style={{ background: isConnected ? "#10b981" : isOnHold ? "#f59e0b" : "#ef4444" }}
        />
        <PhoneOutlined style={{ fontSize: 16, color: "#34d399" }} />
        <span className="incall-pill-name">{contactName || "Active Call"}</span>
        <span className="incall-pill-timer">{timerText}</span>
        <Tooltip title="Expand Call Window">
          <FullscreenOutlined style={{ fontSize: 14, color: "#94a3b8" }} />
        </Tooltip>
      </div>
    );
  }

  // Full Screen In-Call Modal
  return (
    <div className="incall-overlay">
      <div className="incall-modal">
        {/* Header Bar */}
        <div className="incall-header">
          <div className="incall-header-left">
            <div className="incall-avatar">
              {(contactName || "C").charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="incall-meta-title">
                {contactName || "Caller"}
                <span
                  className={`incall-status-badge ${
                    isConnected ? "connected" : isOnHold ? "onhold" : isEnded ? "ended" : "ringing"
                  }`}
                >
                  <span className="incall-pulse-dot" />
                  {isConnected
                    ? "Live Call Connected"
                    : isOnHold
                    ? "Call On Hold"
                    : isEnded
                    ? "Call Ended"
                    : "Connecting…"}
                </span>
                {callData?.direction && (
                  <Tag color="cyan" style={{ borderRadius: 6, fontWeight: 600 }}>
                    {callData.direction}
                  </Tag>
                )}
              </h2>
              <div className="incall-meta-sub">
                <span>
                  <PhoneOutlined /> {phone || "No phone"}
                </span>
                {phone && (
                  <Tooltip title="Copy number">
                    <CopyOutlined
                      style={{ cursor: "pointer", color: "#38bdf8" }}
                      onClick={() => {
                        navigator.clipboard.writeText(phone);
                        message.success("Phone copied!");
                      }}
                    />
                  </Tooltip>
                )}
                {email && (
                  <span>
                    • <MailOutlined /> {email}
                  </span>
                )}
                {city && (
                  <span>
                    • <EnvironmentOutlined /> {city}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="incall-header-actions">
            {/* Live Call Duration Clock */}
            <div className="incall-timer-badge">
              <ClockCircleOutlined style={{ fontSize: 16 }} />
              {timerText}
            </div>

            {/* Minimize button */}
            <Tooltip title="Minimize to floating pill">
              <button
                type="button"
                className="incall-btn-icon"
                onClick={() => setIsMinimized(true)}
              >
                <MinusOutlined />
              </button>
            </Tooltip>

            {/* Dismiss / Close button */}
            <Tooltip title="Close Window">
              <button
                type="button"
                className="incall-btn-icon"
                onClick={() => {
                  if (isCallLive) {
                    setIsMinimized(true);
                  } else {
                    setIsOpen(false);
                  }
                }}
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Modal Body Split */}
        <div className="incall-body">
          {/* Left Panel: Customer Profile & Call Controls */}
          <div className="incall-left-panel">
            {/* Quick In-Call Audio Controls */}
            {isCallLive && (
              <div className="incall-controls-bar">
                <button
                  type="button"
                  className={`incall-ctrl-btn ${muted ? "active" : ""}`}
                  onClick={toggleMute}
                  title="Mute / Unmute"
                >
                  <AudioMutedOutlined /> {muted ? "Unmute" : "Mute"}
                </button>
                <button
                  type="button"
                  className={`incall-ctrl-btn ${onHold ? "active" : ""}`}
                  onClick={toggleHold}
                  title="Hold / Resume"
                >
                  <PauseOutlined /> {onHold ? "Resume" : "Hold"}
                </button>
                <button
                  type="button"
                  className="incall-ctrl-btn hangup"
                  onClick={hangupCallOnly}
                  title="End Call Now"
                >
                  <CloseCircleOutlined /> Hang Up
                </button>
              </div>
            )}

            {/* Customer Contact Card */}
            <div className="incall-card">
              <div className="incall-card-title">
                <span>
                  <UserOutlined style={{ color: "#3b82f6" }} /> Customer Details
                </span>
                <span className="incall-badge-tag">Editable</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label className="incall-field-label">
                    Full Name
                  </label>
                  <Input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Enter customer name"
                    prefix={<UserOutlined style={{ color: "#94a3b8" }} />}
                  />
                </div>

                <div>
                  <label className="incall-field-label">
                    Phone Number
                  </label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone number"
                    prefix={<PhoneOutlined style={{ color: "#94a3b8" }} />}
                  />
                </div>

                <div>
                  <label className="incall-field-label">
                    Email Address
                  </label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Customer email"
                    prefix={<MailOutlined style={{ color: "#94a3b8" }} />}
                  />
                </div>

                <div>
                  <label className="incall-field-label">
                    City
                  </label>
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City"
                    prefix={<EnvironmentOutlined style={{ color: "#94a3b8" }} />}
                  />
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="incall-field-label">
                      Pin Code {pincodeLoading && <span style={{ color: "#94a3b8" }}>(looking up…)</span>}
                    </label>
                    <Input
                      value={zipcode}
                      onChange={(e) => setZipcode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6-digit pin code"
                      maxLength={6}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="incall-field-label">State</label>
                    <Input value={stateName} onChange={(e) => setStateName(e.target.value)} placeholder="Auto-filled from pin code" />
                  </div>
                </div>

                <div>
                  <label className="incall-field-label">Country</label>
                  <Select
                    popupClassName="incall-popup"
                    style={{ width: "100%" }}
                    value={country || undefined}
                    onChange={(v) => setCountry(v)}
                    options={COUNTRIES.map((c) => ({ label: c, value: c }))}
                  />
                </div>
              </div>
            </div>

            {/* Persona Details */}
            <div className="incall-card">
              <div className="incall-card-title">
                <span>
                  <UserOutlined style={{ color: "#8b5cf6" }} /> Persona Details
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label className="incall-field-label">Persona</label>
                  <Select
                    popupClassName="incall-popup"
                    style={{ width: "100%" }}
                    value={persona || undefined}
                    onChange={onPersonaChange}
                    placeholder="Select persona"
                    allowClear
                    options={PERSONAS.map((p) => ({ label: p, value: p }))}
                  />
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="incall-field-label">Age</label>
                    <Input
                      value={age}
                      onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
                      placeholder="Age"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="incall-field-label">Gender</label>
                    <Select
                      popupClassName="incall-popup"
                      style={{ width: "100%" }}
                      value={gender || undefined}
                      onChange={(v) => setGender(v)}
                      placeholder="Select"
                      allowClear
                      options={GENDERS.map((g) => ({ label: g, value: g }))}
                    />
                  </div>
                </div>

                <div>
                  <label className="incall-field-label">Highest Qualification</label>
                  <Select
                    popupClassName="incall-popup"
                    style={{ width: "100%" }}
                    value={highestQualification || undefined}
                    onChange={(v) => setHighestQualification(v)}
                    placeholder="Select qualification"
                    allowClear
                    options={HIGHEST_QUALIFICATIONS.map((q) => ({ label: q, value: q }))}
                  />
                </div>

                {(EDUCATION_BY_PERSONA[persona] || []).length > 0 && (
                  <div>
                    <label className="incall-field-label">Education</label>
                    <Select
                      popupClassName="incall-popup"
                      style={{ width: "100%" }}
                      value={education || undefined}
                      onChange={(v) => setEducation(v)}
                      placeholder="Select education background"
                      allowClear
                      options={EDUCATION_BY_PERSONA[persona].map((e) => ({ label: e, value: e }))}
                    />
                  </div>
                )}

                {persona === "Working Professional" && (
                  <div>
                    <label className="incall-field-label">Profile</label>
                    <Select
                      popupClassName="incall-popup"
                      style={{ width: "100%" }}
                      value={profile || undefined}
                      onChange={(v) => setProfile(v)}
                      placeholder="Select profile"
                      allowClear
                      options={PROFILES.map((p) => ({ label: p, value: p }))}
                    />
                  </div>
                )}

                <div>
                  <label className="incall-field-label">Current CTC / Monthly Income</label>
                  <Input
                    value={currentCtc}
                    onChange={(e) => setCurrentCtc(e.target.value)}
                    placeholder="e.g. 4.5 LPA or ₹25,000/month"
                  />
                </div>

                <div>
                  <label className="incall-field-label">Pain Point / Need</label>
                  <Select
                    popupClassName="incall-popup"
                    style={{ width: "100%" }}
                    value={painPoint || undefined}
                    onChange={(v) => setPainPoint(v)}
                    placeholder="Select pain point"
                    allowClear
                    options={PAIN_POINTS.map((p) => ({ label: p, value: p }))}
                  />
                </div>

                <div>
                  <label className="incall-field-label">Preferred Language</label>
                  <Select
                    popupClassName="incall-popup"
                    style={{ width: "100%" }}
                    value={preferredLanguage || undefined}
                    onChange={(v) => setPreferredLanguage(v)}
                    placeholder="Select language"
                    allowClear
                    options={PREFERRED_LANGUAGES.map((l) => ({ label: l, value: l }))}
                  />
                </div>
              </div>
            </div>

            {/* Lead Status & Source Overview */}
            <div className="incall-card">
              <div className="incall-card-title">
                <span>
                  <TagOutlined style={{ color: "#8b5cf6" }} /> Pipeline Stage
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label className="incall-field-label">Move Lead Stage</label>
                  <Select
                    popupClassName="incall-popup"
                    style={{ width: "100%" }}
                    value={stage}
                    onChange={(val) => {
                      setStage(val);
                      setSubStatus(defaultSubStatus(val));
                    }}
                    options={STAGE_NAMES.map((s) => ({ label: s, value: s }))}
                  />
                </div>

                <div>
                  <label className="incall-field-label">Sub-status</label>
                  <Select
                    popupClassName="incall-popup"
                    style={{ width: "100%" }}
                    value={subStatus}
                    onChange={(val) => setSubStatus(val)}
                    options={subStatusesFor(stage).map((s) => ({ label: s, value: s }))}
                  />
                </div>

                {/* Demo Booking — "Demo Booked" asks for a date/time */}
                {(stageConfig(stage)?.meetingSubStatuses || []).includes(subStatus) && (
                  <div>
                    <label className="incall-field-label">
                      <CalendarOutlined /> Demo Date & Time
                    </label>
                    <DatePicker
                      showTime={{ format: "hh:mm A", use12Hours: true, minuteStep: 5 }}
                      popupClassName="incall-popup"
                      style={{ width: "100%" }}
                      value={meetingAt}
                      onChange={(date) => setMeetingAt(date)}
                      format="DD MMM YYYY, hh:mm A"
                      placeholder="Pick demo date and time"
                    />
                  </div>
                )}

                {/* Future Prospect — expected follow-up date */}
                {stageConfig(stage)?.capture === "futureFollowUp" && (
                  <div>
                    <label className="incall-field-label">
                      <CalendarOutlined /> Expected Follow-up Date
                    </label>
                    <DatePicker
                      popupClassName="incall-popup"
                      style={{ width: "100%" }}
                      value={futureFollowUpAt}
                      onChange={(date) => setFutureFollowUpAt(date)}
                      format="DD MMM YYYY"
                      placeholder="Pick expected date"
                    />
                  </div>
                )}

                {crmLeadData?.source && (
                  <div className="incall-meta-line">
                    <strong>Source:</strong> {crmLeadData.source}
                  </div>
                )}
                {callData?.campaign && (
                  <div className="incall-meta-line">
                    <strong>Campaign:</strong> Active Calling Campaign
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: In-Call Form (Requirements, Budget, Disposition, Notes) */}
          <div className="incall-right-panel">
            {/* 1. "Kya Chahiye" / Requirement Section */}
            <div className="incall-card">
              <div className="incall-card-title">
                <span>
                  <BookOutlined style={{ color: "#3b82f6" }} /> Requirements / Interest
                </span>
                <span className="incall-badge-tag">Program & Goals</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label className="incall-field-label">
                    Interested Course / Program
                  </label>
                  <Input
                    value={requirement}
                    onChange={(e) => setRequirement(e.target.value)}
                    placeholder="e.g. Full Stack AI, Data Science, Python, Placement Support..."
                  />
                  {/* Quick Select Chips */}
                  <div className="incall-quick-tags">
                    {POPULAR_COURSES.map((c) => (
                      <span
                        key={c}
                        className={`incall-tag-chip ${requirement === c ? "active" : ""}`}
                        onClick={() => setRequirement(c)}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <div style={{ flex: 1 }}>
                    <label className="incall-field-label">
                      How Soon To Start?
                    </label>
                    <Select
                      popupClassName="incall-popup"
                      style={{ width: "100%" }}
                      value={howSoonToStart || undefined}
                      onChange={(v) => setHowSoonToStart(v)}
                      placeholder="Select timeline"
                      options={TIMELINES.map((t) => ({ label: t, value: t }))}
                      allowClear
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Budget & Financials */}
            <div className="incall-card">
              <div className="incall-card-title">
                <span>
                  <DollarOutlined style={{ color: "#10b981" }} /> Budget & Commercials
                </span>
                <span className="incall-badge-tag">Pricing</span>
              </div>

              <div>
                <label className="incall-field-label">
                  Expected Budget / Fee Discussed
                </label>
                <Input
                  prefix="₹"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="e.g. 45,000 or select from tags below"
                />
                <div className="incall-quick-tags">
                  {BUDGET_OPTIONS.map((b) => (
                    <span
                      key={b}
                      className={`incall-tag-chip ${budget === b ? "active" : ""}`}
                      onClick={() => setBudget(b)}
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Call Outcome / Disposition */}
            <div className="incall-card">
              <div className="incall-card-title">
                <span>
                  <CustomerServiceOutlined style={{ color: "#f59e0b" }} /> Call Outcome /
                  Disposition
                </span>
                <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>* Required</span>
              </div>

              <div className="incall-disp-grid">
                {dispositions.map((d) => (
                  <div
                    key={d.code}
                    className={`incall-disp-chip ${disposition === d.code ? "selected" : ""}`}
                    onClick={() => {
                      setDisposition(d.code);
                      // Pre-select the stage this outcome maps onto — the
                      // agent can still override it above.
                      if (d.crmStage) {
                        setStage(d.crmStage.stage);
                        setSubStatus(d.crmStage.subStatus);
                      }
                    }}
                  >
                    {d.label}
                  </div>
                ))}
              </div>

              {/* Callback scheduler — only the outcomes that imply a
                  follow-up (dispositions.js marks those `callback`). */}
              {selectedDisposition?.category === "callback" && (
                <div className="incall-callback-box">
                  <label className="incall-callback-label">
                    <CalendarOutlined /> Schedule Follow-up / Callback Date & Time:
                  </label>
                  <DatePicker
                    showTime={{ format: "hh:mm A", use12Hours: true, minuteStep: 5 }}
                    showNow
                    popupClassName="incall-popup"
                    style={{ width: "100%" }}
                    value={scheduledCallback}
                    onChange={(date) => setScheduledCallback(date)}
                    // A callback in the past is always a mis-click — it would
                    // be queued already overdue.
                    disabledDate={(d) => d && d < dayjs().startOf("day")}
                    placeholder="Pick callback date and time"
                    format="DD MMM YYYY, hh:mm A"
                  />

                  {/* An agent on a live call should not have to drive a
                      calendar for the three answers they actually give. */}
                  <div className="incall-quick-tags" style={{ marginTop: 8 }}>
                    {CALLBACK_PRESETS.map((p) => (
                      <span
                        key={p.label}
                        className={`incall-tag-chip ${
                          scheduledCallback && scheduledCallback.isSame(p.at(), "minute") ? "active" : ""
                        }`}
                        onClick={() => setScheduledCallback(p.at())}
                      >
                        {p.label}
                      </span>
                    ))}
                  </div>

                  {scheduledCallback && (
                    <div className="incall-callback-echo">
                      Callback set for <strong>{scheduledCallback.format("dddd, DD MMM YYYY")}</strong> at{" "}
                      <strong>{scheduledCallback.format("hh:mm A")}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 4. Agent Response / Conversation Notes */}
            <div className="incall-card">
              <div className="incall-card-title">
                <span>
                  <SendOutlined style={{ color: "#6366f1" }} /> Agent Response & Conversation Notes
                </span>
              </div>

              <TextArea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Write call discussion summary: questions asked, background discussed, key objections or commitments made..."
                style={{ borderRadius: 10 }}
              />
            </div>
          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="incall-footer">
          <div className="incall-footer-left">
            <span>
              <strong>Call Status:</strong>{" "}
              {isConnected
                ? "Live & Connected"
                : isOnHold
                ? "On Hold"
                : isEnded
                ? "Call Ended"
                : "Connecting"}
            </span>
            <span>•</span>
            <span>Duration: {timerText}</span>
          </div>

          <div className="incall-footer-right">
            {/* If call is live, offer Save Without Hangup */}
            {isCallLive && (
              <button
                type="button"
                className="incall-btn-secondary"
                disabled={saving}
                onClick={() => saveDetails({ hangup: false, closeAfter: false })}
              >
                Save Details (Keep Call Live)
              </button>
            )}

            {/* If call is live, prominent Hangup & Save */}
            {isCallLive && (
              <button
                type="button"
                className="incall-btn-submit"
                style={{
                  background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                  boxShadow: "0 4px 12px rgba(239, 68, 68, 0.35)",
                }}
                disabled={saving}
                onClick={() => saveDetails({ hangup: true, closeAfter: false })}
              >
                <CloseCircleOutlined /> End Call & Save
              </button>
            )}

            {/* When call is finished: Submit & Close */}
            {isEnded && (
              <button
                type="button"
                className="incall-btn-submit"
                disabled={saving}
                onClick={() => saveDetails({ hangup: false, closeAfter: true })}
              >
                <CheckCircleOutlined /> Submit Outcome & Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

