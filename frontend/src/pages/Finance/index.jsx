import React, { useEffect, useState } from "react";
import HubTabs from "@/components/HubTabs";
import HubModal from "@/components/HubModal";
import NewTicketModal from "@/components/NewTicketModal";
import { useTickets } from "@/context/ticketsContext";
import { request } from "@/request";
import paymentsApi from "@/pages/Payments/api";
import {
  FundOutlined,
  SolutionOutlined,
  CustomerServiceOutlined,
  CheckOutlined,
  PlusOutlined,
  ExportOutlined,
  WalletOutlined,
  MailOutlined,
  BellOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

const FINANCE_CATEGORY = "Finance";

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

// listAll returns success:false + result:[] when the collection is simply
// empty (backend/.../createCRUDController/listAll.js) — that's not an error.
async function listAllSafe(entity) {
  const res = await request.listAll({ entity });
  return Array.isArray(res?.result) ? res.result : [];
}

// Invoice.isOverdue on the model is never actually set anywhere in the
// backend (it's always false) — this derives the real thing from
// expiredDate/paymentStatus/status instead, same as pages/Invoice/index.jsx.
function invoiceIsOverdue(inv) {
  return inv.expiredDate && new Date(inv.expiredDate) < new Date() && inv.paymentStatus !== "paid" && !["cancelled", "refunded"].includes(inv.status);
}

// The backend's invoice update Joi schema requires the full document
// (client/number/year/status/expiredDate/date/items/taxRate — see
// invoiceController/schemaValidate.js), so a bare {approved: true} patch
// always 400s. Reconstructs the full payload from an already-fetched
// invoice, same helper as pages/Invoice/index.jsx's invoiceUpdatePayload.
function invoiceUpdatePayload(inv, overrides = {}) {
  return {
    client: inv.client?._id || inv.client,
    number: inv.number,
    year: inv.year,
    status: inv.status,
    date: inv.date,
    expiredDate: inv.expiredDate,
    items: inv.items.map((it) => ({
      itemName: it.itemName,
      description: it.description || "",
      quantity: it.quantity,
      price: it.price,
      total: it.total,
    })),
    taxRate: inv.taxRate,
    discount: inv.discount || 0,
    notes: inv.notes || "",
    ...overrides,
  };
}

const PAYMENT_STATUS_META = {
  paid: "hub-badge-green",
  partially: "hub-badge-yellow",
  unpaid: "hub-badge-red",
};

/* =========================================================
   FINANCE MANAGER — oversight: revenue, outstanding, approvals.
========================================================= */

function FinanceManagerTab({ invoices, payments, loading, onApproved }) {
  const navigate = useNavigate();
  const [approvingId, setApprovingId] = useState(null);

  const totalBilled = invoices.reduce((s, inv) => s + (inv.total || 0), 0);
  const totalCollected = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const outstanding = invoices
    .filter((inv) => inv.paymentStatus !== "paid")
    .reduce((s, inv) => s + (inv.total || 0), 0);
  const overdueCount = invoices.filter(invoiceIsOverdue).length;
  const pendingApproval = invoices.filter((inv) => !inv.approved);

  const approve = async (inv) => {
    setApprovingId(inv._id);
    const res = await request.update({ entity: "invoice", id: inv._id, jsonData: invoiceUpdatePayload(inv, { approved: true }) });
    setApprovingId(null);
    if (res?.success) onApproved?.();
  };

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading financial overview…</div>
      </div>
    );
  }

  return (
    <div className="hub-stack">
      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Billed</div>
          <div className="hub-kpi-value">{money(totalBilled)}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Collected</div>
          <div className="hub-kpi-value">{money(totalCollected)}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Outstanding</div>
          <div className="hub-kpi-value">{money(outstanding)}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Overdue Invoices</div>
          <div className="hub-kpi-value">{overdueCount}</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Invoices Awaiting Approval</h3>
          <span className="hub-badge hub-badge-purple">{pendingApproval.length} pending</span>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingApproval.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="hub-empty">Nothing waiting on approval right now.</div>
                  </td>
                </tr>
              )}
              {pendingApproval.map((inv) => (
                <tr key={inv._id}>
                  <td>#{inv.number}/{inv.year}</td>
                  <td>{inv.client?.name || "—"}</td>
                  <td>{money(inv.total, inv.currency)}</td>
                  <td>
                    <span className={`hub-badge ${PAYMENT_STATUS_META[inv.paymentStatus] || "hub-badge-gray"}`}>
                      {inv.paymentStatus}
                    </span>
                  </td>
                  <td>{formatDate(inv.date)}</td>
                  <td>
                    <button
                      type="button"
                      className="hub-btn"
                      disabled={approvingId === inv._id}
                      onClick={() => approve(inv)}
                    >
                      <CheckOutlined /> Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Overdue Invoices</h3>
        </div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {invoices.filter(invoiceIsOverdue).length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="hub-empty">No overdue invoices.</div>
                  </td>
                </tr>
              )}
              {invoices
                .filter(invoiceIsOverdue)
                .map((inv) => (
                  <tr key={inv._id}>
                    <td>#{inv.number}/{inv.year}</td>
                    <td>{inv.client?.name || "—"}</td>
                    <td>{money(inv.total, inv.currency)}</td>
                    <td>{formatDate(inv.expiredDate)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="hub-btn" style={{ marginTop: 14 }} onClick={() => navigate("/invoice")}>
          <ExportOutlined /> Open full Invoices module
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   FINANCE EXECUTIVE — day-to-day: recent invoices & payments.
========================================================= */

function FinanceExecutiveTab({ invoices, payments, loading }) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading transactions…</div>
      </div>
    );
  }

  const recentInvoices = [...invoices]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);
  const recentPayments = [...payments]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);

  return (
    <div className="hub-stack">
      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Invoices</div>
          <div className="hub-kpi-value">{invoices.length}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Payments Recorded</div>
          <div className="hub-kpi-value">{payments.length}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Unpaid Invoices</div>
          <div className="hub-kpi-value">{invoices.filter((i) => i.paymentStatus === "unpaid").length}</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Recent Invoices</h3>
          <button type="button" className="hub-btn" onClick={() => navigate("/invoice")}>
            <ExportOutlined /> View All
          </button>
        </div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentInvoices.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="hub-empty">No invoices yet.</div>
                  </td>
                </tr>
              )}
              {recentInvoices.map((inv) => (
                <tr key={inv._id}>
                  <td>#{inv.number}/{inv.year}</td>
                  <td>{inv.client?.name || "—"}</td>
                  <td>{money(inv.total, inv.currency)}</td>
                  <td>
                    <span className={`hub-badge ${PAYMENT_STATUS_META[inv.paymentStatus] || "hub-badge-gray"}`}>
                      {inv.paymentStatus}
                    </span>
                  </td>
                  <td>
                    <span className="hub-badge hub-badge-blue">{inv.status}</span>
                  </td>
                  <td>{formatDate(inv.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Recent Payments</h3>
          <button type="button" className="hub-btn" onClick={() => navigate("/payment")}>
            <ExportOutlined /> View All
          </button>
        </div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Invoice</th>
                <th>Amount</th>
                <th>Reference</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentPayments.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">No payments recorded yet.</div>
                  </td>
                </tr>
              )}
              {recentPayments.map((p) => (
                <tr key={p._id}>
                  <td>{p.client?.name || "—"}</td>
                  <td>{p.invoice ? `#${p.invoice.number}/${p.invoice.year}` : "—"}</td>
                  <td>{money(p.amount, p.currency)}</td>
                  <td>{p.ref || "—"}</td>
                  <td>{formatDate(p.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   FINANCE SUPPORT — billing queries queue.
========================================================= */

function mapTicket(t) {
  return {
    id: t._id,
    code: `TCK-${t._id.slice(-6).toUpperCase()}`,
    subject: t.subject,
    priority: t.priority,
    status: t.status,
    raisedBy: t.raisedByName || "—",
    date: t.created ? new Date(t.created).toLocaleString() : "",
  };
}

// Same paginated /ticket/list + /ticket/stats fetch pattern as the Support
// page's ModuleTicketsPanel (pages/Support/index.jsx), scoped to the Finance
// category — replaces the old client-side filter over the full unpaginated
// ticketsContext array.
function FinanceSupportTab() {
  const { addTicket } = useTickets();
  const [newOpen, setNewOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [stats, setStats] = useState({ Open: 0, "In Progress": 0, Resolved: 0 });

  const statuses = ["All", "Open", "In Progress", "Resolved"];

  const loadPage = async (targetPage) => {
    setLoading(true);
    const query = new URLSearchParams({
      page: targetPage,
      items: 10,
      category: FINANCE_CATEGORY,
      status: statusFilter,
    }).toString();
    const res = await request.get({ entity: `ticket/list?${query}` });
    if (res?.success) {
      setTickets(res.result.map(mapTicket));
      setPage(res.pagination.page);
      setPages(res.pagination.pages);
      setCount(res.pagination.count);
    } else {
      setTickets([]);
    }
    setLoading(false);
  };

  const loadStats = async () => {
    const res = await request.get({ entity: `ticket/stats?category=${FINANCE_CATEGORY}` });
    if (res?.success) setStats(res.result);
  };

  const reload = () => {
    loadPage(1);
    loadStats();
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <div className="hub-stack">
      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Open</div>
          <div className="hub-kpi-value">{stats.Open}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">In Progress</div>
          <div className="hub-kpi-value">{stats["In Progress"]}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Resolved</div>
          <div className="hub-kpi-value">{stats.Resolved}</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Finance Queries</h3>
          <div className="hub-row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div className="hub-pill-filter">
              {statuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`hub-pill-btn ${statusFilter === s ? "active" : ""}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setNewOpen(true)}>
              <PlusOutlined /> Raise Finance Query
            </button>
          </div>
        </div>

        {loading ? (
          <div className="hub-empty">Loading tickets…</div>
        ) : (
          <>
            <div className="hub-table-wrapper">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Subject</th>
                    <th>Priority</th>
                    <th>Raised By</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <div className="hub-empty">No finance queries in this status.</div>
                      </td>
                    </tr>
                  )}
                  {tickets.map((t) => (
                    <tr key={t.id}>
                      <td>{t.code}</td>
                      <td>{t.subject}</td>
                      <td>
                        <span className="hub-badge hub-badge-yellow">{t.priority}</span>
                      </td>
                      <td>{t.raisedBy}</td>
                      <td>{t.date}</td>
                      <td>
                        <span
                          className={`hub-badge ${
                            t.status === "Open" ? "hub-badge-red" : t.status === "Resolved" ? "hub-badge-green" : "hub-badge-yellow"
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div className="hub-row" style={{ justifyContent: "center", gap: 12, marginTop: 14, alignItems: "center" }}>
                <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => loadPage(page - 1)}>
                  Prev
                </button>
                <span style={{ fontSize: 12.5, color: "#667085" }}>
                  Page {page} of {pages} · {count} tickets
                </span>
                <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => loadPage(page + 1)}>
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <NewTicketModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onAdd={async (data) => {
          const res = await addTicket(data);
          if (res?.success) reload();
          return res;
        }}
        initialCategory={FINANCE_CATEGORY}
      />
    </div>
  );
}

/* =========================================================
   PAYMENTS — the Razorpay/EMI fee-collection stream (pages/Payments),
   shown here so Finance can see every payment coming in without switching
   modules — with a Team/Individual (by agent) filter and name/email/agent
   search. Fetches once and filters client-side, same pattern as the
   Manager/Executive tabs above (listAllSafe over the whole set).
========================================================= */

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
            <div className="fin-pm-section-label">Summary</div>
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
              <MailOutlined /> Emails
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
              <div className="fin-pm-section-label">Installment schedule — which month's payment has come in</div>
              <div className="hub-table-wrapper">
                <table className="hub-table fin-pm-schedule">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Month</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Emails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.plan.installments.map((ins) => (
                      <tr key={ins.installmentNo} className={ins.projected ? "is-projected" : ""}>
                        <td className="fin-pm-inst-no">
                          {ins.installmentNo}/{detail.plan.installmentCount}
                        </td>
                        <td>{monthLabel(ins)}</td>
                        <td>{money(ins.amount)}</td>
                        <td>
                          <span className={`hub-badge ${PAYMENT_REQUEST_STATUS_META[ins.status] || "hub-badge-gray"}`}>{ins.status}</span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {ins.projected
                            ? "—"
                            : ins.status === "paid"
                            ? `Paid ${formatDate(ins.paidAt)}`
                            : ins.emailSent
                            ? "Link sent"
                            : "No link email"}
                          {!ins.projected && ins.status !== "paid" && ins.reminderCount
                            ? ` · ${ins.reminderCount} reminder${ins.reminderCount === 1 ? "" : "s"}`
                            : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </HubModal>
  );
}

function FinancePaymentsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("team"); // 'team' = everyone, 'individual' = one agent
  const [agent, setAgent] = useState("");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState(null);

  const load = async () => {
    setLoading(true);
    const res = await paymentsApi.list({ limit: 500 });
    setRows((res && res.result) || []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const agents = [...new Set(rows.map((r) => r.createdByName).filter(Boolean))].sort();

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (scope === "individual" && agent && (r.createdByName || "") !== agent) return false;
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
                  <th>Student</th>
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
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function Finance() {
  const [tab, setTab] = useState("manager");
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    const [inv, pay] = await Promise.all([listAllSafe("invoice"), listAllSafe("payment")]);
    setInvoices(inv);
    setPayments(pay);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Finance</h2>
          <p>Revenue, approvals, transactions and billing support — for the whole finance team</p>
        </div>
      </div>

      <HubTabs
        tabs={[
          { key: "manager", label: "Finance Manager", icon: <FundOutlined /> },
          { key: "executive", label: "Finance Executive", icon: <SolutionOutlined /> },
          { key: "payments", label: "Payments", icon: <WalletOutlined /> },
          { key: "support", label: "Finance Support", icon: <CustomerServiceOutlined /> },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "manager" && (
        <FinanceManagerTab invoices={invoices} payments={payments} loading={loading} onApproved={loadData} />
      )}
      {tab === "executive" && <FinanceExecutiveTab invoices={invoices} payments={payments} loading={loading} />}
      {tab === "payments" && <FinancePaymentsTab />}
      {tab === "support" && <FinanceSupportTab />}
    </div>
  );
}
