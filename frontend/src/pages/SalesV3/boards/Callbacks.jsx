import React, { useState } from "react";
import { message } from "antd";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { usePoll, dialContact } from "@/pages/Calling/shared";
import { LeadLnk, AgentLnk } from "../popups/Popups";

// v3 design — S3Callbacks, real data: GET calling/callbacks?scope=all (&agent=me
// for "Mine"), PATCH calling/callbacks/:id {status}, call straight off the row
// (same dialContact as the old screen — the in-call popup opens by itself).
const MANAGEMENT = ["owner", "Super Admin", "Admin", "Sales Manager", "Team Manager"];
const IST = { timeZone: "Asia/Kolkata" };
const when = (v, list) => {
  const d = v && new Date(v);
  if (!d || Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", minute: "2-digit", hour12: false });
  const day = d.toLocaleDateString("en-CA", IST);
  const today = new Date().toLocaleDateString("en-CA", IST);
  const yest = new Date(Date.now() - 864e5).toLocaleDateString("en-CA", IST);
  const tom = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", IST);
  if (day === today) return list === "today" ? time : `Today ${time}`;
  if (day === yest) return `Yesterday ${time}`;
  if (day === tom) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" })} ${time}`;
};
// What the auto-dialer has done with the row (same rules as the old screen).
const auto = (cb) => {
  if (cb.status !== "Pending") return null;
  if (cb.autoDialGaveUpAt) return ["Call by hand", "b rd", "Auto-dial gave up after repeated failures — call this one by hand."];
  if (cb.dialAttempts) return [`Tried ${cb.dialAttempts}×`, "b or", `Auto-dialled ${cb.dialAttempts} time(s) — nobody picked up yet.`];
  if (new Date(cb.scheduledAt) <= new Date()) return ["Waiting", "b bl", "Due now — it goes out as soon as the assigned agent is free."];
  return ["Scheduled", "b gr", "This will be dialled automatically at the scheduled time."];
};
const TABS = [
  ["overdue", "Overdue", { color: "#B42318" }],
  ["today", "Today", {}],
  ["upcoming", "Upcoming", {}],
  ["completed", "Completed", { color: "#0B7A55" }],
];

export default function Callbacks() {
  const me = useSelector(selectCurrentAdmin);
  const manager = MANAGEMENT.includes(me?.role);
  const [scope, setScope] = useState("all");
  const [tab, setTab] = useState("");
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [dialingId, setDialingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const mine = scope === "mine" && me?._id ? `&agent=${me._id}` : "";
    const r = await request.get({ entity: `calling/callbacks?scope=all${mine}` });
    if (r?.success) {
      setData(r.result);
      setFailed(false);
    } else setFailed(true);
  };
  usePoll(load, 15000, [scope]);

  const setStatus = async (cb, status) => {
    await request.patch({ entity: `calling/callbacks/${cb._id}`, jsonData: { status } });
    load();
  };
  const callNow = async (cb) => {
    setDialingId(cb._id);
    const r = await dialContact({ phone: cb.phone, contactName: cb.contactName, callLead: cb.callLead, campaign: cb.campaign?._id || cb.campaign });
    setDialingId(null);
    if (r.ok) message.success(r.message || "Calling…");
    else message.error(r.message || "Could not start the call.");
  };

  const pick = tab || (data?.overdue?.length ? "overdue" : "today");
  const rows = (data && data[pick]) || [];

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">Sales › Callbacks</div>
          <h1>Callbacks</h1>
          <p className="lead">Every promised call-back. Same lists and actions (calling/callbacks).</p>
        </div>
        <div className="row">
          {manager && (
            <div className="seg" role="group" aria-label="Scope">
              {[["all", "All"], ["mine", "Mine"]].map(([k, l]) => (
                <button key={k} type="button" className={scope === k ? "on" : ""} onClick={() => { setScope(k); setData(null); }}>{l}</button>
              ))}
            </div>
          )}
          {/* the 15 s poll calls load() too; the button shows it is working and confirms */}
          <button type="button" className="btn" disabled={refreshing} onClick={async () => { setRefreshing(true); await load(); setRefreshing(false); message.success("Callbacks updated", 1.5); }}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button>
        </div>
      </div>

      <div className="kpis" role="tablist" aria-label="Callback lists">
        {TABS.map(([k, l, c]) => (
          <button key={k} type="button" role="tab" aria-selected={pick === k} className={pick === k ? "sv3-tb on" : "sv3-tb"} onClick={() => setTab(k)}>
            <div className="l" style={c}>{l}</div>
            <div className="v" style={c}>{data ? (data[k] || []).length : "—"}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!data && !failed && [0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 64 }} />)}
        {failed && !data && (
          <div className="state err"><b>Couldn’t load callbacks.</b><button type="button" className="btn sm" onClick={load}>Retry</button></div>
        )}
        {data && rows.length === 0 && <div className="state"><b>Nothing in this list.</b></div>}
        {data &&
          rows.map((cb) => {
            const a = auto(cb);
            const open = cb.status === "Pending";
            return (
              <div key={cb._id} className="sv3-cb">
                <div className="t" style={pick === "overdue" ? { color: "#B42318" } : undefined} title={new Date(cb.scheduledAt).toLocaleString("en-IN", IST)}>
                  {when(cb.scheduledAt, pick)}
                </div>
                <div className="w">
                  <b><LeadLnk phone={cb.phone} ink>{cb.contactName || "Unknown"}</LeadLnk></b> · {cb.phone ? <LeadLnk phone={cb.phone} /> : "no number"}
                  {cb.campaign?.name ? ` · ${cb.campaign.name}` : ""} {a && <span className={a[1]} title={a[2]}>{a[0]}</span>}
                  <div className="mut" style={{ fontSize: 12.5 }}>
                    {cb.assignedAgentName ? <AgentLnk name={cb.assignedAgentName} /> : "—"}
                    {cb.notes ? ` · ${cb.notes}` : ""}
                  </div>
                </div>
                <div className="row">
                  {open ? (
                    <>
                      <button type="button" className="btn sm p" onClick={() => setStatus(cb, "Done")}>Done</button>
                      <button type="button" className="btn sm" onClick={() => setStatus(cb, "Missed")}>Missed</button>
                    </>
                  ) : (
                    <span className={cb.status === "Done" ? "b gr" : "b or"}>{cb.status}</span>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}
