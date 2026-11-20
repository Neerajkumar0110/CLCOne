import React, { useEffect, useRef, useState } from "react";
import { message } from "antd";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { FULL_ACCESS_ROLES } from "@/config/permissionModules";
import { STAGE_NAMES } from "@/config/leadStages";
import { openTel, usePoll } from "@/pages/Calling/shared";
import { Head, Pager, Skel, Empty, nf, initials, fmtWhen, stageBadge } from "../ui";
import { LeadLnk } from "../popups/Popups";

// v3 design — S3DialerAgent › Dialer. Same APIs as before:
//   lead/my-contacts?page&items&stage&owner&q → contacts (+ stageCounts, ownerCounts)
//   calling/history?items&page                → recent calls
//   calling/manual/dial · calling/agent/active (1 s while calling) · calling/manual/end/:id
//   lead update after the call (New Lead / No Response only), calling/status, admin read
const CAN_SEE_AGENT_NUMBER = [...FULL_ACCESS_ROLES, "Team Manager"];
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const clean = (raw) => {
  const s = String(raw || "");
  const lead = s.trimStart().startsWith("+") ? "+" : "";
  return (lead + s.replace(/[^\d*#]/g, "")).slice(0, 20);
};
const mmss = (t) => `${Math.floor((t || 0) / 60)}:${String(Math.floor((t || 0) % 60)).padStart(2, "0")}`;
const PH = "M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2z";
const Phone = ({ s = 16 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={PH} /></svg>;

export default function Dialer({ go }) {
  const me = useSelector(selectCurrentAdmin);
  const [tab, setTab] = useState("contacts");
  const [num, setNum] = useState("");
  const inRef = useRef(null);
  const [prov, setProv] = useState(null);
  const [agentPhone, setAgentPhone] = useState("");
  // contacts
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("All");
  const [owner, setOwner] = useState("");
  const [cp, setCp] = useState(1);
  const [c, setC] = useState({ rows: [], count: 0, pages: 1, stageCounts: {}, ownerCounts: { all: 0, given: 0, pool: 0 }, loading: true });
  // recent
  const [rp, setRp] = useState(1);
  const [r, setR] = useState({ rows: [], count: 0, pages: 1, loading: true });
  // the call
  const [call, setCall] = useState(null); // { id, contact, status, answeredAt }
  const [dialing, setDialing] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    request.get({ entity: "calling/status" }).then((x) => x?.success && setProv(x.result));
  }, []);
  useEffect(() => {
    if (!me?._id) return;
    request.read({ entity: "admin", id: me._id }).then((x) => x?.success && setAgentPhone(x.result?.phone || ""));
  }, [me?._id]);
  const isCloud = prov?.provider === "cloud";

  const loadContacts = async (pg = cp) => {
    setC((x) => ({ ...x, loading: true }));
    const p = new URLSearchParams({ page: String(pg), items: "8" });
    if (stage !== "All") p.set("stage", stage);
    if (owner) p.set("owner", owner);
    if (q.trim()) p.set("q", q.trim());
    const x = await request.get({ entity: `lead/my-contacts?${p}` });
    setC({ rows: x?.success ? x.result || [] : [], count: x?.pagination?.count || 0, pages: x?.pagination?.pages || 1, stageCounts: x?.stageCounts || {}, ownerCounts: x?.ownerCounts || { all: 0, given: 0, pool: 0 }, loading: false });
  };
  const loadRecent = async (pg = rp) => {
    setR((x) => ({ ...x, loading: true }));
    const x = await request.get({ entity: `calling/history?items=8&page=${pg}` });
    setR({ rows: x?.success ? x.result || [] : [], count: x?.pagination?.count || 0, pages: x?.pagination?.pages || 1, loading: false });
  };
  useEffect(() => {
    const t = setTimeout(() => loadContacts(cp), q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, owner, q, cp]);
  useEffect(() => setCp(1), [stage, owner, q]);
  useEffect(() => {
    loadRecent(rp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rp]);

  useEffect(() => {
    if (!call) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [call]);
  usePoll(async () => {
    if (!call?.id) return;
    const x = await request.get({ entity: "calling/agent/active" });
    const a = x?.success ? x.result?.call : null;
    if (a && String(a._id) === String(call.id)) setCall((cur) => (cur ? { ...cur, status: a.status, answeredAt: a.answeredAt || null } : cur));
    else if (!a) {
      setCall(null);
      loadRecent(1);
    }
  }, 1000, [call?.id]);

  const secs = call?.answeredAt ? (now - new Date(call.answeredAt).getTime()) / 1000 : 0;

  const startCall = async (contact) => {
    if (dialing || call) return;
    const phone = String(contact.phone || "").replace(/[^\d+]/g, "");
    if (phone.replace(/\D/g, "").length < 8) return message.error("Enter a valid phone number.");
    setDialing(true);
    const x = await request.post({ entity: "calling/manual/dial", jsonData: { phone, contactName: contact.name, agentPhone: isCloud ? agentPhone : undefined } });
    setDialing(false);
    if (!x?.success) return message.error(x?.message || "Could not start the call.");
    setCall({ id: x.result?.record?._id || null, contact, status: x.result?.record?.status || "dialing", answeredAt: x.result?.record?.answeredAt || null });
    if (x.result?.tel) openTel(x.result.tel);
    message.success(x.message || "Calling the customer — you'll be connected once they pick up.");
  };
  const endCall = async () => {
    const cur = call;
    const answered = !!cur?.answeredAt;
    setCall(null);
    if (cur?.id) await request.post({ entity: `calling/manual/end/${cur.id}`, jsonData: { talkSeconds: secs } });
    if (cur?.contact?._id) {
      setC((x) => ({ ...x, rows: x.rows.filter((k) => k._id !== cur.contact._id), count: Math.max(0, x.count - 1) }));
      const st = cur.contact.stage || "New Lead";
      if (st === "New Lead" || st === "No Response") {
        const next = answered ? { stage: "Connected Leads", subStatus: "Connected - Response Pending" } : { stage: "No Response", subStatus: "Not Reachable" };
        request.update({ entity: "lead", id: cur.contact._id, jsonData: next, notify: false }).catch(() => {});
      }
    }
    loadRecent(1);
  };
  const callTyped = () => {
    if (!num) return;
    startCall({ name: "Unknown Number", phone: num });
    setNum("");
  };
  const stageTotal = Object.values(c.stageCounts).reduce((a, n) => a + n, 0);

  return (
    <>
      <Head crumb="Sales › Dialer" title="Dialer" lead="Dial a number or a contact. Same calls API (calling/manual/dial)." />

      {call && (
        <div className="sv3-callbar">
          <div>
            <span className="b" style={call.answeredAt ? { background: "#14532D", color: "#BBF7D0" } : { background: "#1E3A8A", color: "#BFDBFE" }}>{call.answeredAt ? (call.status === "onhold" ? "On hold" : "Connected") : "Ringing the customer…"}</span>
            <div className="t">{mmss(secs)}</div>
            <div style={{ color: "#9FB3C3", fontSize: 13 }}>{call.contact.name} · {call.contact.phone}</div>
          </div>
          <div className="ctl">
            {go && <button type="button" onClick={() => go("agent")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" /></svg> Agent Screen</button>}
            <button type="button" className="end" onClick={endCall}><Phone /> End call</button>
          </div>
        </div>
      )}

      <div className="g2">
        <div className="card">
          <input ref={inRef} className="sv3-dialnum" type="tel" inputMode="tel" autoComplete="off" aria-label="Phone number" placeholder="Enter phone number" value={num} onChange={(e) => setNum(clean(e.target.value))} onKeyDown={(e) => e.key === "Enter" && !dialing && callTyped()} />
          {isCloud && CAN_SEE_AGENT_NUMBER.includes(me?.role) && <div className="mut" style={{ fontSize: 12.5, textAlign: "center", marginTop: 6 }}>Rings this agent at: <b style={{ color: "#0F1E2B" }}>{agentPhone || "No phone number on file — add one in Settings"}</b></div>}
          <div style={{ height: 14 }} />
          <div className="sv3-pad">
            {KEYS.slice(0, 11).map((k) => <button key={k} type="button" onClick={() => { setNum((p) => clean(p + k)); inRef.current?.focus(); }}>{k}</button>)}
            <button type="button" aria-label="Delete digit" disabled={!num} onClick={() => { setNum((p) => p.slice(0, -1)); inRef.current?.focus(); }}>⌫</button>
          </div>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button type="button" className="sv3-callb" aria-label="Call" disabled={!num || dialing || !!call} onClick={callTyped}><Phone s={26} /></button>
          </div>
        </div>

        <div className="card">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" className={tab === "contacts" ? "tab on" : "tab"} aria-selected={tab === "contacts"} onClick={() => setTab("contacts")}>Contacts <span className="n">{nf(c.count)}</span></button>
            <button type="button" role="tab" className={tab === "recent" ? "tab on" : "tab"} aria-selected={tab === "recent"} onClick={() => setTab("recent")}>Recent calls</button>
          </div>
          {tab === "contacts" ? (
            <>
              <div style={{ margin: "12px 0" }}>
                <label className="srch">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
                  <input placeholder="Search contact or phone number…" aria-label="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
              </div>
              <div className="fgrid" style={{ marginBottom: 10 }}>
                <label className="fld">Lead owner
                  <select className="sel" value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">All my contacts ({nf(c.ownerCounts.all)})</option>
                    <option value="given">Given to me by admin ({nf(c.ownerCounts.given)})</option>
                    {c.ownerCounts.pool > 0 && <option value="pool">Team pool ({nf(c.ownerCounts.pool)})</option>}
                  </select>
                </label>
                <label className="fld">Stage
                  <select className="sel" value={stage} onChange={(e) => setStage(e.target.value)}>
                    {["All", ...STAGE_NAMES].map((s) => <option key={s} value={s}>{s} ({nf(s === "All" ? stageTotal : c.stageCounts[s] || 0)})</option>)}
                  </select>
                </label>
              </div>
              {c.loading ? <Skel h={220} /> : !c.rows.length ? <Empty /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {c.rows.map((k) => (
                    <div key={k._id} className="row sv3-crow">
                      <span className="who"><span className="av">{initials(k.name)}</span><span><LeadLnk lead={k} phone={k.phone} ink>{k.name}</LeadLnk><br /><span className="mut" style={{ fontSize: 12 }}>{k.phone} · <span className={stageBadge(k.stage)} style={{ fontSize: 11 }}>{k.stage || "New Lead"}</span>{k.givenByName ? ` · given by ${k.givenByName}` : ""}</span></span></span>
                      <button type="button" className="btn sm p" disabled={dialing || !!call} onClick={() => startCall(k)}><Phone s={14} /> Call</button>
                    </div>
                  ))}
                </div>
              )}
              {c.count > 0 && <Pager page={cp} pages={c.pages} count={c.count} per={8} onPage={setCp} noun="contacts" />}
            </>
          ) : (
            <>
              <div style={{ height: 12 }} />
              {r.loading ? <Skel h={220} /> : !r.rows.length ? <Empty text="You haven't placed any calls yet." /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {r.rows.map((k) => {
                    const miss = ["no-answer", "failed", "busy"].includes(k.status);
                    return (
                      <div key={k._id} className="row sv3-crow">
                        <span className="who"><span className="av" style={miss ? { background: "#FDECEA", color: "#B42318" } : undefined}><Phone s={14} /></span><span><LeadLnk phone={k.phone} ink>{k.contactName || k.phone}</LeadLnk><br /><span className="mut" style={{ fontSize: 12 }}>{k.phone} · {mmss(k.duration)} · {fmtWhen(k.endedAt || k.created)}</span></span></span>
                        <button type="button" className="btn sm p" disabled={dialing || !!call} onClick={() => startCall({ name: k.contactName, phone: k.phone })}><Phone s={14} /> Call</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {r.count > 0 && <Pager page={rp} pages={r.pages} count={r.count} per={8} onPage={setRp} noun="calls" />}
            </>
          )}
        </div>
      </div>
    </>
  );
}
