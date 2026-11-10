import React from 'react';
import '../components/LearnerDesign.css';

// Support Manager boards (design canvas page 5, S1–S9): the teal staff page
// shell. Loader / formatting helpers are shared with the PM boards.
export { useLoad, Loading, res, fmtDay, fmtTime, fmtDayTime, errText, shortName } from '../PMBoards/shared';

export function SMPage({ title, sub, right, children }) {
  return (
    <div className="ld-page sm">
      <div className="ld-hd" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {title && <h1>{title}</h1>}
          {sub && <div className="ld-muted" style={{ fontSize: 14 }}>{sub}</div>}
        </div>
        {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

// tiny CSV helper for the "Export" buttons (client side, what's on screen)
export function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
