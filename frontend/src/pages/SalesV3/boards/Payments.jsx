import React, { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { message } from "antd";
import { request } from "@/request";
import { getSocket } from "@/socket";
import { BASE_URL } from "@/config/serverApiConfig";
import paymentsApi from "@/pages/Payments/api";
import { Head, Modal, Pager, Skel, Empty, Fail, nf, inr, IST } from "../ui";

// v3 design — S3Payments. Data, same APIs as before (backend paymentsController):
//   GET payments?limit&teamView        → every link in scope (KPIs, chart, table)
//   GET payments/finance?teamView      → finance (EMI) KYC requests
//   GET payments/stats                 → Me / My team switch (when on a team)
//   POST payments · payments/finance · :id/resend · :id/refresh · :id/next-installment
//   GET payments/:id (QR, KYC, fee plan) · payments/finance/:id · payments/course-fee
// Live: socket "payments:updated".
const MIN_REG = 5000;
const STATUS = { created: ["Pending", "b or"], paid: ["Paid", "b gr"], expired: ["Expired", "b gy"], cancelled: ["Cancelled", "b gy"], failed: ["Failed", "b rd"] };
const VIEWS = [["all", "All"], ["paid", "Paid"], ["pending", "Pending"], ["fin", "Finance"], ["exp", "Expired"]];
const LIMIT = 2000;
const day = (d) => {
  if (!d) return "—";
  const k = new Date(d).toLocaleDateString("en-CA", IST);
  if (k === new Date().toLocaleDateString("en-CA", IST)) return "Today";
  if (k === new Date(Date.now() - 864e5).toLocaleDateString("en-CA", IST)) return "Yesterday";
  return new Date(d).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" });
};
const copy = (url) => {
  if (!url) return;
  navigator.clipboard?.writeText(url);
  message.success("Link copied.");
};
const Ic = ({ d }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const I = {
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  qr: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3z",
  mail: "M4 4h16v16H4zM4 6l8 7 8-7",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

function useCourses() {
  const [courses, setCourses] = useState([]);
  useEffect(() => {
    request.listAll({ entity: "course" }).then((r) => setCourses(((r && r.result) || []).filter((c) => c.status !== "Archived"))).catch(() => {});
  }, []);
  return courses;
}

// New payment link
function NewLink({ courses, onClose, onCreated }) {
  const [f, setF] = useState({ studentName: "", studentEmail: "", studentPhone: "", course: "", amount: String(MIN_REG), notes: "" });
  const [fee, setFee] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pickCourse = async (e) => {
    const course = e.target.value;
    setF((x) => ({ ...x, course }));
    setFee(null);
    if (!course) return;
    const r = await paymentsApi.courseFee(course).catch(() => null);
    const fe = r?.result || null;
    setFee(fe);
    if (fe) setF((x) => ({ ...x, amount: String(Math.max(fe.installmentAmount, MIN_REG)) }));
  };
  // keep the QR honest until it is paid
  useEffect(() => {
    if (!res || res.status === "paid") return undefined;
    const t = setInterval(async () => {
      const r = await paymentsApi.get(res.id).catch(() => null);
      if (r?.result?.status === "paid") {
        setRes((x) => ({ ...x, status: "paid" }));
        onCreated();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [res, onCreated]);
  const why = !f.studentName.trim() ? "Enter the candidate name" : !/^\S+@\S+\.\S+$/.test(f.studentEmail.trim()) ? "Enter a valid email" : !f.course ? "Select the internship / course" : !(Number(f.amount) >= MIN_REG) ? `Registration amount must be at least ₹${nf(MIN_REG)}` : "";
  const save = async () => {
    setBusy(true);
    const r = await paymentsApi.create({ ...f, amount: Number(f.amount) }).catch(() => null);
    setBusy(false);
    if (r?.success) {
      setRes(r.result);
      message.success("Payment link created.");
      onCreated();
    } else message.error(r?.message || "Could not create the payment link.");
  };
  return (
    <Modal title="New payment link" sub={res ? (res.status === "paid" ? "Payment received" : "Share the link or let them scan the QR") : <>Fields marked <span className="req">*</span> are required</>} onClose={onClose} width={720} footer={res ? <button type="button" className="btn p" onClick={onClose}>Done</button> : <>{why && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>{why}</span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || !!why} onClick={save}>{busy ? "Creating…" : "Create link"}</button></>}>
      {res ? (
        res.status === "paid" ? (
          <div className="ok" style={{ textAlign: "center", padding: 20 }}><b style={{ fontSize: 18 }}>Payment received!</b><div>{inr(res.amount)} confirmed</div></div>
        ) : (
          <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
            {res.qrDataUrl && <img src={res.qrDataUrl} alt="Payment QR" style={{ width: 180, height: 180, borderRadius: 12, border: "1px solid #E2E8F0" }} />}
            <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><input className="in" readOnly value={res.shortUrl || ""} aria-label="Payment link" /><button type="button" className="btn" onClick={() => copy(res.shortUrl)}>Copy</button></div>
              <div className={res.emailSent ? "ok" : "warn"}>{res.emailSent ? "Email sent to the candidate." : `Email not sent${res.emailError ? ` — ${res.emailError}` : "."}`}</div>
              <div className="mut" style={{ fontSize: 12.5 }}>Waiting for payment — this turns green by itself when it lands.</div>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="fgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <label className="fld">Candidate name <span className="req">*</span><input className="in" placeholder="Full name" value={f.studentName} onChange={set("studentName")} /></label>
            <label className="fld">Candidate email <span className="req">*</span><input className="in" type="email" placeholder="name@example.com" value={f.studentEmail} onChange={set("studentEmail")} /></label>
            <label className="fld">Internship / course <span className="req">*</span>
              <select className="sel" value={f.course} onChange={pickCourse}>
                <option value="">Select</option>
                {courses.map((c) => <option key={c._id} value={c.title}>{c.code ? `${c.code} — ` : ""}{c.title}</option>)}
              </select>
            </label>
            <label className="fld">Total course fee (INR, incl. GST)<input className="in" readOnly placeholder="From the course’s fee plan" value={fee ? nf(fee.totalFee) : ""} title="Filled from the course fee plan" /></label>
            <label className="fld">Registration amount (INR) <span className="req">*</span><input className="in" type="number" min={MIN_REG} step={500} placeholder="e.g. 5000" value={f.amount} onChange={set("amount")} /></label>
            <label className="fld">Candidate phone<input className="in" placeholder="For WhatsApp reminders" value={f.studentPhone} onChange={set("studentPhone")} /></label>
          </div>
          <label className="fld" style={{ marginTop: 10 }}>Notes (optional)<input className="in" placeholder="Internal note — not shown to the candidate" value={f.notes} onChange={set("notes")} /></label>
          {fee && <div className="mut" style={{ marginTop: 10, fontSize: 12.5 }}><b style={{ color: "#0F1E2B" }}>{inr(fee.totalFee)}</b> total ({inr(fee.baseFee)} + 18% GST) · {fee.durationMonths} monthly instalments of <b style={{ color: "#0F1E2B" }}>{inr(fee.installmentAmount)}</b></div>}
        </>
      )}
    </Modal>
  );
}

// Finance / KYC link (EMI through the finance partner)
function FinanceLink({ courses, onClose, onCreated }) {
  const [f, setF] = useState({ studentName: "", studentEmail: "", studentPhone: "", course: "", courseFee: "", financeAmount: "", tenureMonths: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pickCourse = async (e) => {
    const course = e.target.value;
    setF((x) => ({ ...x, course }));
    if (!course) return;
    const r = await paymentsApi.courseFee(course).catch(() => null);
    if (r?.result) setF((x) => ({ ...x, courseFee: String(r.result.totalFee), financeAmount: String(r.result.totalFee) }));
  };
  const why = !(Number(f.financeAmount) > 0) ? "Enter the amount to finance" : !f.tenureMonths ? "Select the tenure" : !f.studentName.trim() ? "Enter the candidate name" : !/^\S+@\S+\.\S+$/.test(f.studentEmail.trim()) ? "Enter a valid email" : !/^\+?[\d\s-]{10,15}$/.test(f.studentPhone.trim()) ? "Enter a valid phone" : !f.course ? "Select the internship" : "";
  const save = async () => {
    setBusy(true);
    const r = await paymentsApi.financeCreate({ ...f, courseFee: Number(f.courseFee) || undefined, financeAmount: Number(f.financeAmount), tenureMonths: Number(f.tenureMonths) }).catch(() => null);
    setBusy(false);
    if (r?.success) {
      setRes(r.result);
      message.success(r.result.emailSent ? "Finance KYC form emailed to the candidate." : "Finance request saved — email not sent.");
      onCreated();
    } else message.error(r?.message || "Could not create the finance request.");
  };
  return (
    <Modal title="Finance / KYC link" sub="EMI through the finance partner" onClose={onClose} width={560} footer={res ? <button type="button" className="btn p" onClick={onClose}>Done</button> : <>{why && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>{why}</span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || !!why} onClick={save}>{busy ? "Creating…" : "Copy KYC link"}</button></>}>
      {res ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><input className="in" readOnly value={res.kycLink || ""} aria-label="KYC link" /><button type="button" className="btn" onClick={() => copy(res.kycLink)}>Copy</button></div>
          <div className={res.emailSent ? "ok" : "warn"}>{res.emailSent ? "Finance KYC form emailed to the candidate." : `Email not sent${res.emailError ? ` — ${res.emailError}` : "."}`}</div>
        </div>
      ) : (
        <>
          <label className="fld">Amount to finance (INR) <span className="req">*</span><input className="in" type="number" min={1} step={500} placeholder="e.g. 60000" value={f.financeAmount} onChange={set("financeAmount")} /></label>
          <label className="fld" style={{ marginTop: 10 }}>Tenure <span className="req">*</span>
            <select className="sel" value={f.tenureMonths} onChange={set("tenureMonths")}><option value="">Select months</option>{[3, 6, 9, 12, 18, 24].map((m) => <option key={m} value={m}>{m}</option>)}</select>
          </label>
          <div className="fgrid" style={{ marginTop: 10 }}>
            <label className="fld">Candidate name <span className="req">*</span><input className="in" value={f.studentName} onChange={set("studentName")} /></label>
            <label className="fld">Candidate email <span className="req">*</span><input className="in" type="email" value={f.studentEmail} onChange={set("studentEmail")} /></label>
            <label className="fld">Candidate phone <span className="req">*</span><input className="in" placeholder="10-digit mobile" value={f.studentPhone} onChange={set("studentPhone")} /></label>
            <label className="fld">Internship <span className="req">*</span>
              <select className="sel" value={f.course} onChange={pickCourse}><option value="">Select</option>{courses.map((c) => <option key={c._id} value={c.title}>{c.code ? `${c.code} — ` : ""}{c.title}</option>)}</select>
            </label>
          </div>
          <p className="mut" style={{ fontSize: 12.5, marginBottom: 0 }}>No payment link — the candidate gets the finance KYC form (Aadhaar, PAN, bank details, WhatsApp) by email.</p>
        </>
      )}
    </Modal>
  );
}

function QrModal({ row, onClose }) {
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    paymentsApi.get(row.id).then((r) => (r?.result?.qrDataUrl ? setQr(r.result.qrDataUrl) : setErr(true))).catch(() => setErr(true));
  }, [row.id]);
  return (
    <Modal title={`QR — ${row.studentName}`} sub={inr(row.amount)} onClose={onClose} width={380} footer={<button type="button" className="btn p" onClick={onClose}>Close</button>}>
      <div style={{ textAlign: "center" }}>
        {err ? <div className="warn">Couldn’t load the QR for this link.</div> : !qr ? <Skel h={260} /> : <img src={qr} alt="Payment QR" style={{ width: 260, height: 260 }} />}
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: "nowrap" }}><input className="in" readOnly value={row.shortUrl || ""} aria-label="Payment link" /><button type="button" className="btn" onClick={() => copy(row.shortUrl)}>Copy</button></div>
      </div>
    </Modal>
  );
}

const Docs = ({ items }) => (
  <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
    {items.map(([label, path]) => (
      <figure key={label} style={{ margin: 0, width: 150 }}>
        <div style={{ height: 100, border: "1px solid #E2E8F0", borderRadius: 10, display: "grid", placeItems: "center", overflow: "hidden", background: "#F8FAFC" }}>
          {path ? <a href={`${BASE_URL}${path}`} target="_blank" rel="noreferrer"><img src={`${BASE_URL}${path}`} alt={label} style={{ maxWidth: "100%", maxHeight: 100 }} /></a> : <span className="mut" style={{ fontSize: 12 }}>No file</span>}
        </div>
        <figcaption className="mut" style={{ fontSize: 12, marginTop: 4 }}>{label}</figcaption>
      </figure>
    ))}
  </div>
);
const KV = ({ rows }) => <div className="kv">{rows.map(([k, v]) => <React.Fragment key={k}><span>{k}</span><span>{v || "—"}</span></React.Fragment>)}</div>;

// View details — KYC + fee plan + collect the next instalment
function DetailModal({ row, onClose, onChanged }) {
  const [p, setP] = useState(null);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState(null);
  const load = () => paymentsApi.get(row.id).then((r) => {
    const x = r?.result || null;
    setP(x || { error: true });
    if (x?.plan) setAmt(String(x.plan.suggestedNextAmount || x.plan.remaining || ""));
  });
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);
  const collect = async () => {
    setBusy(true);
    const r = await paymentsApi.nextInstallment(row.id, Number(amt)).catch(() => null);
    setBusy(false);
    if (r?.success) {
      setNext(r.result);
      message.success("Payment link created.");
      onChanged();
      load();
    } else message.error(r?.message || "Could not create the payment link.");
  };
  const k = p?.kyc;
  return (
    <Modal title={(k && k.name) || row.studentName} sub={`${row.course || "No internship"} · ${inr(row.amount)}`} onClose={onClose} width={760} footer={<button type="button" className="btn p" onClick={onClose}>Close</button>}>
      {!p ? <Skel h={240} /> : p.error ? <div className="warn">Couldn’t load the details.</div> : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <span className={(STATUS[p.status] || [])[1] || "b gy"}>{(STATUS[p.status] || [p.status])[0]}</span>
            <span className={p.kycSubmitted ? "b gr" : "b or"}>{p.kycSubmitted ? "KYC submitted" : "KYC pending"}</span>
            {p.shortUrl && <button type="button" className="btn sm" onClick={() => copy(p.shortUrl)}>Copy link</button>}
          </div>
          {p.plan && (
            <div className="card" style={{ background: "#F8FAFC", marginBottom: 12 }}>
              <div className="ch" style={{ marginBottom: 8 }}><div><h3>Fee plan</h3><p>Instalment {p.installmentNo} of {p.plan.installmentCount}</p></div><b>{inr(p.plan.planTotal)} total</b></div>
              <div className="hb" style={{ gridTemplateColumns: "1fr 60px", padding: 0 }}><span className="t"><b style={{ width: `${Math.min(100, (p.plan.paidTotal / p.plan.planTotal) * 100 || 0)}%`, background: "#0F766E" }} /></span><span className="n">{Math.round((p.plan.paidTotal / p.plan.planTotal) * 100 || 0)}%</span></div>
              <KV rows={[["Paid", inr(p.plan.paidTotal)], ["Remaining", inr(p.plan.remaining)], ...(p.plan.remaining > 0 && p.plan.nextInstallmentDueAt ? [["Next due", dayjs(p.plan.nextInstallmentDueAt).format("D MMM YYYY")]] : [])]} />
              {p.plan.remaining > 0 && (next ? (
                <div className="row" style={{ gap: 12, marginTop: 10 }}>
                  {next.qrDataUrl && <img src={next.qrDataUrl} alt="Payment QR" style={{ width: 110, height: 110 }} />}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><input className="in" readOnly value={next.shortUrl || ""} aria-label="Next instalment link" /><button type="button" className="btn sm" onClick={() => copy(next.shortUrl)}>Copy</button></div>
                    <div className={next.emailSent ? "ok" : "warn"} style={{ marginTop: 6 }}>{next.emailSent ? "Email sent to the candidate." : "Email not sent."}</div>
                  </div>
                </div>
              ) : (
                <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "nowrap" }}>
                  <input className="in" type="number" min={1} step={100} aria-label="Amount to collect" style={{ maxWidth: 180 }} value={amt} onChange={(e) => setAmt(e.target.value)} />
                  <button type="button" className="btn p" disabled={busy || !(Number(amt) > 0)} onClick={collect}>{busy ? "Creating…" : "Collect payment"}</button>
                </div>
              ))}
              {(p.plan.installments || []).length > 1 && (
                <div className="row" style={{ gap: 6, marginTop: 10 }}>
                  {p.plan.installments.map((x) => <span key={x.id} className={(STATUS[x.status] || [])[1] || "b gy"}>#{x.installmentNo} · {inr(x.amount)} · {(STATUS[x.status] || [x.status])[0]}</span>)}
                </div>
              )}
            </div>
          )}
          {!k ? <Empty text="KYC not submitted yet." /> : (
            <>
              <h4 style={{ margin: "6px 0" }}>Personal details</h4>
              <KV rows={[["Father’s name", k.fatherName], ["Mother’s name", k.motherName], ["State", k.state], ["District", k.district], ["City", k.city], ["Pincode", k.pincode], ["Address", k.address]]} />
              <h4 style={{ margin: "12px 0 6px" }}>Documents</h4>
              <Docs items={[["Aadhaar — front", k.aadharFront], ["Aadhaar — back", k.aadharBack], ["PAN — front", k.panFront]]} />
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function FinanceDetail({ row, onClose }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    paymentsApi.financeGet(row.id).then((r) => setP(r?.result || { error: true })).catch(() => setP({ error: true }));
  }, [row.id]);
  const k = p?.kyc;
  return (
    <Modal title={(k && k.name) || row.studentName} sub={["Finance", row.course || "No internship", row.financeAmount ? inr(row.financeAmount) : "", row.tenureMonths ? `${row.tenureMonths} months` : ""].filter(Boolean).join(" · ")} onClose={onClose} width={780} footer={<button type="button" className="btn p" onClick={onClose}>Close</button>}>
      {!p ? <Skel h={240} /> : p.error ? <div className="warn">Couldn’t load the details.</div> : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <span className={p.status === "submitted" ? "b gr" : "b or"}>{p.status === "submitted" ? "KYC received" : "KYC pending"}</span>
            {p.kycLink && <button type="button" className="btn sm" onClick={() => copy(p.kycLink)}>Copy KYC link</button>}
          </div>
          {!k ? <Empty text="The candidate hasn’t submitted the finance KYC form yet." /> : (
            <>
              <h4 style={{ margin: "6px 0" }}>Personal details</h4>
              <KV rows={[["Date of birth", k.dob], ["Gender", k.gender], ["Father’s name", k.fatherName], ["Mother’s name", k.motherName], ["Mobile", k.mobile], ["WhatsApp", k.whatsapp], ["Alternate mobile", k.alternateMobile], ["Email", k.email], ["Occupation", k.occupation], ["Monthly income", k.monthlyIncome], ["Aadhaar no.", k.aadharNumber], ["PAN no.", k.panNumber]]} />
              <h4 style={{ margin: "12px 0 6px" }}>Address</h4>
              <KV rows={[["State", k.state], ["District", k.district], ["City", k.city], ["Pincode", k.pincode], ["Full address", k.address]]} />
              <h4 style={{ margin: "12px 0 6px" }}>Bank details</h4>
              <KV rows={[["Account holder", k.bank?.accountHolder], ["Bank", k.bank?.bankName], ["Account no.", k.bank?.accountNumber], ["IFSC", k.bank?.ifsc], ["Branch", k.bank?.branch], ["Account type", k.bank?.accountType], ["Bank-registered mobile", k.bank?.registeredMobile]]} />
              <h4 style={{ margin: "12px 0 6px" }}>Documents</h4>
              <Docs items={[["Aadhaar — front", k.aadharFront], ["Aadhaar — back", k.aadharBack], ["PAN — front", k.panFront], ...(k.photo ? [["Photo", k.photo]] : []), ...(k.bankProof ? [["Cheque / passbook", k.bankProof]] : [])]} />
            </>
          )}
        </>
      )}
    </Modal>
  );
}

export default function Payments() {
  const courses = useCourses();
  const [teamView, setTeamView] = useState(false);
  const [team, setTeam] = useState(null);
  const [pay, setPay] = useState({ rows: [], count: 0, loading: true, error: false });
  const [fin, setFin] = useState({ rows: [], loading: true, error: false });
  const [view, setView] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(20);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState("");
  const [tick, setTick] = useState(0);
  const reload = useRef(() => {});

  useEffect(() => {
    paymentsApi.stats().then((r) => setTeam(r?.result?.team || null)).catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    setPay((x) => ({ ...x, loading: true, error: false }));
    setFin((x) => ({ ...x, loading: true, error: false }));
    const tv = teamView ? 1 : undefined;
    paymentsApi.list({ limit: LIMIT, teamView: tv }).then((r) => live && setPay(r?.success ? { rows: r.result || [], count: r.pagination?.count || 0, loading: false, error: false } : { rows: [], count: 0, loading: false, error: true })).catch(() => live && setPay({ rows: [], count: 0, loading: false, error: true }));
    paymentsApi.financeList({ teamView: tv }).then((r) => live && setFin(r?.success ? { rows: r.result || [], loading: false, error: false } : { rows: [], loading: false, error: true })).catch(() => live && setFin({ rows: [], loading: false, error: true }));
    return () => {
      live = false;
    };
  }, [teamView, tick]);
  reload.current = () => setTick((x) => x + 1);
  useEffect(() => {
    const socket = getSocket();
    const on = () => reload.current();
    socket?.on("payments:updated", on);
    return () => socket?.off("payments:updated", on);
  }, []);
  useEffect(() => setPage(1), [view, q, teamView]);

  const rows = pay.rows;
  const m0 = dayjs().startOf("month");
  const inMonth = (d) => d && dayjs(d).isAfter(m0);
  const paidMonth = rows.filter((r) => r.status === "paid" && inMonth(r.paidAt));
  const pending = rows.filter((r) => r.status === "created");
  const sentMonth = rows.filter((r) => inMonth(r.created));
  const kycWaiting = fin.rows.filter((r) => r.status !== "submitted");

  // weekly revenue — last 8 weeks (Monday-start)
  const weeks = useMemo(() => {
    const now = dayjs();
    const mon = (now.day() === 0 ? now.subtract(6, "day") : now.startOf("week").add(1, "day")).startOf("day");
    const out = Array.from({ length: 8 }, (_, i) => ({ start: mon.subtract(7 - i, "week"), amount: 0, n: 0 }));
    for (const r of rows) {
      if (r.status !== "paid" || !r.paidAt) continue;
      const t = dayjs(r.paidAt);
      const w = out.find((x) => !t.isBefore(x.start) && t.isBefore(x.start.add(1, "week")));
      if (w) {
        w.amount += Number(r.amount) || 0;
        w.n += 1;
      }
    }
    return out;
  }, [rows]);
  const wMax = Math.max(1, ...weeks.map((w) => w.amount));
  const X = (i) => 60 + i * (640 / 7);
  const Y = (v) => Math.round(190 - (v / wMax) * 160);
  const pts = weeks.map((w, i) => `${X(i)},${Y(w.amount)}`).join(" ");
  const area = `M${X(0)} 190 L${weeks.map((w, i) => `${X(i)} ${Y(w.amount)}`).join(" L")} L${X(7)} 190 Z`;
  const wLabel = (w, i) => {
    const prev = weeks[i - 1];
    const wk = Math.ceil(w.start.date() / 7);
    return !prev || prev.start.month() !== w.start.month() ? `${w.start.format("MMM")} W${wk}` : `W${wk}`;
  };

  const needle = q.trim().toLowerCase();
  const match = (r) => !needle || `${r.studentName || ""} ${r.studentEmail || ""} ${r.course || ""} ${r.createdByName || ""}`.toLowerCase().includes(needle);
  const list = view === "fin" ? fin.rows.filter(match) : rows.filter((r) => match(r) && (view === "all" || (view === "paid" && r.status === "paid") || (view === "pending" && r.status === "created") || (view === "exp" && ["expired", "cancelled", "failed"].includes(r.status))));
  const pages = Math.max(1, Math.ceil(list.length / per));
  const shown = list.slice((page - 1) * per, page * per);
  const loading = view === "fin" ? fin.loading : pay.loading;
  const error = view === "fin" ? fin.error : pay.error;

  const act = async (id, fn, ok) => {
    setBusy(id);
    const r = await fn(id).catch(() => null);
    setBusy("");
    if (r?.success) {
      if (ok) message.success(ok);
    } else message.error(r?.message || "Could not do that.");
    reload.current();
  };

  const tile = (icon, label, value, sub, iconStyle) => (
    <div className="kpi">
      <div className="l"><i style={iconStyle}>{icon}</i>{label}</div>
      <div className="v">{pay.loading ? <span className="skel" style={{ display: "block", height: 26, width: "60%" }} /> : value}</div>
      <div className="d mut">{sub}</div>
    </div>
  );

  return (
    <>
      <Head crumb="Sales › Payments" title="Payments" lead="Payment links, money collected, finance & KYC.">
        <button type="button" className="btn" onClick={() => setModal({ kind: "kyc" })}>Finance / KYC link</button>
        <button type="button" className="btn p" onClick={() => setModal({ kind: "link" })}>+ New payment link</button>
      </Head>

      <div className="kpis">
        {tile("₹", "Collected · this month", inr(paidMonth.reduce((a, r) => a + (Number(r.amount) || 0), 0)), `${nf(paidMonth.length)} payments`)}
        {tile("⏱", "Pending", inr(pending.reduce((a, r) => a + (Number(r.amount) || 0), 0)), `${nf(pending.length)} links unpaid`, { background: "#FEF0E6", color: "#B54708" })}
        {tile("🔗", "Links sent", nf(sentMonth.length), "this month")}
        <div className="kpi">
          <div className="l"><i>✓</i>KYC waiting</div>
          <div className="v">{fin.loading ? <span className="skel" style={{ display: "block", height: 26, width: "60%" }} /> : nf(kycWaiting.length)}</div>
          <div className="d mut">finance forms</div>
        </div>
      </div>

      <div className="card">
        <div className="ch"><div><h3>Revenue collected over time</h3><p>Area chart · volume + growth, by week</p></div><span className="src">payments list → paidAt, amount</span></div>
        {pay.loading ? <Skel h={220} /> : pay.error ? <Fail onRetry={reload.current} /> : !weeks.some((w) => w.amount) ? <Empty /> : (
          <svg viewBox="0 0 720 220" width="100%" height="220" role="img" aria-label="Revenue collected per week">
            <defs><linearGradient id="sv3ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0F766E" stopOpacity=".35" /><stop offset="1" stopColor="#0F766E" stopOpacity="0" /></linearGradient></defs>
            <line x1="40" y1="190" x2="710" y2="190" stroke="#CFD8E1" /><line x1="40" y1="110" x2="710" y2="110" stroke="#EEF2F6" /><line x1="40" y1="30" x2="710" y2="30" stroke="#EEF2F6" />
            <path d={area} fill="url(#sv3ga)" />
            <polyline points={pts} fill="none" stroke="#0F766E" strokeWidth="3" />
            {weeks.map((w, i) => (
              <g key={i}>
                <circle cx={X(i)} cy={Y(w.amount)} r="10" fill="transparent"><title>{`Week of ${w.start.format("D MMM")}: ${inr(w.amount)} · ${nf(w.n)} payments`}</title></circle>
                <text x={X(i)} y="208" fontSize="11" fill="#5B6B79" textAnchor="middle">{wLabel(w, i)}</text>
              </g>
            ))}
          </svg>
        )}
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <div className="seg" role="group" aria-label="Status">
            {VIEWS.map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}
          </div>
          {team && (
            <div className="seg" role="group" aria-label="Whose">
              <button type="button" className={!teamView ? "on" : ""} onClick={() => setTeamView(false)}>Me</button>
              <button type="button" className={teamView ? "on" : ""} onClick={() => setTeamView(true)}>My team{team.name ? ` · ${team.name}` : ""}</button>
            </div>
          )}
        </div>
        <label className="srch" style={{ flex: "0 1 320px" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
          <input type="search" placeholder="Search student or email…" aria-label="Search payments" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <div className="tw">
        <table>
          <thead><tr><th scope="col">Created</th><th scope="col">Student</th><th scope="col">Course</th><th scope="col">Instalment</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Sent by</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
          <tbody>
            {loading && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={8}><div className="skel" style={{ height: 22 }} /></td></tr>)}
            {!loading && view !== "fin" && shown.map((r) => {
              const st = STATUS[r.status] || [r.status, "b gy"];
              return (
                <tr key={r.id}>
                  <td>{day(r.created)}</td>
                  <td><b>{r.studentName}</b><div className="mut" style={{ fontSize: 12 }}>{r.studentEmail}</div></td>
                  <td style={{ whiteSpace: "normal", maxWidth: 220 }}>{r.course || "—"}</td>
                  <td>{r.installmentCount > 1 ? `${r.installmentNo} of ${r.installmentCount}` : "Full"}</td>
                  <td className="num">{inr(r.amount)}</td>
                  <td><span className={st[1]}>{st[0]}</span>{r.status === "paid" && <div className="mut" style={{ fontSize: 11.5 }}>{r.kycSubmitted ? "KYC submitted" : "KYC pending"}</div>}</td>
                  <td>{r.createdByName || "—"}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      {r.shortUrl && <button type="button" className="ib" aria-label="Copy link" title="Copy payment link" onClick={() => copy(r.shortUrl)}><Ic d={I.copy} /></button>}
                      {r.shortUrl && <button type="button" className="ib" aria-label="Show QR" title="Show QR" onClick={() => setModal({ kind: "qr", row: r })}><Ic d={I.qr} /></button>}
                      {r.status !== "paid" && <button type="button" className="ib" aria-label="Re-send email" title="Re-send email" disabled={busy === r.id} onClick={() => act(r.id, paymentsApi.resend, "Email re-sent.")}><Ic d={I.mail} /></button>}
                      {r.status !== "paid" && <button type="button" className="ib" aria-label="Refresh from Razorpay" title="Refresh status from Razorpay" disabled={busy === r.id} onClick={() => act(r.id, paymentsApi.refresh)}><Ic d={I.refresh} /></button>}
                      <button type="button" className="ib" aria-label="View details" title="View details" onClick={() => setModal({ kind: "detail", row: r })}><Ic d={I.more} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && view === "fin" && shown.map((r) => (
              <tr key={r.id}>
                <td>{day(r.created)}</td>
                <td><b>{r.studentName}</b><div className="mut" style={{ fontSize: 12 }}>{r.studentEmail}</div></td>
                <td style={{ whiteSpace: "normal", maxWidth: 220 }}>{r.course || "—"}</td>
                <td>EMI{r.tenureMonths ? ` · ${r.tenureMonths} mo` : ""}</td>
                <td className="num">{r.financeAmount ? inr(r.financeAmount) : "—"}</td>
                <td><span className={r.status === "submitted" ? "b gr" : r.emailSent ? "b bl" : "b rd"}>{r.status === "submitted" ? "Finance · KYC received" : r.emailSent ? "Finance · KYC" : "Email not sent"}</span></td>
                <td>{r.createdByName || "—"}</td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    {r.kycLink && <button type="button" className="ib" aria-label="Copy KYC link" title="Copy KYC form link" onClick={() => copy(r.kycLink)}><Ic d={I.copy} /></button>}
                    {r.status !== "submitted" && <button type="button" className="ib" aria-label="Re-send email" title="Re-send email" disabled={busy === r.id} onClick={() => act(r.id, paymentsApi.financeResend, "Email re-sent.")}><Ic d={I.mail} /></button>}
                    <button type="button" className="ib" aria-label="View details" title="View details" onClick={() => setModal({ kind: "fin", row: r })}><Ic d={I.more} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && error && <Fail onRetry={reload.current} text="Couldn’t load the payments." />}
      {!loading && !error && list.length === 0 && <Empty />}
      {list.length > 0 && <Pager page={page} pages={pages} count={list.length} per={per} pers={[10, 20, 50, 100]} onPer={(n) => { setPer(n); setPage(1); }} onPage={setPage} noun="payments" />}
      {view !== "fin" && pay.count > LIMIT && <p className="mut" style={{ fontSize: 12.5 }}>Showing the newest {nf(LIMIT)} of {nf(pay.count)} links.</p>}

      {modal?.kind === "link" && <NewLink courses={courses} onClose={() => setModal(null)} onCreated={reload.current} />}
      {modal?.kind === "kyc" && <FinanceLink courses={courses} onClose={() => setModal(null)} onCreated={reload.current} />}
      {modal?.kind === "qr" && <QrModal row={modal.row} onClose={() => setModal(null)} />}
      {modal?.kind === "detail" && <DetailModal row={modal.row} onClose={() => setModal(null)} onChanged={reload.current} />}
      {modal?.kind === "fin" && <FinanceDetail row={modal.row} onClose={() => setModal(null)} />}
    </>
  );
}
