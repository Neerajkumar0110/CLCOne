import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Modal, message } from "antd";
import { LoginOutlined, LogoutOutlined, CoffeeOutlined, CalendarOutlined, GiftOutlined, PlayCircleOutlined, PhoneOutlined, CloseOutlined } from "@ant-design/icons";
import { request } from "@/request";
import { getSocket } from "@/socket";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { DEPARTMENT_ROLES } from "@/config/roles";
import LeaveModal from "./LeaveModal";
import "./workday.css";

// Header work-day widget (backend /api/workday, services/hr/workday.js):
//   not logged in → [Login]   (Sales: turns the auto-dialer on)
//   logged in     → ● Working 2:14  [Break]  [Logout]
//   on a break    → ● Tea Break 08:12 left  [End break]
//   + holiday / leave chip, and [Leave] (calendar) always.
// Everything opens in a modal.

// Sales users only — admins, Super Admin, Support, Finance and LMS accounts
// (candidates / teachers) never see it.
const forRole = (role) => DEPARTMENT_ROLES.Sales.includes(role);
const pad = (n) => String(n).padStart(2, "0");
const hm = (min) => `${Math.floor(min / 60)}:${pad(min % 60)}`;
const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const clock = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : "—");
const to12 = (hmStr) => {
  const [h, m] = String(hmStr).split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const greet = () => {
  const h = Number(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
};
const TARGET_MIN = 8 * 60;
const toMin = (hmStr) => {
  const [h, m] = String(hmStr).split(":").map(Number);
  return h * 60 + m;
};
const istNowMin = (ms) => {
  const [h, m] = new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }).split(":").map(Number);
  return h * 60 + m;
};
// Today's next scheduled break not taken yet (its window not over), and how
// far off it is — the header shows it; the break starts on its own then.
const nextBreak = (breaks, ms) => {
  const nowMin = istNowMin(ms);
  const b = (breaks || []).find((x) => !x.taken && x.start && nowMin < toMin(x.end));
  return b ? { ...b, inMin: toMin(b.start) - nowMin } : null;
};

// Shared shell for the Login / Break / Logout modals — gradient header in
// the action's colour, same look as the leave modal.
function WdModal({ open, onClose, tone, icon, title, subtitle, aside, children }) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} width={520} destroyOnClose className={`wm-modal wm-${tone}`} styles={{ content: { padding: 0, overflow: "hidden", borderRadius: 20 } }}>
      <div className="wm-head">
        <span className="wm-head-ico">{icon}</span>
        <div className="wm-head-txt">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {aside}
        <button type="button" className="lv-close" onClick={onClose} aria-label="Close"><CloseOutlined /></button>
      </div>
      <div className="wm-body">{children}</div>
    </Modal>
  );
}

// Worked time vs the day's target, as a progress ring.
function Ring({ value, max, label, sub }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, value / max);
  return (
    <div className="wm-ring">
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} className="track" />
        <circle cx="60" cy="60" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div>
        <b>{label}</b>
        <span>{sub}</span>
      </div>
    </div>
  );
}

export default function WorkdayWidget() {
  const admin = useSelector(selectCurrentAdmin);
  const [data, setData] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [modal, setModal] = useState(null); // login | break | logout | leave
  const [busy, setBusy] = useState(false);
  // dialer on but no Login today → the login prompt comes back every 5 minutes
  const [nudge, setNudge] = useState(null); // null | { by }
  const lastNudgeRef = useRef(0);

  const load = useCallback(async () => {
    const r = await request.get({ entity: "workday/me" });
    if (r?.success) setData(r.result);
  }, []);

  useEffect(() => {
    if (!admin || !forRole(admin.role)) return undefined;
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [admin, load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!data?.loginReminder) {
      if (nudge && data?.session?.loginAt) setNudge(null);
      return;
    }
    if (Date.now() - lastNudgeRef.current < 5 * 60 * 1000) return;
    lastNudgeRef.current = Date.now();
    setNudge({ by: null });
    setModal("login");
  }, [data, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // management pressed Remind in Sales 360° → show it right away
  useEffect(() => {
    if (!admin || !forRole(admin.role)) return undefined;
    const socket = getSocket();
    const onRemind = (p) => {
      lastNudgeRef.current = Date.now();
      setNudge({ by: p?.by || null });
      setModal("login");
      load();
    };
    socket?.on("workday:remind-login", onRemind);
    // a scheduled break just started on its own → show the break timer now
    const onChanged = (p) => {
      if (p?.resumed) message.success("Break over — your auto-dialer is back on.");
      else message.info("Break time — your auto-dialer is paused until the break ends.");
      load();
    };
    socket?.on("workday:changed", onChanged);
    return () => {
      socket?.off("workday:remind-login", onRemind);
      socket?.off("workday:changed", onChanged);
    };
  }, [admin, load]);

  if (!admin || !forRole(admin.role) || !data) return null;

  const act = async (entity, body = {}) => {
    setBusy(true);
    const r = await request.post({ entity, jsonData: body });
    setBusy(false);
    if (r?.success) {
      message.success(r.message);
      setModal(null);
      load();
    } else message.error(r?.message || "Something went wrong.");
    return r;
  };

  const s = data.session;
  const breakMin = (s?.breaks || []).reduce((t, b) => {
    const end = b.endAt ? new Date(b.endAt) : new Date(Math.min(now, new Date(b.startAt).getTime() + b.plannedMin * 60000));
    return t + Math.max(0, Math.round((end - new Date(b.startAt)) / 60000));
  }, 0);
  const started = s?.loginAt || s?.autoStartedAt;
  const workedMin = started ? Math.max(0, Math.round((now - new Date(started)) / 60000) - breakMin) : 0;
  const onBreak = data.onBreak && new Date(data.onBreak.until).getTime() > now ? data.onBreak : null;
  const off = data.dayOff;
  const upcoming = data.loggedIn && !onBreak ? nextBreak(data.breaks, now) : null;

  return (
    <div className="wd-bar">
      {data.holiday && (
        <span className="wd-pill is-holiday" title={`Holiday — ${data.holiday.name}`}>
          <GiftOutlined /> <span className="wd-label">Holiday · {data.holiday.name}</span>
        </span>
      )}
      {!data.holiday && off?.kind === "leave" && (
        <span className="wd-pill is-leave">
          <CalendarOutlined /> <span className="wd-label">On leave today</span>
        </span>
      )}
      {data.leaveNow && off?.kind !== "leave" && (
        <span className="wd-pill is-leave" title={data.leaveNow.label}>
          <CalendarOutlined /> <span className="wd-label">On leave till {clock(data.leaveNow.until)}</span>
        </span>
      )}

      {!data.loggedIn && (
        <button type="button" className="wd-pill is-login" onClick={() => setModal("login")}>
          <LoginOutlined /> <span className="wd-label">{data.autoStarted ? "Login (dialer auto-started)" : "Login"}</span>
        </button>
      )}

      {data.loggedIn && !onBreak && (
        <>
          <span className="wd-pill is-working" title={`Logged in at ${clock(s.loginAt)}`}>
            <span className="wd-dot" /> <span className="wd-label">Working</span> <span className="wd-time">{hm(workedMin)}</span>
          </span>
          <button
            type="button"
            className="wd-pill"
            onClick={() => setModal("break")}
            title={upcoming ? `${upcoming.label} at ${to12(upcoming.start)} — the dialer turns off on its own then (${upcoming.durationMin} min)` : "Take a break"}
          >
            <CoffeeOutlined />{" "}
            {upcoming ? (
              <>
                <span className="wd-label">{upcoming.label}</span>{" "}
                <span className="wd-time">
                  {upcoming.inMin > 0
                    ? upcoming.inMin <= 60
                      ? `in ${upcoming.inMin}m`
                      : to12(upcoming.start)
                    : "now"}
                </span>
              </>
            ) : (
              <span className="wd-label">Break</span>
            )}
          </button>
          <button type="button" className="wd-pill is-icon" title="Logout" onClick={() => setModal("logout")}>
            <LogoutOutlined />
          </button>
        </>
      )}

      {data.loggedIn && onBreak && (
        <button type="button" className="wd-pill is-break" onClick={() => act("workday/break/end")} disabled={busy} title="End break and resume">
          <span className="wd-dot" /> <span className="wd-label">{onBreak.label}</span>
          <span className="wd-time">{mmss(new Date(onBreak.until).getTime() - now)} left</span>
          <PlayCircleOutlined />
        </button>
      )}

      <button type="button" className="wd-pill is-icon" title="Leave / calendar" onClick={() => setModal("leave")}>
        <CalendarOutlined />
      </button>

      {/* ── Login ── */}
      {/* ── Login ── */}
      <WdModal
        open={modal === "login"}
        onClose={() => setModal(null)}
        tone="green"
        icon="👋"
        title={`Good ${greet()}, ${admin.name}`}
        subtitle={new Date(now).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}
        aside={<div className="wm-clock">{new Date(now).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit" })}</div>}
      >
        <div className="wm-cards">
          <div className="wm-card" style={{ "--c": "#2563eb" }}>
            <span className="wm-ico">🕙</span>
            <b>{to12(data.workday.start)} – {to12(data.workday.end)}</b>
            <span>Today's shift</span>
          </div>
          <div className="wm-card" style={{ "--c": data.dialer.eligible && !off ? "#16a34a" : "#94a3b8" }}>
            <span className="wm-ico">📞</span>
            <b>{!data.dialer.eligible ? "Not on dialer" : off ? "Stays off" : "Turns on"}</b>
            <span>Auto-dialer</span>
          </div>
          <div className="wm-card" style={{ "--c": "#d97706" }}>
            <span className="wm-ico">☕</span>
            <b>{data.breaks.length} breaks</b>
            <span>{data.breaks.reduce((t, b) => t + b.durationMin, 0)} min in total</span>
          </div>
        </div>

        <div className="wm-sched">
          {data.breaks.map((b) => (
            <span key={b.key}><i />{b.label} · {b.window}</span>
          ))}
        </div>

        {nudge && (
          <div className="wm-note amber" style={{ fontWeight: 600 }}>
            ⚠️ {data.dialer.on ? "Your auto-dialer is on but you haven't logged in." : "You haven't logged in today."} Please press <b>Start my day</b>.
            {nudge.by ? <> (Reminder from {nudge.by})</> : <> This reminder comes back every 5 minutes until you log in.</>}
          </div>
        )}
        {data.holiday && <div className="wm-note pink">🎉 Today is a holiday — <b>{data.holiday.name}</b>. You can still log in; the dialer stays off.</div>}
        {off?.kind === "leave" && <div className="wm-note amber">🌴 You're on approved leave today — the dialer stays off.</div>}
        {data.leaveNow && off?.kind !== "leave" && <div className="wm-note amber">⏳ You're on leave until <b>{clock(data.leaveNow.until)}</b> — the dialer starts after that.</div>}
        {data.autoStarted && <div className="wm-note blue">⚡ Your auto-dialer was started at <b>{clock(s.autoStartedAt)}</b> because you hadn't logged in.</div>}
        {data.dialer.eligible && !off && !data.leaveNow && (
          <div className="wm-note green"><PhoneOutlined /> Calls start coming the moment you log in.</div>
        )}

        <button type="button" className="wm-btn green" disabled={busy} onClick={() => act("workday/login")}>
          {busy ? <span className="lv-spin" /> : <LoginOutlined />} {busy ? "Starting…" : "Start my day"}
        </button>
      </WdModal>

      {/* ── Break ── */}
      <WdModal
        open={modal === "break"}
        onClose={() => setModal(null)}
        tone="amber"
        icon="☕"
        title="Take a break"
        subtitle="Breaks start on their own at the scheduled time — your dialer pauses and starts again when the break ends. You can also start one now."
      >
        <div className="wm-breaks">
          {data.breaks.map((b, i) => (
            <button
              key={b.key}
              type="button"
              className={`wm-break ${b.taken ? "taken" : ""}`}
              disabled={b.taken || busy}
              style={{ animationDelay: `${i * 60}ms` }}
              onClick={() => act("workday/break/start", { key: b.key })}
            >
              <span className="wm-break-ico">{b.key === "lunch" ? "🍱" : "☕"}</span>
              <b>{b.label}</b>
              <span className="wm-break-min">{b.durationMin} min</span>
              <span className="wm-break-win">auto at {to12(b.start || b.window.split("–")[0])}</span>
              {b.taken ? <span className="wm-tag done">✓ Taken today</span> : <span className="wm-tag">Start now →</span>}
            </button>
          ))}
        </div>
        <div className="wm-note blue" style={{ marginTop: 14 }}>💡 Back early? Tap the timer in the header to end the break and resume calls.</div>
      </WdModal>

      {/* ── Logout ── */}
      <WdModal
        open={modal === "logout"}
        onClose={() => setModal(null)}
        tone="rose"
        icon="🌙"
        title="Wrap up for the day?"
        subtitle={`Logged in at ${clock(s?.loginAt)}`}
      >
        <div className="wm-sum">
          <Ring value={workedMin} max={TARGET_MIN} label={hm(workedMin)} sub="worked" />
          <div className="wm-sum-stats">
            <div><b>{clock(s?.loginAt)}</b><span>Logged in</span></div>
            <div><b>{breakMin}m</b><span>On breaks ({(s?.breaks || []).length})</span></div>
            <div><b>{Math.round((workedMin / TARGET_MIN) * 100)}%</b><span>of the {TARGET_MIN / 60}h target</span></div>
          </div>
        </div>
        {data.dialer.eligible && <div className="wm-note amber">📴 Logging out turns your auto-dialer off — no more calls today.</div>}
        <div className="wm-actions">
          <button type="button" className="wm-btn ghost" onClick={() => setModal(null)}>Keep working</button>
          <button type="button" className="wm-btn rose" disabled={busy} onClick={() => act("workday/logout")}>
            {busy ? <span className="lv-spin" /> : <LogoutOutlined />} {busy ? "Logging out…" : "Logout"}
          </button>
        </div>
      </WdModal>

      <LeaveModal open={modal === "leave"} onClose={() => setModal(null)} data={data} onChanged={load} />
    </div>
  );
}
