import React, { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Ic, chMeta, nf, pct, Skel, ErrorState, EmptyState, ChannelIcon } from './shared';

// Overview tab (design artboard "1 · Overview").

function Delta({ cur, prev, invert = false, suffix = '', vs = 'vs previous', showPrev = true, fmt = nf }) {
  const diff = Math.round((cur - prev) * 10) / 10;
  if (!diff) return <span className="flat">No change {vs}</span>;
  const up = diff > 0;
  const good = invert ? !up : up;
  return (
    <span className={good ? 'up' : 'dn'}>
      {up ? '↑' : '↓'} {fmt(Math.abs(diff))}{suffix} {vs}{showPrev ? ` (${fmt(prev)}${suffix === ' pts' ? '%' : ''})` : ''}{invert && good ? ' · better' : ''}
    </span>
  );
}

function Card({ icon, tone = '', title, sub, right, children, style }) {
  return (
    <section className="ch2-card" style={style}>
      <div className="ch2-ch">
        <div>
          <h3>{icon && <span className={`ch2-ic ${tone}`}><Ic n={icon} /></span>}{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const keyLabel = (k, bucket, long) => {
  if (bucket === 'month') return dayjs(`${k}-01`).format(long ? 'MMMM YYYY' : 'MMM YYYY');
  if (bucket === 'week') return `${long ? 'Week of ' : ''}${dayjs(k).format('D MMM')}`;
  return dayjs(k).format(long ? 'ddd D MMM' : 'D MMM');
};

function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

function Trend({ trend, bucket, onBucket }) {
  const [hover, setHover] = useState(null);
  const X0 = 44, X1 = 1188, Y0 = 212, Y1 = 12;
  const max = niceMax(Math.max(1, ...trend.map((t) => t.n)));
  const n = trend.length;
  const x = (i) => (n <= 1 ? (X0 + X1) / 2 : X0 + (i * (X1 - X0)) / (n - 1));
  const y = (v) => Y0 - (v / max) * (Y0 - Y1);
  const line = (k) => trend.map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(t[k]).toFixed(1)}`).join('');
  const peakI = trend.reduce((b, t, i) => (t.n > (trend[b]?.n ?? -1) ? i : b), 0);
  const hi = hover == null ? peakI : hover;
  const h = trend[hi];
  const ticks = Math.min(8, n);
  const tickIdx = n <= 1 ? [0] : Array.from({ length: ticks }, (_, i) => Math.round((i * (n - 1)) / (ticks - 1)));
  const unit = bucket === 'month' ? 'month' : bucket === 'week' ? 'week' : 'day';
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 1200;
    const i = n <= 1 ? 0 : Math.round(((px - X0) / (X1 - X0)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') setHover(Math.min(n - 1, hi + 1));
    else if (e.key === 'ArrowLeft') setHover(Math.max(0, hi - 1));
    else return;
    e.preventDefault();
  };
  const peak = trend[peakI];
  return (
    <Card
      icon="trend"
      title="Lead generation trend"
      sub={peak && peak.n ? `Leads that came in per ${unit} · busiest ${unit} ${keyLabel(peak.key, bucket, true)} with ${nf(peak.n)} leads · hover a ${unit} for its numbers` : `Leads that came in per ${unit}`}
      right={
        <div className="ch2-seg" role="group" aria-label="Group the trend by">
          {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([k, l]) => (
            <button key={k} type="button" className={bucket === k ? 'on' : ''} aria-pressed={bucket === k} onClick={() => onBucket(k)}>{l}</button>
          ))}
        </div>
      }
    >
      <div className="ch2-trend">
        <div className="ch2-trend-plot">
          <div className="ch2-legend">
            <span><i className="ch2-sw" style={{ background: 'var(--c-s1)' }} />Leads</span>
            <span><i className="ch2-sw" style={{ background: 'var(--c-s2)' }} />Qualified</span>
          </div>
          <svg viewBox="0 0 1200 240" role="img" tabIndex={0} aria-label={`Leads per ${unit}, ${n ? `${keyLabel(trend[0].key, bucket)} to ${keyLabel(trend[n - 1].key, bucket)}` : 'no data'}${peak ? `, peak ${nf(peak.n)} on ${keyLabel(peak.key, bucket)}` : ''}. Use the arrow keys to move between ${unit}s.`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onKeyDown={onKey}>
            <line x1={X0} x2={X1} y1={Y1} y2={Y1} stroke="var(--c-line-2)" />
            <line x1={X0} x2={X1} y1={(Y0 + Y1) / 2} y2={(Y0 + Y1) / 2} stroke="var(--c-line-2)" />
            <line x1={X0} x2={X1} y1={Y0} y2={Y0} stroke="var(--c-field)" />
            <text x="36" y="16" textAnchor="end" fontSize="11">{nf(max)}</text>
            <text x="36" y="116" textAnchor="end" fontSize="11">{nf(max / 2)}</text>
            <text x="36" y="216" textAnchor="end" fontSize="11">0</text>
            {n > 0 && (
              <>
                <path d={`${line('n')}L${x(n - 1).toFixed(1)},${Y0}L${x(0).toFixed(1)},${Y0}Z`} fill="var(--c-s1)" opacity="0.12" />
                <path d={line('n')} fill="none" stroke="var(--c-s1)" strokeWidth="2" strokeLinejoin="round" />
                <path d={line('qualified')} fill="none" stroke="var(--c-s2)" strokeWidth="2" strokeLinejoin="round" />
                {h && <line x1={x(hi)} x2={x(hi)} y1={Y1} y2={Y0} stroke="#94A3B8" strokeDasharray="3 3" />}
                {h && <circle cx={x(hi)} cy={y(h.n)} r="5" fill="var(--c-s1)" stroke="var(--c-surface)" strokeWidth="2" />}
                {tickIdx.map((i) => (
                  <text key={i} x={x(i)} y="234" textAnchor="middle" fontSize="11">{keyLabel(trend[i].key, bucket)}</text>
                ))}
              </>
            )}
          </svg>
        </div>
        {h && (
          <div className="ch2-hover" aria-live="polite">
            <span className="cap">{hover == null ? `BUSIEST ${unit.toUpperCase()}` : `HOVERED ${unit.toUpperCase()}`}</span>
            <b>{keyLabel(h.key, bucket, true)}</b>
            <span><i className="ch2-sw" style={{ background: 'var(--c-s1)' }} />Leads <b>{nf(h.n)}</b></span>
            <span><i className="ch2-sw" style={{ background: 'var(--c-s2)' }} />Qualified <b>{nf(h.qualified)}</b></span>
            <span className="mut">Rejected {nf(h.rejected)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

function Donut({ parts, total, center, centerSub, label }) {
  const C = 2 * Math.PI * 52;
  let off = 0;
  const gap = parts.filter((p) => p.n > 0).length > 1 ? 2 : 0;
  return (
    <svg width="170" height="170" viewBox="0 0 140 140" role="img" aria-label={label}>
      <circle cx="70" cy="70" r="52" fill="none" stroke="var(--c-track)" strokeWidth="16" />
      {total > 0 &&
        parts.filter((p) => p.n > 0).map((p) => {
          const len = (p.n / total) * C;
          const el = <circle key={p.label} cx="70" cy="70" r="52" fill="none" stroke={p.color} strokeWidth="16" strokeDasharray={`${Math.max(0.6, len - gap).toFixed(1)} ${C.toFixed(1)}`} strokeDashoffset={(-off).toFixed(1)} transform="rotate(-90 70 70)" />;
          off += len;
          return el;
        })}
      <text x="70" y="70" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--c-text)">{center}</text>
      <text x="70" y="88" textAnchor="middle" fontSize="11" fill="var(--c-muted)">{centerSub}</text>
    </svg>
  );
}

const Meter = ({ v, color }) => (
  <span className="ch2-meter">{v > 0 && <b style={{ width: `${Math.min(100, v)}%`, background: color }} />}</span>
);

export default function Overview({ data, loading, error, onRetry, bucket, onBucket, rangeText, prevText, onFilterUser, onGoLeads, onGoSource, onClear, filtersActive }) {
  const d = data;
  const srcParts = useMemo(() => {
    if (!d) return [];
    return d.bySource.filter((s) => s.total > 0).map((s) => ({ label: s.channel, n: s.total, color: chMeta(s.channel).chart }));
  }, [d]);

  if (error) return <ErrorState onRetry={onRetry} />;
  if (loading && !d) {
    return (
      <>
        <div className="ch2-kpis">{Array.from({ length: 6 }, (_, i) => <Skel key={i} h={128} />)}</div>
        <Skel h={330} />
        <div className="ch2-grid2"><Skel h={240} /><Skel h={240} /></div>
      </>
    );
  }
  if (!d) return null;
  const t = d.totals;
  const p = d.prev;
  if (!t.total && filtersActive) return <EmptyState onClear={onClear} />;
  const working = Math.max(0, t.total - t.qualified - t.rejected);
  const qualifiedOnly = Math.max(0, t.qualified - t.converted);
  const zeroAlways = d.bySource.filter((s) => s.total === 0 && ['Capture Form', 'LinkedIn', 'YouTube'].includes(s.channel));
  const funnel = d.funnel;
  let worst = null;
  for (let i = 1; i < funnel.length; i++) {
    const lost = funnel[i - 1].n - funnel[i].n;
    if (lost > 0 && (!worst || lost > worst.lost)) worst = { i, lost, of: funnel[i - 1].n };
  }
  const reasonsTotal = d.reasons.reduce((s, r) => s + r.n, 0);
  const reasonMax = Math.max(1, ...d.reasons.map((r) => r.n));
  const unclear = d.reasons.filter((r) => /not clear|no reason/i.test(r.reason)).reduce((s, r) => s + r.n, 0);
  const unclearPct = pct(unclear, reasonsTotal);
  const today = d.today, yest = d.yesterday;
  const spot = ['Capture Form', 'LinkedIn', 'YouTube'].map((c) => d.bySource.find((s) => s.channel === c) || { channel: c, total: 0 });
  const spotText = {
    'Capture Form': (n) => `${nf(n)} leads · form and landing page are live`,
    LinkedIn: (n) => `${nf(n)} leads · ${n ? 'from LinkedIn ads and links' : 'connect LinkedIn Ads or share the LinkedIn link'}`,
    YouTube: (n) => `${nf(n)} leads · ${n ? 'from YouTube videos and ads' : 'put the YouTube link in videos and ads'}`,
  };

  return (
    <>
      <div className="ch2-kpis">
        <div className="ch2-kpi"><span className="ch2-ic"><Ic n="user" /></span><span className="ch2-kl">Total leads</span><span className="kv">{nf(t.total)}</span><Delta cur={t.total} prev={p.total} vs="vs previous period" showPrev={false} /></div>
        <div className="ch2-kpi"><span className="ch2-ic"><Ic n="bolt" /></span><span className="ch2-kl">Today</span><span className="kv">{nf(today)}</span><Delta cur={today} prev={yest} vs="vs yesterday" /></div>
        <div className="ch2-kpi"><span className="ch2-ic g"><Ic n="check" /></span><span className="ch2-kl">Qualified</span><span className="kv">{nf(t.qualified)}</span><Delta cur={t.qualified} prev={p.qualified} /></div>
        <div className="ch2-kpi"><span className="ch2-ic g2"><Ic n="trophy" /></span><span className="ch2-kl">Converted</span><span className="kv">{nf(t.converted)}</span><Delta cur={t.converted} prev={p.converted} /></div>
        <div className="ch2-kpi"><span className="ch2-ic r"><Ic n="xcircle" /></span><span className="ch2-kl">Rejected</span><span className="kv">{nf(t.rejected)}</span><Delta cur={t.rejected} prev={p.rejected} invert showPrev={false} /></div>
        <div className="ch2-kpi"><span className="ch2-ic v"><Ic n="bars" /></span><span className="ch2-kl">Lead quality</span><span className="kv">{t.qualityPct}%</span><Delta cur={t.qualityPct} prev={p.qualityPct} suffix=" pts" fmt={(v) => String(Math.round(v * 10) / 10)} /></div>
      </div>

      <Trend trend={d.trend} bucket={bucket} onBucket={onBucket} />

      <div className="ch2-grid2">
        <Card icon="bolt" title="Daily lead performance" sub="Today against yesterday">
          <div className="ch2-box2">
            <div className="ch2-box"><div className="ch2-kl">Today</div><div className="kv">{nf(today)}</div></div>
            <div className="ch2-box"><div className="ch2-kl">Yesterday</div><div className="kv">{nf(yest)}</div></div>
            <div className="ch2-box"><div className="ch2-kl">Difference</div><div className="kv" style={{ color: today === yest ? undefined : today > yest ? 'var(--c-good)' : 'var(--c-bad)' }}>{today === yest ? '0' : `${today > yest ? '↑' : '↓'} ${nf(Math.abs(today - yest))}`}</div></div>
            <div className="ch2-box"><div className="ch2-kl">Change</div><div className="kv" style={{ color: !yest || today === yest ? undefined : today > yest ? 'var(--c-good)' : 'var(--c-bad)' }}>{yest ? `${today >= yest ? '+' : '−'}${Math.abs(pct(today - yest, yest))}%` : '—'}</div></div>
          </div>
        </Card>
        <Card icon="swap" title="What changed vs the previous period" sub={`${rangeText} vs ${prevText}`}>
          <div className="ch2-tw">
            <table>
              <thead><tr><th scope="col">Measure</th><th scope="col" className="n">Now</th><th scope="col" className="n">Before</th><th scope="col">Change</th></tr></thead>
              <tbody>
                {[
                  ['Leads', t.total, p.total],
                  ['Qualified', t.qualified, p.qualified],
                  ['Converted', t.converted, p.converted],
                  ['Rejected', t.rejected, p.rejected, true],
                ].map(([l, a, b, inv]) => {
                  const diff = a - b;
                  const good = inv ? diff < 0 : diff > 0;
                  return (
                    <tr key={l}>
                      <th scope="row">{l}</th><td className="n">{nf(a)}</td><td className="n">{nf(b)}</td>
                      <td className={diff ? (good ? 'up' : 'dn') : 'flat'}>{diff ? `${diff > 0 ? '↑' : '↓'} ${nf(Math.abs(diff))}${b && !inv ? ` (${diff > 0 ? '+' : '−'}${Math.abs(pct(diff, b))}%)` : ''}${inv && good ? ' · better' : ''}` : 'No change'}</td>
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row">Lead quality</th><td className="n">{t.qualityPct}%</td><td className="n">{p.qualityPct}%</td>
                  {(() => {
                    const dq = Math.round((t.qualityPct - p.qualityPct) * 10) / 10;
                    return <td className={dq ? (dq > 0 ? 'up' : 'dn') : 'flat'}>{dq ? `${dq > 0 ? '↑' : '↓'} ${Math.abs(dq)} pts` : 'No change'}</td>;
                  })()}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="ch2-grid2">
        <Card icon="layers" title="Lead sources" sub={`Where the ${nf(t.total)} leads came from`} right={<button type="button" className="ch2-linkbtn" onClick={() => onGoSource(null)}>Manage sources →</button>}>
          <div className="ch2-donut-row">
            <Donut parts={srcParts} total={t.total} center={nf(t.total)} centerSub="leads" label={srcParts.map((s) => `${s.label} ${s.n}`).join(', ') || 'No leads'} />
            <div className="ch2-lgs">
              {srcParts.map((s) => (
                <div className="ch2-lg" key={s.label}><i className="ch2-sw" style={{ background: s.color }} /><span>{s.label}</span><b>{nf(s.n)}</b><span className="mut n">{pct(s.n, t.total)}%</span></div>
              ))}
              {zeroAlways.length > 0 && (
                <div className="ch2-lg dim"><i className="ch2-sw" style={{ background: 'var(--c-track)' }} /><span>{zeroAlways.map((s) => s.channel).join(' · ')}</span><b>0</b><span className="n">0%</span></div>
              )}
            </div>
          </div>
        </Card>
        <Card icon="check" tone="g" title="Lead quality overview" sub="What became of the leads in this range">
          <div className="ch2-donut-row">
            <Donut
              parts={[
                { label: 'Converted', n: t.converted, color: 'var(--c-s6)' },
                { label: 'Qualified', n: qualifiedOnly, color: 'var(--c-s1)' },
                { label: 'Rejected', n: t.rejected, color: 'var(--c-s5)' },
                { label: 'Working', n: working, color: 'var(--c-s4)' },
              ]}
              total={t.total}
              center={`${t.qualityPct}%`}
              centerSub="quality"
              label={`Converted ${t.converted}, qualified ${qualifiedOnly}, rejected ${t.rejected}, still being worked ${working}`}
            />
            <div className="ch2-lgs">
              <div className="ch2-lg"><i className="ch2-sw" style={{ background: 'var(--c-s6)' }} /><span>Converted (Enrolled)</span><b>{nf(t.converted)}</b><span className="mut n">{pct(t.converted, t.total)}%</span></div>
              <div className="ch2-lg"><i className="ch2-sw" style={{ background: 'var(--c-s1)' }} /><span>Qualified, not yet enrolled</span><b>{nf(qualifiedOnly)}</b><span className="mut n">{pct(qualifiedOnly, t.total)}%</span></div>
              <div className="ch2-lg"><i className="ch2-sw" style={{ background: 'var(--c-s5)' }} /><span>Rejected</span><b>{nf(t.rejected)}</b><span className="mut n">{pct(t.rejected, t.total)}%</span></div>
              <div className="ch2-lg"><i className="ch2-sw" style={{ background: 'var(--c-s4)' }} /><span>Still being worked</span><b>{nf(working)}</b><span className="mut n">{pct(working, t.total)}%</span></div>
            </div>
          </div>
        </Card>
      </div>

      <div className="ch2-grid3">
        {spot.map((s) => (
          <div className="ch2-spot" key={s.channel}>
            <ChannelIcon name={s.channel} icon={20} />
            <div><b>{chMeta(s.channel).short}</b><div className="mut" style={{ fontSize: 12.5 }}>{spotText[s.channel](s.total)}</div></div>
            <button type="button" className="ch2-btn" style={{ minHeight: 38 }} onClick={() => onGoSource(s.channel)}>{s.total ? 'Open' : 'Set up'}</button>
          </div>
        ))}
      </div>

      <Card icon="bars" title="Which source gives better leads?" sub="Leads, quality, conversion and rejection per source · sorted by leads">
        <div className="ch2-tw">
          <table>
            <thead><tr><th scope="col">Source</th><th scope="col" className="n">Leads</th><th scope="col" className="n">Qualified</th><th scope="col">Qualified %</th><th scope="col" className="n">Converted</th><th scope="col">Conversion %</th><th scope="col">Rejection %</th></tr></thead>
            <tbody>
              {d.bySource.map((s) => (
                <tr key={s.channel} className={s.total ? 'ch2-click' : 'dim'} onClick={s.total ? () => onGoLeads({ channel: s.channel }) : undefined}>
                  <th scope="row">{s.total ? <button type="button" className="ch2-namebtn" onClick={(e) => { e.stopPropagation(); onGoLeads({ channel: s.channel }); }}>{s.channel}</button> : s.channel}</th>
                  <td className="n">{nf(s.total)}</td>
                  <td className="n">{nf(s.qualified)}</td>
                  <td>{s.total ? <><Meter v={s.qualityPct} color="var(--c-s2)" />{s.qualityPct}%</> : '—'}</td>
                  <td className="n">{nf(s.converted)}</td>
                  <td>{s.total ? <><Meter v={s.conversionPct} color="var(--c-s6)" />{s.conversionPct}%</> : '—'}</td>
                  <td>{s.total ? <><Meter v={s.rejectionPct} color="var(--c-s5)" />{s.rejectionPct}%</> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="ch2-grid2">
        <Card icon="filter" title="Lead conversion funnel" sub={`How far the ${nf(t.total)} leads have got`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {funnel.map((f, i) => (
              <React.Fragment key={f.label}>
                <div className="ch2-fn">
                  <span>{f.label}</span>
                  <div className="ch2-bar" style={{ height: 24 }}>{f.n > 0 && <b style={{ width: `${Math.max(1.5, pct(f.n, funnel[0].n || 1))}%`, background: 'var(--c-s1)' }} />}</div>
                  <span><b>{nf(f.n)}</b> <span className="mut">{pct(f.n, funnel[0].n)}%</span></span>
                </div>
                {worst && worst.i === i && <div className="ch2-drop">−{nf(worst.lost)} dropped here ({pct(worst.lost, worst.of)}%)</div>}
              </React.Fragment>
            ))}
          </div>
        </Card>
        <Card icon="xcircle" tone="r" title="Why leads were not good" sub={`Reasons saved on the ${nf(t.rejected)} rejected leads`}>
          {d.reasons.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {d.reasons.slice(0, 8).map((r) => (
                <div className="ch2-rs" key={`${r.stage}-${r.reason}`}>
                  <span>{r.reason}<span className="sub">{r.stage === 'Invalid Leads' ? 'Invalid' : 'Not interested'}</span></span>
                  <div className="ch2-bar"><b style={{ width: `${pct(r.n, reasonMax)}%`, background: 'var(--c-s5)' }} /></div>
                  <span className="n"><b>{nf(r.n)}</b> <span className="mut">{pct(r.n, reasonsTotal)}%</span></span>
                </div>
              ))}
              {unclearPct >= 40 && (
                <div className="ch2-tip">{unclearPct}% of rejections have no clear reason. Asking sales users to pick a specific reason makes this chart useful for deciding where to spend.</div>
              )}
            </div>
          ) : (
            <p className="mut" style={{ margin: 0 }}>No rejected leads in this range.</p>
          )}
        </Card>
      </div>

      <Card icon="user" title="Sales users handling these leads" sub="Lead owner now · click a name to filter every number to that person" right={<button type="button" className="ch2-linkbtn" onClick={() => onGoLeads({})}>See their leads →</button>}>
        <div className="ch2-tw">
          <table>
            <thead><tr><th scope="col">Sales user</th><th scope="col" className="n">Leads</th><th scope="col" className="n">Qualified</th><th scope="col" className="n">Converted</th><th scope="col" className="n">Rejected</th><th scope="col">Quality</th></tr></thead>
            <tbody>
              {d.byUser.map((u) => (
                <tr key={u.adminId || 'none'}>
                  <th scope="row"><button type="button" className="ch2-namebtn" onClick={() => onFilterUser(u.adminId || 'none')}>{u.name}</button></th>
                  <td className="n">{nf(u.total)}</td><td className="n">{nf(u.qualified)}</td><td className="n">{nf(u.converted)}</td><td className="n">{nf(u.rejected)}</td>
                  <td><Meter v={u.qualityPct} color="var(--c-s2)" />{u.qualityPct}%</td>
                </tr>
              ))}
              {!d.byUser.length && <tr><td colSpan={6} className="mut">No leads in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
