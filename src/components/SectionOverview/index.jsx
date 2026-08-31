import React, { useCallback, useEffect, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';

import { request } from '@/request';

/**
 * SectionOverview — a live KPI grid for a section's read-only "Overview" tab.
 * Each stat is one cheap count query against a feature entity
 * (GET /api/<entity>/list?items=1 → pagination.count), optionally narrowed by
 * a single field equality (filter + equal, supported by paginatedList).
 *
 * stats: [{ label, entity, filter?, equal?, hint? }]
 */
export default function SectionOverview({ stats = [], note }) {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(
      stats.map(async (s) => {
        const options = { items: 1, page: 1 };
        if (s.filter && s.equal !== undefined) {
          options.filter = s.filter;
          options.equal = s.equal;
        }
        const res = await request.list({ entity: s.entity, options });
        return res?.pagination?.count ?? 0;
      })
    );
    const map = {};
    stats.forEach((s, i) => {
      map[s.label] = results[i];
    });
    setCounts(map);
    setLoading(false);
  }, [stats]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Live Snapshot</h3>
          <button type="button" className="hub-btn" onClick={load}>
            <ReloadOutlined /> Refresh
          </button>
        </div>
        {note && <div className="hub-empty" style={{ textAlign: 'left', padding: '4px 2px 12px' }}>{note}</div>}
        <div className="hub-kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          {stats.map((s) => (
            <div className="hub-kpi" key={s.label}>
              <div className="hub-kpi-label">{s.label}</div>
              <div className="hub-kpi-value">{loading ? '…' : (counts[s.label] ?? 0).toLocaleString()}</div>
              {s.hint && <div className="hub-kpi-delta"><span className="hub-badge hub-badge-gray">{s.hint}</span></div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
