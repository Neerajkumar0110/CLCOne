import React, { useEffect, useMemo, useState } from "react";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import {
  ExportOutlined,
  FileDoneOutlined,
  EyeOutlined,
  ArrowLeftOutlined,
  UserOutlined,
  CalendarOutlined,
  DollarOutlined,
  WalletOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";

const PAGE_SIZE = 10;

function formatMoney(n, money) {
  const symbol = money?.currency_symbol || "₹";
  const position = money?.currency_position || "before";
  const precision = Number.isFinite(money?.cent_precision) ? money.cent_precision : 2;
  const amount = Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: precision, maximumFractionDigits: precision });
  return position === "after" ? `${amount}${symbol}` : `${symbol}${amount}`;
}

function formatDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function fetchSettings(keys) {
  const res = await request.get({ entity: `setting/listBySettingKey?settingKeyArray=${keys.join(",")}` });
  const map = {};
  if (res?.success) res.result.forEach((s) => { map[s.settingKey] = s.settingValue; });
  return map;
}

/* =========================================================
   RECORD / EDIT PAYMENT MODAL
========================================================= */

function PaymentFormModal({ open, onClose, onSaved, editing, nextNumber }) {
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [invoiceOptions, setInvoiceOptions] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    if (editing) {
      setSelectedInvoice(editing.invoice);
      setAmount(editing.amount);
      setDate(editing.date ? new Date(editing.date).toISOString().slice(0, 10) : "");
      setRef(editing.ref || "");
      setDescription(editing.description || "");
    } else {
      setSelectedInvoice(null);
      setAmount(0);
      setDate(new Date().toISOString().slice(0, 10));
      setRef("");
      setDescription("");
      setInvoiceQuery("");
      setInvoiceOptions([]);
    }
  }, [editing, open]);

  useEffect(() => {
    if (editing || !open) return;
    const t = setTimeout(async () => {
      const res = await request.list({ entity: "invoice", options: { page: 1, items: 20, ...(invoiceQuery.trim() ? { q: invoiceQuery.trim() } : {}) } });
      if (res?.success !== false) setInvoiceOptions((res.result || []).filter((i) => i.paymentStatus !== "paid" && i.status !== "cancelled" && i.status !== "refunded"));
    }, 300);
    return () => clearTimeout(t);
  }, [invoiceQuery, open, editing]);

  const balanceDue = selectedInvoice ? selectedInvoice.total - (selectedInvoice.discount || 0) - (selectedInvoice.credit || 0) : 0;

  const submit = async () => {
    setError("");
    if (!editing && !selectedInvoice) { setError("Select an invoice to pay against."); return; }
    setSaving(true);

    const res = editing
      ? await request.update({ entity: "payment", id: editing._id, jsonData: { number: editing.number, date, amount: Number(amount), ref, description } })
      : await request.create({
          entity: "payment",
          jsonData: {
            client: selectedInvoice.client?._id || selectedInvoice.client,
            invoice: selectedInvoice._id,
            number: nextNumber,
            date,
            amount: Number(amount),
            currency: selectedInvoice.currency,
            ref,
            description,
          },
        });

    setSaving(false);
    if (res?.success) { onSaved(res.result); onClose(); }
    else setError(res?.message || "Could not save payment.");
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title={editing ? `Edit Payment #${editing.number}` : "Record Payment"}
      subtitle={editing ? `Invoice #${editing.invoice?.number}` : "Pick an invoice and record what was received"}
      width={420}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={saving}>
            <DollarOutlined /> {saving ? "Saving…" : editing ? "Save Changes" : "Record Payment"}
          </button>
        </>
      }
    >
      {!editing && (
        <div className="hub-form-row">
          <label>Invoice</label>
          {selectedInvoice ? (
            <div className="hub-row" style={{ justifyContent: "space-between", alignItems: "center", border: "1px solid var(--hub-border)", borderRadius: 8, padding: "8px 10px" }}>
              <span style={{ fontSize: 13 }}>#{selectedInvoice.number} — {selectedInvoice.client?.name}</span>
              <button type="button" className="hub-btn" style={{ padding: "3px 8px" }} onClick={() => setSelectedInvoice(null)}>Change</button>
            </div>
          ) : (
            <>
              <input className="hub-input" placeholder="Search invoice # or client…" value={invoiceQuery} onChange={(e) => setInvoiceQuery(e.target.value)} />
              <div style={{ maxHeight: 160, overflowY: "auto", marginTop: 6, border: invoiceOptions.length ? "1px solid var(--hub-border)" : "none", borderRadius: 8 }}>
                {invoiceOptions.map((inv) => (
                  <div
                    key={inv._id}
                    onClick={() => { setSelectedInvoice(inv); setAmount(inv.total - (inv.discount || 0) - (inv.credit || 0)); }}
                    style={{ padding: "8px 10px", fontSize: 12.5, cursor: "pointer", borderBottom: "1px solid var(--hub-border)" }}
                  >
                    #{inv.number} — {inv.client?.name} · balance {formatMoney(inv.total - (inv.discount || 0) - (inv.credit || 0))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {selectedInvoice && (
        <div style={{ fontSize: 12, color: "var(--hub-muted)", marginBottom: 10 }}>Balance due: <strong>{formatMoney(balanceDue)}</strong></div>
      )}

      <div className="hub-form-row">
        <label>Amount</label>
        <input className="hub-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="hub-form-row">
        <label>Date</label>
        <input className="hub-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="hub-form-row">
        <label>Reference (optional)</label>
        <input className="hub-input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transaction / cheque #" />
      </div>
      <div className="hub-form-row">
        <label>Note (optional)</label>
        <input className="hub-input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {error && <div style={{ color: "var(--hub-red)", fontSize: 12, marginTop: 4 }}>{error}</div>}
    </HubModal>
  );
}

function ConfirmModal({ open, title, message, onConfirm, onClose }) {
  return (
    <HubModal
      open={open}
      onClose={onClose}
      title={title}
      width={380}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" style={{ background: "var(--hub-red)", borderColor: "var(--hub-red)" }} onClick={() => { onConfirm(); onClose(); }}>
            Delete
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, color: "var(--hub-text-soft)", display: "flex", gap: 10, alignItems: "flex-start" }}>
        <ExclamationCircleOutlined style={{ color: "var(--hub-yellow)", fontSize: 18, marginTop: 1 }} />
        <span>{message}</span>
      </div>
    </HubModal>
  );
}

/* =========================================================
   PAYMENT DETAIL
========================================================= */

function PaymentDetail({ payment, money, onBack, onEdit, onDelete }) {
  return (
    <div className="hub-stack">
      <div className="hub-row" style={{ justifyContent: "space-between" }}>
        <button type="button" className="hub-btn" onClick={onBack} style={{ width: "fit-content" }}>
          <ArrowLeftOutlined /> Back to Payments
        </button>
        <div className="hub-btn-group">
          <button type="button" className="hub-btn" onClick={() => onEdit(payment)}><EditOutlined /> Edit</button>
          <button type="button" className="hub-btn" style={{ color: "var(--hub-red)", borderColor: "var(--hub-red-soft)" }} onClick={() => onDelete(payment)}><DeleteOutlined /> Delete</button>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Payment #{payment.number}</h3>
        </div>

        <div style={{ fontSize: 30, fontWeight: 800, color: "var(--hub-text)", marginBottom: 20 }}>
          {formatMoney(payment.amount, money)}
        </div>

        <div className="hub-grid-2" style={{ marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--hub-muted)", textTransform: "uppercase", marginBottom: 12 }}>Payment Details</div>
            {[
              [<UserOutlined key="c" />, "Client", payment.client?.name],
              [<FileDoneOutlined key="i" />, "Invoice #", payment.invoice?.number],
              [<CalendarOutlined key="d" />, "Date", formatDateTime(payment.date)],
              [<DollarOutlined key="r" />, "Reference", payment.ref || "—"],
              [<UserOutlined key="cb" />, "Recorded By", payment.createdBy?.name],
            ].map(([icon, label, value]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--hub-border)", fontSize: 13 }}>
                <span style={{ color: "var(--hub-blue)", fontSize: 14, width: 18 }}>{icon}</span>
                <span style={{ color: "var(--hub-muted)", minWidth: 140 }}>{label}</span>
                <span style={{ fontWeight: 600, color: "var(--hub-text)" }}>{value}</span>
              </div>
            ))}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--hub-muted)", textTransform: "uppercase", marginBottom: 12 }}>Note</div>
            <div style={{ fontSize: 13, color: payment.description ? "var(--hub-text-soft)" : "var(--hub-muted)", lineHeight: 1.6 }}>
              {payment.description || "No additional note for this payment."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   MAIN PAYMENT LIST PAGE
========================================================= */

export default function Payment() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createdByFilter, setCreatedByFilter] = useState("All");
  const [admins, setAdmins] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [money, setMoney] = useState({});
  const [kpi, setKpi] = useState({ count: 0, total: 0 });

  const [viewingPayment, setViewingPayment] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadMoney = async () => setMoney(await fetchSettings(["currency_symbol", "currency_position", "cent_precision"]));

  const loadAdmins = async () => {
    const res = await request.list({ entity: "admin" });
    if (Array.isArray(res?.result)) setAdmins(res.result);
  };

  const loadKpi = async () => {
    const res = await request.get({ entity: "payment/summary" });
    if (res?.success) setKpi(res.result);
  };

  const loadPage = async (targetPage) => {
    setLoading(true);
    const options = { page: targetPage, items: PAGE_SIZE };
    if (createdByFilter !== "All") options.createdBy = createdByFilter;
    if (search.trim()) options.q = search.trim();
    const res = await request.list({ entity: "payment", options });
    if (res?.success !== false) {
      setPayments(res.result || []);
      setPage(res.pagination?.page || 1);
      setPages(res.pagination?.pages || 1);
      setCount(res.pagination?.count || 0);
    } else {
      setPayments([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadMoney();
    loadAdmins();
    loadKpi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdByFilter]);

  useEffect(() => {
    const t = setTimeout(() => loadPage(1), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const refresh = () => { loadPage(page); loadKpi(); };

  const nextPaymentNumber = useMemo(() => Number(Date.now().toString().slice(-9)), [formOpen]);

  const handleDelete = async (p) => {
    const res = await request.delete({ entity: "payment", id: p._id });
    if (res?.success) { setViewingPayment(null); refresh(); }
  };

  const exportCurrentPage = () => {
    const csv = [
      ["Payment #", "Client", "Invoice #", "Amount", "Recorded By", "Date"].join(","),
      ...payments.map((p) => [p.number, p.client?.name, p.invoice?.number, p.amount, p.createdBy?.name, formatDateTime(p.date)].join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payments.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (viewingPayment) {
    return (
      <div className="hub-page">
        <PaymentDetail
          payment={viewingPayment}
          money={money}
          onBack={() => setViewingPayment(null)}
          onEdit={(p) => { setEditingPayment(p); setFormOpen(true); }}
          onDelete={(p) => setDeleteTarget(p)}
        />
        <PaymentFormModal
          open={formOpen}
          editing={editingPayment}
          nextNumber={nextPaymentNumber}
          onClose={() => { setFormOpen(false); setEditingPayment(null); }}
          onSaved={(p) => { refresh(); setViewingPayment(p); }}
        />
        <ConfirmModal
          open={!!deleteTarget}
          title="Delete this payment?"
          message={`Payment #${deleteTarget?.number} will be permanently removed and the invoice balance restored.`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      </div>
    );
  }

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Payments</h2>
          <p>Every payment received, who recorded it, and against which invoice</p>
        </div>
      </div>

      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label"><WalletOutlined /> Total Received</div>
          <div className="hub-kpi-value">{formatMoney(kpi.total, money)}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label"><FileDoneOutlined /> Payments Recorded</div>
          <div className="hub-kpi-value">{kpi.count}</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>All Payments</h3>

          <div className="hub-row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <select className="hub-select" value={createdByFilter} onChange={(e) => setCreatedByFilter(e.target.value)}>
              <option value="All">Everyone</option>
              {admins.map((a) => <option key={a._id} value={a._id}>{a.name} {a.surname}</option>)}
            </select>

            <input
              className="hub-input"
              placeholder="Search client, invoice # or reference…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 220 }}
            />

            <button type="button" className="hub-btn" onClick={exportCurrentPage}>
              <ExportOutlined /> Export
            </button>

            <button type="button" className="hub-btn hub-btn-primary" onClick={() => { setEditingPayment(null); setFormOpen(true); }}>
              <PlusOutlined /> Record Payment
            </button>
          </div>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Payment #</th>
                <th>Client</th>
                <th>Invoice #</th>
                <th>Amount</th>
                <th>Recorded By</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7}><div className="hub-empty">Loading payments…</div></td></tr>
              )}
              {!loading && payments.length === 0 && (
                <tr><td colSpan={7}><div className="hub-empty">No payments match this filter.</div></td></tr>
              )}
              {!loading && payments.map((p) => (
                <tr key={p._id}>
                  <td style={{ textAlign: "left", fontWeight: 600 }}>#{p.number}</td>
                  <td>{p.client?.name || "—"}</td>
                  <td>#{p.invoice?.number ?? "—"}</td>
                  <td>{formatMoney(p.amount, money)}</td>
                  <td>{p.createdBy?.name}</td>
                  <td>{formatDateTime(p.date)}</td>
                  <td>
                    <button type="button" className="hub-btn" style={{ padding: "5px 12px" }} onClick={() => setViewingPayment(p)}>
                      <EyeOutlined /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="hub-row" style={{ justifyContent: "center", gap: 12, marginTop: 16, alignItems: "center" }}>
            <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => loadPage(page - 1)}>Prev</button>
            <span style={{ fontSize: 12.5, color: "var(--hub-muted)" }}>Page {page} of {pages} · {count} payments</span>
            <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => loadPage(page + 1)}>Next</button>
          </div>
        )}
      </div>

      <PaymentFormModal
        open={formOpen}
        editing={editingPayment}
        nextNumber={nextPaymentNumber}
        onClose={() => { setFormOpen(false); setEditingPayment(null); }}
        onSaved={refresh}
      />

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete this payment?"
        message={`Payment #${deleteTarget?.number} will be permanently removed and the invoice balance restored.`}
        onConfirm={() => handleDelete(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
