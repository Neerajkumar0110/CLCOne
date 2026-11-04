import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchOutlined } from "@ant-design/icons";
import { request } from "@/request";
import LeadFullDetailModal from "@/components/LeadFullDetail";

// The search box's results: everything on the Sales side that matches, one
// section per kind of record. All dates unless the user narrows it. Any filter
// in the bar still applies: it leaves the sections it belongs to.
// Which page section a result group follows; no entry = only with no filter on.
const FOLLOWS = { leads: "usedLeads", calls: "callList", demos: "demos", payments: "money", deals: "deals", quotes: "quotes", orders: "orders", overdue: "overdueTasks", cases: "cases", outages: "outages", activity: "activity" };
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "");
const wordsIn = (q) => (/^[\d\s+()-]+$/.test(q) ? [q.replace(/\D/g, "").slice(-10)] : q.split(/\s+/)).filter(Boolean);

function Marked({ text, rx }) {
  if (!text) return null;
  return String(text).split(rx).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export default function Sales360Search({ q, base, scope, rangeLabel, onPickUser }) {
  const navigate = useNavigate();
  const [dated, setDated] = useState(false);
  const [groups, setGroups] = useState(null);
  const [view, setView] = useState(null);
  const [more, setMore] = useState("");
  const query = useMemo(() => new URLSearchParams({ ...base, q, ...(dated ? { dated: "1" } : {}) }).toString(), [base, q, dated]);
  const rx = useMemo(() => new RegExp(`(${wordsIn(q).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "$^"})`, "ig"), [q]);

  useEffect(() => {
    let live = true;
    setGroups((g) => (g ? { ...g, loading: true } : g));
    request.get({ entity: `workday/admin/360/search?${query}` }).then((r) => {
      if (live) setGroups({ list: r?.success ? r.result.groups : [], error: !r?.success });
    });
    return () => {
      live = false;
    };
  }, [query]);

  const loadMore = async (g) => {
    setMore(g.key);
    const r = await request.get({ entity: `workday/admin/360/search?${query}&group=${g.key}&skip=${g.rows.length}` });
    setMore("");
    const next = r?.success ? r.result.groups[0] : null;
    if (next) setGroups((all) => ({ ...all, list: all.list.map((x) => (x.key === g.key ? { ...x, rows: [...x.rows, ...next.rows], more: next.more } : x)) }));
  };
  const open = (row) => {
    const a = row.action;
    if (a?.type === "lead" && a.phone) setView({ phone: a.phone, name: a.name });
    else if (a?.type === "user") onPickUser(a.adminId);
    else if (a?.type === "go") navigate(a.to);
  };

  const list = (groups?.list || []).filter((g) => !scope || scope.has(FOLLOWS[g.key]));
  const found = list.reduce((sum, g) => sum + g.rows.length, 0);
  const anyMore = list.some((g) => g.more);
  return (
    <section className={`s3-panel s3-search${groups?.loading ? " is-loading" : ""}`}>
      <LeadFullDetailModal lead={view} onClose={() => setView(null)} />
      <header>
        <h4><SearchOutlined /> Results for “{q}”</h4>
        <div className="s3-presets">
          <button type="button" className={dated ? "" : "on"} onClick={() => setDated(false)}>All dates</button>
          <button type="button" className={dated ? "on" : ""} onClick={() => setDated(true)}>{rangeLabel}</button>
        </div>
      </header>
      {!groups && <div className="s3-skel-rows"><i /><i /><i /><i /></div>}
      {groups?.error && <div className="s3-empty">Search could not run. Please try again.</div>}
      {groups && !groups.error && (
        <p className="s3-note" style={{ marginTop: 0 }}>
          {found ? `${found}${anyMore ? "+" : ""} found in ${list.length} section${list.length === 1 ? "" : "s"}.` : dated ? `Nothing matches in ${rangeLabel}. Try All dates.` : "Nothing on the Sales side matches this."}
        </p>
      )}
      {list.map((g) => (
        <div key={g.key} className="s3-search-group">
          <h5>{g.label} <span>{g.rows.length}{g.more ? "+" : ""}</span></h5>
          {g.failed && <div className="s3-muted">This section took too long to search. Pick the dates above or a user to narrow it.</div>}
          {g.rows.map((row) => {
            const clickable = row.action && (row.action.type !== "lead" || row.action.phone);
            return (
              <div key={row.id} className={`s3-search-row${clickable ? " s3-click" : ""}`} role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined} onClick={clickable ? () => open(row) : undefined} onKeyDown={clickable ? (e) => e.key === "Enter" && open(row) : undefined}>
                <div className="s3-search-main">
                  <b><Marked text={row.title} rx={rx} /></b>
                  {row.sub && <div className="s3-muted"><Marked text={row.sub} rx={rx} /></div>}
                  {row.match && <div className="s3-search-match"><Marked text={row.match} rx={rx} /></div>}
                </div>
                <div className="s3-search-side">
                  {row.pill && <span className="s3-pill" style={{ "--c": "#64748B" }}><Marked text={row.pill} rx={rx} /></span>}
                  {row.pill2 && <span className="s3-muted"><Marked text={row.pill2} rx={rx} /></span>}
                  {row.at && <span className="s3-muted">{when(row.at)}</span>}
                </div>
              </div>
            );
          })}
          {g.more && <button type="button" className="hub-btn s3-search-more" disabled={more === g.key} onClick={() => loadMore(g)}>{more === g.key ? "Loading…" : `Show more ${g.label.toLowerCase()}`}</button>}
        </div>
      ))}
    </section>
  );
}
