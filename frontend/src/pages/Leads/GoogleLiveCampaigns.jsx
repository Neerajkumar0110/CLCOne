import React, { useEffect, useState } from "react";
import { ReloadOutlined, GoogleOutlined } from "@ant-design/icons";
import { request } from "@/request";

// Marketing › Google Ads: the campaigns ALREADY running in the connected Google
// Ads account, with their numbers for a date range — read-only, nothing is sent
// to Google (backend googleController/liveCampaigns.js).

const RANGES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["this_month", "This month"],
  ["last_month", "Last month"],
];
const STATUS = { ENABLED: ["Active", "hub-badge-green"], PAUSED: ["Paused", "hub-badge-gray"] };
const TYPE = { SEARCH: "Search", DISPLAY: "Display", PERFORMANCE_MAX: "Performance Max", VIDEO: "Video", SHOPPING: "Shopping", DEMAND_GEN: "Demand Gen", SMART: "Smart" };
const pretty = (s) => String(s || "—").toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function GoogleLiveCampaigns({ customerId }) {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (r = range) => {
    setLoading(true);
    setError("");
    const res = await request.get({ entity: `google/live-campaigns?range=${r}` });
    if (res?.success) setData(res.result);
    else setError(res?.message || "Could not load the campaigns from Google Ads.");
    setLoading(false);
  };

  useEffect(() => {
    if (customerId) load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, range]);

  const cur = data?.account?.currency === "INR" || !data?.account?.currency ? "₹" : `${data.account.currency} `;
  const money = (v) => `${cur}${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: v && v < 100 ? 2 : 0 })}`;
  const int = (v) => Number(v || 0).toLocaleString("en-IN");
  const pct = (v) => `${Number(v || 0).toFixed(2)}%`;
  const t = data?.totals;
  const maxClicks = Math.max(1, ...(data?.days || []).map((d) => d.clicks));

  return (
    <div className="hub-card">
      <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3>
          <GoogleOutlined /> Live campaigns from Google Ads
          {data?.account && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--hub-muted)", marginLeft: 8 }}>{data.account.name} · {data.account.id}</span>}
        </h3>
        <button type="button" className="hub-btn" onClick={() => load()} disabled={loading}>
          <ReloadOutlined spin={loading} /> Refresh
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--hub-muted)", marginBottom: 12 }}>
        Read-only — the campaigns already running in your Google Ads account, with their numbers straight from Google. Nothing is created or sent from here.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {RANGES.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setRange(k)}
            className="hub-btn"
            style={range === k ? { background: "var(--hub-blue)", color: "#fff", borderColor: "var(--hub-blue)" } : undefined}
          >
            {label}
          </button>
        ))}
        {data && <span style={{ alignSelf: "center", fontSize: 11.5, color: "var(--hub-muted)", marginLeft: 6 }}>{data.from} → {data.to}</span>}
      </div>

      {error && (
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(220,38,38,.07)", border: "1px solid rgba(220,38,38,.3)", color: "#b91c1c", fontSize: 12.5, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {loading && !data && <div className="hub-empty">Loading campaigns from Google Ads…</div>}

      {t && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
            {[
              ["Spend", money(t.cost), "#dc2626"],
              ["Clicks", int(t.clicks), "#2563eb"],
              ["Impressions", int(t.impressions), "#7c3aed"],
              ["CTR", pct(t.ctr), "#0891b2"],
              ["Avg. CPC", money(t.avgCpc), "#d97706"],
              ["Conversions", int(Math.round(t.conversions * 100) / 100), "#16a34a"],
              ["Cost / conv.", t.conversions ? money(t.costPerConversion) : "—", "#475569"],
              ["Campaigns", `${t.enabled} active / ${t.campaigns}`, "#64748b"],
            ].map(([label, value, color]) => (
              <div key={label} style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid var(--hub-border)", background: "var(--hub-bg-soft)", borderLeft: `3px solid ${color}` }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "var(--hub-text)" }}>{value}</div>
                <div style={{ fontSize: 11, color: "var(--hub-muted)", fontWeight: 600 }}>{label}</div>
              </div>
            ))}
          </div>

          {data.days.length > 1 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, color: "var(--hub-muted)", fontWeight: 600, marginBottom: 6 }}>Clicks per day</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 70, padding: "0 2px", borderBottom: "1px solid var(--hub-border)" }}>
                {data.days.map((d) => (
                  <div key={d.date} title={`${d.date}: ${d.clicks} clicks · ${int(d.impressions)} impressions · ${money(d.cost)}`} style={{ flex: 1, minWidth: 3, height: `${Math.max(2, (d.clicks / maxClicks) * 100)}%`, background: "var(--hub-blue)", borderRadius: "3px 3px 0 0", opacity: d.clicks ? 0.85 : 0.25 }} />
                ))}
              </div>
            </div>
          )}

          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th style={{ textAlign: "right" }}>Budget / day</th>
                  <th>Bid strategy</th>
                  <th style={{ textAlign: "right" }}>Impr.</th>
                  <th style={{ textAlign: "right" }}>Clicks</th>
                  <th style={{ textAlign: "right" }}>CTR</th>
                  <th style={{ textAlign: "right" }}>Avg. CPC</th>
                  <th style={{ textAlign: "right" }}>Cost</th>
                  <th style={{ textAlign: "right" }}>Conv.</th>
                </tr>
              </thead>
              <tbody>
                {!data.campaigns.length && (
                  <tr><td colSpan={11}><div className="hub-empty">No campaigns in this Google Ads account.</div></td></tr>
                )}
                {data.campaigns.map((c) => {
                  const st = STATUS[c.status] || [pretty(c.status), "hub-badge-gray"];
                  return (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td><span className={`hub-badge ${st[1]}`}>{st[0]}</span></td>
                      <td>{TYPE[c.type] || pretty(c.type)}</td>
                      <td style={{ textAlign: "right" }}>{c.dailyBudget != null ? money(c.dailyBudget) : "—"}</td>
                      <td>{pretty(c.biddingStrategy)}</td>
                      <td style={{ textAlign: "right" }}>{int(c.impressions)}</td>
                      <td style={{ textAlign: "right" }}>{int(c.clicks)}</td>
                      <td style={{ textAlign: "right" }}>{pct(c.ctr)}</td>
                      <td style={{ textAlign: "right" }}>{c.clicks ? money(c.avgCpc) : "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{money(c.cost)}</td>
                      <td style={{ textAlign: "right" }}>{int(Math.round(c.conversions * 100) / 100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "var(--hub-muted)", marginTop: 8 }}>
            Updated {new Date(data.fetchedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · Google can take a few hours to finalise today&rsquo;s numbers.
          </div>
        </>
      )}
    </div>
  );
}
