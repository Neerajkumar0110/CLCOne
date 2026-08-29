import React, { useMemo, useState } from "react";
import HubModal from "@/components/HubModal";

const STATUS_META = {
  Active: "hub-badge-green",
  Inactive: "hub-badge-gray",
};

const AVATAR_COLORS = ["#2563EB", "#7C3AED", "#0891B2", "#D97706", "#E11D48", "#16A34A"];

const customersSeed = [
  { name: "Nexa Digital", contact: "Rohan Malhotra", email: "rohan@nexadigital.com", phone: "+91 98111 22334", country: "India", invoices: 12, lifetimeValue: 486000, status: "Active", color: "#2563EB" },
  { name: "BrightPath Edu", contact: "Kavita Rao", email: "kavita@brightpathedu.com", phone: "+91 98222 33445", country: "India", invoices: 8, lifetimeValue: 312000, status: "Active", color: "#7C3AED" },
  { name: "UrbanCart", contact: "Sameer Khan", email: "sameer@urbancart.in", phone: "+91 98333 44556", country: "India", invoices: 5, lifetimeValue: 158000, status: "Active", color: "#0891B2" },
  { name: "Finzo Capital", contact: "Anjali Deshmukh", email: "anjali@finzocapital.com", phone: "+91 98444 55667", country: "India", invoices: 15, lifetimeValue: 724000, status: "Active", color: "#D97706" },
  { name: "GreenLeaf Foods", contact: "Manoj Tiwari", email: "manoj@greenleaf.co", phone: "+91 98555 66778", country: "India", invoices: 3, lifetimeValue: 64000, status: "Inactive", color: "#E11D48" },
  { name: "Skyline Realty", contact: "Divya Nair", email: "divya@skylinerealty.com", phone: "+91 98666 77889", country: "India", invoices: 9, lifetimeValue: 398000, status: "Active", color: "#16A34A" },
  { name: "MetroTech", contact: "Farhan Ali", email: "farhan@metrotech.io", phone: "+91 98777 88990", country: "India", invoices: 2, lifetimeValue: 42000, status: "Inactive", color: "#2563EB" },
  { name: "Sunrise Apparel", contact: "Pooja Iyer", email: "pooja@sunriseapparel.com", phone: "+91 98888 99001", country: "India", invoices: 6, lifetimeValue: 176000, status: "Active", color: "#7C3AED" },
];

function formatMoney(n) {
  return "₹" + n.toLocaleString("en-IN");
}

function AddCustomerModal({ open, onClose, onAdd }) {
  const blank = { name: "", contact: "", email: "", phone: "", country: "India" };
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    if (!form.name.trim()) return;
    onAdd({
      ...form,
      invoices: 0,
      lifetimeValue: 0,
      status: "Active",
      color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    });
    setForm(blank);
    onClose();
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="Add New Customer"
      subtitle="Add a company and its primary contact"
      width={440}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit}>Add Customer</button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Company Name</label>
        <input className="hub-input" value={form.name} onChange={set("name")} placeholder="e.g. Nexa Digital" />
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Contact Person</label>
          <input className="hub-input" value={form.contact} onChange={set("contact")} placeholder="e.g. Rohan Malhotra" />
        </div>
        <div className="hub-form-row">
          <label>Phone</label>
          <input className="hub-input" value={form.phone} onChange={set("phone")} placeholder="+91 90000 00000" />
        </div>
      </div>
      <div className="hub-form-row">
        <label>Email</label>
        <input className="hub-input" value={form.email} onChange={set("email")} placeholder="name@company.com" />
      </div>
    </HubModal>
  );
}

export default function Customer() {
  const [customers, setCustomers] = useState(customersSeed);
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 6;

  const statuses = ["All", "Active", "Inactive"];

  const filtered = useMemo(
    () =>
      customers
        .filter((c) => status === "All" || c.status === status)
        .filter(
          (c) =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.contact.toLowerCase().includes(search.toLowerCase())
        ),
    [customers, status, search]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  const totalCustomers = customers.length;
  const activeCustomers = customers.filter((c) => c.status === "Active").length;
  const newThisMonth = 3;
  const totalLTV = customers.reduce((s, c) => s + c.lifetimeValue, 0);

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Customers</h2>
          <p>Every company you work with, their contacts, and lifetime value</p>
        </div>
      </div>

      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Customers</div>
          <div className="hub-kpi-value">{totalCustomers}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Active</div>
          <div className="hub-kpi-value">{activeCustomers}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">New This Month</div>
          <div className="hub-kpi-value">{newThisMonth}</div>
          <div className="hub-kpi-delta hub-badge-green" style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20 }}>▲ 12%</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Lifetime Value</div>
          <div className="hub-kpi-value">{formatMoney(totalLTV)}</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>All Customers</h3>

          <div className="hub-row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="hub-input"
              placeholder="Search company or contact…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{ minWidth: 210 }}
            />

            <div className="hub-pill-filter">
              {statuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`hub-pill-btn ${status === s ? "active" : ""}`}
                  onClick={() => { setStatus(s); setPage(1); }}
                >
                  {s}
                </button>
              ))}
            </div>

            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setAddOpen(true)}>
              + Add Customer
            </button>
          </div>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Invoices</th>
                <th>Lifetime Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="hub-empty">No customers match this search.</div>
                  </td>
                </tr>
              )}
              {pageItems.map((c) => (
                <tr key={c.name}>
                  <td>
                    <div className="hub-person">
                      <div className="hub-avatar" style={{ background: c.color }}>
                        {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      {c.name}
                    </div>
                  </td>
                  <td>{c.contact}</td>
                  <td>{c.email}</td>
                  <td>{c.phone}</td>
                  <td>{c.invoices}</td>
                  <td>{formatMoney(c.lifetimeValue)}</td>
                  <td>
                    <span className={`hub-badge ${STATUS_META[c.status]}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 12, color: "#667085" }}>
            Showing {pageItems.length === 0 ? 0 : (page - 1) * pageSize + 1}–{(page - 1) * pageSize + pageItems.length} of {filtered.length}
          </span>
          <div className="hub-btn-group">
            <button type="button" className="hub-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span style={{ alignSelf: "center", fontSize: 12.5, color: "#344054" }}>Page {page} of {totalPages}</span>
            <button type="button" className="hub-btn" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
      </div>

      <AddCustomerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={(c) => { setCustomers((prev) => [c, ...prev]); setPage(1); }}
      />
    </div>
  );
}