import React, { useCallback, useEffect, useState } from "react";
import HubModal from "@/components/HubModal";
import { getSocket } from "@/socket";
import paymentsApi from "@/pages/Payments/api";
import { FundOutlined, MailOutlined, WalletOutlined, BellOutlined } from "@ant-design/icons";

// Finance's own oversight view of the Razorpay/EMI fee-collection stream
// (pages/Payments is the "create a payment link" admin hub; this is the
// read-only "see everything that came in" view for the Finance team) — moved
// out of Finance/index.jsx's in-page "Payments" tab into its own sidebar
// entry, per the business's request to stop nesting it behind a tab. Same
// Team/Individual (by agent) filter and name/email/agent search as before.

function money(amount, currency) {
  const n = Number(amount || 0);
  return `${currency && currency !== "NA" ? currency + " " : "₹"}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// "Which month's payment this is" — the due month if it's still pending, the
// month it actually landed once paid. Falls back to the created month for a
// plain one-off payment with no EMI due date at all.
function monthLabel(row) {
  const d = row.paidAt || row.dueAt || row.created;
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const PAYMENT_REQUEST_STATUS_META = {
  paid: "hub-badge-green",
  created: "hub-badge-yellow",
  upcoming: "hub-badge-purple",
  expired: "hub-badge-gray",
  cancelled: "hub-badge-gray",
  failed: "hub-badge-red",
};

function initialsOf(name) {
  return (
    String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

function reminderTag(daysUntilDue) {
  if (daysUntilDue > 0) return `${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"} before due`;
  if (daysUntilDue === 0) return "on due date";
  return "overdue";
}

// Row-click detail modal — pulls the enriched single-record view
// (paymentsController/get.js) so Finance can see exactly who was emailed,
// when every reminder went out, and — for an EMI plan — the full
// 1..installmentCount schedule (including installments not yet created)
// side by side, not just the one row that was clicked.
function PaymentDetailModal({ id, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    paymentsApi.get(id).then((res) => {
      if (!cancelled) {
        setDetail((res && res.result) || null);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // If this exact record gets paid / KYC-submitted while its modal is open
  // (e.g. the admin has it open right as the student pays on their phone),
  // silently re-fetch instead of leaving a stale "created"/"Link sent" view.
  useEffect(() => {
    if (!id) return undefined;
    const socket = getSocket();
    const onUpdate = (evt) => {
      if (evt && evt.id === id) paymentsApi.get(id).then((res) => setDetail((res && res.result) || null));
    };
    socket?.on("payments:updated", onUpdate);
    return () => socket?.off("payments:updated", onUpdate);
  }, [id]);

  return (
    <HubModal open={!!id} onClose={onClose} title="Payment details" width={680}>
      {loading || !detail ? (
        <div className="hub-empty">Loading…</div>
      ) : (
        <div>
          <div className="fin-pm-head">
            <div className="fin-pm-avatar">{initialsOf(detail.studentName)}</div>
            <div className="fin-pm-who">
              <div className="fin-pm-name">{detail.studentName}</div>
              <div className="fin-pm-email">{detail.studentEmail}</div>
            </div>
            <div className="fin-pm-amount">
              <span className={`hub-badge ${PAYMENT_REQUEST_STATUS_META[detail.status] || "hub-badge-gray"}`}>{detail.status}</span>
              <div className="fin-pm-amount-value">{money(detail.amount)}</div>
            </div>
          </div>

          <div className="fin-pm-section">
            <div className="fin-pm-section-label">
              <span className="fin-pm-section-icon">
                <FundOutlined />
              </span>
              Summary
            </div>
            <div className="fin-pm-grid">
              <div className="fin-pm-field">
                <span>Course</span>
                <b>
                  {detail.course || "—"}
                  {detail.installmentCount > 1 ? ` (${detail.installmentNo}/${detail.installmentCount})` : ""}
                </b>
              </div>
              <div className="fin-pm-field">
                <span>Month</span>
                <b>{monthLabel(detail)}</b>
              </div>
              <div className="fin-pm-field">
                <span>Agent</span>
                <b>{detail.createdByName || "—"}</b>
              </div>
              <div className="fin-pm-field">
                <span>Due date</span>
                <b>{formatDate(detail.dueAt)}</b>
              </div>
              <div className="fin-pm-field">
                <span>Paid on</span>
                <b>{formatDate(detail.paidAt)}</b>
              </div>
              <div className="fin-pm-field">
                <span>Created</span>
                <b>{formatDate(detail.created)}</b>
              </div>
            </div>
          </div>

          <div className="fin-pm-section">
            <div className="fin-pm-section-label">
              <span className="fin-pm-section-icon">
                <MailOutlined />
              </span>
              Emails
            </div>
            <div className="fin-pm-email-row">
              <div className={`fin-pm-email-icon ${detail.emailSent ? "is-ok" : "is-warn"}`}>
                <MailOutlined />
              </div>
              <div className="fin-pm-email-text">
                <b>Payment link email</b> — {detail.emailSent ? "sent" : `not sent${detail.emailError ? ` (${detail.emailError})` : ""}`}
              </div>
              {detail.emailSent && <div className="fin-pm-email-when">{formatDateTime(detail.emailSentAt)}</div>}
            </div>

            <div className="fin-pm-email-row">
              <div className="fin-pm-email-icon is-info">
                <BellOutlined />
              </div>
              <div className="fin-pm-email-text">
                <b>{(detail.reminderLog || []).length}</b> EMI reminder{(detail.reminderLog || []).length === 1 ? "" : "s"} sent
              </div>
            </div>
            {(detail.reminderLog || []).length > 0 && (
              <div className="fin-pm-reminder-list">
                {detail.reminderLog
                  .slice()
                  .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
                  .map((r, i) => (
                    <div className="fin-pm-reminder" key={i}>
                      <span className="fin-pm-reminder-dot" />
                      <span className="fin-pm-reminder-tag">{reminderTag(r.daysUntilDue)}</span>
                      <span className="fin-pm-reminder-when">{formatDateTime(r.sentAt)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {detail.plan && (
            <div className="fin-pm-section">
              <div className="fin-pm-section-label">
                <span className="fin-pm-section-icon">
                  <WalletOutlined />
                </span>
                Installment schedule — which month's payment has come in
              </div>
              <div className="fin-pm-sched-list">
                {detail.plan.installments.map((ins) => (
                  <div className={`fin-pm-sched-row ${ins.projected ? "is-projected" : ""}`} key={ins.installmentNo}>
                    <div className="fin-pm-sched-no">
                      {ins.installmentNo}/{detail.plan.installmentCount}
                    </div>
                    <div className="fin-pm-sched-mid">
                      <div className="fin-pm-sched-month">{monthLabel(ins)}</div>
                      <div className="fin-pm-sched-emails">
                        {ins.projected
                          ? "Not created yet"
                          : ins.status === "paid"
                          ? `Paid ${formatDate(ins.paidAt)}`
                          : ins.emailSent
                          ? "Link sent"
                          : "No link email"}
                        {!ins.projected && ins.status !== "paid" && ins.reminderCount
                          ? ` · ${ins.reminderCount} reminder${ins.reminderCount === 1 ? "" : "s"}`
                          : ""}
                      </div>
                    </div>
                    <div className="fin-pm-sched-end">
                      <span className={`hub-badge ${PAYMENT_REQUEST_STATUS_META[ins.status] || "hub-badge-gray"}`}>{ins.status}</span>
                      <span className="fin-pm-sched-amount">{money(ins.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </HubModal>
  );
}

export default function FinancePayments() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("team"); // 'team' = everyone in my scope, 'individual' = one agent
  const [agent, setAgent] = useState("");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [roster, setRoster] = useState([]); // agents selectable in the Individual dropdown

  // Scoping follows the sales org chart (Admin.reportsTo — same rule as
  // Performance/Targets/Reports, see services/access/salesHierarchy.js):
  // Sales Manager/Admin/owner see everyone and may narrow to one person via
  // `agent` — which the backend expands to that person's own hierarchy scope
  // (self + everyone reporting up to them), not just their single row.
  // Everyone else is always scoped to themselves + everyone reporting up to
  // them, so an Executive sees only their own team (or, picking themselves
  // under Individual, just their own row) — never a flat "whole CRM" view.
  // `hierarchyScope=1` opts this page into that rule without touching the
  // Sales "create a payment link" hub, which still uses the older flat
  // Team-based scope (see backend's paymentsController/scope.js).
  const load = useCallback(async () => {
    setLoading(true);
    const res = await paymentsApi.list({
      limit: 500,
      hierarchyScope: 1,
      agent: scope === "individual" && agent ? agent : undefined,
    });
    setRows((res && res.result) || []);
    setLoading(false);
  }, [scope, agent]);
  useEffect(() => {
    load();
  }, [load]);

  // The Individual dropdown's roster is the full sales hierarchy scope
  // (everyone, for a full-access viewer; their own downline otherwise) —
  // not derived from payment rows, so someone who hasn't recorded a payment
  // yet (a brand-new Sales Intern, say) still shows up and can be picked.
  const loadRoster = useCallback(async () => {
    const res = await paymentsApi.roster();
    setRoster((res && res.result) || []);
  }, []);
  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  // Live updates — a payment can flip from "created" to "paid" (or KYC get
  // submitted) purely server-side, whenever the student completes it on
  // their own phone — see backend services/payments/realtime.js, which
  // broadcasts 'payments:updated' on exactly those two edges. Without this
  // the table would only ever show that in the "Status" column after a
  // manual reload. Same event/pattern pages/Payments/index.jsx already uses.
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = () => {
      load();
      loadRoster();
    };
    socket?.on("payments:updated", onUpdate);
    return () => socket?.off("payments:updated", onUpdate);
  }, [load, loadRoster]);

  const agents = roster;

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (!q) return true;
    return (
      (r.studentName || "").toLowerCase().includes(q) ||
      (r.studentEmail || "").toLowerCase().includes(q) ||
      (r.createdByName || "").toLowerCase().includes(q) ||
      (r.course || "").toLowerCase().includes(q)
    );
  });

  const totalCollected = filtered.filter((r) => r.status === "paid").reduce((s, r) => s + (r.amount || 0), 0);
  const totalPending = filtered.filter((r) => r.status === "created").reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Payments</h2>
          <p>Every fee payment coming in — EMI schedule, reminders and KYC status for each student</p>
        </div>
      </div>

      <div className="hub-stack">
        <div className="hub-kpi-row">
          <div className="hub-kpi">
            <div className="hub-kpi-label">Payments</div>
            <div className="hub-kpi-value">{filtered.length}</div>
          </div>
          <div className="hub-kpi">
            <div className="hub-kpi-label">Collected</div>
            <div className="hub-kpi-value">{money(totalCollected)}</div>
          </div>
          <div className="hub-kpi">
            <div className="hub-kpi-label">Awaiting Payment</div>
            <div className="hub-kpi-value">{money(totalPending)}</div>
          </div>
          <div className="hub-kpi">
            <div className="hub-kpi-label">Agents</div>
            <div className="hub-kpi-value">{agents.length}</div>
          </div>
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3>All Payments</h3>
            <div className="hub-row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div className="hub-pill-filter">
                <button
                  type="button"
                  className={`hub-pill-btn ${scope === "team" ? "active" : ""}`}
                  onClick={() => setScope("team")}
                >
                  Team
                </button>
                <button
                  type="button"
                  className={`hub-pill-btn ${scope === "individual" ? "active" : ""}`}
                  onClick={() => setScope("individual")}
                >
                  Individual
                </button>
              </div>
              {scope === "individual" && (
                <select
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e3e8ef", fontSize: 13 }}
                >
                  <option value="">All agents</option>
                  {agents.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="text"
                placeholder="Search name, email or agent…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e3e8ef", fontSize: 13, minWidth: 220 }}
              />
            </div>
          </div>

          {loading ? (
            <div className="hub-empty">Loading payments…</div>
          ) : (
            <div className="hub-table-wrapper">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Course</th>
                    <th>Month</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Reminders</th>
                    <th>Agent</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <div className="hub-empty">No payments match this filter.</div>
                      </td>
                    </tr>
                  )}
                  {filtered
                    .slice()
                    .sort((a, b) => new Date(b.created) - new Date(a.created))
                    .map((r) => (
                      <tr key={r.id} onClick={() => setDetailId(r.id)} style={{ cursor: "pointer" }}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.studentName}</div>
                          <div style={{ fontSize: 12, color: "#667085" }}>{r.studentEmail}</div>
                        </td>
                        <td>
                          {r.course || "—"}
                          {r.installmentCount > 1 ? ` (${r.installmentNo}/${r.installmentCount})` : ""}
                        </td>
                        <td>{monthLabel(r)}</td>
                        <td>{money(r.amount)}</td>
                        <td>
                          <span className={`hub-badge ${PAYMENT_REQUEST_STATUS_META[r.status] || "hub-badge-gray"}`}>{r.status}</span>
                        </td>
                        <td>
                          {r.reminderCount ? (
                            <span className="hub-badge hub-badge-blue">
                              <BellOutlined /> {r.reminderCount}
                            </span>
                          ) : (
                            <span style={{ color: "#98a2b3", fontSize: 12 }}>—</span>
                          )}
                        </td>
                        <td>{r.createdByName || "—"}</td>
                        <td>{formatDate(r.created)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <PaymentDetailModal id={detailId} onClose={() => setDetailId(null)} />
      </div>
    </div>
  );
}
