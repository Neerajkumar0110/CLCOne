import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { FULL_ACCESS_ROLES } from "@/config/permissionModules";
import { openTel, fmtDateTime, usePoll } from "./shared";
import { STAGE_NAMES } from "@/config/leadStages";
import "./Dialer.css";

// Same management tier used everywhere else in the app (see salesScope.js's
// FULL_ACCESS_ROLES + 'Team Manager') — everyone else never even sees the
// "Your number" box below, since it's fully automatic for them now (pulled
// from Admin.phone) and showing it just added confusing, non-actionable UI.
const CAN_SEE_AGENT_NUMBER_ROLES = [...FULL_ACCESS_ROLES, "Team Manager"];

// Calling › Dialer — the round keypad + contacts + recent-calls screen from
// the old Sales "Live Dialer" tab, restored as its own tab here (so it's
// obvious where to actually place a call from) and pointed at the Calling
// module's own data: `lead/my-contacts` for contacts, `calling/history`
// for recent calls, `calling/manual/dial` / `calling/manual/end` to place
// and log the call — the same endpoints Agent Screen's active-call view
// polls, so a call started here shows up there too.

const LEAD_STATUS_FILTERS = ["All", ...STAGE_NAMES];

function formatSeconds(total) {
  const m = Math.floor((total || 0) / 60);
  const s = Math.floor((total || 0) % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function PhoneIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 011.12 4.18 2 2 0 013.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L7.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function MicIcon({ muted }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {muted ? (
        <>
          <path d="M1 1l22 22" />
          <path d="M9 9v3a3 3 0 005.12 2.12" />
          <path d="M15 9V5a3 3 0 00-5.83-1" />
          <path d="M17 16.95A7 7 0 015 12" />
          <path d="M12 19v3" />
        </>
      ) : (
        <>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0014 0" />
          <path d="M12 19v3" />
        </>
      )}
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 010 7" />
      <path d="M18.5 5.5a9 9 0 010 13" />
    </svg>
  );
}

function CallIcon({ type }) {
  return (
    <span className={`call-history-icon ${type}`}>
      <PhoneIcon size={14} />
    </span>
  );
}

// Characters a phone can dial. A leading "+" is kept (international), any
// other "+" is not; spaces, dashes and brackets from a pasted number go.
function sanitizeDialInput(raw) {
  const s = String(raw || "");
  const lead = s.trimStart().startsWith("+") ? "+" : "";
  return (lead + s.replace(/[^\d*#]/g, "")).slice(0, 20);
}

const DIAL_KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

export default function Dialer() {
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsPage, setContactsPage] = useState(1);
  const [contactsPages, setContactsPages] = useState(1);
  const [contactsCount, setContactsCount] = useState(0);
  const [recentCalls, setRecentCalls] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentPage, setRecentPage] = useState(1);
  const [recentPages, setRecentPages] = useState(1);

  const [selectedContact, setSelectedContact] = useState(null);
  const [isCalling, setIsCalling] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("All");
  const [dialNumber, setDialNumber] = useState("");
  const dialInputRef = useRef(null);
  // Real elapsed talk time — only ever computed from `callAnsweredAt`, a
  // timestamp the backend sets (see manualDial.js / cloudWebhook.js), never
  // from a client-side counter started the instant dial() was called. A
  // cloud (Tata) call rings the customer first; the timer must stay at 0:00
  // through that ringing phase and only start once they actually pick up.
  const [callStatus, setCallStatus] = useState(null); // 'dialing' | 'ringing' | 'connected' | 'onhold' | null
  const [callAnsweredAt, setCallAnsweredAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const [prov, setProv] = useState(null);
  useEffect(() => {
    request.get({ entity: "calling/status" }).then((r) => r?.success && setProv(r.result));
  }, []);
  const isCloud = prov?.provider === "cloud";

  // Real calling: the provider bridges to this number once the customer
  // answers. It's read-only here and always pulled from the phone every
  // admin already has on file since account creation (Admin.phone — see
  // createUserController/create.js, required for every role/department) —
  // CloudCallProvider.placeCall no longer accepts a per-call override, it
  // always rings whatever's on the agent's own profile (plivoAnswer.js
  // looks it up fresh from Admin.phone when bridging), so a manual-entry
  // box here would just be misleading. Update it from Settings/HRMS instead.
  const currentAdmin = useSelector(selectCurrentAdmin);
  const canSeeAgentNumber = CAN_SEE_AGENT_NUMBER_ROLES.includes(currentAdmin?.role);
  const [agentPhone, setAgentPhone] = useState("");
  useEffect(() => {
    if (!currentAdmin?._id) return;
    request.read({ entity: "admin", id: currentAdmin._id }).then((r) => {
      if (r?.success) setAgentPhone(r.result?.phone || "");
    });
  }, [currentAdmin?._id]);
  const [activeCallId, setActiveCallId] = useState(null);
  const [callMsg, setCallMsg] = useState("");
  const [dialing, setDialing] = useState(false);

  const loadRecentCalls = async (targetPage = 1) => {
    setRecentLoading(true);
    const res = await request.get({ entity: `calling/history?items=5&page=${targetPage}` });
    setRecentCalls(res?.success ? res.result : []);
    setRecentPages(res?.pagination?.pages || 1);
    setRecentPage(targetPage);
    setRecentLoading(false);
  };

  // Contacts = leads assigned straight to me (works with no team), plus my
  // equal share of my team's pooled (team-assigned, no individual owner)
  // leads — the backend splits that pool evenly across the team so a
  // team-assigned lead shows to exactly one member, not everyone.
  const loadContacts = async (targetPage = 1) => {
    setContactsLoading(true);
    const res = await request.get({ entity: `lead/my-contacts?page=${targetPage}&items=5` });
    setContacts(res?.success ? res.result : []);
    setContactsPages(res?.pagination?.pages || 1);
    setContactsCount(res?.pagination?.count || 0);
    setContactsPage(targetPage);
    setContactsLoading(false);
  };

  useEffect(() => {
    loadContacts(1);
  }, []);

  useEffect(() => {
    loadRecentCalls();
  }, []);

  // Ticks `now` every second so the elapsed-time display below stays live
  // once the call is actually answered — the display itself is always
  // `now - callAnsweredAt`, never a counter that started at dial time.
  useEffect(() => {
    if (!isCalling) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isCalling]);

  // Poll the real call state (same endpoint Agent Screen uses) while a call
  // is active, so "Ringing the customer…" flips to "Connected" — and the
  // timer starts — the instant the provider's webhook reports the customer
  // actually picked up, not the instant we asked the provider to dial.
  usePoll(
    async () => {
      if (!isCalling || !activeCallId) return;
      const r = await request.get({ entity: "calling/agent/active" });
      const call = r?.success ? r.result?.call : null;
      if (call && String(call._id) === String(activeCallId)) {
        setCallStatus(call.status);
        setCallAnsweredAt(call.answeredAt || null);
      } else if (!call) {
        // Provider/webhook already ended it (no-answer, busy, hangup from
        // the other side) — reflect that instead of leaving a dead "active"
        // screen up with a timer that can never start.
        setIsCalling(false);
        setCallMsg("");
        loadRecentCalls();
      }
    },
    1000,
    [isCalling, activeCallId]
  );

  const callSeconds = callAnsweredAt ? (now - new Date(callAnsweredAt).getTime()) / 1000 : 0;
  const isRinging = isCalling && !callAnsweredAt;

  const filteredContacts = contacts.filter(
    (contact) =>
      (contact.name.toLowerCase().includes(search.toLowerCase()) || (contact.phone || "").includes(search)) &&
      (tagFilter === "All" || contact.stage === tagFilter)
  );

  const startCall = async (contact) => {
    if (dialing || isCalling) return;
    const num = String(contact.phone || "").replace(/[^\d+]/g, "");
    if (num.replace(/\D/g, "").length < 8) {
      window.alert("Enter a valid phone number.");
      return;
    }
    const initials = contact.initials || contact.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
    setSelectedContact({ ...contact, initials });
    setDialing(true);
    setCallMsg("");

    const r = await request.post({
      entity: "calling/manual/dial",
      jsonData: { phone: num, contactName: contact.name, agentPhone: isCloud ? agentPhone : undefined },
    });
    setDialing(false);

    if (r?.success) {
      setActiveCallId(r.result?.record?._id || null);
      setCallStatus(r.result?.record?.status || null);
      // A device/manual call is answeredAt=now from the backend the instant
      // it's created (the CRM can't observe a phone's native dialer ringing)
      // — a cloud call starts with answeredAt unset and the poll below picks
      // up the real value once the provider's webhook reports it answered.
      setCallAnsweredAt(r.result?.record?.answeredAt || null);
      setIsCalling(true);
      setIsMuted(false);
      setIsSpeaker(false);
      if (r.result?.tel) openTel(r.result.tel);
      setCallMsg(r.message || "Calling the customer — you'll be connected once they pick up.");
    } else {
      setSelectedContact(null);
      window.alert(r?.message || "Could not start the call.");
    }
  };

  const endCall = async () => {
    const wasAnswered = !!callAnsweredAt;
    const contact = selectedContact;
    setIsCalling(false);
    setCallMsg("");
    setCallStatus(null);
    setCallAnsweredAt(null);
    if (activeCallId) {
      await request.post({
        entity: `calling/manual/end/${activeCallId}`,
        jsonData: { talkSeconds: callSeconds },
      });
      setActiveCallId(null);
    }
    if (contact?._id) {
      // Real-time: drop this contact out of the working queue the instant
      // the call ends — no waiting on the lead-update/reload round trip
      // below — so a just-called number never sits there looking callable
      // again. It's still reachable via "Filter by stage" / Recent Calls.
      setContacts((prev) => prev.filter((c) => c._id !== contact._id));
      setContactsCount((prev) => Math.max(0, prev - 1));

      // Auto-classify the lead's stage from this call's outcome — connected
      // = "Connected Leads", nobody picked up = "No Response" — so the rep
      // isn't also manually flipping the stage after every single call.
      // Only touches a lead still in "New Lead"/"No Response" (not yet
      // meaningfully engaged): one already qualified further (Demo Booking,
      // Interested Leads, ...) keeps its real stage instead of being
      // silently reset by a routine follow-up call.
      const stage = contact.stage || "New Lead";
      if (stage === "New Lead" || stage === "No Response") {
        const next = wasAnswered
          ? { stage: "Connected Leads", subStatus: "1st Discussion Done - Qualified" }
          : { stage: "No Response", subStatus: "Not Reachable" };
        request.update({ entity: "lead", id: contact._id, jsonData: next, notify: false }).catch(() => {});
      }
    }
    loadRecentCalls();
  };

  // Typed or pasted input gets the same treatment a keypad tap would: keep
  // only what a phone can actually dial, so a number copied as
  // "+91 98765-43210" or "(022) 1234 5678" lands clean instead of being
  // rejected later by the backend's validator.
  const dialKey = (key) => {
    setDialNumber((prev) => sanitizeDialInput(prev + key));
    dialInputRef.current?.focus();
  };
  const clearDial = () => {
    setDialNumber((prev) => prev.slice(0, -1));
    dialInputRef.current?.focus();
  };
  const callDialNumber = () => {
    if (!dialNumber) return;
    startCall({ name: "Unknown Number", phone: dialNumber, initials: "UN", color: "#2563EB" });
    setDialNumber("");
  };

  return (
    <div className="calls-layout">
      {/* LEFT */}
      <div className="calls-left">
        <div className="call-search">
          <span>⌕</span>
          <input
            type="text"
            placeholder="Search contact or phone number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="call-section">
          <div className="section-title contacts-title">
            <div className="contacts-heading">
              <span>Contacts</span>
              <small>{contactsCount}</small>
            </div>
          </div>

          <div className="hub-form-row" style={{ marginBottom: 14 }}>
            <label>Filter by stage</label>
            <select className="hub-select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              {LEAD_STATUS_FILTERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="contacts-list">
            {contactsLoading ? (
              <div className="hub-empty">Loading your contacts…</div>
            ) : filteredContacts.length === 0 ? (
              <div className="hub-empty">No contacts match this filter yet.</div>
            ) : (
              filteredContacts.map((contact) => {
                const initials = contact.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div
                    className={`contact-card ${selectedContact?._id === contact._id ? "selected" : ""}`}
                    key={contact._id}
                    onClick={() => setSelectedContact(contact)}
                  >
                    <div className="contact-avatar" style={{ background: contact.color || "#2563EB" }}>
                      {initials}
                    </div>
                    <div className="contact-info">
                      <strong>{contact.name}</strong>
                      <span>{contact.phone}</span>
                    </div>
                    <button className="small-call-btn" onClick={(e) => { e.stopPropagation(); startCall(contact); }}>
                      <PhoneIcon size={16} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {!contactsLoading && contactsPages > 1 && (
            <div className="hub-row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 11.5, color: "var(--hub-muted)" }}>
                Page {contactsPage} of {contactsPages}
              </span>
              <div className="hub-row" style={{ gap: 6 }}>
                <button type="button" className="hub-btn" style={{ padding: "4px 10px", fontSize: 12 }} disabled={contactsPage <= 1} onClick={() => loadContacts(contactsPage - 1)}>
                  ‹ Prev
                </button>
                <button type="button" className="hub-btn" style={{ padding: "4px 10px", fontSize: 12 }} disabled={contactsPage >= contactsPages} onClick={() => loadContacts(contactsPage + 1)}>
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="call-section recent-section">
          <div className="section-title">
            <span>Recent Calls</span>
            <small>My calls</small>
          </div>

          {recentLoading && <div className="hub-empty">Loading recent calls…</div>}
          {!recentLoading && recentCalls.length === 0 && (
            <div className="hub-empty">You haven't placed any calls yet.</div>
          )}

          {!recentLoading &&
            recentCalls.map((c) => (
              <div className="recent-call" key={c._id}>
                <CallIcon type={["no-answer", "failed", "busy"].includes(c.status) ? "missed" : "outgoing"} />
                <div className="recent-info">
                  <strong>{c.contactName}</strong>
                  <span>{c.phone}</span>
                </div>
                <div className="recent-meta">
                  <span>{formatSeconds(c.duration)}</span>
                  <small>{fmtDateTime(c.endedAt || c.created)}</small>
                </div>
                <button
                  className="recent-call-btn"
                  onClick={() => startCall({ name: c.contactName, phone: c.phone, color: "#2563EB" })}
                >
                  <PhoneIcon size={15} />
                </button>
              </div>
            ))}

          {!recentLoading && recentCalls.length > 0 && recentPages > 1 && (
            <div className="hub-row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 11.5, color: "var(--hub-muted)" }}>
                Page {recentPage} of {recentPages}
              </span>
              <div className="hub-row" style={{ gap: 6 }}>
                <button type="button" className="hub-btn" style={{ padding: "4px 10px", fontSize: 12 }} disabled={recentPage <= 1} onClick={() => loadRecentCalls(recentPage - 1)}>
                  ‹ Prev
                </button>
                <button type="button" className="hub-btn" style={{ padding: "4px 10px", fontSize: 12 }} disabled={recentPage >= recentPages} onClick={() => loadRecentCalls(recentPage + 1)}>
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT DIALER */}
      <div className="dialer-panel">
        {!isCalling ? (
          <>
            <div className="dialer-header">
              <div>
                <h2>Dialer</h2>
                <span>Make a new call</span>
              </div>
            </div>

            {isCloud && canSeeAgentNumber && (
              <div style={{ padding: "0 16px", marginBottom: 8, fontSize: 12.5 }}>
                <span style={{ color: "var(--hub-muted)" }}>Rings this agent at: </span>
                <strong>{agentPhone || "No phone number on file — add one in Settings"}</strong>
              </div>
            )}

            {/* A real input, not a display div — an agent with a number on
                screen or in the clipboard types or pastes it far faster than
                they can tap twelve round buttons, and this also gives mobile
                a numeric keyboard. The keypad below writes into the same
                state, so both ways stay in sync. */}
            <div className="dial-display">
              <input
                ref={dialInputRef}
                className="dial-number"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={dialNumber}
                placeholder="Enter phone number"
                onChange={(e) => setDialNumber(sanitizeDialInput(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && dialNumber && !dialing) callDialNumber();
                }}
              />
            </div>

            <div className="dial-pad">
              {DIAL_KEYS.map(([number, letters]) => (
                <button key={number} onClick={() => dialKey(number)}>
                  <strong>{number}</strong>
                  <small>{letters}</small>
                </button>
              ))}
            </div>

            <div className="dial-actions">
              <button className="dial-delete" onClick={clearDial} disabled={!dialNumber}>⌫</button>
              <button className="dial-call" onClick={callDialNumber} disabled={!dialNumber || dialing}>
                <PhoneIcon size={23} />
              </button>
              <span />
            </div>
          </>
        ) : (
          <div className="active-call">
            <div className="active-call-status">
              <span className="pulse" />
              {isRinging ? "Ringing the customer…" : callStatus === "onhold" ? "On Hold" : "Connected"}
            </div>
            {isRinging && callMsg && (
              <p style={{ fontSize: 12, color: "var(--hub-muted)", textAlign: "center", margin: "0 16px 8px", maxWidth: 300 }}>
                {callMsg}
              </p>
            )}

            <div className="active-avatar" style={{ background: selectedContact?.color || "#2563EB" }}>
              {selectedContact?.initials}
            </div>

            <h2>{selectedContact?.name}</h2>
            <p className="active-phone">{selectedContact?.phone}</p>
            <div className="call-timer">{formatSeconds(callSeconds)}</div>

            <div className="active-controls">
              <button className={isMuted ? "active" : ""} onClick={() => setIsMuted(!isMuted)}>
                <MicIcon muted={isMuted} />
                <span>{isMuted ? "Unmute" : "Mute"}</span>
              </button>
              <button className={isSpeaker ? "active" : ""} onClick={() => setIsSpeaker(!isSpeaker)}>
                <SpeakerIcon />
                <span>Speaker</span>
              </button>
              <button>
                <span className="keypad-symbol">⠿</span>
                <span>Keypad</span>
              </button>
              <button>
                <span className="add-symbol">+</span>
                <span>Add Call</span>
              </button>
            </div>

            <button className="end-call" onClick={endCall}>
              <PhoneIcon size={22} /> End Call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
