import React, { useEffect, useState } from "react";
import {
  RightOutlined,
  ArrowRightOutlined,
  ProfileOutlined,
  PhoneOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  HistoryOutlined,
  FileTextOutlined,
  UserOutlined,
  CalendarOutlined,
  SoundOutlined,
  TagOutlined,
  SwapOutlined,
  RobotOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  GlobalOutlined,
  CustomerServiceOutlined,
} from "@ant-design/icons";
import { message } from "antd";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import { stageColor, badgeClassForStatus } from "@/config/leadStages";
import "./leadDetail.css";

// One customer, everything about them, in one modal — opened by clicking a
// lead / number row anywhere in the app (Leads tables, Captured Leads,
// called-leads lists, Reports …). Backend: GET /api/lead/full-detail
// (leadController/fullDetail.js) → the lead with every field users filled
// in, every call to the number (who, when, how long they talked, response,
// notes, recording), pending callbacks, totals.
//
// Every section is an accordion, and every call / response / stage change
// inside it is its own (nested) accordion item — see leadDetail.css.
//
//   <LeadFullDetailModal lead={row} onClose={...} />      row with _id / phone
//   <LeadFullDetailModal phone="98…" onClose={...} />     just a number

const fmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null);
const talk = (s) => {
  const n = Math.max(0, Math.round(s || 0));
  if (!n) return "0s";
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};

const label = { fontSize: 11, color: "var(--hub-muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 600 };
const box = { fontSize: 13, color: "var(--hub-text)", padding: "10px 12px", background: "var(--hub-bg-soft)", border: "1px solid var(--hub-border)", borderRadius: 8 };

function Field({ k, v }) {
  return (
    <div>
      <div style={label}>{k}</div>
      <div style={{ fontSize: 13.5, color: "var(--hub-text)", wordBreak: "break-word" }}>{v || "—"}</div>
    </div>
  );
}

function StatTile({ icon, color, value, label: text, title }) {
  return (
    <div className="ld-stat" style={{ "--st": color }} title={title}>
      <span className="ld-stat-icon">{icon}</span>
      <div style={{ minWidth: 0 }}>
        <b>{value}</b>
        <span>{text}</span>
      </div>
    </div>
  );
}

// Top-level section: coloured icon tile, title + one-line summary, count badge, rotating arrow.
function Accordion({ icon, title, summary, count, accent = "#2563eb", defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`ld-acc${open ? " is-open" : ""}`} style={{ "--ld-accent": accent }}>
      <button type="button" className="ld-acc-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="ld-acc-icon">{icon}</span>
        <span className="ld-acc-title">
          <b>{title}</b>
          {summary ? <span>{summary}</span> : null}
        </span>
        {count !== undefined && count !== null && <span className="ld-count">{count}</span>}
        <span className="ld-chev"><RightOutlined /></span>
      </button>
      <div className="ld-collapse">
        <div>
          <div className="ld-acc-body">{children}</div>
        </div>
      </div>
    </section>
  );
}

// Nested item inside a section: one call / response / stage change.
function Item({ dot = "#2563eb", title, meta, side, open, onToggle, children }) {
  return (
    <div className={`ld-item${open ? " is-open" : ""}`} style={{ "--ld-dot": dot }}>
      <button type="button" className="ld-item-head" aria-expanded={open} onClick={onToggle}>
        <span className="ld-chev"><RightOutlined /></span>
        <span className="ld-item-main">
          <span className="ld-item-title">{title}</span>
          {meta ? <span className="ld-item-meta">{meta}</span> : null}
        </span>
        {side ? <span className="ld-item-side">{side}</span> : null}
      </button>
      <div className="ld-collapse">
        <div>
          <div className="ld-item-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Open/close state for a list of nested items (the newest starts open) + "Expand all / Collapse all".
function useItems(n, firstOpen = true) {
  const [open, setOpen] = useState(() => (firstOpen && n ? { 0: true } : {}));
  const toggle = (i) => setOpen((o) => ({ ...o, [i]: !o[i] }));
  const all = (v) => setOpen(v ? Object.fromEntries(Array.from({ length: n }, (_, i) => [i, true])) : {});
  const tools =
    n > 1 ? (
      <div className="ld-tools">
        <button type="button" className="ld-link" onClick={() => all(true)}>Expand all</button>
        <button type="button" className="ld-link" onClick={() => all(false)}>Collapse all</button>
      </div>
    ) : null;
  return { isOpen: (i) => !!open[i], toggle, tools };
}

function StageChip({ stage }) {
  if (!stage) return null;
  return (
    <span className="ld-stage" style={{ "--chip": stageColor(stage) }}>
      <i />
      {stage}
    </span>
  );
}

function Kv({ rows }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!shown.length) return null;
  return (
    <dl className="ld-kv">
      {shown.map(([k, v, icon]) => (
        <React.Fragment key={k}>
          <dt>{icon}{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function CallsList({ calls }) {
  const it = useItems(calls.length);
  return (
    <>
      {it.tools}
      <div className="ld-list ld-scroll">
        {calls.map((c, i) => {
          const result = c.answered ? ["Spoke", "green"] : c.notPlaced ? ["Failed: no balance", "gray"] : c.missedByAgent ? ["User missed", "red"] : ["Not picked", "amber"];
          const dot = c.answered ? "#16a34a" : c.notPlaced ? "#64748b" : c.missedByAgent ? "#dc2626" : "#d97706";
          const inbound = /in/i.test(c.direction || "");
          return (
            <Item
              key={c._id || i}
              dot={dot}
              open={it.isOpen(i)}
              onToggle={() => it.toggle(i)}
              title={
                <>
                  {inbound ? <ArrowDownOutlined style={{ color: "#2563eb" }} /> : <ArrowUpOutlined style={{ color: "#7c3aed" }} />}
                  {fmt(c.at)}
                  {c.response ? <span style={{ fontWeight: 500, color: "var(--hub-text-soft)" }}>· {c.response}</span> : null}
                </>
              }
              meta={
                <>
                  <span><UserOutlined />{c.agentName || "—"}</span>
                  <span>{c.direction}{c.instantLead ? " · Facebook instant" : ""}</span>
                  {c.answered ? <span><SoundOutlined />{talk(c.talkSeconds)} talked</span> : null}
                </>
              }
              side={<span className={`ld-pill ${result[1]}`}>{result[0]}</span>}
            >
              <Kv
                rows={[
                  ["Result", result[0], <TagOutlined key="r" />],
                  ["Talked", c.answered ? talk(c.talkSeconds) : null, <SoundOutlined key="t" />],
                  ["Response", c.response, <MessageOutlined key="m" />],
                  ["Transferred to", c.transferredTo, <SwapOutlined key="x" />],
                ]}
              />
              {c.notes ? <div className="ld-note">{c.notes}</div> : null}
              {c.recordingUrl ? (
                <audio controls preload="none" src={c.recordingUrl} style={{ width: "100%", maxWidth: 420, height: 34 }} />
              ) : (
                <span className="ld-empty" style={{ fontSize: 12 }}>No recording for this call.</span>
              )}
            </Item>
          );
        })}
      </div>
    </>
  );
}

function ResponsesList({ items }) {
  const it = useItems(items.length);
  return (
    <>
      {it.tools}
      <div className="ld-list ld-scroll">
        {items.map((h, i) => (
          <Item
            key={i}
            dot="#0891b2"
            open={it.isOpen(i)}
            onToggle={() => it.toggle(i)}
            title={<><MessageOutlined style={{ color: "#0891b2" }} />{h.outcome || "Response"}</>}
            meta={
              <>
                <span><UserOutlined />{h.byName || "—"}</span>
                <span><CalendarOutlined />{fmt(h.at)}</span>
              </>
            }
            side={i === 0 ? <span className="ld-pill blue">Latest</span> : null}
          >
            <Kv
              rows={[
                ["Response", h.outcome || "Response", <MessageOutlined key="o" />],
                ["Saved by", h.byName || "—", <UserOutlined key="u" />],
                ["When", fmt(h.at), <CalendarOutlined key="c" />],
              ]}
            />
            {h.notes ? <div className="ld-note">{h.notes}</div> : <span className="ld-empty" style={{ fontSize: 12 }}>No notes written.</span>}
          </Item>
        ))}
      </div>
    </>
  );
}

function StageTimeline({ items }) {
  const it = useItems(items.length);
  return (
    <>
      {it.tools}
      <div className="ld-scroll">
        <div className="ld-list ld-timeline">
          {items.map((h, i) => {
            const system = !h.changedByName || /^system$/i.test(h.changedByName);
            return (
              <Item
                key={i}
                dot={stageColor(h.toStage) || "#64748b"}
                open={it.isOpen(i)}
                onToggle={() => it.toggle(i)}
                title={
                  <>
                    {h.fromStage ? (
                      <>
                        <StageChip stage={h.fromStage} />
                        <ArrowRightOutlined className="ld-arrow" />
                      </>
                    ) : null}
                    <StageChip stage={h.toStage} />
                  </>
                }
                meta={
                  <>
                    {h.toSubStatus ? <span><TagOutlined />{h.toSubStatus}</span> : null}
                    <span>{system ? <RobotOutlined /> : <UserOutlined />}{h.changedByName || "System"}</span>
                    <span><CalendarOutlined />{fmt(h.at)}</span>
                  </>
                }
                side={i === 0 ? <span className="ld-pill blue">Current</span> : null}
              >
                <Kv
                  rows={[
                    ["From", h.fromStage ? `${h.fromStage}${h.fromSubStatus ? ` · ${h.fromSubStatus}` : ""}` : "— (first stage)", <HistoryOutlined key="f" />],
                    ["To", `${h.toStage || "—"}${h.toSubStatus ? ` · ${h.toSubStatus}` : ""}`, <ArrowRightOutlined key="t" />],
                    ["Changed by", h.changedByName || "System", system ? <RobotOutlined key="b" /> : <UserOutlined key="b" />],
                    ["On call of", h.onCallOf, <PhoneOutlined key="p" />],
                    ["When", fmt(h.at), <CalendarOutlined key="w" />],
                  ]}
                />
                {h.remarks ? <div className="ld-note">{h.remarks}</div> : null}
              </Item>
            );
          })}
        </div>
      </div>
    </>
  );
}

// A name / number in any table that opens the full detail on click — for
// pages that list calls or numbers rather than Lead rows.
//   <LeadLink phone={r.phone}>{r.contactName}</LeadLink>
export function LeadLink({ phone, lead, children }) {
  const [open, setOpen] = useState(false);
  if (!phone && !lead) return children || "—";
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title="Click for full details"
        style={{ cursor: "pointer", color: "var(--hub-blue)", fontWeight: 600 }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
      >
        {children || phone || "—"}
      </span>
      {open && <LeadFullDetailModal lead={lead} phone={phone} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function LeadFullDetailModal({ lead: row, phone: phoneProp, onClose }) {
  const open = !!(row || phoneProp);
  const id = row && (row.crmLeadId || row.leadId || row._id);
  const phone = (row && row.phone) || phoneProp;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let gone = false;
    setData(null);
    setError(null);
    const qs = new URLSearchParams();
    if (id) qs.set("id", id);
    if (phone) qs.set("phone", phone);
    request.get({ entity: `lead/full-detail?${qs.toString()}` }).then((r) => {
      if (gone) return;
      if (r?.success) setData(r.result);
      else setError(r?.message || "Could not load the details.");
    });
    return () => {
      gone = true;
    };
  }, [open, id, phone]);

  if (!open) return null;

  // Until it loads, show what the row already has.
  const l = (data && data.lead) || row || {};
  const t = data?.totals;
  const extra = [
    ["Email", l.email],
    ["Alt. Phone", l.alternatePhone],
    ["Source", l.source],
    ["Form", l.metaFormName],
    ["Assigned To", l.assignedUserName],
    ["Team", l.team],
    ["City", l.city],
    ["State", l.state],
    ["Country", l.country],
    ["Pin Code", l.zipcode],
    ["Persona", l.persona],
    ["Age", l.age],
    ["Gender", l.gender],
    ["Highest Qualification", l.highestQualification],
    ["Education", l.education],
    ["Profile", l.profile],
    ["Current CTC", l.currentCtc],
    ["Pain Point", l.painPoint],
    ["Preferred Language", l.preferredLanguage],
    ["Budget", l.budgetRange],
    ["How Soon To Start", l.howSoonToStart],
    ["Call Back On", l.callBackAt && fmt(l.callBackAt)],
    ["Demo / Meeting", l.meetingAt && fmt(l.meetingAt)],
    ["Future Follow-up", fmtDay(l.futureFollowUpAt)],
    ["Enrolled On", fmtDay(l.enrolledAt)],
    ["Last Contact", l.lastContactAt && fmt(l.lastContactAt)],
    ["Came In", l.facebookCreatedAt ? fmt(l.facebookCreatedAt) : l.created && fmt(l.created)],
  ];
  const filled = extra.filter(([, v]) => v);
  const responses = Array.isArray(l.callHistory) ? [...l.callHistory].reverse() : [];
  const stages = Array.isArray(l.stageHistory) ? [...l.stageHistory].reverse() : [];
  const calls = data ? data.calls : [];
  const spoke = calls.filter((c) => c.answered).length;

  const name = l.name || (data && data.phone) || phone || "Lead";
  const shownPhone = l.phone || (data && data.phone) || phone || "";
  const dial = String(shownPhone).replace(/[^\d+]/g, "");
  const initials =
    String(l.name || "")
      .replace(/[^A-Za-z\s]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "#";
  const copyPhone = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(shownPhone).then(() => message.success("Number copied")).catch(() => {});
  };

  // Header: avatar in the stage's colour, the name, and chips (number with copy / call, stage, source, owner).
  const hero = (
    <span className="ld-hero" style={{ "--ld-hero": (l.stage && stageColor(l.stage)) || "#2563eb" }}>
      <span className="ld-avatar" aria-hidden="true">{initials}</span>
      <span className="ld-hero-text">
        <span className="ld-hero-name">{name}</span>
        <span className="ld-hero-chips">
          {shownPhone ? (
            <span className="ld-chip phone">
              <PhoneOutlined />
              {shownPhone}
              <button type="button" className="ld-chip-btn" title="Copy number" aria-label="Copy number" onClick={copyPhone}>
                <CopyOutlined />
              </button>
              {dial ? (
                <a className="ld-chip-btn" href={`tel:${dial}`} title="Call this number" aria-label="Call this number" onClick={(e) => e.stopPropagation()}>
                  <PhoneOutlined />
                </a>
              ) : null}
            </span>
          ) : null}
          {l.stage ? (
            <span className={`hub-badge ${badgeClassForStatus(l.stage)}`} style={{ height: 26, display: "inline-flex", alignItems: "center" }}>
              {l.stage}
            </span>
          ) : null}
          {l.subStatus ? <span className="ld-chip"><TagOutlined />{l.subStatus}</span> : null}
          {l.source ? <span className="ld-chip"><GlobalOutlined />{l.source}</span> : null}
          {l.assignedUserName ? <span className="ld-chip"><UserOutlined />{l.assignedUserName}</span> : null}
        </span>
      </span>
    </span>
  );

  return (
    <HubModal
      open
      onClose={onClose}
      title={hero}
      width={860}
      footer={<button type="button" className="hub-btn hub-btn-primary" onClick={onClose}>Close</button>}
    >
      <div className="hub-stack" style={{ gap: 12 }}>
        {error && <div style={{ ...box, color: "#b91c1c" }}>{error}</div>}
        {!data && !error && <div style={{ fontSize: 13, color: "var(--hub-muted)" }}>Loading calls and details…</div>}

        {t && (
          <div className="ld-stats">
            <StatTile icon={<PhoneOutlined />} color="#2563eb" value={t.calls} label="Calls" />
            <StatTile
              icon={<CustomerServiceOutlined />}
              color="#16a34a"
              value={`${t.connected}${t.calls ? ` · ${Math.round((t.connected / t.calls) * 100)}%` : ""}`}
              label="Spoke"
            />
            <StatTile icon={<SoundOutlined />} color="#7c3aed" value={talk(t.talkSeconds)} label="Total talk time" />
            <StatTile icon={<CalendarOutlined />} color="#d97706" value={t.lastCallAt ? fmt(t.lastCallAt) : "—"} label="Last call" title={t.lastCallAt ? fmt(t.lastCallAt) : ""} />
          </div>
        )}
        {t && (
          <div className="ld-people">
            <em>Who spoke to them:</em>
            {t.people.length ? (
              t.people.map((p) => (
                <span key={p} className="ld-person">
                  <i>{p.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</i>
                  {p}
                </span>
              ))
            ) : (
              <span className="ld-empty" style={{ fontSize: 12 }}>nobody yet</span>
            )}
          </div>
        )}

        <Accordion
          icon={<ProfileOutlined />}
          title="Details filled in"
          summary={filled.length ? `${filled.length} field${filled.length === 1 ? "" : "s"} filled${l.source ? ` · ${l.source}` : ""}` : "Nothing filled in yet"}
          count={filled.length}
          accent="#4f46e5"
          defaultOpen
        >
          {filled.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
              {filled.map(([k, v]) => (
                <Field key={k} k={k} v={v} />
              ))}
            </div>
          ) : (
            <div className="ld-empty">Nothing filled in yet.</div>
          )}
          {(l.message || l.remarks) && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 14 }}>
              {l.message && (
                <div>
                  <div style={label}><FileTextOutlined /> Requirement / Message</div>
                  <div style={box}>{l.message}</div>
                </div>
              )}
              {l.remarks && (
                <div>
                  <div style={label}><FileTextOutlined /> Remarks</div>
                  <div style={box}>{l.remarks}</div>
                </div>
              )}
            </div>
          )}
        </Accordion>

        {data && (
          <Accordion
            icon={<PhoneOutlined />}
            title="Calls"
            summary={calls.length ? `${spoke} spoke · ${calls.length - spoke} not connected${t && t.lastCallAt ? ` · last ${fmt(t.lastCallAt)}` : ""}` : "No calls to this number yet"}
            count={calls.length}
            accent="#16a34a"
            defaultOpen
          >
            {calls.length ? <CallsList calls={calls} /> : <div className="ld-empty">No calls to this number yet.</div>}
          </Accordion>
        )}

        {data && data.callbacks.length > 0 && (
          <Accordion
            icon={<ClockCircleOutlined />}
            title="Pending callbacks"
            summary={`Next: ${fmt(data.callbacks[0].scheduledAt)}`}
            count={data.callbacks.length}
            accent="#db2777"
            defaultOpen
          >
            <div className="ld-list">
              {data.callbacks.map((cb) => (
                <div key={cb._id} className="ld-item" style={{ "--ld-dot": "#db2777", padding: "9px 12px", fontSize: 13 }}>
                  <div className="ld-item-title">
                    <CalendarOutlined style={{ color: "#db2777" }} />
                    {fmt(cb.scheduledAt)}
                  </div>
                  <div className="ld-item-meta" style={{ marginTop: 2 }}>
                    <span><UserOutlined />{cb.assignedAgentName || "—"}</span>
                    {cb.notes ? <span>{cb.notes}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </Accordion>
        )}

        {responses.length > 0 && (
          <Accordion
            icon={<MessageOutlined />}
            title="Responses saved"
            summary={`Latest: ${responses[0].outcome || "Response"} · ${responses[0].byName || "—"} · ${fmt(responses[0].at)}`}
            count={responses.length}
            accent="#0891b2"
            defaultOpen
          >
            <ResponsesList items={responses} />
          </Accordion>
        )}

        {stages.length > 0 && (
          <Accordion
            icon={<HistoryOutlined />}
            title="Stage history"
            summary={`Now: ${stages[0].toStage || "—"}${stages[0].toSubStatus ? ` · ${stages[0].toSubStatus}` : ""} · ${stages.length} change${stages.length === 1 ? "" : "s"}`}
            count={stages.length}
            accent="#7c3aed"
            defaultOpen
          >
            <StageTimeline items={stages} />
          </Accordion>
        )}
      </div>
    </HubModal>
  );
}
