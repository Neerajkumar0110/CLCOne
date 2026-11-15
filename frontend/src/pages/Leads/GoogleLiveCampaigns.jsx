import React, { useEffect, useState } from "react";
import { ReloadOutlined, GoogleOutlined, WarningOutlined } from "@ant-design/icons";
import { request } from "@/request";

// Marketing › Google Ads: the campaigns ALREADY running in Google Ads, with
// their numbers for a date range — read-only, nothing is sent to Google
// (backend googleController/liveCampaigns.js). Covers every connected Google
// login and every ad account each reaches (incl. client accounts under a
// manager), with an account filter.

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
const sym = (c) => (!c || c === "INR" ? "₹" : `${c} `);

export default function GoogleLiveCampaigns({ refreshKey }) {
  const [range, setRange] = useState("7d");
  const [account, setAccount] = useState("all");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [errAccounts, setErrAccounts] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async (r = range, a = account, fresh = false) => {
    setLoading(true);
    setError("");
    const res = await request.get({ entity: `google/live-campaigns?range=${r}&account=${a}${fresh ? "&fresh=1" : ""}` });
    if (res?.success) {
      setData(res.result);
      setErrAccounts([]);
    } else {
      setError(res?.message || "Could not load the campaigns from Google Ads.");
      setErrAccounts(res?.result?.accounts || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load(range, account);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, account, refreshKey]);

  const money = (v, c = data?.account?.currency) =>
    `${sym(c)}${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: v && v < 100 ? 2 : 0 })}`;
  const int = (v) => Number(v || 0).toLocaleString("en-IN");
  const pct = (v) => `${Number(v || 0).toFixed(2)}%`;
  const t = data?.totals;
  const maxClicks = Math.max(1, ...(data?.days || []).map((d) => d.clicks));
  const accounts = data?.accounts || errAccounts;
  const adAccounts = accounts.filter((a) => !a.manager);
  const problems = [
    ...(data?.loginErrors || []).map((e) => ({ key: `l-${e.login}`, title: e.login, error: e.error })),
    ...accounts.filter((a) => a.error).map((a) => ({ key: a.id, title: `${a.name} · ${a.id}`, error: a.error })),
  ];
  const multi = adAccounts.length > 1;

  return (
    <div className="hub-card">
      <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3>
          <GoogleOutlined /> Live campaigns from Google Ads
          {data?.account && (
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--hub-muted)", marginLeft: 8 }}>
              {data.account.id ? `${data.account.name} · ${data.account.id}` : `${data.account.name} · ${data.logins?.length || 1} Google login${data.logins?.length === 1 ? "" : "s"}`}
            </span>
          )}
        </h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {adAccounts.length > 0 && (
            <select className="hub-select" style={{ minWidth: 220 }} value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="all">All ad accounts ({adAccounts.length})</option>
              {adAccounts.map((a) => (
                <option key={a.id} value={a.id} disabled={!!a.error}>
                  {a.name} · {a.id}{a.managerName ? ` (via ${a.managerName})` : ""}{a.error ? " — no access" : ""}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="hub-btn" onClick={() => load(range, account, true)} disabled={loading}>
            <ReloadOutlined spin={loading} /> Refresh
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--hub-muted)", marginBottom: 12 }}>
        Read-only — every campaign in every connected Google Ads account (including accounts under a manager account), with numbers straight from Google. Nothing is created or sent from here.
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
      {problems.length > 0 && (
        <details style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(217,119,6,.08)", border: "1px solid rgba(217,119,6,.3)", fontSize: 12, marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "#b45309" }}>
            <WarningOutlined /> {problems.length} account{problems.length === 1 ? "" : "s"} could not be read — tap to see why
          </summary>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {problems.map((p) => (
              <div key={p.key}><b>{p.title}</b>: <span style={{ color: "var(--hub-muted)" }}>{p.error}</span></div>
            ))}
          </div>
        </details>
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
          {data.mixedCurrency && (
            <div style={{ fontSize: 11.5, color: "#b45309", marginTop: -6, marginBottom: 12 }}>
              These accounts use different currencies — totals add them as-is; pick one account above for exact spend.
            </div>
          )}

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
                  {multi && account === "all" && <th>Account</th>}
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
                  <tr><td colSpan={12}><div className="hub-empty">No campaigns found in the connected Google Ads account{adAccounts.length === 1 ? "" : "s"}.</div></td></tr>
                )}
                {data.campaigns.map((c) => {
                  const st = STATUS[c.status] || [pretty(c.status), "hub-badge-gray"];
                  return (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      {multi && account === "all" && (
                        <td style={{ fontSize: 12 }}>
                          {c.accountName}
                          <div style={{ color: "var(--hub-muted)", fontSize: 11 }}>{c.accountId}</div>
                        </td>
                      )}
                      <td><span className={`hub-badge ${st[1]}`}>{st[0]}</span></td>
                      <td>{TYPE[c.type] || pretty(c.type)}</td>
                      <td style={{ textAlign: "right" }}>{c.dailyBudget != null ? money(c.dailyBudget, c.currency) : "—"}</td>
                      <td>{pretty(c.biddingStrategy)}</td>
                      <td style={{ textAlign: "right" }}>{int(c.impressions)}</td>
                      <td style={{ textAlign: "right" }}>{int(c.clicks)}</td>
                      <td style={{ textAlign: "right" }}>{pct(c.ctr)}</td>
                      <td style={{ textAlign: "right" }}>{c.clicks ? money(c.avgCpc, c.currency) : "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{money(c.cost, c.currency)}</td>
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
