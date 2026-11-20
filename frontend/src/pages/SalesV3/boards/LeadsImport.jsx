import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { message } from "antd";
import { request } from "@/request";
import { API_BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";
import { Modal, Pager, Empty, Skel, nf, fmtWhen } from "../ui";
import { LeadLnk } from "../popups/Popups";
import { fullName } from "./leadForms";

// v3 design — S3LeadImport. Data: POST lead/import (file + team / distribution),
// GET lead/export (blob), leadimportbatch list, unassigned leads = lead list
// filter team="", assign = PATCH lead/:id (round-robin across teams' members),
// DELETE lead/:id.
async function download(path, name) {
  const token = storePersist.get("auth")?.current?.token;
  const res = await axios.get(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, responseType: "blob" });
  const url = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function LeadsImport({ teamNames, admins, onChanged }) {
  const [teams, setTeams] = useState([]);
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [split, setSplit] = useState({});
  const [addTeam, setAddTeam] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [expTeam, setExpTeam] = useState("");
  const [fmt, setFmt] = useState("csv");
  const [exporting, setExporting] = useState(false);
  const [hist, setHist] = useState({ rows: [], page: 1, pages: 1, count: 0, loading: true });
  const [un, setUn] = useState({ rows: [], page: 1, pages: 1, count: 0, loading: true });
  const [sel, setSel] = useState([]);
  const [rrTeams, setRrTeams] = useState([]);
  const [dTeam, setDTeam] = useState("");
  const [dPerson, setDPerson] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const people = admins.filter((a) => !["owner", "Super Admin", "Admin"].includes(a.role) && a.enabled !== false);

  useEffect(() => {
    request.listAll({ entity: "team" }).then((r) => setTeams(r?.success ? r.result : []));
  }, []);
  const loadHist = async (page = 1) => {
    setHist((h) => ({ ...h, loading: true }));
    const r = await request.list({ entity: "leadimportbatch", options: { page, items: 10, sortBy: "created", sortValue: -1 } });
    setHist({ rows: r?.success ? r.result : [], page, pages: r?.pagination?.pages || 1, count: r?.pagination?.count || 0, loading: false });
  };
  const loadUn = async (page = 1) => {
    setUn((u) => ({ ...u, loading: true }));
    const r = await request.list({ entity: "lead", options: { page, items: 10, filter: "team", equal: "" } });
    setUn({ rows: r?.success ? r.result : [], page, pages: r?.pagination?.pages || 1, count: r?.pagination?.count || 0, loading: false });
  };
  useEffect(() => {
    loadHist(1);
    loadUn(1);
  }, []);

  const allocated = Object.values(split).reduce((t, n) => t + (Number(n) || 0), 0);
  const startImport = async () => {
    if (!file) return;
    setImporting(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    const dist = Object.entries(split).filter(([, n]) => Number(n) > 0).map(([team, n]) => ({ team, count: Number(n) }));
    if (dist.length === 1) fd.append("team", dist[0].team);
    else if (dist.length > 1) fd.append("distribution", JSON.stringify(dist));
    const r = await request.post({ entity: "lead/import", jsonData: fd });
    setImporting(false);
    if (r?.success) {
      setResult({ ok: true, text: r.message, duplicates: r.result?.duplicates || [] });
      setFile(null);
      setSplit({});
      loadHist(1);
      loadUn(1);
      onChanged?.();
    } else setResult({ ok: false, text: r?.message || "Import failed." });
  };
  const runExport = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams({ format: fmt });
      if (expTeam) p.set("team", expTeam);
      await download(`lead/export?${p}`, fmt === "excel" ? "leads-export.xlsx" : "leads-export.csv");
    } catch (e) {
      message.error("Could not export.");
    }
    setExporting(false);
  };

  // round-robin within a team across its real members (same rule as before)
  const memberOf = (teamName, cur) => {
    const t = teams.find((x) => x.name === teamName);
    const members = t?.members?.length ? t.members : [];
    if (!members.length) return null;
    const i = (cur[teamName] || 0) % members.length;
    cur[teamName] = i + 1;
    const a = people.find((p) => fullName(p) === members[i]);
    return { assignedUser: a?._id, assignedUserName: members[i] };
  };
  const allIds = async () => {
    const r = await request.list({ entity: "lead", options: { page: 1, items: 100000, filter: "team", equal: "" } });
    return r?.success ? r.result.map((l) => l._id) : [];
  };
  const assign = async (ids, targets) => {
    if (!ids.length || !targets.length) return;
    setBusy(true);
    const cur = {};
    await Promise.all(
      ids.map((id, i) => {
        const t = targets[i % targets.length];
        if (t.team && !t.person) return request.update({ entity: "lead", id, jsonData: { team: t.team, ...(memberOf(t.team, cur) || {}) }, notify: false });
        const team = teams.find((x) => (x.members || []).includes(fullName(t.person)))?.name;
        return request.update({ entity: "lead", id, jsonData: { assignedUser: t.person._id, assignedUserName: fullName(t.person), ...(team ? { team } : {}) }, notify: false });
      })
    );
    setBusy(false);
    setSel([]);
    setRrTeams([]);
    setDTeam("");
    setDPerson("");
    message.success(`${ids.length} lead${ids.length === 1 ? "" : "s"} assigned.`);
    loadUn(1);
    onChanged?.();
  };
  const allSel = un.count > 0 && sel.length === un.count;

  return (
    <>
      <div className="g2">
        <div className="card">
          <div className="ch"><div><h3><span className="sv3-step">1</span> Import a file</h3><p>CSV or Excel · same columns as today</p></div><span className="src">lead/import</span></div>
          <div
            className={`state sv3-drop${drag ? " on" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
          >
            <b>{file ? file.name : "Drop a CSV / Excel file here"}</b>
            <span className="mut" style={{ fontSize: 12.5 }}>{file ? `${Math.round(file.size / 1024)} KB · ready to import` : "or pick one from your computer"}</span>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
            <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>{file ? "Choose another file" : "Choose file"}</button>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: "space-between" }}><b style={{ fontSize: 13.5 }}><span className="sv3-step">2</span> Split across teams</b><span className="mut" style={{ fontSize: 12.5 }}>{allocated ? `${nf(allocated)} rows allocated · the rest stay without a team` : "Leave empty to import without a team"}</span></div>
            {Object.keys(split).map((t) => (
              <div key={t} className="row" style={{ gap: 8, margin: "8px 0" }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{t}</span>
                <input className="in" style={{ width: 110 }} value={split[t]} onChange={(e) => setSplit({ ...split, [t]: e.target.value.replace(/\D/g, "") })} aria-label={`Rows for ${t}`} placeholder="rows" />
                <button type="button" className="ib" aria-label={`Remove ${t}`} onClick={() => { const n = { ...split }; delete n[t]; setSplit(n); }}>✕</button>
              </div>
            ))}
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <select className="sel" style={{ flex: 1 }} value={addTeam} onChange={(e) => setAddTeam(e.target.value)} aria-label="Team">
                <option value="">Add a team…</option>
                {teamNames.filter((t) => !(t in split)).map((t) => <option key={t}>{t}</option>)}
              </select>
              <button type="button" className="btn" disabled={!addTeam} onClick={() => { setSplit({ ...split, [addTeam]: "" }); setAddTeam(""); }}>Add</button>
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn p" disabled={!file || importing} onClick={startImport}>{importing ? "Importing…" : "Import leads"}</button>
          </div>
          {result && (
            <div className={result.ok ? "ok" : "warn"} style={{ marginTop: 12 }}>
              {result.text}
              {result.duplicates?.length > 0 && <div style={{ fontWeight: 500, marginTop: 4 }}>{result.duplicates.length} duplicate number(s) skipped: {result.duplicates.slice(0, 8).map((d) => d.phone || d).join(", ")}{result.duplicates.length > 8 ? " …" : ""}</div>}
            </div>
          )}
        </div>

        <div className="card">
          <div className="ch"><div><h3>Export leads</h3><p>Pick a team and a format</p></div><span className="src">lead/export</span></div>
          <div className="fgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <label className="fld">Team
              <select className="sel" value={expTeam} onChange={(e) => setExpTeam(e.target.value)}>
                <option value="">All</option>
                {teamNames.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="fld">Format
              <span className="seg">
                {[["csv", "CSV"], ["excel", "Excel"]].map(([k, l]) => <button key={k} type="button" className={fmt === k ? "on" : ""} onClick={() => setFmt(k)}>{l}</button>)}
              </span>
            </label>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn p" disabled={exporting} onClick={runExport}>{exporting ? "Exporting…" : `Export ${fmt === "excel" ? "Excel" : "CSV"}`}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="ch"><div><h3>Leads with no team</h3><p>Imported or added without a team · pick leads, then assign</p></div>{un.count > 0 && <span className="b or">{nf(un.count)} waiting</span>}</div>
        {sel.length > 0 && (
          <div className="bulk" style={{ marginBottom: 10 }}>
            <b>{nf(sel.length)} selected</b>
            <button type="button" className="btn sm d" onClick={() => setDel(sel)}>Delete</button>
            <span className="sp" />
            <button type="button" className="btn sm g" style={{ color: "#fff" }} onClick={() => setSel([])}>Clear</button>
          </div>
        )}
        {un.loading ? <Skel h={200} /> : un.rows.length === 0 ? <Empty text="Every lead has a team." /> : (
          <>
            <div className="tw">
              <table style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th scope="col"><input type="checkbox" aria-label="Select every lead with no team (all pages)" checked={allSel} onChange={async () => setSel(allSel ? [] : await allIds())} /></th>
                    <th scope="col">Lead</th><th scope="col">Phone</th><th scope="col">Source</th><th scope="col">Came in</th>
                    <th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {un.rows.map((l) => (
                    <tr key={l._id} className={sel.includes(l._id) ? "sel" : ""}>
                      <td><input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.includes(l._id)} onChange={() => setSel((s) => (s.includes(l._id) ? s.filter((x) => x !== l._id) : [...s, l._id]))} /></td>
                      <td><LeadLnk lead={l} phone={l.phone} ink><b>{l.name || "—"}</b></LeadLnk></td>
                      <td><LeadLnk lead={l} phone={l.phone} /></td>
                      <td>{l.source || "—"}</td>
                      <td>{fmtWhen(l.created)}</td>
                      <td><button type="button" className="ib" aria-label={`Delete ${l.name}`} title="Delete" onClick={() => setDel([l._id])}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={un.page} pages={un.pages} count={un.count} per={10} onPage={loadUn} noun="leads" />
          </>
        )}
        <div className="g2" style={{ marginTop: 14 }}>
          <div>
            <b style={{ fontSize: 13.5 }}>Round-robin across teams</b>
            <div className="row" style={{ marginTop: 8, gap: 12 }}>
              {teamNames.map((t) => (
                <label key={t} className="row" style={{ gap: 6, fontSize: 13.5 }}>
                  <input type="checkbox" checked={rrTeams.includes(t)} onChange={() => setRrTeams((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))} /> {t}
                </label>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" className="btn p" disabled={busy || !sel.length || !rrTeams.length} onClick={() => assign(sel, rrTeams.map((team) => ({ team })))}>Assign equally</button>
              <button type="button" className="btn" disabled={busy || !un.count || !teamNames.length} onClick={async () => assign(await allIds(), teamNames.map((team) => ({ team })))}>Distribute all to all teams</button>
            </div>
          </div>
          <div>
            <b style={{ fontSize: 13.5 }}>Give directly to a team or person</b>
            <div className="fgrid" style={{ marginTop: 8, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
              <label className="fld">Team<select className="sel" value={dTeam} onChange={(e) => setDTeam(e.target.value)}><option value="">—</option>{teamNames.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className="fld">Person<select className="sel" value={dPerson} onChange={(e) => setDPerson(e.target.value)}><option value="">—</option>{people.map((p) => <option key={p._id} value={p._id}>{fullName(p)}</option>)}</select></label>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn"
                disabled={busy || !sel.length || (!dTeam && !dPerson)}
                onClick={() => assign(sel, [...(dTeam ? [{ team: dTeam }] : []), ...(dPerson ? [{ person: people.find((p) => p._id === dPerson) }] : [])])}
              >
                Assign selected
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="ch"><div><h3>Recent import history</h3></div><span className="src">leadimportbatch</span></div>
        {hist.loading ? <Skel h={160} /> : hist.rows.length === 0 ? <Empty text="No imports yet." /> : (
          <>
            <div className="tw">
              <table>
                <thead><tr><th scope="col">When</th><th scope="col">File</th><th scope="col">Teams</th><th scope="col" className="num">Total rows</th><th scope="col" className="num">Added</th><th scope="col" className="num">Duplicates</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {hist.rows.map((b) => (
                    <tr key={b._id}>
                      <td>{fmtWhen(b.created)}</td>
                      <td>{b.fileName || "—"}</td>
                      <td>{(b.teams || []).length ? b.teams.map((t) => <span key={t.team} className="b gy" style={{ marginRight: 4 }}>{t.team} · {t.count}</span>) : b.team || <span className="mut">—</span>}</td>
                      <td className="num">{nf(b.totalRows)}</td>
                      <td className="num">{nf(b.successCount)}</td>
                      <td className="num">{b.duplicateCount ? <span className="b or">{nf(b.duplicateCount)} skipped</span> : "—"}</td>
                      <td>{b.failedCount > 0 ? <span className="b rd">{b.failedCount} row{b.failedCount === 1 ? "" : "s"} failed</span> : <span className="b gr">Completed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={hist.page} pages={hist.pages} count={hist.count} per={10} onPage={loadHist} noun="imports" />
          </>
        )}
      </div>

      {del && (
        <Modal
          title={del.length === 1 ? "Delete this lead?" : `Delete ${del.length} leads?`}
          sub="This cannot be undone"
          onClose={() => setDel(null)}
          width={440}
          footer={
            <>
              <button type="button" className="btn g" onClick={() => setDel(null)}>Cancel</button>
              <button
                type="button"
                className="btn d"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await Promise.allSettled(del.map((id) => request.delete({ entity: "lead", id })));
                  const ok = res.filter((r) => r.status === "fulfilled" && r.value?.success !== false).length;
                  setBusy(false);
                  setSel((s) => s.filter((x) => !del.includes(x)));
                  setDel(null);
                  if (ok < del.length) message.warning(`${ok} deleted · ${del.length - ok} failed`);
                  else message.success(`${ok} lead${ok === 1 ? "" : "s"} deleted`);
                  loadUn(1);
                  onChanged?.();
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <div className="warn">The lead{del.length === 1 ? "" : "s"} will be removed permanently.</div>
        </Modal>
      )}
    </>
  );
}
