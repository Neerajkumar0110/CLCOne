import React, { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  SearchOutlined,
  DownloadOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  CaretUpOutlined,
  CaretDownOutlined,
  SettingOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { Dropdown, Checkbox, Popconfirm, Modal } from "antd";
import { request } from "@/request";
import { badgeClassFor } from "./formatters";
import { exportRowsAsCsv } from "./csvExport";
import { buildQuery } from "./useDashboardData";

const PAGE_SIZES = [10, 25, 50, 100];
const COLS_KEY = (m) => `dash.${m}.cols`;

function cellText(col, value) {
  if (value == null || value === "") return "—";
  if (col.type === "date") {
    const d = dayjs(value);
    return d.isValid() ? d.format("DD MMM YYYY") : "—";
  }
  if (col.type === "number") return Number(value).toLocaleString("en-IN");
  return String(value);
}

function drillPredicate(d) {
  if (!d) return () => true;
  const vals = Array.isArray(d.value) ? d.value.map(String) : [String(d.value)];
  return (row) => {
    const cell = row[d.field];
    switch (d.op) {
      case "in":
      case "eq":
        return vals.includes(String(cell));
      case "gte":
        return Number(cell) >= Number(d.value);
      case "lte":
        return Number(cell) <= Number(d.value);
      case "truthy":
        return !!cell;
      case "falsy":
        return !cell;
      default:
        return true;
    }
  };
}

export default function AdvancedTable({
  module,
  meta = {},
  columns = [],
  rows: clientRows = [],
  query,
  drill,
  onClearDrill,
  rowActions = {},
}) {
  const server = meta.mode === "server";
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sortBy, setSortBy] = useState(columns[0] ? columns[0].key : "");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [hidden, setHidden] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(COLS_KEY(module))) || {};
    } catch {
      return {};
    }
  });
  const [selected, setSelected] = useState(new Set());
  const [viewRow, setViewRow] = useState(null);

  // server-mode state
  const [srvRows, setSrvRows] = useState([]);
  const [srvCount, setSrvCount] = useState(0);
  const [srvLoading, setSrvLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, pageSize, drill, query]);

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY(module), JSON.stringify(hidden));
    } catch {
      /* ignore */
    }
  }, [hidden, module]);

  // ── server fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!server) return;
    const id = ++reqId.current;
    setSrvLoading(true);
    const params = buildQuery(query);
    const extra = new URLSearchParams(params);
    extra.set("page", page);
    extra.set("items", pageSize);
    extra.set("sortBy", sortBy);
    extra.set("sortValue", sortDir === "asc" ? "1" : "-1");
    if (debouncedQ) extra.set("q", debouncedQ);
    if (drill) {
      extra.set("drillField", drill.field);
      extra.set("drillOp", drill.op);
      extra.set("drillValue", Array.isArray(drill.value) ? drill.value.join(",") : drill.value);
    }
    request.get({ entity: `analytics/${module}/rows?${extra.toString()}` }).then((r) => {
      if (id !== reqId.current) return;
      setSrvRows(r && r.success ? r.result : []);
      setSrvCount(r && r.pagination ? r.pagination.count : 0);
      setSrvLoading(false);
    });
  }, [server, module, query, page, pageSize, sortBy, sortDir, debouncedQ, drill]);

  // ── client processing ────────────────────────────────────────────────────
  const processed = useMemo(() => {
    if (server) return { rows: srvRows, total: srvCount };
    let rows = (clientRows || []).filter(drillPredicate(drill));
    if (debouncedQ) {
      const needle = debouncedQ.toLowerCase();
      rows = rows.filter((row) =>
        columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(needle))
      );
    }
    rows = rows.slice().sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      let cmp;
      if (av == null) cmp = -1;
      else if (bv == null) cmp = 1;
      else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return { rows, total: rows.length };
  }, [server, srvRows, srvCount, clientRows, drill, debouncedQ, sortBy, sortDir, columns]);

  const total = processed.total;
  const pageRows = server
    ? processed.rows
    : processed.rows.slice((page - 1) * pageSize, page * pageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const visibleCols = columns.filter((c) => !hidden[c.key]);

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const exportCsv = async () => {
    let rows = server ? processed.rows : processed.rows;
    if (server && total > pageRows.length) {
      const params = new URLSearchParams(buildQuery(query));
      params.set("items", "10000");
      params.set("sortBy", sortBy);
      params.set("sortValue", sortDir === "asc" ? "1" : "-1");
      if (debouncedQ) params.set("q", debouncedQ);
      if (drill) {
        params.set("drillField", drill.field);
        params.set("drillOp", drill.op);
        params.set("drillValue", Array.isArray(drill.value) ? drill.value.join(",") : drill.value);
      }
      const r = await request.get({ entity: `analytics/${module}/rows?${params.toString()}` });
      rows = r && r.success ? r.result : rows;
    }
    if (selected.size) rows = rows.filter((r) => selected.has(r.id));
    exportRowsAsCsv(module, rows, visibleCols);
  };

  const colMenu = {
    items: columns.map((c) => ({
      key: c.key,
      label: (
        <Checkbox
          checked={!hidden[c.key]}
          onChange={(e) => setHidden((h) => ({ ...h, [c.key]: !e.target.checked }))}
        >
          {c.label}
        </Checkbox>
      ),
    })),
  };

  return (
    <div className="hub-card dash-table hub-fade-up">
      <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
        <h3>Records</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="dash-search">
            <SearchOutlined />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
          </div>
          <Dropdown menu={colMenu} trigger={["click"]} placement="bottomRight">
            <button type="button" className="hub-btn" style={{ padding: "5px 9px" }}>
              <SettingOutlined /> Columns
            </button>
          </Dropdown>
          <button type="button" className="hub-btn" onClick={exportCsv}>
            <DownloadOutlined /> CSV
          </button>
        </div>
      </div>

      {drill && (
        <div className="dash-drill-chip">
          Filtered: <strong>{drill.label || `${drill.field} = ${drill.value}`}</strong>
          <button type="button" onClick={onClearDrill} aria-label="Clear filter">
            <CloseOutlined />
          </button>
        </div>
      )}

      <div className="hub-table-wrapper">
        <table className="hub-table dash-table-el">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <Checkbox
                  checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))}
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      pageRows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id)));
                      return n;
                    })
                  }
                />
              </th>
              {visibleCols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {c.label}{" "}
                  {sortBy === c.key &&
                    (sortDir === "asc" ? <CaretUpOutlined /> : <CaretDownOutlined />)}
                </th>
              ))}
              {(rowActions.view || rowActions.edit || rowActions.delete) && <th style={{ width: 90 }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(server && srvLoading ? [] : pageRows).map((row) => (
              <tr key={row.id} className="hub-fade-row">
                <td>
                  <Checkbox
                    checked={selected.has(row.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        e.target.checked ? n.add(row.id) : n.delete(row.id);
                        return n;
                      })
                    }
                  />
                </td>
                {visibleCols.map((c) => (
                  <td key={c.key}>
                    {c.type === "badge" ? (
                      <span className={`hub-badge ${badgeClassFor(row[c.key])}`}>
                        {row[c.key] || "—"}
                      </span>
                    ) : (
                      cellText(c, row[c.key])
                    )}
                  </td>
                ))}
                {(rowActions.view || rowActions.edit || rowActions.delete) && (
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      {rowActions.view && (
                        <button type="button" className="hub-icon-btn" onClick={() => setViewRow(row)} title="View">
                          <EyeOutlined />
                        </button>
                      )}
                      {rowActions.edit && typeof rowActions.onEdit === "function" && (
                        <button type="button" className="hub-icon-btn" onClick={() => rowActions.onEdit(row)} title="Edit">
                          <EditOutlined />
                        </button>
                      )}
                      {rowActions.delete && typeof rowActions.onDelete === "function" && (
                        <Popconfirm title="Delete this record?" onConfirm={() => rowActions.onDelete(row)}>
                          <button type="button" className="hub-icon-btn hub-icon-btn-danger" title="Delete">
                            <DeleteOutlined />
                          </button>
                        </Popconfirm>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!srvLoading && pageRows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length + 2}>
                  <div className="hub-empty">
                    {debouncedQ || drill ? "No records match your filters." : "No records for this range."}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="dash-pager">
        <span>
          {total === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} of{" "}
          {total.toLocaleString()}
          {selected.size ? ` · ${selected.size} selected` : ""}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="hub-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ maxWidth: 90 }}>
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
          <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </button>
          <span style={{ minWidth: 60, textAlign: "center" }}>
            {page} / {pages}
          </span>
          <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </div>

      <Modal
        open={!!viewRow}
        onCancel={() => setViewRow(null)}
        footer={null}
        title={null}
        width={560}
        className="dash-detail-modal"
        centered
      >
        {viewRow && (
          <div className="dash-detail">
            <div className="dash-detail-head">
              <div className="dash-detail-avatar">
                {String(viewRow[columns[0]?.key] || "?")
                  .trim()
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div className="dash-detail-headtext">
                <div className="dash-detail-title">
                  {cellText(columns[0] || {}, viewRow[columns[0]?.key]) || "Record"}
                </div>
                {columns[1] && (
                  <div className="dash-detail-sub">
                    {columns[1].label}: {cellText(columns[1], viewRow[columns[1].key])}
                  </div>
                )}
              </div>
            </div>

            <div className="dash-detail-grid">
              {columns.map((c) => (
                <div className="dash-detail-tile" key={c.key}>
                  <div className="dash-detail-label">{c.label}</div>
                  <div className="dash-detail-value">
                    {c.type === "badge" && viewRow[c.key] ? (
                      <span className={`hub-badge ${badgeClassFor(viewRow[c.key])}`}>
                        {viewRow[c.key]}
                      </span>
                    ) : (
                      cellText(c, viewRow[c.key])
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="dash-detail-actions">
              <button type="button" className="hub-btn hub-btn-primary" onClick={() => setViewRow(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
