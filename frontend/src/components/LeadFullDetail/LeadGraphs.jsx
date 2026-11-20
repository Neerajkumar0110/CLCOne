import React from "react";

// Sales One Place design — the graphs in the lead popup. Built only from what
// lead/full-detail already returns (calls[], lead.stageHistory, lead.created);
// nothing new is fetched.
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA");
const dayLabel = (k) => new Date(`${k}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const mmss = (s) => {
  const n = Math.round(Number(s) || 0);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
const shortDay = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");

export default function LeadGraphs({ calls = [], stages = [], created, currentStage }) {
  const withDate = calls.filter((c) => c && c.at);
  // Calls per day — the last 7 days that had a call.
  const byDay = {};
  withDate.forEach((c) => {
    const k = dayKey(c.at);
    byDay[k] = byDay[k] || { spoke: 0, not: 0 };
    if (c.answered) byDay[k].spoke += 1;
    else byDay[k].not += 1;
  });
  const days = Object.keys(byDay).sort().slice(-7);
  const maxDay = Math.max(1, ...days.map((k) => byDay[k].spoke + byDay[k].not));

  // Spoke vs not
  const spoke = calls.filter((c) => c.answered).length;
  const notPlaced = calls.filter((c) => !c.answered && (c.notPlaced || c.missedByAgent)).length;
  const notConn = calls.length - spoke - notPlaced;
  const pct = (n) => (calls.length ? (n / calls.length) * 100 : 0);
  const parts = [
    ["Spoke", spoke, "#0F766E"],
    ["Not connected", notConn, "#94A3B8"],
    ["Missed / not placed", notPlaced, "#EA580C"],
  ];
  let acc = 0;

  // Talk time per call — the last 7 calls that connected.
  const talked = withDate
    .filter((c) => c.answered)
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .slice(-7);
  const maxTalk = Math.max(1, ...talked.map((c) => Number(c.talkSeconds) || 0));

  // Stage journey — oldest first, ending at the stage it is in now.
  const path = [...stages].sort((a, b) => new Date(a.at) - new Date(b.at));
  const steps = [{ stage: path[0]?.fromStage || "New Lead", at: created, by: "System" }].concat(
    path.map((h) => ({ stage: h.toStage, at: h.at, by: h.changedByName }))
  );

  if (!calls.length && !path.length) return null;
  return (
    <div className="ld-graphs">
      {calls.length > 0 && (
        <div className="ld-gbox">
          <h4>
            Calls per day
            <span className="ld-legend">
              <span><i style={{ background: "#0F766E" }} />Spoke</span>
              <span><i style={{ background: "#CBD5E1" }} />Not connected</span>
            </span>
          </h4>
          {days.length ? (
            <div className="ld-cbars" role="img" aria-label="Calls per day">
              {days.map((k) => (
                <div key={k} title={`${dayLabel(k)}: ${byDay[k].spoke} spoke, ${byDay[k].not} not connected`}>
                  <i style={{ height: `${(byDay[k].not / maxDay) * 100}%`, background: "#CBD5E1" }} />
                  <i style={{ height: `${(byDay[k].spoke / maxDay) * 100}%`, background: "#0F766E" }} />
                  <span>{dayLabel(k)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="ld-empty">No data available.</div>
          )}
        </div>
      )}
      {calls.length > 0 && (
        <div className="ld-gbox">
          <h4>Spoke vs not</h4>
          <div className="ld-donut-row">
            <svg width="116" height="116" viewBox="0 0 42 42" role="img" aria-label={`Spoke ${Math.round(pct(spoke))} percent`}>
              <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EEF2F6" strokeWidth="6" />
              {parts.map(([l, n, c]) => {
                const p = pct(n);
                const el =
                  p > 0 ? (
                    <circle key={l} cx="21" cy="21" r="15.915" fill="none" stroke={c} strokeWidth="6" strokeDasharray={`${p} ${100 - p}`} strokeDashoffset={25 - acc} />
                  ) : null;
                acc += p;
                return el;
              })}
              <text x="21" y="23.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="Space Grotesk, Inter, sans-serif">
                {Math.round(pct(spoke))}%
              </text>
            </svg>
            <div className="ld-legend col">
              {parts.map(([l, n, c]) => (
                <span key={l}>
                  <i style={{ background: c }} />
                  {l} <b>{n}</b>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {talked.length > 0 && (
        <div className="ld-gbox">
          <h4>Talk time per call</h4>
          {talked.map((c, i) => (
            <div key={`${c.at}-${i}`} className="ld-hb">
              <span>{shortDay(c.at)}</span>
              <span className="t"><b style={{ width: `${((Number(c.talkSeconds) || 0) / maxTalk) * 100}%` }} /></span>
              <span className="n">{mmss(c.talkSeconds)}</span>
            </div>
          ))}
        </div>
      )}
      {path.length > 0 && (
        <div className="ld-gbox">
          <h4>Stage journey</h4>
          <div className="ld-journey">
            {steps.map((s, i) => {
              const last = i === steps.length - 1;
              const meta = [shortDay(s.at), s.by, last && (!currentStage || s.stage === currentStage) ? "now" : ""].filter(Boolean).join(" · ");
              return (
                <React.Fragment key={`${s.stage}-${i}`}>
                  {i > 0 && <span className="ld-jarrow" aria-hidden="true">→</span>}
                  <span className={last ? "ld-stp cur" : "ld-stp"}>
                    {s.stage || "—"}
                    <small>{meta}</small>
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
