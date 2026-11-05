import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { request } from "@/request";
import LeadFullDetailModal from "@/components/LeadFullDetail";
import matchShortcuts from "./salesSearchMatch";

// The search box's results: everything on the Sales side that matches, one
// section per kind of record. All dates unless the user narrows it. Any filter
// in the bar still applies: it leaves the sections it belongs to.
// Which page section a result group follows; no entry = only with no filter on.
const FOLLOWS = { leads: "usedLeads", calls: "callList", demos: "demos", payments: "money", deals: "deals", quotes: "quotes", orders: "orders", overdue: "overdueTasks", cases: "cases", corrections: "corrections", outages: "outages", activity: "activity" };
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "");
const wordsIn = (q) => (/^[\d\s+()-]+$/.test(q) ? [q.replace(/\D/g, "").slice(-10)] : q.split(/\s+/)).filter(Boolean);

function Marked({ text, rx }) {
  if (!text) return null;
  return String(text).split(rx).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

const highlighter = (q) => new RegExp(`(${wordsIn(q).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "$^"})`, "ig");
const SUGGEST_ROWS = 4;
const SUGGEST_WAIT_MS = 250;

// The search box: as you type, the matching sections, filters and pages open
// under it (`shortcuts`, each with its own `run`), then the top matches among
// the records. A click opens that one. Enter or "See all results" opens the
// full results.
export function Sales360SearchBox({ value, onChange, onSearch, base, scope, shortcuts, onPickUser }) {
  const navigate = useNavigate();
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState(null);
  const [active, setActive] = useState(-1);
  const [view, setView] = useState(null);
  const q = value.trim();
  const ready = wordsIn(q).join("").length >= 2; // the search itself ignores less
  const query = useMemo(() => new URLSearchParams({ ...base, q, limit: String(SUGGEST_ROWS) }).toString(), [base, q]);
  const rx = useMemo(() => highlighter(q), [q]);

  useEffect(() => {
    if (!ready) {
      setFound(null);
      return undefined;
    }
    if (!open) return undefined;
    let live = true;
    setFound((f) => (f ? { ...f, loading: true } : f));
    const id = setTimeout(() => {
      request.get({ entity: `workday/admin/360/search?${query}` }).catch(() => null).then((r) => {
        if (!live) return;
        setFound({ list: r?.success ? r.result.groups : [], error: !r?.success });
        setActive(-1);
      });
    }, SUGGEST_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, ready, open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(".s3-suggest-row.on")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const list = (found?.list || []).filter((g) => !scope || scope.has(FOLLOWS[g.key]));
  const direct = useMemo(() => (ready ? matchShortcuts(shortcuts, q) : []), [shortcuts, q, ready]);
  const shown = [...direct, ...list.filter((g) => g.rows.length)];
  const rows = shown.flatMap((g) => g.rows);
  const anyFailed = list.some((g) => g.failed);
  const seeAll = () => {
    setOpen(false);
    onSearch(q);
  };
  // Every suggestion opens something: a record with no page of its own (a
  // dispute, an outage, an activity) opens in the full results.
  const pick = (row) => {
    const a = row.action;
    setOpen(false);
    if (row.run) row.run();
    else if (a?.type === "lead" && a.phone) setView({ phone: a.phone, name: a.name });
    else if (a?.type === "user") onPickUser(a.adminId);
    else if (a?.type === "go") navigate(a.to);
    else onSearch(q);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter") {
      if (open && rows[active]) pick(rows[active]);
      else seeAll();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.length) {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i < 0 && step < 0 ? rows.length - 1 : (i + step + rows.length) % rows.length));
    }
  };

  let at = -1;
  return (
    <div ref={boxRef} className="s3-suggest-box s3-filter-show">
      <LeadFullDetailModal lead={view} onClose={() => setView(null)} />
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Search all of Sales: name, phone, email, remark, deal, payment, user"
        aria-label="Search"
        role="combobox"
        aria-expanded={open && ready}
        aria-autocomplete="list"
        aria-controls="s3-suggest-list"
        aria-activedescendant={open && rows[active] ? `s3-suggest-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && ready && (
        <div className={`s3-suggest${found?.loading ? " is-loading" : ""}`}>
          <div id="s3-suggest-list" ref={listRef} className="s3-suggest-list" role="listbox" aria-label="Suggestions">
            {found?.error && <div className="s3-suggest-note">Records could not be searched. Please try again.</div>}
            {found && !found.error && !rows.length && !anyFailed && <div className="s3-suggest-note">Nothing on the Sales side matches this.</div>}
            {shown.map((g) => (
              <div key={g.key} role="group" aria-label={g.label}>
                <div className="s3-suggest-group">{g.label}</div>
                {g.rows.map((row) => {
                  at += 1;
                  const i = at;
                  return (
                    <div
                      key={`${g.key}-${row.id}`}
                      id={`s3-suggest-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className={`s3-suggest-row${i === active ? " on" : ""}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(row)}
                    >
                      <div className="s3-search-main">
                        <b><Marked text={row.title} rx={rx} /></b>
                        {(row.match || row.sub) && <div className="s3-muted"><Marked text={row.match || row.sub} rx={rx} /></div>}
                      </div>
                      {row.pill && <span className="s3-pill" style={{ "--c": "#64748B" }}><Marked text={row.pill} rx={rx} /></span>}
                    </div>
                  );
                })}
              </div>
            ))}
            {!found && <div className="s3-suggest-note">Searching records…</div>}
            {anyFailed && <div className="s3-suggest-note">Some sections took too long. See all results to search them again.</div>}
          </div>
          <button type="button" className="s3-suggest-all" onClick={seeAll}><SearchOutlined /> See all results for “{q}”</button>
        </div>
      )}
    </div>
  );
}

export default function Sales360Search({ q, base, scope, rangeLabel, onPickUser }) {
  const navigate = useNavigate();
  const [dated, setDated] = useState(false);
  const [groups, setGroups] = useState(null);
  const [view, setView] = useState(null);
  const [more, setMore] = useState("");
  const query = useMemo(() => new URLSearchParams({ ...base, q, ...(dated ? { dated: "1" } : {}) }).toString(), [base, q, dated]);
  const rx = useMemo(() => highlighter(q), [q]);

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
