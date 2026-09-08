// Tiny client-side CSV export — no dependency. Used by <AdvancedTable>'s
// "Export CSV". Serialises whatever rows/columns it's handed (already
// filtered / sorted / column-trimmed by the caller).
import dayjs from "dayjs";

function cell(col, value) {
  if (value == null) return "";
  if (col.type === "date") {
    const d = dayjs(value);
    return d.isValid() ? d.format("YYYY-MM-DD") : "";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function esc(s) {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows, columns) {
  const cols = columns.filter((c) => c.key !== "__actions");
  const head = cols.map((c) => esc(c.label || c.key));
  const body = (rows || []).map((r) => cols.map((c) => esc(cell(c, r[c.key]))));
  return [head, ...body].map((r) => r.join(",")).join("\r\n");
}

export function downloadCsv(filename, text) {
  // Prepend a UTF-8 BOM so Excel opens non-ASCII correctly.
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportRowsAsCsv(module, rows, columns) {
  downloadCsv(`${module}-${dayjs().format("YYYY-MM-DD")}.csv`, rowsToCsv(rows, columns));
}
