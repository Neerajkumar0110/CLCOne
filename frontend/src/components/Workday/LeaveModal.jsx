import React, { useEffect, useMemo, useState } from "react";
import { Modal, message, Popconfirm, Tooltip } from "antd";
import dayjs from "dayjs";
import {
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  HourglassOutlined,
  SunOutlined,
  CalendarOutlined,
  CheckOutlined,
  SendOutlined,
  GiftOutlined,
} from "@ant-design/icons";
import { request } from "@/request";

// Apply for leave from a calendar — 1 hour, 2 hours, half day, a day or
// several days (backend services/hr/workday.js applyLeave). Holidays HR
// added and the user's own leaves are marked on the calendar; approval goes
// to the approver by email and the status shows under "My leaves".

const DURATIONS = [
  { key: "h1", label: "1 hour", type: "hours", hours: 1, Icon: ClockCircleOutlined },
  { key: "h2", label: "2 hours", type: "hours", hours: 2, Icon: FieldTimeOutlined },
  { key: "half", label: "Half day", type: "half", Icon: HourglassOutlined },
  { key: "full", label: "Full day", type: "full", Icon: SunOutlined },
  { key: "multi", label: "Multiple days", type: "multi", Icon: CalendarOutlined },
];
const TYPE_STYLE = {
  Casual: ["🌴", "#0ea5e9"],
  Sick: ["🤒", "#ef4444"],
  Earned: ["⭐", "#f59e0b"],
  Unpaid: ["💼", "#64748b"],
  "Comp Off": ["🔁", "#8b5cf6"],
  Maternity: ["🍼", "#ec4899"],
  Paternity: ["👶", "#14b8a6"],
  Bereavement: ["🕊️", "#475569"],
};
const STATUS_STYLE = { Approved: "#16a34a", Pending: "#d97706", Rejected: "#dc2626", Cancelled: "#94a3b8", Withdrawn: "#94a3b8" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymd = (d) => dayjs(d).format("YYYY-MM-DD");
const istYmd = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const addHours = (hm, h) => dayjs(`2000-01-01T${hm}`).add(h, "hour").format("HH:mm");
const to12 = (hm) => dayjs(`2000-01-01T${hm}`).format("h:mm A");

export default function LeaveModal({ open, onClose, data, onChanged }) {
  const today = dayjs().startOf("day");
  const [month, setMonth] = useState(today.startOf("month"));
  const [slide, setSlide] = useState(""); // animation direction for the month grid
  const [date, setDate] = useState(today);
  const [toDate, setToDate] = useState(null);
  const [dur, setDur] = useState("full");
  const [fromTime, setFromTime] = useState("10:00");
  const [halfPart, setHalfPart] = useState("first");
  const [leaveType, setLeaveType] = useState("Casual");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [tab, setTab] = useState("apply");

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setTab("apply");
  }, [open]);

  const holidays = data?.holidays || [];
  const leaves = data?.leaves || [];
  const w = data?.workday || { start: "10:00", end: "19:30", halfSplit: "14:30", weeklyOff: [0] };
  const d = DURATIONS.find((x) => x.key === dur);
  const multi = d.type === "multi";

  // day → { holiday, leaves[] }
  const byDay = useMemo(() => {
    const m = new Map();
    const get = (k) => m.get(k) || (m.set(k, { leaves: [] }), m.get(k));
    for (const h of holidays) get(istYmd(h.date)).holiday = h;
    for (const l of leaves) {
      if (["Cancelled", "Withdrawn"].includes(l.status)) continue;
      let cur = dayjs(istYmd(l.fromDate));
      const end = dayjs(istYmd(l.toDate));
      for (let i = 0; i < 62 && !cur.isAfter(end); i += 1, cur = cur.add(1, "day")) get(cur.format("YYYY-MM-DD")).leaves.push(l);
    }
    return m;
  }, [holidays, leaves]);

  const cells = useMemo(() => {
    const start = month.startOf("month").startOf("week");
    return Array.from({ length: 42 }, (_, i) => start.add(i, "day"));
  }, [month]);

  const go = (n) => {
    setSlide(n > 0 ? "lv-next" : "lv-prev");
    setMonth((m) => m.add(n, "month"));
  };

  const pick = (day) => {
    if (day.isBefore(today)) return;
    if (!day.isSame(month, "month")) {
      setSlide(day.isAfter(month) ? "lv-next" : "lv-prev");
      setMonth(day.startOf("month"));
    }
    if (multi && date && !toDate && !day.isBefore(date) && !day.isSame(date, "day")) {
      setToDate(day);
      return;
    }
    setDate(day);
    setToDate(null);
  };

  const inRange = (day) => multi && toDate && day.isAfter(date, "day") && day.isBefore(toDate, "day");
  const pickedHoliday = byDay.get(ymd(date))?.holiday;
  const weeklyOff = (w.weeklyOff || []).includes(date.day());
  const hourSlots = useMemo(() => {
    const out = [];
    for (let h = parseInt(w.start, 10); h < parseInt(w.end, 10); h += 1) out.push(`${String(h).padStart(2, "0")}:00`);
    return out;
  }, [w.start, w.end]);

  const summary = (() => {
    const day = date.format("ddd, D MMM");
    if (d.type === "hours") return { big: d.label, small: `${day} · ${to12(fromTime)} – ${to12(addHours(fromTime, d.hours))}` };
    if (d.type === "half") return { big: "Half day", small: `${day} · ${halfPart === "first" ? `${to12(w.start)} – ${to12(w.halfSplit)}` : `${to12(w.halfSplit)} – ${to12(w.end)}`}` };
    if (multi) return toDate ? { big: `${toDate.diff(date, "day") + 1} days`, small: `${day} → ${toDate.format("ddd, D MMM")}` } : { big: "Pick the last day", small: "Tap the end date on the calendar" };
    return { big: "Full day", small: day };
  })();

  const submit = async () => {
    if (multi && !toDate) return message.warning("Tap the last day of your leave on the calendar.");
    if (!reason.trim()) return message.warning("Please add a reason.");
    setSaving(true);
    const res = await request.post({
      entity: "workday/leave",
      jsonData: { durationType: d.type, date: ymd(date), toDate: toDate ? ymd(toDate) : undefined, hours: d.hours, fromTime, halfPart, leaveType, reason: reason.trim() },
    });
    setSaving(false);
    if (res?.success) {
      setDone(true);
      setReason("");
      setToDate(null);
      onChanged?.();
    } else message.error(res?.message || "Could not apply for leave.");
  };

  const cancelLeave = async (id) => {
    const res = await request.post({ entity: `workday/leave/${id}/cancel`, jsonData: {} });
    if (res?.success) {
      message.success("Leave cancelled.");
      onChanged?.();
    } else message.error(res?.message || "Could not cancel.");
  };

  const mine = [...leaves].sort((a, b) => new Date(b.fromDate) - new Date(a.fromDate));
  const pending = mine.filter((l) => l.status === "Pending").length;
  const nextHolidays = holidays.filter((h) => new Date(h.date) >= today.toDate()).slice(0, 3);

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={1000} closable={false} destroyOnClose className="lv-modal" styles={{ content: { padding: 0, overflow: "hidden", borderRadius: 20 } }}>
      {/* ── header ── */}
      <div className="lv-head">
        <div>
          <h2>Leave & time off</h2>
          <p>Pick a day, choose how long — it goes to your manager for approval.</p>
        </div>
        <div className="lv-tabs">
          <button type="button" className={tab === "apply" ? "on" : ""} onClick={() => setTab("apply")}>Apply</button>
          <button type="button" className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>
            My leaves {pending > 0 && <span className="lv-count">{pending}</span>}
          </button>
        </div>
        <button type="button" className="lv-close" onClick={onClose} aria-label="Close"><CloseOutlined /></button>
      </div>

      {tab === "mine" ? (
        <div className="lv-body lv-fade">
          {mine.length === 0 ? (
            <div className="lv-empty"><CalendarOutlined /> <b>No leaves yet</b><span>Your requests and their approval status show up here.</span></div>
          ) : (
            <div className="lv-list">
              {mine.map((l, i) => {
                const [emoji, color] = TYPE_STYLE[l.leaveType] || ["📅", "#6366f1"];
                return (
                  <div key={l._id} className="lv-item" style={{ "--c": STATUS_STYLE[l.status] || "#94a3b8", animationDelay: `${i * 40}ms` }}>
                    <span className="lv-item-ico" style={{ background: `${color}1a` }}>{emoji}</span>
                    <div className="lv-item-main">
                      <b>{l.label}</b>
                      <span>
                        {l.leaveType}
                        {l.reason ? ` · ${l.reason}` : ""}
                      </span>
                      {(l.decisionBy || l.decisionNote) && (
                        <span className="lv-item-note">
                          {l.decisionBy ? `${l.status === "Approved" ? "Approved" : l.status === "Rejected" ? "Rejected" : "Updated"} by ${l.decisionBy}` : ""}
                          {l.decisionNote ? ` — “${l.decisionNote}”` : ""}
                        </span>
                      )}
                    </div>
                    <span className="lv-status">{l.status}</span>
                    {(l.status === "Pending" || (l.status === "Approved" && new Date(l.fromDate) > new Date())) && (
                      <Popconfirm title="Cancel this leave?" onConfirm={() => cancelLeave(l._id)} okText="Yes, cancel">
                        <button type="button" className="lv-link">Cancel</button>
                      </Popconfirm>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : done ? (
        <div className="lv-body lv-done">
          <div className="lv-check"><CheckOutlined /></div>
          <h3>Leave request sent!</h3>
          <p>Your manager has been emailed. You'll get a notification here as soon as it's approved.</p>
          <div className="lv-done-actions">
            <button type="button" className="lv-btn ghost" onClick={() => setTab("mine")}>View my leaves</button>
            <button type="button" className="lv-btn" onClick={() => setDone(false)}>Apply another</button>
          </div>
        </div>
      ) : (
        <div className="lv-body lv-grid">
          {/* ── calendar ── */}
          <div className="lv-cal-wrap">
            <div className="lv-cal">
              <div className="lv-cal-head">
                <div>
                  <span className="lv-month">{month.format("MMMM")}</span> <span className="lv-year">{month.format("YYYY")}</span>
                </div>
                <div className="lv-nav">
                  {!month.isSame(today, "month") && (
                    <button type="button" className="lv-today" onClick={() => { setSlide(month.isAfter(today) ? "lv-prev" : "lv-next"); setMonth(today.startOf("month")); }}>Today</button>
                  )}
                  <button type="button" onClick={() => go(-1)} disabled={month.isSame(today, "month")} aria-label="Previous month"><LeftOutlined /></button>
                  <button type="button" onClick={() => go(1)} aria-label="Next month"><RightOutlined /></button>
                </div>
              </div>
              <div className="lv-week">{WEEKDAYS.map((x) => <span key={x}>{x}</span>)}</div>
              <div key={month.format("YYYY-MM")} className={`lv-days ${slide}`}>
                {cells.map((day) => {
                  const k = ymd(day);
                  const info = byDay.get(k);
                  const out = !day.isSame(month, "month");
                  const past = day.isBefore(today);
                  const sel = day.isSame(date, "day") || (toDate && day.isSame(toDate, "day"));
                  const off = (w.weeklyOff || []).includes(day.day());
                  const leave = info?.leaves?.[0];
                  const cls = ["lv-day", out && "out", past && "past", off && "off", sel && "sel", inRange(day) && "range", day.isSame(today, "day") && "today", info?.holiday && "holiday"].filter(Boolean).join(" ");
                  const tip = [info?.holiday && `🎉 ${info.holiday.name}`, leave && `${leave.leaveType} leave · ${leave.status}`, off && !info?.holiday && "Weekly off"].filter(Boolean).join(" · ");
                  const cell = (
                    <button key={k} type="button" className={cls} onClick={() => pick(day)} disabled={past}>
                      <span className="n">{day.date()}</span>
                      <span className="dots">
                        {info?.holiday && <i style={{ background: "#ec4899" }} />}
                        {leave && <i style={{ background: STATUS_STYLE[leave.status] }} />}
                      </span>
                    </button>
                  );
                  return tip ? <Tooltip key={k} title={tip}>{cell}</Tooltip> : cell;
                })}
              </div>
            </div>
            <div className="lv-legend">
              <span><i style={{ background: "#ec4899" }} />Holiday</span>
              <span><i style={{ background: "#16a34a" }} />Approved</span>
              <span><i style={{ background: "#d97706" }} />Pending</span>
              <span><i style={{ background: "#dc2626" }} />Rejected</span>
              <span><i className="striped" />Weekly off</span>
            </div>
            {nextHolidays.length > 0 && (
              <div className="lv-hol">
                <b><GiftOutlined /> Upcoming holidays</b>
                {nextHolidays.map((h) => (
                  <div key={h._id}>
                    <span>{dayjs(istYmd(h.date)).format("ddd, D MMM")}</span>
                    {h.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── form ── */}
          <div className="lv-form">
            <div className="lv-step"><span>1</span> {date.format("dddd, D MMMM")}{multi && toDate ? ` → ${toDate.format("D MMMM")}` : ""}</div>
            {pickedHoliday && <div className="lv-alert pink">🎉 {pickedHoliday.name} is a holiday — no leave needed.</div>}
            {!pickedHoliday && weeklyOff && <div className="lv-alert blue">This is a weekly off day.</div>}

            <div className="lv-step"><span>2</span> How long?</div>
            <div className="lv-durs">
              {DURATIONS.map(({ key, label, Icon }) => (
                <button key={key} type="button" className={dur === key ? "on" : ""} onClick={() => { setDur(key); if (key !== "multi") setToDate(null); }}>
                  <Icon />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {d.type === "hours" && (
              <div className="lv-sub lv-fade">
                <small>Starting at</small>
                <div className="lv-chips">
                  {hourSlots.map((t) => (
                    <button key={t} type="button" className={fromTime === t ? "on" : ""} onClick={() => setFromTime(t)}>{to12(t)}</button>
                  ))}
                </div>
              </div>
            )}
            {d.type === "half" && (
              <div className="lv-sub lv-fade lv-halves">
                {[
                  ["first", "First half", `${to12(w.start)} – ${to12(w.halfSplit)}`],
                  ["second", "Second half", `${to12(w.halfSplit)} – ${to12(w.end)}`],
                ].map(([k, l, t]) => (
                  <button key={k} type="button" className={halfPart === k ? "on" : ""} onClick={() => setHalfPart(k)}>
                    <b>{l}</b>
                    <span>{t}</span>
                  </button>
                ))}
              </div>
            )}
            {multi && !toDate && <div className="lv-alert violet lv-fade">👉 Now tap the <b>last day</b> of your leave on the calendar.</div>}

            <div className="lv-step"><span>3</span> Type & reason</div>
            <div className="lv-types">
              {(data?.leaveTypes || Object.keys(TYPE_STYLE)).map((t) => {
                const [emoji, color] = TYPE_STYLE[t] || ["📅", "#6366f1"];
                return (
                  <button key={t} type="button" className={leaveType === t ? "on" : ""} style={{ "--c": color }} onClick={() => setLeaveType(t)}>
                    {emoji} {t}
                  </button>
                );
              })}
            </div>
            <div className="lv-reason">
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 1000))} placeholder="A line for your manager — e.g. doctor's appointment" />
              <span>{reason.length}/1000</span>
            </div>

            <div key={`${summary.big}${summary.small}`} className="lv-ticket lv-pop">
              <span className="lv-ticket-ico">{(TYPE_STYLE[leaveType] || ["📅"])[0]}</span>
              <div>
                <b>{summary.big}</b>
                <span>{summary.small}</span>
              </div>
              <em>{leaveType}</em>
            </div>

            <button type="button" className="lv-btn lv-submit" disabled={saving || !!pickedHoliday} onClick={submit}>
              {saving ? <span className="lv-spin" /> : <SendOutlined />} {saving ? "Sending…" : "Send for approval"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
