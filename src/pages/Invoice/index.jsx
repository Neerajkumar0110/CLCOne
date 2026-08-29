import React, { useEffect, useMemo, useState } from "react";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import { BASE_URL } from "@/config/serverApiConfig";
import {
  PlusOutlined,
  DownloadOutlined,
  PrinterOutlined,
  MailOutlined,
  EditOutlined,
  CopyOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  ArrowLeftOutlined,
  FileTextOutlined,
  BankOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  ExportOutlined,
  EyeOutlined,
  PlusCircleOutlined,
  MinusCircleOutlined,
  UserAddOutlined,
} from "@ant-design/icons";

/* =========================================================
   REAL DATA — settings, status enums, money formatting
========================================================= */

// Same real Setting API used by pages/Settings/Settings.jsx — reused
// read-only here for the invoice letterhead (company name/address/bank)
// and money formatting, so the invoice document matches what's actually
// configured in Settings instead of showing made-up seller details.
async function fetchSettings(keys) {
  const res = await request.get({ entity: `setting/listBySettingKey?settingKeyArray=${keys.join(",")}` });
  const map = {};
  if (res?.success) res.result.forEach((s) => { map[s.settingKey] = s.settingValue; });
  return map;
}

const COMPANY_KEYS = ["company_name", "company_address", "company_phone", "company_email", "company_bank_account", "company_logo"];
const MONEY_KEYS = ["currency_symbol", "currency_position", "cent_precision", "default_currency_code"];

// Backend Invoice.status enum (backend/src/models/appModels/Invoice.js) —
// these exact lowercase strings are what the update Joi schema accepts.
const STATUS_OPTIONS = ["draft", "pending", "sent", "refunded", "cancelled", "on hold"];
const STATUS_LABELS = { draft: "Draft", pending: "Pending", sent: "Sent", refunded: "Refunded", cancelled: "Cancelled", "on hold": "On Hold" };
const STATUS_META = { draft: "hub-badge-gray", pending: "hub-badge-yellow", sent: "hub-badge-blue", refunded: "hub-badge-purple", cancelled: "hub-badge-gray", "on hold": "hub-badge-yellow" };
const PAYMENT_STATUS_LABELS = { unpaid: "Unpaid", partially: "Partially Paid", paid: "Paid" };
const PAYMENT_STATUS_META = { unpaid: "hub-badge-red", partially: "hub-badge-yellow", paid: "hub-badge-green" };

const PAGE_SIZE = 10;

function isOverdue(inv) {
  return inv.expiredDate && new Date(inv.expiredDate) < new Date() && inv.paymentStatus !== "paid" && !["cancelled", "refunded"].includes(inv.status);
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function toDateInput(d) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

function moneyFmt(n, money) {
  const symbol = money?.currency_symbol || "₹";
  const position = money?.currency_position || "before";
  const precision = Number.isFinite(money?.cent_precision) ? money.cent_precision : 2;
  const amount = Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: precision, maximumFractionDigits: precision });
  return position === "after" ? `${amount}${symbol}` : `${symbol}${amount}`;
}

function blankLineItem() {
  return { key: Math.random().toString(36).slice(2), itemName: "", description: "", quantity: 1, price: 0 };
}

function calcTotals(items, taxRate) {
  const subTotal = items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.price || 0), 0);
  const taxTotal = subTotal * (Number(taxRate || 0) / 100);
  return { subTotal, taxTotal, total: subTotal + taxTotal };
}

// Reconstructs the full payload the backend's strict update Joi schema
// requires (client/number/year/status/expiredDate/date/items/taxRate all
// required — see invoiceController/schemaValidate.js) from an
// already-fetched invoice, so any partial change (status, approve) can
// still be sent as a complete, valid update instead of a bare {field}
// patch that the schema would reject.
export function invoiceUpdatePayload(inv, overrides = {}) {
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

/* =========================================================
   CREATE / EDIT INVOICE MODAL
========================================================= */

function InvoiceFormModal({ open, onClose, onSaved, editing, clients, onClientsChanged, nextNumber }) {
  const blank = () => ({
    client: clients[0]?._id || "",
    number: nextNumber,
    year: new Date().getFullYear(),
    date: toDateInput(new Date()),
    expiredDate: toDateInput(new Date(Date.now() + 14 * 24 * 3600 * 1000)),
    items: [blankLineItem()],
    taxRate: 18,
    discount: 0,
    notes: "Thank you for your business.",
    status: "draft",
    currency: "NA",
  });

  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [addingClient, setAddingClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", email: "", phone: "" });
  const [savingClient, setSavingClient] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        client: editing.client?._id || editing.client,
        number: editing.number,
        year: editing.year,
        date: toDateInput(editing.date),
        expiredDate: toDateInput(editing.expiredDate),
        items: editing.items.map((it) => ({ key: it._id || Math.random().toString(36).slice(2), itemName: it.itemName, description: it.description || "", quantity: it.quantity, price: it.price })),
        taxRate: editing.taxRate || 0,
        discount: editing.discount || 0,
        notes: editing.notes || "",
        status: editing.status,
        currency: editing.currency,
      });
    } else {
      setForm(blank());
    }
    setAddingClient(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, open, nextNumber]);

  const totals = useMemo(() => calcTotals(form.items, form.taxRate), [form.items, form.taxRate]);

  const updateItem = (key, field, value) => setForm((f) => ({ ...f, items: f.items.map((it) => (it.key === key ? { ...it, [field]: value } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, blankLineItem()] }));
  const removeItem = (key) => setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((it) => it.key !== key) : f.items }));

  const saveClient = async () => {
    if (!newClient.name.trim()) return;
    setSavingClient(true);
    const res = await request.create({ entity: "client", jsonData: newClient });
    setSavingClient(false);
    if (res?.success) {
      await onClientsChanged();
      setForm((f) => ({ ...f, client: res.result._id }));
      setAddingClient(false);
      setNewClient({ name: "", email: "", phone: "" });
    }
  };

  const submit = async () => {
    if (!form.client || form.items.every((it) => !it.itemName.trim())) return;
    setSaving(true);
    const items = form.items
      .filter((it) => it.itemName.trim())
      .map((it) => ({ itemName: it.itemName, description: it.description, quantity: Number(it.quantity) || 0, price: Number(it.price) || 0, total: (Number(it.quantity) || 0) * (Number(it.price) || 0) }));

    const payload = {
      client: form.client,
      number: Number(form.number),
      year: Number(form.year),
      date: form.date,
      expiredDate: form.expiredDate,
      items,
      taxRate: Number(form.taxRate) || 0,
      discount: Number(form.discount) || 0,
      notes: form.notes,
      status: form.status,
      currency: form.currency,
    };

    const res = editing
      ? await request.update({ entity: "invoice", id: editing._id, jsonData: payload })
      : await request.create({ entity: "invoice", jsonData: payload });

    setSaving(false);
    if (res?.success) {
      onSaved(res.result);
      onClose();
    }
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title={editing ? `Edit Invoice #${editing.number}` : "Create Invoice"}
      subtitle="Add customer, line items, and terms"
      width={760}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={saving}>
            <FileTextOutlined /> {saving ? "Saving…" : editing ? "Save Changes" : "Create Invoice"}
          </button>
        </>
      }
    >
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Invoice Number</label>
          <input className="hub-input" type="number" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} />
        </div>
        <div className="hub-form-row">
          <label>Client</label>
          {!addingClient ? (
            <div className="hub-row" style={{ gap: 8 }}>
              <select className="hub-select" style={{ flex: 1 }} value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}>
                {clients.length === 0 && <option value="">No clients yet</option>}
                {clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
              <button type="button" className="hub-btn" title="Add new client" onClick={() => setAddingClient(true)}>
                <UserAddOutlined />
              </button>
            </div>
          ) : (
            <div className="hub-card" style={{ padding: 12, background: "var(--hub-bg-soft)" }}>
              <input className="hub-input" placeholder="Client name" style={{ marginBottom: 6 }} value={newClient.name} onChange={(e) => setNewClient((c) => ({ ...c, name: e.target.value }))} />
              <input className="hub-input" placeholder="Email" style={{ marginBottom: 6 }} value={newClient.email} onChange={(e) => setNewClient((c) => ({ ...c, email: e.target.value }))} />
              <input className="hub-input" placeholder="Phone" style={{ marginBottom: 8 }} value={newClient.phone} onChange={(e) => setNewClient((c) => ({ ...c, phone: e.target.value }))} />
              <div className="hub-row" style={{ gap: 8 }}>
                <button type="button" className="hub-btn hub-btn-primary" onClick={saveClient} disabled={savingClient} style={{ flex: 1 }}>
                  {savingClient ? "Saving…" : "Save Client"}
                </button>
                <button type="button" className="hub-btn" onClick={() => setAddingClient(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Issue Date</label>
          <input className="hub-input" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </div>
        <div className="hub-form-row">
          <label>Due Date</label>
          <input className="hub-input" type="date" value={form.expiredDate} onChange={(e) => setForm((f) => ({ ...f, expiredDate: e.target.value }))} />
        </div>
      </div>

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Status</label>
          <select className="hub-select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Currency</label>
          <input className="hub-input" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={6} />
        </div>
      </div>

      <div style={{ margin: "18px 0 8px", fontSize: 12.5, fontWeight: 700, color: "var(--hub-text)" }}>Line Items</div>

      <div className="hub-table-wrapper" style={{ marginBottom: 10 }}>
        <table className="hub-table" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Item</th>
              <th style={{ textAlign: "left" }}>Description</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {form.items.map((it) => (
              <tr key={it.key}>
                <td style={{ textAlign: "left" }}>
                  <input className="hub-input" style={{ minWidth: 140 }} value={it.itemName} onChange={(e) => updateItem(it.key, "itemName", e.target.value)} placeholder="Service name" />
                </td>
                <td style={{ textAlign: "left" }}>
                  <input className="hub-input" style={{ minWidth: 140 }} value={it.description} onChange={(e) => updateItem(it.key, "description", e.target.value)} placeholder="Optional" />
                </td>
                <td>
                  <input className="hub-input" type="number" style={{ width: 64, textAlign: "center" }} value={it.quantity} onChange={(e) => updateItem(it.key, "quantity", e.target.value)} />
                </td>
                <td>
                  <input className="hub-input" type="number" style={{ width: 92, textAlign: "center" }} value={it.price} onChange={(e) => updateItem(it.key, "price", e.target.value)} />
                </td>
                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{moneyFmt(Number(it.quantity || 0) * Number(it.price || 0))}</td>
                <td>
                  <button type="button" onClick={() => removeItem(it.key)} style={{ border: "none", background: "none", color: "var(--hub-red)", cursor: "pointer", fontSize: 15 }} title="Remove line">
                    <MinusCircleOutlined />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" className="hub-btn" onClick={addItem} style={{ marginBottom: 18 }}>
        <PlusCircleOutlined /> Add Line
      </button>

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Tax Rate (%)</label>
          <input className="hub-input" type="number" value={form.taxRate} onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} />
        </div>
        <div className="hub-form-row">
          <label>Discount</label>
          <input className="hub-input" type="number" value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 28, fontSize: 12.5, padding: "12px 4px", borderTop: "1px solid var(--hub-border)", marginBottom: 16 }}>
        <div>Subtotal: <strong>{moneyFmt(totals.subTotal)}</strong></div>
        <div>Tax: <strong>{moneyFmt(totals.taxTotal)}</strong></div>
        <div>Total: <strong style={{ color: "var(--hub-blue)" }}>{moneyFmt(totals.total)}</strong></div>
      </div>

      <div className="hub-form-row">
        <label>Notes</label>
        <textarea className="hub-input" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: "vertical", fontFamily: "inherit" }} />
      </div>
    </HubModal>
  );
}

/* =========================================================
   CONFIRM DIALOG
========================================================= */

function ConfirmModal({ open, title, message, confirmLabel, danger, onConfirm, onClose }) {
  return (
    <HubModal
      open={open}
      onClose={onClose}
      title={title}
      width={380}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" style={danger ? { background: "var(--hub-red)", borderColor: "var(--hub-red)" } : {}} onClick={() => { onConfirm(); onClose(); }}>
            {confirmLabel}
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
   INVOICE DETAIL / PRINT VIEW
========================================================= */

function InvoiceDetail({ invoice, company, money, onBack, onEdit, onDuplicate, onCancelInvoice, onDeleteInvoice, onRecordPayment, onSend }) {
  const [confirmAction, setConfirmAction] = useState(null); // 'cancel' | 'delete' | null

  const balanceDue = invoice.total - invoice.discount - (invoice.credit || 0);
  const overdue = isOverdue(invoice);

  return (
    <div className="hub-stack">
      <div className="hub-card no-print">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <button type="button" className="hub-btn" onClick={onBack}>
            <ArrowLeftOutlined /> Back to Invoices
          </button>

          <div className="hub-btn-group">
            <button type="button" className="hub-btn" onClick={() => onEdit(invoice)}>
              <EditOutlined /> Edit
            </button>
            <button type="button" className="hub-btn" onClick={() => window.print()}>
              <PrinterOutlined /> Print
            </button>
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => window.print()}>
              <DownloadOutlined /> Download PDF
            </button>
            {invoice.status === "draft" && (
              <button type="button" className="hub-btn" onClick={() => onSend(invoice)}>
                <MailOutlined /> Mark as Sent
              </button>
            )}
            {invoice.paymentStatus !== "paid" && invoice.status !== "cancelled" && (
              <button type="button" className="hub-btn" onClick={() => onRecordPayment(invoice)}>
                <DollarOutlined /> Record Payment
              </button>
            )}
            <button type="button" className="hub-btn" onClick={() => onDuplicate(invoice)}>
              <CopyOutlined /> Duplicate
            </button>
            {invoice.status !== "cancelled" && (
              <button type="button" className="hub-btn" style={{ color: "var(--hub-red)", borderColor: "var(--hub-red-soft)" }} onClick={() => setConfirmAction("cancel")}>
                <CloseCircleOutlined /> Cancel
              </button>
            )}
            <button type="button" className="hub-btn" style={{ color: "var(--hub-red)", borderColor: "var(--hub-red-soft)" }} onClick={() => setConfirmAction("delete")}>
              <DeleteOutlined /> Delete
            </button>
          </div>
        </div>
      </div>

      <div className="hub-card invoice-print-area" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "28px 32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 20, borderBottom: "2px solid var(--hub-text)", paddingBottom: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {company.company_logo ? (
                <img src={BASE_URL + company.company_logo} alt="logo" style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 52, height: 52, borderRadius: 12, background: "linear-gradient(135deg,var(--hub-blue),#6d9bff)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 20, flexShrink: 0 }}>
                  {(company.company_name || "C")[0]}
                </div>
              )}
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "var(--hub-text)" }}>{company.company_name || "Your Company"}</div>
                <div style={{ fontSize: 11.5, color: "var(--hub-muted)", lineHeight: 1.5, maxWidth: 260 }}>
                  {company.company_address}<br />
                  {company.company_phone} · {company.company_email}
                </div>
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--hub-blue)", letterSpacing: "0.5px" }}>TAX INVOICE</div>
              <div style={{ fontSize: 12.5, color: "var(--hub-text-soft)", marginTop: 6 }}>Invoice #: <strong>{invoice.number}</strong></div>
              <div style={{ fontSize: 12.5, color: "var(--hub-text-soft)" }}>Invoice Date: {formatDate(invoice.date)}</div>
              <div style={{ fontSize: 12.5, color: "var(--hub-text-soft)" }}>Due Date: {formatDate(invoice.expiredDate)}</div>
              <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <span className={`hub-badge ${STATUS_META[invoice.status]}`}>{STATUS_LABELS[invoice.status]}</span>
                <span className={`hub-badge ${PAYMENT_STATUS_META[invoice.paymentStatus]}`}>{PAYMENT_STATUS_LABELS[invoice.paymentStatus]}</span>
                {overdue && <span className="hub-badge hub-badge-red">Overdue</span>}
              </div>
            </div>
          </div>

          <div className="hub-grid-2" style={{ marginBottom: 22 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--hub-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Bill To</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--hub-text)" }}>{invoice.client?.name}</div>
              <div style={{ fontSize: 12, color: "var(--hub-muted)", lineHeight: 1.6 }}>
                {invoice.client?.address}<br />
                {invoice.client?.phone} · {invoice.client?.email}
              </div>
            </div>
          </div>

          <div className="hub-table-wrapper" style={{ marginBottom: 16 }}>
            <table className="hub-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>#</th>
                  <th style={{ textAlign: "left" }}>Item</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((it, idx) => (
                  <tr key={it._id || idx}>
                    <td style={{ textAlign: "left" }}>{idx + 1}</td>
                    <td style={{ textAlign: "left" }}>
                      {it.itemName}
                      {it.description && <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>{it.description}</div>}
                    </td>
                    <td>{it.quantity}</td>
                    <td>{moneyFmt(it.price, money)}</td>
                    <td style={{ fontWeight: 700 }}>{moneyFmt(it.total, money)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
            <div style={{ width: 280 }}>
              {[["Subtotal", invoice.subTotal], [`Tax (${invoice.taxRate}%)`, invoice.taxTotal]].map(([label, val]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", color: "var(--hub-text-soft)" }}>
                  <span>{label}</span><span>{moneyFmt(val, money)}</span>
                </div>
              ))}
              {invoice.discount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", color: "var(--hub-text-soft)" }}>
                  <span>Discount</span><span>-{moneyFmt(invoice.discount, money)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, padding: "10px 0", borderTop: "2px solid var(--hub-text)", marginTop: 4, color: "var(--hub-text)" }}>
                <span>Total</span><span>{moneyFmt(invoice.total, money)}</span>
              </div>
              {invoice.credit > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0", color: "var(--hub-green)" }}>
                  <span>Amount Paid</span><span>{moneyFmt(invoice.credit, money)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 700, padding: "6px 0", color: balanceDue > 0 ? "var(--hub-red)" : "var(--hub-green)" }}>
                <span>Balance Due</span><span>{moneyFmt(balanceDue, money)}</span>
              </div>
            </div>
          </div>

          {company.company_bank_account && (
            <div style={{ borderTop: "1px solid var(--hub-border)", paddingTop: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--hub-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                <BankOutlined /> Bank Details
              </div>
              <div style={{ fontSize: 12, color: "var(--hub-text-soft)" }}>{company.company_bank_account}</div>
            </div>
          )}

          {invoice.notes && (
            <div style={{ borderTop: "1px solid var(--hub-border)", paddingTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--hub-muted)", textTransform: "uppercase", marginBottom: 6 }}>Notes</div>
              <div style={{ fontSize: 12, color: "var(--hub-muted)" }}>{invoice.notes}</div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmAction === "cancel"}
        title="Cancel this invoice?"
        message={`Invoice #${invoice.number} will be marked as Cancelled.`}
        confirmLabel="Cancel Invoice"
        danger
        onConfirm={() => onCancelInvoice(invoice)}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmModal
        open={confirmAction === "delete"}
        title="Delete this invoice?"
        message={`Invoice #${invoice.number} will be permanently removed.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => onDeleteInvoice(invoice)}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
}

/* =========================================================
   RECORD PAYMENT MODAL — creates a real Payment record
========================================================= */

function RecordPaymentModal({ invoice, money, onClose, onRecorded, nextPaymentNumber }) {
  const balanceDue = invoice ? invoice.total - invoice.discount - (invoice.credit || 0) : 0;
  const [amount, setAmount] = useState(0);
  const [ref, setRef] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (invoice) { setAmount(balanceDue); setRef(""); setDescription(""); setError(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  if (!invoice) return null;

  const submit = async () => {
    setSaving(true);
    setError("");
    const res = await request.create({
      entity: "payment",
      jsonData: {
        client: invoice.client?._id || invoice.client,
        invoice: invoice._id,
        number: nextPaymentNumber,
        date: new Date().toISOString().slice(0, 10),
        amount: Number(amount),
        currency: invoice.currency,
        ref,
        description,
      },
    });
    setSaving(false);
    if (res?.success) {
      onRecorded(res.result);
      onClose();
    } else {
      setError(res?.message || "Could not record payment.");
    }
  };

  return (
    <HubModal
      open={!!invoice}
      onClose={onClose}
      title={`Record Payment — Invoice #${invoice.number}`}
      subtitle={`Balance due: ${moneyFmt(balanceDue, money)}`}
      width={380}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={saving}>
            <DollarOutlined /> {saving ? "Recording…" : "Record Payment"}
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Amount Received</label>
        <input className="hub-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
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

/* =========================================================
   MAIN INVOICE LIST PAGE
========================================================= */

export default function Invoice() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState(new Set());

  const [clients, setClients] = useState([]);
  const [company, setCompany] = useState({});
  const [money, setMoney] = useState({});
  const [kpi, setKpi] = useState({ total: 0, total_undue: 0, performance: [] });

  const [formOpen, setFormOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const loadClients = async () => {
    const res = await request.listAll({ entity: "client" });
    if (res?.success !== false && Array.isArray(res?.result)) setClients(res.result);
  };

  const loadSettingsData = async () => {
    const [c, m] = await Promise.all([fetchSettings(COMPANY_KEYS), fetchSettings(MONEY_KEYS)]);
    setCompany(c);
    setMoney(m);
  };

  const loadKpi = async () => {
    const res = await request.get({ entity: "invoice/summary" });
    if (res?.success) setKpi({ total: res.result.total || 0, total_undue: res.result.total_undue || 0, performance: res.result.performance || [] });
  };

  const loadPage = async (targetPage) => {
    setLoading(true);
    const options = { page: targetPage, items: PAGE_SIZE };
    if (status !== "All") options.status = status;
    if (search.trim()) options.q = search.trim();
    const res = await request.list({ entity: "invoice", options });
    if (res?.success !== false) {
      setInvoices(res.result || []);
      setPage(res.pagination?.page || 1);
      setPages(res.pagination?.pages || 1);
      setCount(res.pagination?.count || 0);
    } else {
      setInvoices([]);
    }
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => {
    loadClients();
    loadSettingsData();
    loadKpi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const t = setTimeout(() => loadPage(1), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const refresh = () => { loadPage(page); loadKpi(); };

  const performanceCount = (key) => kpi.performance.find((p) => p.status === key)?.count || 0;

  const toggleSelect = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelected((prev) => (prev.size === invoices.length ? new Set() : new Set(invoices.map((i) => i._id))));

  const handleSaved = () => { refresh(); };

  const handleEdit = (inv) => { setEditingInvoice(inv); setViewingInvoice(null); setFormOpen(true); };

  const handleDuplicate = async (inv) => {
    const res = await request.create({
      entity: "invoice",
      jsonData: {
        client: inv.client?._id || inv.client,
        number: (inv.number || 0) + 1,
        year: inv.year,
        date: new Date().toISOString().slice(0, 10),
        expiredDate: toDateInput(new Date(Date.now() + 14 * 24 * 3600 * 1000)),
        items: inv.items.map((it) => ({ itemName: it.itemName, description: it.description, quantity: it.quantity, price: it.price, total: it.total })),
        taxRate: inv.taxRate,
        discount: inv.discount,
        notes: inv.notes,
        status: "draft",
        currency: inv.currency,
      },
    });
    if (res?.success) {
      refresh();
      setViewingInvoice(res.result);
    }
  };

  const handleCancelInvoice = async (inv) => {
    const res = await request.update({ entity: "invoice", id: inv._id, jsonData: invoiceUpdatePayload(inv, { status: "cancelled" }) });
    if (res?.success) { setViewingInvoice(res.result); refresh(); }
  };

  const handleDeleteInvoice = async (inv) => {
    const res = await request.delete({ entity: "invoice", id: inv._id });
    if (res?.success) { setViewingInvoice(null); refresh(); }
  };

  const handleSend = async (inv) => {
    const res = await request.update({ entity: "invoice", id: inv._id, jsonData: invoiceUpdatePayload(inv, { status: "sent" }) });
    if (res?.success) { setViewingInvoice(res.result); refresh(); }
  };

  const handleRecordPayment = async (payment) => {
    refresh();
    if (viewingInvoice) {
      const res = await request.read({ entity: "invoice", id: viewingInvoice._id });
      if (res?.success) setViewingInvoice(res.result);
    }
  };

  const bulkMarkSent = async () => {
    const targets = invoices.filter((i) => selected.has(i._id) && i.status === "draft");
    await Promise.all(targets.map((i) => request.update({ entity: "invoice", id: i._id, jsonData: invoiceUpdatePayload(i, { status: "sent" }) })));
    refresh();
  };

  const bulkDelete = async () => {
    await Promise.all([...selected].map((id) => request.delete({ entity: "invoice", id })));
    refresh();
  };

  const exportCurrentPage = () => {
    const rows = selected.size > 0 ? invoices.filter((i) => selected.has(i._id)) : invoices;
    const csv = [
      ["Invoice #", "Client", "Issued", "Due", "Amount", "Status"].join(","),
      ...rows.map((i) => [i.number, i.client?.name, formatDate(i.date), formatDate(i.expiredDate), i.total.toFixed(2), i.status].join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "invoices.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const nextInvoiceNumber = useMemo(() => (invoices[0]?.number || 1000) + 1, [invoices]);
  const nextPaymentNumber = useMemo(() => Number(Date.now().toString().slice(-9)), [payingInvoice]);

  if (viewingInvoice) {
    return (
      <div className="hub-page">
        <InvoiceDetail
          invoice={viewingInvoice}
          company={company}
          money={money}
          onBack={() => setViewingInvoice(null)}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
          onCancelInvoice={handleCancelInvoice}
          onDeleteInvoice={handleDeleteInvoice}
          onRecordPayment={(inv) => setPayingInvoice(inv)}
          onSend={handleSend}
        />
        <RecordPaymentModal invoice={payingInvoice} money={money} nextPaymentNumber={nextPaymentNumber} onClose={() => setPayingInvoice(null)} onRecorded={handleRecordPayment} />
        <InvoiceFormModal
          open={formOpen}
          editing={editingInvoice}
          clients={clients}
          onClientsChanged={loadClients}
          nextNumber={nextInvoiceNumber}
          onClose={() => { setFormOpen(false); setEditingInvoice(null); }}
          onSaved={(inv) => { handleSaved(); setViewingInvoice(inv); }}
        />
      </div>
    );
  }

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Invoices</h2>
          <p>Create, track, and collect on every invoice — from draft to paid</p>
        </div>
      </div>

      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Invoiced</div>
          <div className="hub-kpi-value">{moneyFmt(kpi.total, money)}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Outstanding</div>
          <div className="hub-kpi-value" style={{ color: "var(--hub-yellow)" }}>{moneyFmt(kpi.total_undue, money)}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Paid Invoices</div>
          <div className="hub-kpi-value" style={{ color: "var(--hub-green)" }}>{performanceCount("paid")}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Overdue</div>
          <div className="hub-kpi-value" style={{ color: "var(--hub-red)" }}>{performanceCount("overdue")}</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>All Invoices</h3>

          <div className="hub-row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="hub-input"
              placeholder="Search invoice # or client…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 200 }}
            />

            <button type="button" className="hub-btn" onClick={exportCurrentPage}>
              <ExportOutlined /> Export
            </button>

            <button type="button" className="hub-btn hub-btn-primary" onClick={() => { setEditingInvoice(null); setFormOpen(true); }}>
              <PlusOutlined /> Create Invoice
            </button>
          </div>
        </div>

        <div style={{ paddingTop: 16, marginBottom: 16, borderTop: "1px solid var(--hub-border)" }}>
          <div className="hub-pill-filter">
            <button type="button" className={`hub-pill-btn ${status === "All" ? "active" : ""}`} onClick={() => setStatus("All")}>All</button>
            {STATUS_OPTIONS.map((s) => (
              <button key={s} type="button" className={`hub-pill-btn ${status === s ? "active" : ""}`} onClick={() => setStatus(s)}>
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--hub-blue-soft)", border: "1px solid var(--hub-border)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--hub-text)" }}>
              {selected.size} invoice{selected.size === 1 ? "" : "s"} selected
            </span>
            <div className="hub-btn-group">
              <button type="button" className="hub-btn" onClick={bulkMarkSent}>
                <MailOutlined /> Mark as Sent
              </button>
              <button type="button" className="hub-btn" onClick={exportCurrentPage}>
                <ExportOutlined /> Export Selected
              </button>
              <button type="button" className="hub-btn" style={{ color: "var(--hub-red)", borderColor: "var(--hub-red-soft)" }} onClick={() => setBulkConfirm(true)}>
                <DeleteOutlined /> Delete
              </button>
            </div>
          </div>
        )}

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={invoices.length > 0 && selected.size === invoices.length} onChange={toggleSelectAll} />
                </th>
                <th style={{ textAlign: "left" }}>Invoice #</th>
                <th>Client</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9}><div className="hub-empty">Loading invoices…</div></td></tr>
              )}
              {!loading && invoices.length === 0 && (
                <tr><td colSpan={9}><div className="hub-empty">No invoices match this search.</div></td></tr>
              )}
              {!loading && invoices.map((i) => (
                <tr key={i._id}>
                  <td><input type="checkbox" checked={selected.has(i._id)} onChange={() => toggleSelect(i._id)} /></td>
                  <td style={{ textAlign: "left", fontWeight: 600 }}>#{i.number}</td>
                  <td>{i.client?.name || "—"}</td>
                  <td>{formatDate(i.date)}</td>
                  <td>{formatDate(i.expiredDate)}</td>
                  <td>{moneyFmt(i.total, money)}</td>
                  <td>
                    <span className={`hub-badge ${STATUS_META[i.status]}`}>{STATUS_LABELS[i.status]}</span>
                    {isOverdue(i) && <span className="hub-badge hub-badge-red" style={{ marginLeft: 4 }}>Overdue</span>}
                  </td>
                  <td><span className={`hub-badge ${PAYMENT_STATUS_META[i.paymentStatus]}`}>{PAYMENT_STATUS_LABELS[i.paymentStatus]}</span></td>
                  <td>
                    <button type="button" className="hub-btn" style={{ padding: "5px 12px" }} onClick={() => setViewingInvoice(i)}>
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
            <span style={{ fontSize: 12.5, color: "var(--hub-muted)" }}>Page {page} of {pages} · {count} invoices</span>
            <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => loadPage(page + 1)}>Next</button>
          </div>
        )}
      </div>

      <InvoiceFormModal
        open={formOpen}
        editing={editingInvoice}
        clients={clients}
        onClientsChanged={loadClients}
        nextNumber={nextInvoiceNumber}
        onClose={() => { setFormOpen(false); setEditingInvoice(null); }}
        onSaved={handleSaved}
      />

      <ConfirmModal
        open={bulkConfirm}
        title="Delete selected invoices?"
        message={`${selected.size} invoice${selected.size === 1 ? "" : "s"} will be permanently removed.`}
        confirmLabel="Delete"
        danger
        onConfirm={bulkDelete}
        onClose={() => setBulkConfirm(false)}
      />
    </div>
  );
}
