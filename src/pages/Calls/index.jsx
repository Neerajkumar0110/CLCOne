import React, { useState, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { Collapse, ConfigProvider } from "antd";
import "./Calls.css";
import HubTabs from "@/components/HubTabs";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";

const LEAD_STATUS_FILTERS = ["All", "New", "Contacted", "Qualified", "Won", "Lost"];

// Roles that manage more than one team and should see the cross-team
// "Team Overview" tab — matches backend/src/models/coreModels/Admin.js and
// callController/agentStats.js's MANAGEMENT_ROLES.
const MANAGEMENT_ROLES = ["owner", "Super Admin", "Admin", "Sales Manager"];

function formatSeconds(total) {
  const m = Math.floor((total || 0) / 60);
  const s = Math.floor((total || 0) % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Resolves the logged-in admin's team (Team.members matches on Admin.name) so
// every call screen can be scoped to "my team" / "myself" instead of
// everyone in the org.
function useMyTeam() {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const [team, setTeam] = useState(null);
  const [teamLoading, setTeamLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await request.get({ entity: "team/mine" });
      setTeam(res?.success ? res.result : null);
      setTeamLoading(false);
    })();
  }, []);

  return { currentAdmin, team, teamLoading };
}

function PhoneIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 011.12 4.18 2 2 0 013.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L7.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}
function MicIcon({ muted }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
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
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 010 7" />
      <path d="M18.5 5.5a9 9 0 010 13" />
    </svg>
  );
}

function CallIcon({ type }) {
  if (type === "missed") {
    return (
      <span className="call-history-icon missed">
        <PhoneIcon size={14} />
      </span>
    );
  }

  return (
    <span className="call-history-icon outgoing">
      <PhoneIcon size={14} />
    </span>
  );
}

function LiveDialer() {
  const { currentAdmin, team, teamLoading } = useMyTeam();

  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsPage, setContactsPage] = useState(1);
  const [contactsPages, setContactsPages] = useState(1);
  const [contactsCount, setContactsCount] = useState(0);
  const [recentCalls, setRecentCalls] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const [selectedContact, setSelectedContact] = useState(null);
  const [isCalling, setIsCalling] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("All");
  const [dialNumber, setDialNumber] = useState("");
  const [callSeconds, setCallSeconds] = useState(0);
  const timerRef = useRef(null);

  const loadRecentCalls = async () => {
    if (!currentAdmin?.name) return;
    setRecentLoading(true);
    const res = await request.list({
      entity: "call",
      options: { page: 1, items: 10, filter: "calledBy", equal: currentAdmin.name, sortBy: "created", sortValue: -1 },
    });
    setRecentCalls(res?.success ? res.result : []);
    setRecentLoading(false);
  };

  // Contacts = this admin's team's leads, paginated 5 per page. No team, no
  // dialer contacts — there's nothing cross-team to fall back to.
  const loadContacts = async (targetPage = 1) => {
    if (!team) {
      setContacts([]);
      setContactsLoading(false);
      return;
    }
    setContactsLoading(true);
    const res = await request.list({
      entity: "lead",
      options: { page: targetPage, items: 5, filter: "team", equal: team.name },
    });
    setContacts(res?.success ? res.result : []);
    setContactsPages(res?.pagination?.pages || 1);
    setContactsCount(res?.pagination?.count || 0);
    setContactsPage(targetPage);
    setContactsLoading(false);
  };

  useEffect(() => {
    if (teamLoading) return;
    loadContacts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, teamLoading]);

  useEffect(() => {
    loadRecentCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAdmin?.name]);

  // Live elapsed-time timer for the active call, in seconds — also becomes
  // the logged Call's duration once the call ends.
  useEffect(() => {
    if (isCalling) {
      setCallSeconds(0);
      timerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isCalling]);

  const filteredContacts = contacts.filter(
    (contact) =>
      (contact.name
        .toLowerCase()
        .includes(search.toLowerCase()) ||
      (contact.phone || "").includes(search)) &&
      (tagFilter === "All" || contact.status === tagFilter)
  );
  const startCall = (contact) => {
    const initials =
      contact.initials || contact.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
    setSelectedContact({ ...contact, initials });
    setIsCalling(true);
    setIsMuted(false);
    setIsSpeaker(false);
  };

  const endCall = async () => {
    setIsCalling(false);
    if (selectedContact && team && currentAdmin) {
      await request.create({
        entity: "call",
        jsonData: {
          lead: selectedContact._id || undefined,
          contactName: selectedContact.name,
          phone: selectedContact.phone,
          direction: "Outgoing",
          status: "Connected",
          duration: callSeconds,
          team: team.name,
          calledBy: currentAdmin.name,
        },
      });
      loadRecentCalls();
    }
  };

  const dialKey = (key) => {
    setDialNumber((prev) => prev + key);
  };

  const clearDial = () => {
    setDialNumber((prev) => prev.slice(0, -1));
  };

  const callDialNumber = () => {
    if (!dialNumber) return;

    const contact = {
      name: "Unknown Number",
      phone: dialNumber,
      initials: "UN",
      color: "#2563EB",
    };

    startCall(contact);
  };

  return (
    <>
      {/* MAIN */}
      <div className="calls-layout">

        {/* LEFT */}
        <div className="calls-left">

          {/* SEARCH */}
          <div className="call-search">
            <span>⌕</span>

            <input
              type="text"
              placeholder="Search contact or phone number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* CONTACTS */}
          <div className="call-section">

            <div className="section-title contacts-title">
              <div className="contacts-heading">
                <span>Contacts</span>
                <small>{contactsCount}</small>
              </div>
            </div>

            <div className="hub-form-row" style={{ marginBottom: 14 }}>
              <label>Filter by stage</label>
              <select
                className="hub-select"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                {LEAD_STATUS_FILTERS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="contacts-list">

              {teamLoading || contactsLoading ? (
                <div className="hub-empty">Loading your team's contacts…</div>
              ) : !team ? (
                <div className="hub-empty">You're not assigned to a team yet — ask a manager to add you to one.</div>
              ) : filteredContacts.length === 0 ? (
                <div className="hub-empty">No contacts match this filter yet.</div>
              ) : (
                filteredContacts.map((contact) => {
                  const initials = contact.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <div
                      className={`contact-card ${selectedContact?._id === contact._id
                        ? "selected"
                        : ""
                        }`}
                      key={contact._id}
                      onClick={() => setSelectedContact(contact)}
                    >

                      <div
                        className="contact-avatar"
                        style={{
                          background: contact.color || "#2563EB",
                        }}
                      >
                        {initials}
                      </div>

                      <div className="contact-info">
                        <strong>{contact.name}</strong>
                        <span>{contact.phone}</span>
                      </div>

                      <button
                        className="small-call-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          startCall(contact);
                        }}
                      >
                        <PhoneIcon size={16} />
                      </button>

                    </div>
                  );
                })
              )}

            </div>

            {!teamLoading && !contactsLoading && team && contactsPages > 1 && (
              <div className="hub-row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <span style={{ fontSize: 11.5, color: "#8c8c8c" }}>
                  Page {contactsPage} of {contactsPages}
                </span>
                <div className="hub-row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="hub-btn"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    disabled={contactsPage <= 1}
                    onClick={() => loadContacts(contactsPage - 1)}
                  >
                    ‹ Prev
                  </button>
                  <button
                    type="button"
                    className="hub-btn"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    disabled={contactsPage >= contactsPages}
                    onClick={() => loadContacts(contactsPage + 1)}
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* RECENT CALLS */}
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
              recentCalls.map((call) => (
                <div className="recent-call" key={call._id}>

                  <CallIcon type={call.status === "Missed" ? "missed" : "outgoing"} />

                  <div className="recent-info">
                    <strong>{call.contactName}</strong>
                    <span>{call.phone}</span>
                  </div>

                  <div className="recent-meta">
                    <span>{formatSeconds(call.duration)}</span>
                    <small>{new Date(call.created).toLocaleString()}</small>
                  </div>

                  <button
                    className="recent-call-btn"
                    onClick={() =>
                      startCall({
                        _id: call.lead,
                        name: call.contactName,
                        phone: call.phone,
                        color: "#2563EB",
                      })
                    }
                  >
                    <PhoneIcon size={15} />
                  </button>

                </div>
              ))}

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

              <div className="dial-display">
                <div className="dial-number">
                  {dialNumber || "Enter phone number"}
                </div>
              </div>

              <div className="dial-pad">

                {[
                  ["1", ""],
                  ["2", "ABC"],
                  ["3", "DEF"],
                  ["4", "GHI"],
                  ["5", "JKL"],
                  ["6", "MNO"],
                  ["7", "PQRS"],
                  ["8", "TUV"],
                  ["9", "WXYZ"],
                  ["*", ""],
                  ["0", "+"],
                  ["#", ""],
                ].map(([number, letters]) => (
                  <button
                    key={number}
                    onClick={() => dialKey(number)}
                  >
                    <strong>{number}</strong>
                    <small>{letters}</small>
                  </button>
                ))}

              </div>

              <div className="dial-actions">

                <button
                  className="dial-delete"
                  onClick={clearDial}
                >
                  ⌫
                </button>

                <button
                  className="dial-call"
                  onClick={callDialNumber}
                >
                  <PhoneIcon size={23} />
                </button>

                <span />

              </div>
            </>
          ) : (

            /* ACTIVE CALL */
            <div className="active-call">

              <div className="active-call-status">
                <span className="pulse" />
                Connected
              </div>

              <div
                className="active-avatar"
                style={{
                  background:
                    selectedContact?.color || "#2563EB",
                }}
              >
                {selectedContact?.initials}
              </div>

              <h2>
                {selectedContact?.name}
              </h2>

              <p className="active-phone">
                {selectedContact?.phone}
              </p>

              <div className="call-timer">
                {formatSeconds(callSeconds)}
              </div>

              <div className="active-controls">

                <button
                  className={isMuted ? "active" : ""}
                  onClick={() =>
                    setIsMuted(!isMuted)
                  }
                >
                  <MicIcon muted={isMuted} />
                  <span>
                    {isMuted ? "Unmute" : "Mute"}
                  </span>
                </button>

                <button
                  className={isSpeaker ? "active" : ""}
                  onClick={() =>
                    setIsSpeaker(!isSpeaker)
                  }
                >
                  <SpeakerIcon />
                  <span>Speaker</span>
                </button>

                <button>
                  <span className="keypad-symbol">
                    ⠿
                  </span>
                  <span>Keypad</span>
                </button>

                <button>
                  <span className="add-symbol">
                    +
                  </span>
                  <span>Add Call</span>
                </button>

              </div>

              <button
                className="end-call"
                onClick={endCall}
              >
                <PhoneIcon size={22} />
                End Call
              </button>

            </div>
          )}

        </div>
      </div>
    </>
  );
}
/* =========================================================
   CALL LOG & STATUS  (call status filter + call management)
========================================================= */

const LOG_RANGE_DAYS = { "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365 };

const CALL_STATUS_META = {
  Connected: "hub-badge-green",
  Missed: "hub-badge-red",
  "No Answer": "hub-badge-yellow",
  Busy: "hub-badge-yellow",
  Voicemail: "hub-badge-purple",
};

function CallStatusLog() {
  const { currentAdmin, team, teamLoading } = useMyTeam();
  const isManager = MANAGEMENT_ROLES.includes(currentAdmin?.role);

  const [status, setStatus] = useState("All");
  const [viewMode, setViewMode] = useState(isManager ? "AllTeams" : "Team");
  const [people, setPeople] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState("");
  const [range, setRange] = useState("1M");
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);

  const statuses = ["All", "Connected", "Missed", "No Answer", "Busy", "Voicemail"];

  // Managers get the full org roster to pick any one sales person from;
  // regular agents never see anyone else's name, so they don't need this.
  useEffect(() => {
    if (!isManager) return;
    (async () => {
      const res = await request.listAll({ entity: "team" });
      const roster = res?.success ? [...new Set(res.result.flatMap((t) => t.members || []))] : [];
      setPeople(roster);
      setSelectedPerson((prev) => prev || roster[0] || "");
    })();
  }, [isManager]);

  // Regular agents: "My Team" only ever queries this admin's own team, "Just
  // Me" only ever queries this admin's own calls. Managers instead get "All
  // Teams" (everyone, every team) or "Sales Person" (any one person by name)
  // — there's still no way for a regular agent to browse anyone else's data.
  const loadCalls = async () => {
    if (!isManager && viewMode === "Team" && !team) {
      setCalls([]);
      setLoading(false);
      return;
    }
    if (isManager && viewMode === "Person" && !selectedPerson) {
      setCalls([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const base = { page: 1, items: 500, sortBy: "created", sortValue: -1 };
    const options = isManager
      ? viewMode === "Person"
        ? { ...base, filter: "calledBy", equal: selectedPerson }
        : base
      : viewMode === "Team"
        ? { ...base, filter: "team", equal: team.name }
        : { ...base, filter: "calledBy", equal: currentAdmin.name };
    const res = await request.list({ entity: "call", options });
    setCalls(res?.success ? res.result : []);
    setLoading(false);
  };

  useEffect(() => {
    if (teamLoading || !currentAdmin?.name) return;
    loadCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, team, teamLoading, currentAdmin?.name, selectedPerson, isManager]);

  const withinRange = (c) => {
    const daysAgo = (Date.now() - new Date(c.created).getTime()) / 86400000;
    return daysAgo <= LOG_RANGE_DAYS[range];
  };

  const rangedFiltered = calls.filter(withinRange);

  const filtered =
    status === "All"
      ? rangedFiltered
      : rangedFiltered.filter((c) => c.status === status);

  const counts = statuses.reduce((acc, s) => {
    acc[s] =
      s === "All"
        ? rangedFiltered.length
        : rangedFiltered.filter((c) => c.status === s).length;
    return acc;
  }, {});

  const showLoading = teamLoading || loading;
  const showNoTeam = !showLoading && !isManager && viewMode === "Team" && !team;

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header" style={{ marginBottom: 16 }}>
          <h3>Call Status Filter</h3>

          <div className="hub-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <select
              className="hub-select"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value)}
            >
              {isManager ? (
                <>
                  <option value="AllTeams">All Teams</option>
                  <option value="Person">Sales Person</option>
                </>
              ) : (
                <>
                  <option value="Team">My Team</option>
                  <option value="Individual">Just Me</option>
                </>
              )}
            </select>

            {isManager && viewMode === "Person" && (
              <select
                className="hub-select"
                value={selectedPerson}
                onChange={(e) => setSelectedPerson(e.target.value)}
              >
                {people.length === 0 && <option value="">No sales persons yet</option>}
                {people.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}

            <select
              className="hub-select"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              {Object.keys(LOG_RANGE_DAYS).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        <div
          style={{
            paddingTop: 16,
            marginBottom: 20,
            borderTop: "1px solid var(--hub-border)",
          }}
        >
          <div className="hub-pill-filter">
            {statuses.map((s) => (
              <button
                key={s}
                type="button"
                className={`hub-pill-btn ${status === s ? "active" : ""}`}
                onClick={() => setStatus(s)}
              >
                {s} <span style={{ opacity: 0.65 }}>({counts[s]})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Phone</th>
                <th>Agent</th>
                <th>Team</th>
                <th>Direction</th>
                <th>Duration</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {showLoading && (
                <tr>
                  <td colSpan={8}>
                    <div className="hub-empty">Loading calls…</div>
                  </td>
                </tr>
              )}

              {showNoTeam && (
                <tr>
                  <td colSpan={8}>
                    <div className="hub-empty">You're not assigned to a team yet.</div>
                  </td>
                </tr>
              )}

              {!showLoading && !showNoTeam && filtered.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="hub-empty">No calls match this filter yet.</div>
                  </td>
                </tr>
              )}

              {!showLoading &&
                !showNoTeam &&
                filtered.map((c) => (
                  <tr key={c._id}>
                    <td>
                      <div className="hub-person">
                        <div className="hub-avatar" style={{ background: "#2563EB" }}>
                          {(c.contactName || "?").split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </div>
                        {c.contactName}
                      </div>
                    </td>
                    <td>{c.phone}</td>
                    <td>{c.calledBy}</td>
                    <td>{c.team || "—"}</td>
                    <td>{c.direction}</td>
                    <td>{formatSeconds(c.duration)}</td>
                    <td>{new Date(c.created).toLocaleString()}</td>
                    <td>
                      <span className={`hub-badge ${CALL_STATUS_META[c.status]}`}>{c.status}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   CALL RECORDING MANAGEMENT
========================================================= */

const recordingsSeed = [
  { contact: "Rahul Sharma", agent: "Rahul Kumar", duration: "04:32", date: "Today, 10:42 AM", review: "Reviewed" },
  { contact: "Amit Singh", agent: "Ankit Verma", duration: "02:18", date: "Yesterday, 6:12 PM", review: "Flagged" },
  { contact: "Ritu Bansal", agent: "Rahul Kumar", duration: "06:41", date: "2 days ago", review: "Reviewed" },
  { contact: "Divya Nair", agent: "Vikas Yadav", duration: "03:05", date: "3 days ago", review: "Pending" },
  { contact: "Farhan Ali", agent: "Priya Sharma", duration: "01:47", date: "4 days ago", review: "Pending" },
];

const RECORDING_AGENTS = ["Rahul Kumar", "Ankit Verma", "Vikas Yadav", "Priya Sharma"];

const REVIEW_META = {
  Reviewed: "hub-badge-green",
  Flagged: "hub-badge-red",
  Pending: "hub-badge-yellow",
};

function durationToSeconds(d) {
  const [m, s] = d.split(":").map(Number);
  return m * 60 + s;
}

function formatTime(total) {
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function PlayerModal({ recording, onClose }) {
  const totalSeconds = recording ? durationToSeconds(recording.duration) : 0;
  const [playing, setPlaying] = useState(true);
  const [current, setCurrent] = useState(0);
  const [volume, setVolume] = useState(80);
  const intervalRef = useRef(null);

  useEffect(() => {
    setCurrent(0);
    setPlaying(true);
  }, [recording]);

  useEffect(() => {
    if (playing && recording) {
      intervalRef.current = setInterval(() => {
        setCurrent((c) => {
          if (c >= totalSeconds) {
            setPlaying(false);
            return totalSeconds;
          }
          return c + 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, recording]);

  if (!recording) return null;

  const pct = totalSeconds ? (current / totalSeconds) * 100 : 0;

  const seek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setCurrent(Math.max(0, Math.min(totalSeconds, Math.round(ratio * totalSeconds))));
  };

  return (
    <HubModal
      open={!!recording}
      onClose={onClose}
      title="Call Recording"
      subtitle={`${recording.contact} · ${recording.agent}`}
      width={380}
    >
      <div className="hub-player">
        <div className="hub-player-avatar">
          {recording.contact.split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </div>

        <div style={{ textAlign: "center" }}>
          <div className="hub-player-name">{recording.contact}</div>
          <div className="hub-player-meta">{recording.date}</div>
        </div>

        <div className="hub-player-seek" style={{ width: "100%" }}>
          <div className="hub-player-seek-track" onClick={seek}>
            <div className="hub-player-seek-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="hub-player-times">
            <span>{formatTime(current)}</span>
            <span>{recording.duration}</span>
          </div>
        </div>

        <div className="hub-player-controls">
          <button
            type="button"
            className="hub-player-btn"
            onClick={() => setCurrent((c) => Math.max(0, c - 10))}
          >
            ⏮
          </button>

          <button
            type="button"
            className="hub-player-btn hub-player-btn-main"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "⏸" : "▶"}
          </button>

          <button
            type="button"
            className="hub-player-btn"
            onClick={() => setCurrent((c) => Math.min(totalSeconds, c + 10))}
          >
            ⏭
          </button>
        </div>

        <div className="hub-player-volume">
          <span style={{ fontSize: 13 }}>🔊</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <span style={{ fontSize: 11, color: "#8c8c8c", minWidth: 28 }}>{volume}%</span>
        </div>
      </div>
    </HubModal>
  );
}

function DownloadModal({ recording, onClose }) {
  const [progress, setProgress] = useState(0);
  const fakeSizeMb = recording ? (durationToSeconds(recording.duration) * 0.18).toFixed(1) : 0;

  useEffect(() => {
    if (!recording) return;
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          return 100;
        }
        return Math.min(100, p + Math.round(8 + Math.random() * 10));
      });
    }, 220);
    return () => clearInterval(interval);
  }, [recording]);

  if (!recording) return null;

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  const downloadedMb = ((progress / 100) * fakeSizeMb).toFixed(1);

  return (
    <HubModal
      open={!!recording}
      onClose={onClose}
      title="Downloading Recording"
      subtitle={`${recording.contact} · ${recording.duration}`}
      width={340}
    >
      <div className="hub-download-box">
        <div className="hub-download-ring">
          <svg width="92" height="92">
            <circle className="hub-download-ring-bg" cx="46" cy="46" r={radius} />
            <circle
              className="hub-download-ring-fill"
              cx="46"
              cy="46"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="hub-download-ring-label">{progress}%</div>
        </div>

        <div style={{ fontSize: 13, color: "#1f1f1f", fontWeight: 600 }}>
          {progress < 100 ? "Downloading…" : "Download complete"}
        </div>

        <div style={{ fontSize: 12, color: "#8c8c8c" }}>
          {downloadedMb} MB of {fakeSizeMb} MB
        </div>

        {progress >= 100 && (
          <button
            type="button"
            className="hub-btn hub-btn-primary"
            onClick={onClose}
            style={{ marginTop: 4 }}
          >
            Done
          </button>
        )}
      </div>
    </HubModal>
  );
}

function CallRecordings() {
  const [playing, setPlaying] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [reviewFilter, setReviewFilter] = useState("All");
  const [viewMode, setViewMode] = useState("Team");
  const [selectedAgent, setSelectedAgent] = useState(RECORDING_AGENTS[0]);
  const [search, setSearch] = useState("");

  const filters = ["All", "Reviewed", "Flagged", "Pending"];

  const scoped =
    viewMode === "Individual"
      ? recordingsSeed.filter((r) => r.agent === selectedAgent)
      : recordingsSeed;

  const searched = scoped.filter(
    (r) =>
      r.contact.toLowerCase().includes(search.toLowerCase()) ||
      r.date.toLowerCase().includes(search.toLowerCase())
  );

  const filtered =
    reviewFilter === "All"
      ? searched
      : searched.filter((r) => r.review === reviewFilter);

  return (
    <div className="hub-stack">
      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Recordings</div>
          <div className="hub-kpi-value">{recordingsSeed.length.toLocaleString()}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Storage Used</div>
          <div className="hub-kpi-value">2.4 GB</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Flagged for Review</div>
          <div className="hub-kpi-value">{recordingsSeed.filter((r) => r.review === "Flagged").length}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Retention Policy</div>
          <div className="hub-kpi-value">90 days</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Call Recordings</h3>

          <div className="hub-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <select
              className="hub-select"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value)}
            >
              <option value="Team">Team</option>
              <option value="Individual">Individual</option>
            </select>

            {viewMode === "Individual" && (
              <select
                className="hub-select"
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
              >
                {RECORDING_AGENTS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            )}

            <input
              className="hub-input"
              placeholder="Search by name or date…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 200 }}
            />
          </div>
        </div>

        <div className="hub-pill-filter" style={{ marginTop: 4, marginBottom: 20 }}>
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              className={`hub-pill-btn ${reviewFilter === f ? "active" : ""}`}
              onClick={() => setReviewFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Agent</th>
                <th>Duration</th>
                <th>Date</th>
                <th>Review Status</th>
                <th>Recording</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr key={`${r.contact}-${idx}`}>
                  <td>{r.contact}</td>
                  <td>{r.agent}</td>
                  <td>{r.duration}</td>
                  <td>{r.date}</td>
                  <td>
                    <span className={`hub-badge ${REVIEW_META[r.review]}`}>{r.review}</span>
                  </td>
                  <td>
                    <div className="hub-btn-group">
                      <button
                        type="button"
                        className="hub-btn hub-btn-primary"
                        onClick={() => setPlaying(r)}
                      >
                        ▶ Play
                      </button>
                      <button
                        type="button"
                        className="hub-btn"
                        onClick={() => setDownloading(r)}
                      >
                        ⬇ Download
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PlayerModal recording={playing} onClose={() => setPlaying(null)} />
      <DownloadModal recording={downloading} onClose={() => setDownloading(null)} />
    </div>
  );
}

/* =========================================================
   AUTO CALL DIALER
========================================================= */

const dialerQueueSeed = [
  { contact: "Manoj Tiwari", phone: "+91 98555 66778", attempt: 1, status: "Dialing", agent: "Rahul Kumar", country: "India" },
  { contact: "Anjali Deshmukh", phone: "+91 98444 55667", attempt: 1, status: "Queued", agent: "Priya Sharma", country: "India" },
  { contact: "Kavita Rao", phone: "+91 98222 33445", attempt: 2, status: "Queued", agent: "Rahul Kumar", country: "India" },
  { contact: "Sameer Khan", phone: "+91 98333 44556", attempt: 1, status: "Queued", agent: "Ankit Verma", country: "India" },
  { contact: "Rohan Malhotra", phone: "+91 98111 22334", attempt: 3, status: "Queued", agent: "Vikas Yadav", country: "India" },
  { contact: "Jason Miller", phone: "+1 415 555 0142", attempt: 1, status: "Queued", agent: "Rahul Kumar", country: "USA" },
  { contact: "Emily Davis", phone: "+1 212 555 0187", attempt: 1, status: "Queued", agent: "Priya Sharma", country: "USA" },
  { contact: "Michael Brown", phone: "+1 312 555 0163", attempt: 2, status: "Queued", agent: "Ankit Verma", country: "USA" },
];

const DIALER_AGENTS = ["Rahul Kumar", "Priya Sharma", "Ankit Verma", "Vikas Yadav"];

const COUNTRY_META = {
  India: { flag: "🇮🇳", hours: "10:00 AM – 7:00 PM IST", code: "+91" },
  USA: { flag: "🇺🇸", hours: "9:00 AM – 6:00 PM EST", code: "+1" },
};

const DIALER_STATUS_META = {
  Dialing: "hub-badge-blue",
  Queued: "hub-badge-gray",
  Connected: "hub-badge-green",
  Failed: "hub-badge-red",
};

function ActiveCallPanel({ call, onEnd, minimized, onToggleMinimize }) {
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);

  useEffect(() => {
    if (!call) return;
    setSeconds(0);
    setMuted(false);
    setOnHold(false);
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [call]);

  if (!call) return null;

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  if (minimized) {
    return (
      <div className="hub-callmini">
        <div className="hub-callmini-avatar">
          {call.contact.split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </div>
        <div className="hub-callmini-info">
          <div className="hub-callmini-name">{call.contact}</div>
          <div className="hub-callmini-timer">{mm}:{ss}</div>
        </div>
        <button
          type="button"
          className="hub-callmini-btn"
          onClick={onToggleMinimize}
          title="Expand"
        >
          ⤢
        </button>
        <button
          type="button"
          className="hub-callmini-btn hub-callmini-btn-end"
          onClick={onEnd}
          title="End call"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="hub-callpanel-overlay">
      <div className="hub-callpanel">
        <div className="hub-callpanel-status">
          <span className="hub-callpanel-dot" />
          {onHold ? "On Hold" : "Connected"}
        </div>

        <div className="hub-callpanel-avatar">
          {call.contact.split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </div>

        <div className="hub-callpanel-name">{call.contact}</div>
        <div className="hub-callpanel-phone">{call.phone}</div>

        <div className="hub-callpanel-timer">{mm}:{ss}</div>

        <div className="hub-callpanel-actions">
          <button
            type="button"
            className={`hub-callpanel-btn ${muted ? "active" : ""}`}
            onClick={() => setMuted((m) => !m)}
            title="Mute"
          >
            {muted ? "🔇" : "🎤"}
          </button>

          <button
            type="button"
            className={`hub-callpanel-btn ${onHold ? "active" : ""}`}
            onClick={() => setOnHold((h) => !h)}
            title="Hold"
          >
            ⏸
          </button>

          <button
            type="button"
            className="hub-callpanel-btn hub-callpanel-btn-end"
            onClick={onEnd}
            title="End call"
          >
            ✕
          </button>
        </div>

        <button
          type="button"
          className="hub-btn"
          style={{
            marginTop: 18,
            background: "rgba(255,255,255,0.08)",
            borderColor: "rgba(255,255,255,0.15)",
            color: "#fff",
          }}
          onClick={onToggleMinimize}
        >
          Minimize
        </button>
      </div>
    </div>
  );
}

function AutoDialer() {
  const [running, setRunning] = useState(true);
  const [pacing, setPacing] = useState("Predictive");
  const [queue, setQueue] = useState(dialerQueueSeed);
  const [viewMode, setViewMode] = useState("Team");
  const [selectedAgent, setSelectedAgent] = useState(DIALER_AGENTS[0]);
  const [country, setCountry] = useState("India");

  const pacingModes = ["Preview", "Progressive", "Predictive"];

  // Simulate a dialing call resolving after a few seconds — connects or
  // fails — no modal/side-panel opens, status just updates inline in the table.
  useEffect(() => {
    if (!running) return;
    const dialingIdx = queue.findIndex(
      (d) => d.status === "Dialing" && d.country === country
    );
    if (dialingIdx === -1) return;

    const timer = setTimeout(() => {
      const connects = Math.random() > 0.2;
      setQueue((prev) =>
        prev.map((d, i) =>
          i === dialingIdx ? { ...d, status: connects ? "Connected" : "Failed" } : d
        )
      );
    }, 3000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, queue, country]);

  // Auto-dial the next queued contact in this country whenever nothing
  // is actively dialing — covers both "call ended" and "didn't connect".
  useEffect(() => {
    if (!running) return;
    const alreadyDialing = queue.some(
      (d) => d.status === "Dialing" && d.country === country
    );
    if (alreadyDialing) return;

    const nextIdx = queue.findIndex(
      (d) => d.status === "Queued" && d.country === country
    );
    if (nextIdx === -1) return;

    const timer = setTimeout(() => {
      setQueue((prev) =>
        prev.map((d, i) => (i === nextIdx ? { ...d, status: "Dialing" } : d))
      );
    }, 1500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, queue, country]);

  const countryQueue = queue.filter((d) => d.country === country);
  const visibleQueue =
    viewMode === "Individual"
      ? countryQueue.filter((d) => d.agent === selectedAgent)
      : countryQueue;

  const connectRate = countryQueue.length
    ? Math.round(
        (countryQueue.filter((d) => d.status === "Connected").length /
          countryQueue.length) *
          100
      )
    : 0;

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header" style={{ marginBottom: 12 }}>
          <h3>Calling Country</h3>
        </div>
        <div className="hub-btn-group">
          {Object.keys(COUNTRY_META).map((c) => (
            <button
              key={c}
              type="button"
              className="hub-btn"
              style={
                country === c
                  ? { background: "#2563eb", color: "#fff", borderColor: "#2563eb" }
                  : {}
              }
              onClick={() => setCountry(c)}
            >
              {COUNTRY_META[c].flag} {c}
            </button>
          ))}
          <span style={{ fontSize: 12, color: "#667085", alignSelf: "center", marginLeft: 6 }}>
            Calling hours: {COUNTRY_META[country].hours}
          </span>
        </div>
      </div>

      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Queue Size ({country})</div>
          <div className="hub-kpi-value">{countryQueue.length}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Calls Placed Today</div>
          <div className="hub-kpi-value">184</div>
          <div className="hub-kpi-delta hub-badge-green" style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20 }}>▲ 12%</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Connect Rate</div>
          <div className="hub-kpi-value">{connectRate}%</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Avg Pacing</div>
          <div className="hub-kpi-value">2.3x</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Campaign Controls</h3>

          <div className="hub-row" style={{ alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 12.5, color: "#8c8c8c" }}>
              {running ? "Campaign running" : "Campaign paused"}
            </span>
            <div
              className={`hub-switch ${running ? "on" : ""}`}
              onClick={() => setRunning((r) => !r)}
            />
          </div>
        </div>

        <div className="hub-row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <label className="hub-btn hub-btn-primary" style={{ cursor: "pointer" }}>
            ⬆ Upload Call List
            <input type="file" accept=".csv" style={{ display: "none" }} />
          </label>

          <div className="hub-btn-group">
            {pacingModes.map((mode) => (
              <button
                key={mode}
                type="button"
                className="hub-btn"
                style={
                  pacing === mode
                    ? { background: "#2563eb", color: "#fff", borderColor: "#2563eb" }
                    : {}
                }
                onClick={() => setPacing(mode)}
              >
                {mode}
              </button>
            ))}
          </div>

          <select
            className="hub-select"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            style={{ marginLeft: "auto" }}
          >
            <option value="Team">Team</option>
            <option value="Individual">Individual</option>
          </select>

          {viewMode === "Individual" && (
            <select
              className="hub-select"
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              {DIALER_AGENTS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Phone</th>
                <th>Agent</th>
                <th>Attempt</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleQueue.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">No calls queued for {country} right now.</div>
                  </td>
                </tr>
              )}
              {visibleQueue.map((d, idx) => (
                <tr key={`${d.contact}-${idx}`}>
                  <td>{d.contact}</td>
                  <td>{d.phone}</td>
                  <td>{d.agent}</td>
                  <td>#{d.attempt}</td>
                  <td>
                    <span className={`hub-badge ${DIALER_STATUS_META[d.status]}`}>
                      {d.status === "Dialing" ? "📞 Dialing…" : d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   TEAM OVERVIEW — management-only: every team's sales persons, their
   number of contacts worked and connected/disconnected call counts.
========================================================= */

function TeamCallOverview() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await request.get({ entity: "call/agent-stats" });
      setTeams(res?.success ? res.result : []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header" style={{ marginBottom: 16 }}>
          <h3>Team Overview</h3>
        </div>

        {loading && <div className="hub-empty">Loading team stats…</div>}
        {!loading && teams.length === 0 && <div className="hub-empty">No teams yet.</div>}

        {!loading && teams.length > 0 && (
          <ConfigProvider theme={{ token: { colorPrimary: "#2563eb", borderRadius: 10 } }}>
            <Collapse
              expandIconPosition="end"
              items={teams.map((t) => ({
                key: t.team,
                label: (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.color || "#2563eb", flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t.team}</span>
                    <span className="hub-badge hub-badge-blue">
                      {t.members.length} sales person{t.members.length === 1 ? "" : "s"}
                    </span>
                  </div>
                ),
                children: (
                  <div className="hub-table-wrapper">
                    <table className="hub-table">
                      <thead>
                        <tr>
                          <th>Sales Person</th>
                          <th>Numbers</th>
                          <th>Connected</th>
                          <th>Disconnected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.members.length === 0 && (
                          <tr>
                            <td colSpan={4}>
                              <div className="hub-empty">No members in this team yet.</div>
                            </td>
                          </tr>
                        )}
                        {t.members.map((m) => (
                          <tr key={m.name}>
                            <td>
                              <div className="hub-person">
                                <div className="hub-avatar" style={{ background: "#2563EB" }}>
                                  {m.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                                </div>
                                {m.name}
                              </div>
                            </td>
                            <td>{m.numbers}</td>
                            <td>
                              <span className="hub-badge hub-badge-green">{m.connected}</span>
                            </td>
                            <td>
                              <span className="hub-badge hub-badge-red">{m.disconnected}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ),
              }))}
            />
          </ConfigProvider>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   CALLS HUB — shared header + tabs across all call features
========================================================= */

export default function Calls() {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const isManager = MANAGEMENT_ROLES.includes(currentAdmin?.role);
  const [tab, setTab] = useState(isManager ? "overview" : "live");

  const tabs = [
    ...(isManager ? [{ key: "overview", label: "Team Overview" }] : []),
    // Live Dialer is an individual-agent tool — managers oversee calls
    // instead of placing them, so it's hidden for their roles.
    ...(isManager ? [] : [{ key: "live", label: "Live Dialer" }]),
    { key: "log", label: "Call Log & Status" },
    { key: "recordings", label: "Recordings" },
    { key: "autodialer", label: "Auto Dialer" },
  ];

  return (
    <div className="calls-page">

      <div className="calls-header">
        <div>
          <h1>Calls</h1>
          <p>Manage live calls, call status, recordings and auto-dialer campaigns</p>
        </div>

        <div className="call-status-online">
          <span />
          Calling service online
        </div>
      </div>

      <div style={{ margin: "16px 0 20px" }}>
        <HubTabs
          tabs={tabs}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "overview" && isManager && <TeamCallOverview />}
      {tab === "live" && !isManager && <LiveDialer />}
      {tab === "log" && <CallStatusLog />}
      {tab === "recordings" && <CallRecordings />}
      {tab === "autodialer" && <AutoDialer />}
    </div>
  );
}