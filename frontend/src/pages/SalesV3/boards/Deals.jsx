import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { message } from "antd";
import { request } from "@/request";
import { FEATURE_SECTIONS } from "@/config/featureSections";
import { Head, Modal, Pager, Skel, Empty, Fail, nf, inr } from "../ui";

// v3 design — S3Deals: Pipeline · Deals · Quotes. Same entities and fields as the
// old Sales tabs (config/featureSections → salesdeal / salesquote):
//   request.listAll / create / update / delete on salesdeal and salesquote.
// Pipeline = the old weighted roll-up of open deals (stage probability fallback).
const SALES = FEATURE_SECTIONS.find((x) => x.key === "sales");
const FIELDS = {
  deals: (SALES?.tabs || []).find((t) => t.key === "deals")?.fields || [],
  quotes: (SALES?.tabs || []).find((t) => t.key === "quotes")?.fields || [],
};
const ENTITY = { deals: "salesdeal", quotes: "salesquote" };
const TABS = {
  pipeline: ["Pipeline", "Deal stages and value.", "New deal"],
  deals: ["Deals", "Every deal and its close date.", "New deal"],
  quotes: ["Quotes", "Every quote and its value.", "New quote"],
};
const OPEN = ["Qualification", "Needs Analysis", "Proposal", "Negotiation"];
const KB = [...OPEN, "Closed Won"];
const PROB = { Qualification: 10, "Needs Analysis": 25, Proposal: 50, Negotiation: 75 };
const STAGE_B = { Qualification: "b gy", "Needs Analysis": "b bl", Proposal: "b tl", Negotiation: "b bl", "Closed Won": "b gr", "Closed Lost": "b rd" };
const QUOTE_B = { Draft: "b gy", "Pending Approval": "b or", Sent: "b or", Accepted: "b gr", Rejected: "b rd", Expired: "b gy" };
const money = (n) => inr(n || 0);
const day = (d) => (d ? dayjs(d).format("D MMM") : "—");

function useList(entity, tick) {
  const [s, setS] = useState({ rows: [], loading: true, error: false });
  useEffect(() => {
    let live = true;
    setS((x) => ({ ...x, loading: true, error: false }));
    request.listAll({ entity }).then((r) => live && setS(r?.success && Array.isArray(r.result) ? { rows: r.result, loading: false, error: false } : { rows: [], loading: false, error: true })).catch(() => live && setS({ rows: [], loading: false, error: true }));
    return () => {
      live = false;
    };
  }, [entity, tick]);
  return s;
}

// New / edit — every field the old form had, grouped like before.
function RecordModal({ kind, record, onClose, onSaved }) {
  const fields = FIELDS[kind];
  const [f, setF] = useState(() => {
    const o = {};
    fields.forEach((x) => {
      const v = record?.[x.name];
      o[x.name] = v == null ? "" : x.type === "date" ? String(v).slice(0, 10) : v;
    });
    return o;
  });
  const [busy, setBusy] = useState(false);
  const missing = fields.find((x) => x.required && !String(f[x.name] || "").trim());
  const groups = [...new Set(fields.map((x) => x.group || ""))];
  const save = async () => {
    setBusy(true);
    const data = {};
    fields.forEach((x) => {
      const v = f[x.name];
      if (v === "" || v == null) return;
      data[x.name] = x.type === "number" ? Number(v) : v;
    });
    const r = record?._id ? await request.update({ entity: ENTITY[kind], id: record._id, jsonData: data }) : await request.create({ entity: ENTITY[kind], jsonData: data });
    setBusy(false);
    if (r?.success) onSaved();
    else message.error(r?.message || "Could not save.");
  };
  const label = kind === "deals" ? "deal" : "quote";
  return (
    <Modal title={record?._id ? `Edit ${label}` : `New ${label}`} sub={<>Same fields as today · <span className="req">*</span> required</>} onClose={onClose} width={780} footer={<>{missing && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>Enter {missing.label.toLowerCase()}</span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || !!missing} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      {groups.map((g) => (
        <div key={g} style={{ marginBottom: 12 }}>
          {g && <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>{g}</h4>}
          <div className="fgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            {fields.filter((x) => (x.group || "") === g).map((x) => {
              const set = (e) => setF((s) => ({ ...s, [x.name]: e.target.value }));
              const lab = <>{x.label}{x.required && <> <span className="req">*</span></>}</>;
              if (x.type === "select") return <label key={x.name} className="fld">{lab}<select className="sel" value={f[x.name]} onChange={set}><option value="">Select</option>{x.options.map((o) => <option key={o}>{o}</option>)}</select></label>;
              if (x.type === "textarea") return <label key={x.name} className="fld" style={{ gridColumn: "1 / -1" }}>{lab}<textarea className="in" rows={3} value={f[x.name]} onChange={set} /></label>;
              return <label key={x.name} className="fld">{lab}<input className="in" type={x.type === "number" ? "number" : x.type === "date" ? "date" : x.type === "email" ? "email" : x.type === "tel" ? "tel" : "text"} placeholder={x.name === "amount" || x.name === "total" ? "₹" : undefined} value={f[x.name]} onChange={set} /></label>;
            })}
          </div>
        </div>
      ))}
    </Modal>
  );
}

function Pipeline({ deals, openEdit }) {
  const now = Date.now();
  const open = deals.rows.filter((d) => !d.stage || OPEN.includes(d.stage));
  const won = deals.rows.filter((d) => d.stage === "Closed Won");
  const lost = deals.rows.filter((d) => d.stage === "Closed Lost");
  const value = open.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const weighted = open.reduce((s, d) => s + ((Number(d.amount) || 0) * (d.probability != null && d.probability !== "" ? Number(d.probability) : PROB[d.stage] || 0)) / 100, 0);
  const ages = open.map((d) => Math.max(0, Math.round((now - new Date(d.created || d.createdAt || now)) / 864e5)));
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
  const tile = (l, v) => <div className="kpi"><div className="l">{l}</div><div className="v">{deals.loading ? <span className="skel" style={{ display: "block", height: 26, width: "60%" }} /> : v}</div></div>;
  return (
    <>
      <div className="kpis">{tile("Open deals", nf(open.length))}{tile("Pipeline value", money(value))}{tile("Weighted value", money(weighted))}{tile("Win rate", `${winRate}%`)}{tile("Avg deal age", `${avgAge} d`)}</div>
      {deals.error ? <Fail /> : deals.loading ? <Skel h={260} /> : !deals.rows.length ? <Empty /> : (
        <div className="sv3-kb">
          {KB.map((st) => {
            const list = deals.rows.filter((d) => (d.stage || "Qualification") === st);
            const sum = list.reduce((s, d) => s + (Number(d.amount) || 0), 0);
            return (
              <div key={st} className="col">
                <div className="row" style={{ justifyContent: "space-between" }}><b style={{ fontSize: 13 }}>{st}</b><span className="b gy">{nf(list.length)} · {money(sum)}</span></div>
                {list.slice(0, 30).map((d) => (
                  <button key={d._id} type="button" className="dc" onClick={() => openEdit(d)} title="Edit this deal">
                    <b>{d.title || "—"}</b><br />{[d.account, d.owner].filter(Boolean).join(" · ") || "—"}{d.amount ? <> · {money(d.amount)}</> : null}
                  </button>
                ))}
                {list.length > 30 && <span className="mut" style={{ fontSize: 12 }}>+{list.length - 30} more in Deals</span>}
                {!list.length && <span className="mut" style={{ fontSize: 12 }}>No deals</span>}
              </div>
            );
          })}
        </div>
      )}
      <p className="mut" style={{ fontSize: 12.5, margin: 0 }}>Data: salesdeal entity (existing). Deal stage and value live here only.</p>
    </>
  );
}

function DealsTable({ deals, openEdit, openDel }) {
  const BL = { q: "", stage: "", owner: "", source: "" };
  const [draft, setDraft] = useState(BL);
  const [f, setF] = useState(BL);
  const [sort, setSort] = useState(["closeDate", 1]);
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(10);
  const owners = useMemo(() => [...new Set(deals.rows.map((d) => d.owner).filter(Boolean))].sort(), [deals.rows]);
  const sources = useMemo(() => [...new Set(deals.rows.map((d) => d.source).filter(Boolean))].sort(), [deals.rows]);
  const rows = useMemo(() => {
    const n = f.q.trim().toLowerCase();
    const [k, dir] = sort;
    return deals.rows
      .filter((d) => (!n || `${d.title || ""} ${d.account || ""}`.toLowerCase().includes(n)) && (!f.stage || d.stage === f.stage) && (!f.owner || d.owner === f.owner) && (!f.source || d.source === f.source))
      .sort((a, b) => {
        const x = a[k] ?? "";
        const y = b[k] ?? "";
        return (k === "amount" ? (Number(x) || 0) - (Number(y) || 0) : String(x).localeCompare(String(y))) * dir;
      });
  }, [deals.rows, f, sort]);
  const apply = (n) => {
    setF(n);
    setDraft(n);
    setPage(1);
  };
  const th = (k, l, num) => <th scope="col" className={num ? "s num" : "s"} tabIndex={0} aria-sort={sort[0] === k ? (sort[1] > 0 ? "ascending" : "descending") : "none"} onClick={() => setSort([k, sort[0] === k ? -sort[1] : 1])} onKeyDown={(e) => e.key === "Enter" && setSort([k, sort[0] === k ? -sort[1] : 1])}>{l} {sort[0] === k ? (sort[1] > 0 ? "↑" : "↓") : ""}</th>;
  const today = dayjs().format("YYYY-MM-DD");
  return (
    <>
      <section className="fp" aria-label="Filters">
        <div className="fgrid">
          <label className="fld">Search<input className="in" placeholder="Deal or account…" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && apply({ ...draft, q: e.currentTarget.value })} /></label>
          <label className="fld">Stage<select className="sel" value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value })}><option value="">All stages</option>{[...OPEN, "Closed Won", "Closed Lost"].map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="fld">Owner<select className="sel" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })}><option value="">All owners</option>{owners.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="fld">Source<select className="sel" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}><option value="">All sources</option>{sources.map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        <div className="factions"><span className="mut" style={{ fontSize: 12.5 }}>{deals.loading ? "Loading…" : `${nf(rows.length)} deals`}</span><div className="row"><button type="button" className="btn g" onClick={() => apply(BL)}>Reset</button><button type="button" className="btn p" onClick={() => apply(draft)}>Apply</button></div></div>
      </section>
      <div className="tw">
        <table>
          <thead><tr>{th("title", "Deal")}<th scope="col">Account</th><th scope="col">Stage</th>{th("amount", "Amount", true)}<th scope="col">Owner</th>{th("closeDate", "Close date")}<th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
          <tbody>
            {deals.loading && [0, 1, 2].map((i) => <tr key={i}><td colSpan={7}><div className="skel" style={{ height: 22 }} /></td></tr>)}
            {!deals.loading && rows.slice((page - 1) * per, page * per).map((d) => {
              const overdue = d.closeDate && String(d.closeDate).slice(0, 10) < today && !String(d.stage || "").startsWith("Closed");
              return (
                <tr key={d._id}>
                  <td><b>{d.title || "—"}</b></td>
                  <td>{d.account || "—"}</td>
                  <td><span className={STAGE_B[d.stage] || "b gy"}>{d.stage || "—"}</span></td>
                  <td className="num">{d.amount != null && d.amount !== "" ? money(d.amount) : "—"}</td>
                  <td>{d.owner || "—"}</td>
                  <td className={overdue ? "dn" : undefined}>{overdue ? `Overdue · ${day(d.closeDate)}` : day(d.closeDate)}</td>
                  <td style={{ whiteSpace: "nowrap" }}><button type="button" className="btn sm" onClick={() => openEdit(d)}>Edit</button> <button type="button" className="btn sm d" onClick={() => openDel(d)}>Delete</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!deals.loading && deals.error && <Fail />}
      {!deals.loading && !deals.error && !rows.length && <Empty action={<button type="button" className="btn sm" onClick={() => apply(BL)}>Reset filters</button>} />}
      {rows.length > 0 && <Pager page={page} pages={Math.max(1, Math.ceil(rows.length / per))} count={rows.length} per={per} pers={[10, 25, 50]} onPer={(n) => { setPer(n); setPage(1); }} onPage={setPage} noun="deals" />}
    </>
  );
}

function QuotesTable({ quotes, openEdit, openDel }) {
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(10);
  const rows = [...quotes.rows].sort((a, b) => String(b.created || b.issueDate || "").localeCompare(String(a.created || a.issueDate || "")));
  return (
    <>
      <div className="tw">
        <table>
          <thead><tr><th scope="col">Quote #</th><th scope="col">Title</th><th scope="col">For</th><th scope="col" className="num">Value</th><th scope="col">Status</th><th scope="col">Valid till</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
          <tbody>
            {quotes.loading && [0, 1, 2].map((i) => <tr key={i}><td colSpan={7}><div className="skel" style={{ height: 22 }} /></td></tr>)}
            {!quotes.loading && rows.slice((page - 1) * per, page * per).map((q) => (
              <tr key={q._id}>
                <td>{q.number || "—"}</td>
                <td>{q.title || "—"}</td>
                <td>{q.account || q.contactName || "—"}</td>
                <td className="num">{q.total != null && q.total !== "" ? money(q.total) : "—"}</td>
                <td><span className={QUOTE_B[q.status] || "b gy"}>{q.status || "—"}</span></td>
                <td>{day(q.validTill)}</td>
                <td style={{ whiteSpace: "nowrap" }}><button type="button" className="btn sm" onClick={() => openEdit(q)}>Edit</button> <button type="button" className="btn sm d" onClick={() => openDel(q)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!quotes.loading && quotes.error && <Fail />}
      {!quotes.loading && !quotes.error && !rows.length && <Empty />}
      {rows.length > 0 && <Pager page={page} pages={Math.max(1, Math.ceil(rows.length / per))} count={rows.length} per={per} pers={[10, 25, 50]} onPer={(n) => { setPer(n); setPage(1); }} onPage={setPage} noun="quotes" />}
    </>
  );
}

export default function Deals({ k, go, keys }) {
  const [tick, setTick] = useState(0);
  const deals = useList("salesdeal", tick);
  const quotes = useList("salesquote", k === "quotes" ? tick : -1);
  const [modal, setModal] = useState(null);
  const tabs = Object.keys(TABS).filter((t) => !keys || keys.includes(t));
  const [title, sub, newLabel] = TABS[k] || TABS.pipeline;
  const kind = k === "quotes" ? "quotes" : "deals";
  const del = async () => {
    const r = await request.delete({ entity: ENTITY[modal.type], id: modal.row._id });
    setModal(null);
    if (r?.success) {
      message.success("Deleted.");
      setTick((x) => x + 1);
    } else message.error(r?.message || "Could not delete.");
  };
  return (
    <>
      <Head crumb={`Sales › ${title}`} title={title} lead={sub}>
        <button type="button" className="btn p" onClick={() => setModal({ kind: "edit", type: kind, row: null })}>+ {newLabel}</button>
      </Head>
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={t === k} className={t === k ? "tab on" : "tab"} onClick={() => go(t)}>{TABS[t][0]}</button>)}
        </div>
      )}
      {k === "pipeline" && <Pipeline deals={deals} openEdit={(d) => setModal({ kind: "edit", type: "deals", row: d })} />}
      {k === "deals" && <DealsTable deals={deals} openEdit={(d) => setModal({ kind: "edit", type: "deals", row: d })} openDel={(d) => setModal({ kind: "del", row: d, type: "deals" })} />}
      {k === "quotes" && <QuotesTable quotes={quotes} openEdit={(q) => setModal({ kind: "edit", type: "quotes", row: q })} openDel={(q) => setModal({ kind: "del", row: q, type: "quotes" })} />}
      {modal?.kind === "edit" && <RecordModal kind={modal.type} record={modal.row} onClose={() => setModal(null)} onSaved={() => { setModal(null); message.success("Saved."); setTick((x) => x + 1); }} />}
      {modal?.kind === "del" && (
        <Modal title={`Delete ${modal.type === "deals" ? `deal “${modal.row.title || ""}”` : `quote ${modal.row.number || ""}`}?`} sub="This can’t be undone" onClose={() => setModal(null)} width={460} footer={<><button type="button" className="btn g" onClick={() => setModal(null)}>Cancel</button><button type="button" className="btn d" onClick={del}>Delete</button></>}>
          <div className="mut">It disappears from every list.</div>
        </Modal>
      )}
    </>
  );
}
