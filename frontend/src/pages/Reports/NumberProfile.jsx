import React, { useMemo, useState } from "react";
import dayjs from "dayjs";
import { request } from "@/request";
import {
  PhoneOutlined,
  SwapOutlined,
  UserSwitchOutlined,
  CalendarOutlined,
  VideoCameraOutlined,
  WalletOutlined,
  BankOutlined,
  CustomerServiceOutlined,
  PlusCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import "./userActivity.css";

// Advanced Reporting → Number Lookup → one customer's full story
// (backend services/reports/number360.js).

const fmtDur = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
};
const fmtDT = (d) => (d ? dayjs(d).format("DD MMM YYYY, hh:mm A") : "—");
const fmtTime = (d) => (d ? dayjs(d).format("hh:mm A") : "—");
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const OUTCOME_CHIP = { Connected: "is-green", "Not picked up": "is-amber", "Missed by agent": "is-red" };
const OUTCOME_BADGE = { Connected: "hub-badge-green", "Not picked up": "hub-badge-yellow", "Missed by agent": "hub-badge-red" };

const EV = {
  call: { icon: <PhoneOutlined />, color: "#7c3aed", soft: "#f5f3ff", label: "Call" },
  stage: { icon: <SwapOutlined />, color: "#0891b2", soft: "#ecfeff", label: "Stage" },
  owner: { icon: <UserSwitchOutlined />, color: "#2563eb", soft: "#eff6ff", label: "Owner" },
  lead: { icon: <PlusCircleOutlined />, color: "#16a34a", soft: "#ecfdf5", label: "New lead" },
  callback: { icon: <CalendarOutlined />, color: "#d97706", soft: "#fffbeb", label: "Callback" },
  demo: { icon: <VideoCameraOutlined />, color: "#db2777", soft: "#fdf2f8", label: "Demo" },
  payment: { icon: <WalletOutlined />, color: "#059669", soft: "#ecfdf5", label: "Payment" },
  finance: { icon: <BankOutlined />, color: "#4f46e5", soft: "#eef2ff", label: "Finance" },
  ticket: { icon: <CustomerServiceOutlined />, color: "#64748b", soft: "#f1f5f9", label: "Ticket" },
};

const LEAD_LABELS = [
  ["email", "Email"],
  ["alternatePhone", "Alt. phone"],
  ["city", "City"],
  ["state", "State"],
  ["source", "Source"],
  ["metaFormName", "Facebook form"],
  ["team", "Team"],
  ["persona", "Persona"],
  ["age", "Age"],
  ["gender", "Gender"],
  ["highestQualification", "Qualification"],
  ["education", "Education"],
  ["profile", "Current profile"],
  ["currentCtc", "Current CTC"],
  ["painPoint", "Pain point"],
  ["preferredLanguage", "Language"],
  ["budgetRange", "Budget"],
  ["howSoonToStart", "Start in"],
];
const LEAD_DATES = [
  ["facebookCreatedAt", "Came in (Facebook)"],
  ["created", "Added to CRM"],
  ["meetingAt", "Demo / meeting"],
  ["callBackAt", "Call back on"],
  ["futureFollowUpAt", "Follow up on"],
  ["enrolledAt", "Enrolled on"],
];

function Kpi({ label, value, hint, tone }) {
  return (
    <div className="hub-kpi" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--hub-muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, marginTop: 4, color: tone || "var(--hub-text)" }}>{value}</div>
      {hint && <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Event({ e }) {
  const m = EV[e.kind] || { icon: <ClockCircleOutlined />, color: "#64748b", soft: "#f1f5f9", label: e.kind };
  let body;
  if (e.kind === "call") {
    body = (
      <>
        <span className="ua-tl-name">{e.by || "—"}</span>
        <span className={`ua-tl-chip ${OUTCOME_CHIP[e.outcome] || ""}`}>{e.outcome}</span>
        {e.durationSec > 0 && <span className="ua-tl-chip">{fmtDur(e.durationSec)}</span>}
        {e.disposition && <span className="ua-tl-chip is-blue">{e.disposition}</span>}
        {e.callType && <span className="ua-tl-phone">· {e.callType}</span>}
        {e.text && <span className="ua-tl-text" style={{ flexBasis: "100%", color: "#475569", whiteSpace: "pre-wrap" }}>“{e.text}”</span>}
      </>
    );
  } else if (e.kind === "stage") {
    body = (
      <>
        <span className="ua-tl-name">{e.by}</span>
        <span className="ua-tl-move">
          <span className="ua-tl-chip">{e.from || "—"}</span>
          <span className="ua-tl-arrow">→</span>
          <span className="ua-tl-chip is-blue">{e.to}</span>
          {e.sub && <span className="ua-tl-phone">{e.sub}</span>}
        </span>
        {e.text && <span className="ua-tl-text" style={{ flexBasis: "100%", color: "#475569" }}>{e.text}</span>}
      </>
    );
  } else {
    body = (
      <>
        <span className="ua-tl-text">{e.kind === "callback" && e.scheduledAt ? `Callback for ${fmtDT(e.scheduledAt)} · ${e.status}` : e.text}</span>
        {e.by && <span className="ua-tl-chip">by {e.by}</span>}
      </>
    );
  }
  return (
    <div className="ua-tl-row">
      <div className="ua-tl-time">{fmtTime(e.at)}</div>
      <div className="ua-tl-rail">
        <span className="ua-tl-node" style={{ background: m.color }}>{m.icon}</span>
      </div>
      <div className="ua-tl-card">
        <span className="ua-tl-kind" style={{ color: m.color, background: m.soft }}>{m.label}</span>
        {body}
      </div>
    </div>
  );
}

export default function NumberProfile({ data }) {
  const [tab, setTab] = useState("calls");
  const [userFilter, setUserFilter] = useState("");
  const [dialing, setDialing] = useState(false);
  const L = data.lead;
  const s = data.summary;
  const name = data.name || L?.name || data.phone;

  const calls = data.calls.filter((c) => !userFilter || (c.agent || "Unassigned") === userFilter);
  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of data.events) {
      const k = dayjs(e.at).format("dddd, DD MMM YYYY");
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m.entries()];
  }, [data.events]);

  const callNow = async () => {
    if (dialing) return;
    setDialing(true);
    const r = await request.post({ entity: "calling/manual/dial", jsonData: { phone: data.phone, contactName: name } });
    setDialing(false);
    if (!r?.success) window.alert(r?.message || "Could not place the call.");
  };

  const others = [
    ...data.callbacks.map((x) => ({ at: x.created, kind: "Callback", text: `For ${fmtDT(x.scheduledAt)}`, by: x.assignedAgentName, status: x.status })),
    ...data.demos.map((x) => ({ at: x.created, kind: "Live demo", text: `${x.date}${x.rebookCount ? ` (moved from ${x.missedDates.join(", ")})` : ""}`, by: x.agentName, status: x.status })),
    ...data.payments.map((x) => ({ at: x.created, kind: "Payment", text: `${inr(x.amount)}${x.course ? ` · ${x.course}` : ""}${x.installmentCount > 1 ? ` · inst. ${x.installmentNo}/${x.installmentCount}` : ""}`, by: x.createdByName, status: x.status })),
    ...data.finance.map((x) => ({ at: x.created, kind: "Finance KYC", text: `${x.financeAmount ? inr(x.financeAmount) : ""}${x.tenureMonths ? ` · ${x.tenureMonths} months` : ""}`, by: x.createdByName, status: x.status })),
    ...data.tickets.map((x) => ({ at: x.created, kind: "Ticket", text: x.subject, by: x.raisedByName, status: x.status })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div className="hub-stack">
      {/* who */}
      <div className="hub-card" style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <span className="hub-avatar" style={{ width: 58, height: 58, fontSize: 21, borderRadius: "50%", background: "linear-gradient(135deg, #2563eb, #7c3aed)", color: "#fff", fontWeight: 800 }}>{initials(name)}</span>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>{name}</h2>
            {L && <span className="hub-badge hub-badge-blue">{L.stage}</span>}
            {L?.subStatus && <span className="hub-badge hub-badge-gray">{L.subStatus}</span>}
          </div>
          <div style={{ fontSize: 13, color: "var(--hub-muted)", marginTop: 4 }}>
            +91 {data.phone}
            {L?.email ? ` · ${L.email}` : ""}
            {L ? ` · Owner: ${L.assignedUserName || "Unassigned"}` : " · Not a lead in the CRM"}
          </div>
        </div>
        <button type="button" className="hub-btn hub-btn-primary" onClick={callNow} disabled={dialing}>
          <PhoneOutlined /> {dialing ? "Calling…" : "Call now"}
        </button>
      </div>

      {data.duplicates.length > 0 && (
        <div className="hub-card" style={{ borderColor: "#fde68a", background: "#fffbeb", fontSize: 13 }}>
          ⚠️ This number is on <b>{data.duplicates.length} leads</b>:{" "}
          {data.duplicates.map((d) => `${d.name} (${d.stage}${d.owner ? `, ${d.owner}` : ""})`).join(" · ")}. Showing the latest; calls and history cover all of them.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
        <Kpi label="Calls" value={s.calls} hint={`${s.notPicked} not picked · ${s.missed} missed`} />
        <Kpi label="Connected" value={s.connected} tone="#16a34a" hint={s.calls ? `${Math.round((s.connected / s.calls) * 100)}% of calls` : "—"} />
        <Kpi label="Total talk" value={fmtDur(s.talkSeconds)} hint={`longest ${fmtDur(s.longest)}`} />
        <Kpi label="Users who called" value={s.users} />
        <Kpi label="First contact" value={s.firstContact ? dayjs(s.firstContact).format("DD MMM YY") : "—"} hint={s.firstContact ? fmtTime(s.firstContact) : null} />
        <Kpi label="Last contact" value={s.lastContact ? dayjs(s.lastContact).format("DD MMM YY") : "—"} hint={s.lastContact ? fmtTime(s.lastContact) : null} />
        <Kpi label="Stage changes" value={s.stageMoves} />
        <Kpi label="Paid" value={inr(s.paidAmount)} tone={s.paidAmount ? "#16a34a" : undefined} />
      </div>

      {/* who talked, how much */}
      <div className="hub-card">
        <div className="hub-card-header">
          <div>
            <h3 style={{ margin: 0 }}>Who talked to this customer</h3>
            <div style={{ fontSize: 12, color: "var(--hub-muted)", marginTop: 2 }}>Click a user to see only their calls</div>
          </div>
        </div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr><th>User</th><th>Calls</th><th>Connected</th><th>Talk time</th><th>Longest</th><th>First call</th><th>Last call</th><th>Responses</th><th>Stage moves</th></tr>
            </thead>
            <tbody>
              {data.byUser.length === 0 && <tr><td colSpan={9}><div className="hub-empty">Nobody has called this number yet.</div></td></tr>}
              {data.byUser.map((u) => (
                <tr
                  key={u.user}
                  style={{ cursor: "pointer", background: userFilter === u.user ? "var(--hub-bg-soft)" : undefined }}
                  onClick={() => { setUserFilter(userFilter === u.user ? "" : u.user); setTab("calls"); }}
                >
                  <td style={{ fontWeight: 700 }}>{u.user}</td>
                  <td>{u.calls || "—"}</td>
                  <td>{u.connected || "—"}</td>
                  <td>{u.talkSeconds ? fmtDur(u.talkSeconds) : "—"}</td>
                  <td>{u.longest ? fmtDur(u.longest) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{u.first ? fmtDT(u.first) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{u.last ? fmtDT(u.last) : "—"}</td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {Object.entries(u.dispositions).map(([d, n]) => <span key={d} className="ua-tl-chip is-blue">{d}{n > 1 ? ` ×${n}` : ""}</span>)}
                      {!Object.keys(u.dispositions).length && "—"}
                    </div>
                  </td>
                  <td>{u.stageMoves || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* lead card */}
      {L && (
        <div className="hub-card">
          <div className="hub-card-header"><h3 style={{ margin: 0 }}>Lead details</h3></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "12px 20px" }}>
            {[...LEAD_LABELS.map(([k, label]) => [label, L[k]]), ...LEAD_DATES.map(([k, label]) => [label, L[k] ? fmtDT(L[k]) : null])]
              .filter(([, v]) => v != null && v !== "")
              .map(([label, v]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: "var(--hub-muted)", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, wordBreak: "break-word" }}>{String(v)}</div>
                </div>
              ))}
          </div>
          {(L.message || L.remarks) && (
            <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "var(--hub-bg-soft)", border: "1px solid var(--hub-border)", fontSize: 13, whiteSpace: "pre-wrap" }}>
              {L.message && <div><b>Requirement:</b> {L.message}</div>}
              {L.remarks && <div style={{ marginTop: L.message ? 6 : 0 }}><b>Remarks:</b> {L.remarks}</div>}
            </div>
          )}
        </div>
      )}

      {/* details */}
      <div className="hub-card">
        <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ margin: 0 }}>History</h3>
          <div className="hub-pill-filter">
            {[
              ["calls", `Calls (${data.calls.length})`],
              ["timeline", "Timeline"],
              ["other", `Callbacks · demos · payments (${others.length})`],
              ["queue", `Pool queue (${data.queue.length})`],
            ].map(([k, label]) => (
              <button key={k} type="button" className={`hub-btn ${tab === k ? "hub-btn-primary" : ""}`} style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12.5, border: "none" }} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === "calls" && (
          <>
            {userFilter && (
              <div style={{ marginBottom: 10, fontSize: 13 }}>
                Showing <b>{userFilter}</b>'s calls ·{" "}
                <button type="button" className="hub-btn" style={{ padding: "2px 10px" }} onClick={() => setUserFilter("")}>Show everyone</button>
              </div>
            )}
            <div className="hub-table-wrapper">
              <table className="hub-table">
                <thead>
                  <tr><th>When</th><th>By</th><th>Type</th><th>Outcome</th><th>Talk</th><th>Response</th><th>Notes</th><th>Recording</th></tr>
                </thead>
                <tbody>
                  {calls.length === 0 && <tr><td colSpan={8}><div className="hub-empty">No calls.</div></td></tr>}
                  {calls.map((c) => (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDT(c.at)}</td>
                      <td style={{ fontWeight: 700 }}>{c.agent || "—"}</td>
                      <td style={{ fontSize: 12 }}>{c.type}{c.direction === "Inbound" ? " · in" : ""}</td>
                      <td><span className={`hub-badge ${OUTCOME_BADGE[c.outcome] || "hub-badge-gray"}`}>{c.outcome}</span></td>
                      <td>{c.durationSec ? fmtDur(c.durationSec) : "—"}</td>
                      <td style={{ fontWeight: 700, fontSize: 12 }}>{c.disposition || "—"}</td>
                      <td style={{ fontSize: 12, color: "#475569", maxWidth: 300, whiteSpace: "pre-wrap" }}>{c.notes || "—"}</td>
                      <td style={{ minWidth: 220 }}>
                        {c.recordingUrl ? <audio controls preload="none" src={c.recordingUrl} style={{ width: 220, height: 32 }} /> : <span style={{ color: "var(--hub-muted)" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "timeline" && (
          <div className="ua-tl">
            {byDay.length === 0 && <div className="hub-empty">Nothing recorded.</div>}
            {byDay.map(([day, evs]) => (
              <div key={day} className="ua-tl-day">
                <div className="ua-tl-dayhead">
                  <b>{day}</b>
                  <span className="ua-tl-count">{evs.length} {evs.length === 1 ? "event" : "events"}</span>
                </div>
                <div className="ua-tl-rows">{evs.map((e, i) => <Event key={i} e={e} />)}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "other" && (
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead><tr><th>When</th><th>What</th><th>Detail</th><th>By</th><th>Status</th></tr></thead>
              <tbody>
                {others.length === 0 && <tr><td colSpan={5}><div className="hub-empty">No callbacks, demos, payments, finance requests or tickets.</div></td></tr>}
                {others.map((x, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDT(x.at)}</td>
                    <td style={{ fontWeight: 700 }}>{x.kind}</td>
                    <td style={{ fontSize: 12.5 }}>{x.text || "—"}</td>
                    <td>{x.by || "—"}</td>
                    <td><span className={`hub-badge ${["paid", "attended", "Done", "submitted", "Resolved"].includes(x.status) ? "hub-badge-green" : "hub-badge-gray"}`}>{x.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "queue" && (
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead><tr><th>Queued</th><th>From</th><th>Status</th><th>Attempts</th><th>Last response</th><th>Last attempt</th></tr></thead>
              <tbody>
                {data.queue.length === 0 && <tr><td colSpan={6}><div className="hub-empty">Never in the auto-dialer queue.</div></td></tr>}
                {data.queue.map((q, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDT(q.created)}</td>
                    <td style={{ fontSize: 12 }}>{q.source || "—"}</td>
                    <td>{q.status}</td>
                    <td>{q.attempts}</td>
                    <td>{q.lastDisposition || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDT(q.lastAttemptAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
