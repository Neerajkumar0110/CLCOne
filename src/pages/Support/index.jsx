import React, { useEffect, useState } from "react";
import HubTabs from "@/components/HubTabs";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import { TICKET_CATEGORY_MODULES } from "@/config/permissionModules";
import {
  AppstoreOutlined,
  DashboardOutlined,
  CustomerServiceOutlined,
  PhoneOutlined,
  TrophyOutlined,
  SolutionOutlined,
  ContainerOutlined,
  CreditCardOutlined,
  BarChartOutlined,
  TeamOutlined,
  MessageOutlined,
  FundOutlined,
  SettingOutlined,
  ReconciliationOutlined,
  GithubOutlined,
  CloudServerOutlined,
} from "@ant-design/icons";

const ALL_TAB = "All";
const PAGE_SIZE = 10;

// Keeps the Subject column skimmable — full text is one click away in the
// ticket detail modal.
const SUBJECT_WORD_LIMIT = 10;
function truncateWords(text, limit) {
  if (!text) return "";
  const words = text.trim().split(/\s+/);
  if (words.length <= limit) return text;
  return words.slice(0, limit).join(" ") + "…";
}

function mapTicket(t) {
  return {
    id: t._id,
    code: `TCK-${t._id.slice(-6).toUpperCase()}`,
    subject: t.subject,
    description: t.description || "",
    category: t.category,
    priority: t.priority,
    status: t.status,
    raisedBy: t.raisedByName || "—",
    date: t.created ? new Date(t.created).toLocaleString() : "",
  };
}

// Same icon each module uses in the sidebar (NavigationContainer.jsx) — kept
// in sync manually so a ticket's tab here is instantly recognizable.
const MODULE_ICONS = {
  Dashboard: <DashboardOutlined />,
  Customer: <CustomerServiceOutlined />,
  Calls: <PhoneOutlined />,
  Performance: <TrophyOutlined />,
  Leads: <SolutionOutlined />,
  Invoices: <ContainerOutlined />,
  Payments: <CreditCardOutlined />,
  Reports: <BarChartOutlined />,
  "User Management": <TeamOutlined />,
  Communication: <MessageOutlined />,
  Finance: <FundOutlined />,
  Settings: <SettingOutlined />,
  About: <ReconciliationOutlined />,
  "Git Management": <GithubOutlined />,
  "Vercel Management": <CloudServerOutlined />,
};

const TICKET_STATUS_META = {
  Open: "hub-badge-red",
  "In Progress": "hub-badge-yellow",
  Resolved: "hub-badge-green",
};

const TICKET_PRIORITY_META = {
  Low: "hub-badge-gray",
  Medium: "hub-badge-blue",
  High: "hub-badge-yellow",
  Urgent: "hub-badge-red",
};

// One module's ticket queue — every module tab on this page renders this
// same panel, just scoped to its own category. The "All" tab passes
// category === ALL_TAB and skips that filter, adding a Category column
// instead so each row's module is still visible.
//
// Backed by GET /api/ticket/list?category=&status=&page=&items= (a custom
// override — the generic list endpoint only supports one filter field at a
// time, and this page needs category + status together) instead of the
// shared ticketsContext's full unpaginated fetch, so this stays fast no
// matter how many tickets pile up over time.
function ModuleTicketsPanel({ category, onStatusChange }) {
  const isAll = category === ALL_TAB;
  const [statusFilter, setStatusFilter] = useState("All");
  const [viewTicket, setViewTicket] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [stats, setStats] = useState({ Open: 0, "In Progress": 0, Resolved: 0 });

  const statuses = ["All", "Open", "In Progress", "Resolved"];
  const columnCount = isAll ? 7 : 6;

  const loadPage = async (targetPage) => {
    setLoading(true);
    const options = { page: targetPage, items: PAGE_SIZE, status: statusFilter };
    if (!isAll) options.category = category;
    const query = new URLSearchParams(options).toString();
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
    const query = isAll ? "" : `?category=${encodeURIComponent(category)}`;
    const res = await request.get({ entity: `ticket/stats${query}` });
    if (res?.success) setStats(res.result);
  };

  useEffect(() => {
    loadPage(1);
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, statusFilter]);

  const updateStatus = async (ticketId, newStatus) => {
    setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t)));
    await request.update({ entity: "ticket", id: ticketId, jsonData: { status: newStatus } });
    loadStats();
    onStatusChange?.();
  };

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
          <h3>{isAll ? "All" : category} Tickets</h3>
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
                    {isAll && <th>Category</th>}
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
                      <td colSpan={columnCount}>
                        <div className="hub-empty">No {isAll ? "" : `${category} `}tickets in this status.</div>
                      </td>
                    </tr>
                  )}
                  {tickets.map((t) => (
                    <tr key={t.id}>
                      <td>{t.code}</td>
                      {isAll && <td>{t.category}</td>}
                      <td>
                        <button type="button" className="hub-link-btn" onClick={() => setViewTicket(t)}>
                          {truncateWords(t.subject, SUBJECT_WORD_LIMIT)}
                        </button>
                      </td>
                      <td>
                        <span className={`hub-badge ${TICKET_PRIORITY_META[t.priority]}`}>{t.priority}</span>
                      </td>
                      <td>{t.raisedBy}</td>
                      <td>{t.date}</td>
                      <td>
                        <select
                          className="hub-select"
                          value={t.status}
                          onChange={(e) => updateStatus(t.id, e.target.value)}
                        >
                          {Object.keys(TICKET_STATUS_META).map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
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

      <HubModal
        open={!!viewTicket}
        onClose={() => setViewTicket(null)}
        title={viewTicket?.code}
        subtitle={viewTicket?.category}
        width={520}
      >
        {viewTicket && (
          <div className="hub-stack" style={{ gap: 0 }}>
            <div className="hub-form-row">
              <label>Subject</label>
              <div>{viewTicket.subject}</div>
            </div>
            <div className="hub-grid-2">
              <div className="hub-form-row">
                <label>Priority</label>
                <div>
                  <span className={`hub-badge ${TICKET_PRIORITY_META[viewTicket.priority]}`}>{viewTicket.priority}</span>
                </div>
              </div>
              <div className="hub-form-row">
                <label>Status</label>
                <div>
                  <span className={`hub-badge ${TICKET_STATUS_META[viewTicket.status]}`}>{viewTicket.status}</span>
                </div>
              </div>
            </div>
            <div className="hub-form-row">
              <label>Raised By</label>
              <div>{viewTicket.raisedBy} · {viewTicket.date}</div>
            </div>
            <div className="hub-form-row">
              <label>Message</label>
              <div>{viewTicket.description || "No additional details provided."}</div>
            </div>
          </div>
        )}
      </HubModal>
    </div>
  );
}

export default function Support() {
  const [tab, setTab] = useState(ALL_TAB);
  const [categoryCounts, setCategoryCounts] = useState({});

  const loadCategoryCounts = async () => {
    const res = await request.get({ entity: "ticket/category-counts" });
    if (res?.success) setCategoryCounts(res.result);
  };

  useEffect(() => {
    loadCategoryCounts();
  }, []);

  const allOpenCount = Object.values(categoryCounts).reduce((sum, n) => sum + n, 0);

  return (
    <>
      <style>{`
        /* Support module UI refresh — scoped only to this page so light mode stays readable
           without changing the rest of the app. */
        .support-module-shell {
          background: linear-gradient(135deg, #eef6ff 0%, #f8fbff 42%, #fff7fb 100%);
          border-radius: 22px;
          padding: 22px 20px 26px;
          border: 1px solid rgba(149, 171, 211, 0.28);
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
        }

        .support-module-shell .hub-header h2,
        .support-module-shell .hub-card-header h3,
        .support-module-shell .hub-kpi-value,
        .support-module-shell .hub-table th,
        .support-module-shell .hub-table td,
        .support-module-shell .hub-form-row label,
        .support-module-shell .hub-form-row div,
        .support-module-shell .hub-pill-btn,
        .support-module-shell .hub-tab,
        .support-module-shell .hub-btn,
        .support-module-shell .hub-empty,
        .support-module-shell .hub-link-btn {
          color: #0f172a !important;
          font-weight: 800 !important;
        }

        .support-module-shell .hub-header p,
        .support-module-shell .hub-kpi-label,
        .support-module-shell .hub-table th,
        .support-module-shell .hub-table td,
        .support-module-shell .hub-form-row label,
        .support-module-shell .hub-empty,
        .support-module-shell .hub-table-wrapper {
          color: #475569 !important;
        }

        .support-module-shell .hub-card,
        .support-module-shell .hub-kpi,
        .support-module-shell .hub-tabbar,
        .support-module-shell .hub-pill-filter,
        .support-module-shell .hub-table-wrapper,
        .support-module-shell .hub-table,
        .support-module-shell .hub-btn {
          background: rgba(255, 255, 255, 0.9) !important;
          border-color: rgba(148, 163, 184, 0.34) !important;
        }

        .support-module-shell .hub-kpi {
          border-radius: 18px;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
        }

        .support-module-shell .hub-kpi:nth-child(1) {
          background: linear-gradient(180deg, #edf5ff 0%, #f8fbff 100%);
        }

        .support-module-shell .hub-kpi:nth-child(2) {
          background: linear-gradient(180deg, #fff0f7 0%, #fffafc 100%);
        }

        .support-module-shell .hub-kpi:nth-child(3) {
          background: linear-gradient(180deg, #edfdf5 0%, #f8fff9 100%);
        }

        .support-module-shell .hub-tabbar {
          border-radius: 16px;
          padding: 6px;
        }

        .support-module-shell .hub-tab {
          border-radius: 12px;
          background: transparent;
          font-weight: 800;
          color: #334155;
        }

        .support-module-shell .hub-tab.active {
          background: linear-gradient(135deg, #123a73 0%, #1d4f8f 100%);
          color: #ffffff !important;
          box-shadow: 0 10px 16px rgba(18, 58, 115, 0.16);
        }

        .support-module-shell .hub-tab-count {
          font-weight: 800;
        }

        .support-module-shell .hub-pill-btn {
          border-radius: 999px;
          background: transparent;
          color: #334155;
          font-weight: 800;
        }

        .support-module-shell .hub-pill-btn.active {
          background: linear-gradient(135deg, #123a73 0%, #1d4f8f 100%);
          color: #ffffff !important;
        }

        .support-module-shell .hub-btn {
          border-radius: 12px;
          font-weight: 800;
          background: white;
          color: #0f172a;
        }

        .support-module-shell .hub-btn:hover {
          background: #edf5ff;
          color: #123a73;
          border-color: rgba(18, 58, 115, 0.35);
        }

        .support-module-shell .hub-btn-primary {
          background: linear-gradient(135deg, #123a73 0%, #1d4f8f 100%);
          color: #ffffff !important;
          border-color: transparent;
        }

        .support-module-shell .hub-table thead th {
          background: #f3f7ff;
          color: #0f172a;
          font-weight: 800;
        }

        .support-module-shell .hub-table tbody tr:hover td {
          background: #f8fbff;
        }

        .support-module-shell .hub-link-btn {
          background: transparent;
          border: none;
          padding: 0;
          font-weight: 800;
          text-align: left;
        }

        .support-module-shell .hub-select {
          background: #ffffff;
          color: #0f172a;
          border-color: rgba(148, 163, 184, 0.42);
          font-weight: 700;
        }

        .support-module-shell .hub-badge {
          font-weight: 800;
        }

        /* Support module dark mode fix — these selectors intentionally come after
           the light-mode rules because the module styles use !important. */
        :root[data-theme='dark'] .support-module-shell {
          background: linear-gradient(135deg, #081a32 0%, #102746 52%, #201a31 100%);
          border-color: rgba(125, 180, 255, 0.28);
          box-shadow: 0 14px 32px rgba(0, 0, 0, 0.28);
          color: #ffffff;
        }

        :root[data-theme='dark'] .support-module-shell .hub-card,
        :root[data-theme='dark'] .support-module-shell .hub-kpi,
        :root[data-theme='dark'] .support-module-shell .hub-tabbar,
        :root[data-theme='dark'] .support-module-shell .hub-pill-filter,
        :root[data-theme='dark'] .support-module-shell .hub-table-wrapper,
        :root[data-theme='dark'] .support-module-shell .hub-table,
        :root[data-theme='dark'] .support-module-shell .hub-btn,
        :root[data-theme='dark'] .support-module-shell .hub-select {
          background: #12213d !important;
          border-color: #2b3f5f !important;
          color: #ffffff !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-kpi:nth-child(1) {
          background: linear-gradient(180deg, #142d4d 0%, #12213d 100%) !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-kpi:nth-child(2) {
          background: linear-gradient(180deg, #38233a 0%, #12213d 100%) !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-kpi:nth-child(3) {
          background: linear-gradient(180deg, #163a31 0%, #12213d 100%) !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-header h2,
        :root[data-theme='dark'] .support-module-shell .hub-card-header h3,
        :root[data-theme='dark'] .support-module-shell .hub-kpi-value,
        :root[data-theme='dark'] .support-module-shell .hub-table th,
        :root[data-theme='dark'] .support-module-shell .hub-table td,
        :root[data-theme='dark'] .support-module-shell .hub-form-row label,
        :root[data-theme='dark'] .support-module-shell .hub-form-row div,
        :root[data-theme='dark'] .support-module-shell .hub-btn,
        :root[data-theme='dark'] .support-module-shell .hub-select,
        :root[data-theme='dark'] .support-module-shell .hub-empty,
        :root[data-theme='dark'] .support-module-shell .hub-link-btn {
          color: #ffffff !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-header p,
        :root[data-theme='dark'] .support-module-shell .hub-kpi-label,
        :root[data-theme='dark'] .support-module-shell .hub-table th,
        :root[data-theme='dark'] .support-module-shell .hub-table td,
        :root[data-theme='dark'] .support-module-shell .hub-form-row label,
        :root[data-theme='dark'] .support-module-shell .hub-empty,
        :root[data-theme='dark'] .support-module-shell .hub-table-wrapper {
          color: rgba(255, 255, 255, 0.4) !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-table thead th {
          background: #162b4a !important;
          color: #ffffff !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-table tbody tr:hover td {
          background: rgba(255, 255, 255, 0.06) !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-tab,
        :root[data-theme='dark'] .support-module-shell .hub-pill-btn {
          background: transparent !important;
          color: rgba(255, 255, 255, 0.4) !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-tab.active,
        :root[data-theme='dark'] .support-module-shell .hub-pill-btn.active,
        :root[data-theme='dark'] .support-module-shell .hub-btn-primary {
          background: linear-gradient(135deg, #245a9c 0%, #3477c5 100%) !important;
          color: #ffffff !important;
        }

        :root[data-theme='dark'] .support-module-shell .hub-btn:hover {
          background: #1a3355 !important;
          color: #ffffff !important;
          border-color: #7db4ff !important;
        }
      `}</style>

      <div className="hub-page support-module-shell">
        <div className="hub-header">
          <div>
            <h2>Support</h2>
            <p>Every module's tickets, split out by where the issue actually is</p>
          </div>
        </div>

        <HubTabs
          tabs={[
            { key: ALL_TAB, label: ALL_TAB, icon: <AppstoreOutlined />, count: allOpenCount },
            ...TICKET_CATEGORY_MODULES.map((mod) => ({
              key: mod,
              label: mod,
              icon: MODULE_ICONS[mod],
              count: categoryCounts[mod] || 0,
            })),
          ]}
          active={tab}
          onChange={setTab}
        />

        <ModuleTicketsPanel category={tab} onStatusChange={loadCategoryCounts} />
      </div>
    </>
  );
}
