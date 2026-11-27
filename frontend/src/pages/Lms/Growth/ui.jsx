import React from 'react';
import { IC } from './icons';
import './growth.css';

// React port of the Figma helper library that drew the LMS Additional
// Requirements design (yKjb2ncoVnPG9Eqql6zwhI). Same names, same sizes, same
// colours — a board here is built exactly the way it was drawn there.

export const C = {
  pri: '#0e7490', priL: '#ecfeff', priM: '#a5f3fc', ind: '#4f46e5', indL: '#eef2ff', ink: '#0f172a', ink2: '#1e293b',
  sub: '#475569', mut: '#64748b', fa: '#94a3b8', ln: '#e2e8f0', bg: '#f8fafc', bg2: '#f1f5f9', w: '#ffffff',
  ok: '#16a34a', okL: '#dcfce7', okD: '#166534', wa: '#d97706', waL: '#fef3c7', waD: '#92400e', er: '#dc2626', erL: '#fee2e2',
  erD: '#991b1b', pu: '#7c3aed', puL: '#ede9fe', sky: '#0284c7', skyL: '#e0f2fe', pk: '#db2777', pkL: '#fce7f3', or: '#c2410c', orL: '#ffedd5',
};
export const TONE = {
  ok: [C.okL, C.okD], wa: [C.waL, C.waD], er: [C.erL, C.erD], pri: [C.priL, C.pri], ind: [C.indL, C.ind], pu: [C.puL, C.pu],
  sky: [C.skyL, C.sky], mut: [C.bg2, C.sub], pk: [C.pkL, C.pk], or: [C.orL, C.or],
};
const cx = (...a) => a.filter(Boolean).join(' ');

export function I({ n, c, s = 18, sw = 2, style, title }) {
  const parts = String(IC[n] || IC.dot).split('|');
  return (
    <svg className="g-ic" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c || 'currentColor'} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {parts.map((p, i) => {
        if (p.startsWith('c:')) {
          const q = p.slice(2).split(',');
          return <circle key={i} cx={q[0]} cy={q[1]} r={q[2]} />;
        }
        if (p.startsWith('r:')) {
          const q = p.slice(2).split(',');
          return <rect key={i} x={q[0]} y={q[1]} width={q[2]} height={q[3]} rx={q[4] || 0} />;
        }
        return <path key={i} d={p} />;
      })}
    </svg>
  );
}

export function IB({ n, tone = 'pri', box = 36, s = 18, bg, c, r = 10 }) {
  return (
    <span className={cx('g-ib', `t-${tone}`)} style={{ width: box, height: box, borderRadius: r, ...(bg ? { background: bg } : {}), ...(c ? { color: c } : {}) }}>
      <I n={n} s={s} />
    </span>
  );
}

export function Chip({ children, tone = 'mut', dot, i, s, style, title }) {
  return (
    <span className={cx('g-chip', `t-${tone}`)} style={{ ...(s ? { fontSize: s } : {}), ...style }} title={title}>
      {dot && <span className="g-chip-dot" />}
      {i && <I n={i} s={12} />}
      {children}
    </span>
  );
}

export function Btn({ children, k = 'p', i, sm, onClick, disabled, type = 'button', style, title, href, target, ariaLabel, className }) {
  const cls = cx('g-btn', `k-${k}`, sm && 'sm', className);
  const inner = (
    <>
      {i && <I n={i} s={sm ? 13 : 15} />}
      {children}
    </>
  );
  if (href)
    return (
      <a className={cls} href={href} target={target} rel={target ? 'noopener noreferrer' : undefined} style={style} title={title} aria-label={ariaLabel}>
        {inner}
      </a>
    );
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} style={style} title={title} aria-label={ariaLabel}>
      {inner}
    </button>
  );
}

export const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

export function Av({ name, ini, col = C.pri, s = 32, src }) {
  return (
    <span className="g-av" style={{ width: s, height: s, background: col, fontSize: Math.round(s * 0.36) }} title={name}>
      {src ? <img src={src} alt="" /> : ini || initials(name)}
    </span>
  );
}

export function Bar({ pct = 0, tone = 'pri', col, h = 6, bg, w, style }) {
  return (
    <div className={cx('g-bar', `t-${tone}`)} style={{ height: h, ...(bg ? { background: bg } : {}), ...(w ? { width: w } : {}), ...style }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, ...(col ? { background: col } : {}) }} />
    </div>
  );
}

export function Card({ title, sub, i, tone = 'pri', right, children, style, className, p, g, as: As = 'section' }) {
  return (
    <As className={cx('g-card', className)} style={{ ...(p != null ? { padding: p } : {}), ...(g != null ? { gap: g } : {}), ...style }} aria-label={typeof title === 'string' ? title : undefined}>
      {title && (
        <div className="g-card-h">
          {i && <IB n={i} tone={tone} box={30} s={16} />}
          <div className="g-card-ht">
            <h3 className="g-card-title">{title}</h3>
            {sub && <span className="g-card-sub">{sub}</span>}
          </div>
          {right}
        </div>
      )}
      {children}
    </As>
  );
}

export const Row = ({ children, g = 16, style, className, ...rest }) => (
  <div className={cx('g-row', className)} style={{ gap: g, ...style }} {...rest}>
    {children}
  </div>
);
export const Col = ({ children, g = 16, style, className, ...rest }) => (
  <div className={cx('g-col', className)} style={{ gap: g, ...style }} {...rest}>
    {children}
  </div>
);

export function KPI({ i, label, val, sub, tone = 'pri', bar, subColor, style }) {
  return (
    <div className="g-card g-kpi" style={style}>
      <div className="g-kpi-h">
        <IB n={i} tone={tone} box={32} s={16} />
        <span className="g-kpi-l">{label}</span>
      </div>
      <div className="g-kpi-v">{val}</div>
      {sub && (
        <div className="g-kpi-s" style={subColor ? { color: subColor } : undefined}>
          {sub}
        </div>
      )}
      {bar != null && <Bar pct={bar} tone={tone} />}
    </div>
  );
}

export function Field({ label, help, err, children, style, htmlFor }) {
  return (
    <div className="g-field" style={style}>
      {label && (
        <label className="g-field-l" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {(help || err) && <span className={cx('g-help', err && 'err')}>{err || help}</span>}
    </div>
  );
}

// cols: [[label, width|'f'], …]; rows: arrays of cells (node or string)
export function Table({ cols, rows, hl = [], onRow, empty = 'Nothing here yet.', style }) {
  return (
    <div className="g-table-w" style={style}>
      <table className="g-table">
        <thead>
          <tr>
            {cols.map(([l, w], i) => (
              <th key={i} style={w && w !== 'f' ? { width: w } : undefined}>
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="g-empty">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, ri) => (
            <tr key={ri} className={cx(hl.includes(ri) && 'hl', onRow && 'click')} onClick={onRow ? () => onRow(ri) : undefined}>
              {r.map((v, ci) => (
                <td key={ci}>{typeof v === 'string' || typeof v === 'number' ? v : <div className="g-cell">{v}</div>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── charts (same geometry as the Figma helpers) ──
const arcPath = (cxp, cyp, r, a0, a1) => {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p0 = [cxp + r * Math.cos(a0), cyp + r * Math.sin(a0)];
  const p1 = [cxp + r * Math.cos(a1), cyp + r * Math.sin(a1)];
  return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${r} ${r} 0 ${large} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
};

export function Gauge({ v = 0, s = 180, c = C.ok, txt, l = 'out of 100', ir = 0.84 }) {
  const r = s / 2;
  const th = r * (1 - ir);
  const rm = r - th / 2;
  const a0 = 0.75 * Math.PI;
  const sp = 1.5 * Math.PI;
  const val = Math.max(0, Math.min(100, Number(v) || 0));
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img" aria-label={`${txt || val} ${l}`}>
      <path d={arcPath(r, r, rm, a0, a0 + sp)} stroke={C.bg2} strokeWidth={th} fill="none" />
      {val > 0 && <path d={arcPath(r, r, rm, a0, a0 + (sp * val) / 100)} stroke={c} strokeWidth={th} fill="none" />}
      <text x={r} y={r + s * 0.06} textAnchor="middle" fontSize={Math.round(s * 0.24)} fontWeight="700" fill={C.ink}>
        {txt != null ? txt : Math.round(val)}
      </text>
      <text x={r} y={r + s * 0.06 + Math.max(10, s * 0.065) + 6} textAnchor="middle" fontSize={Math.max(10, Math.round(s * 0.065))} fill={C.mut}>
        {l}
      </text>
    </svg>
  );
}

export function Donut({ segs, s = 160, center, cl, ir = 0.62 }) {
  const r = s / 2;
  const th = r * (1 - ir);
  const rm = r - th / 2;
  const tot = segs.reduce((a, b) => a + (b.v || 0), 0) || 1;
  let a = -Math.PI / 2;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img" aria-label={center ? `${center} ${cl || ''}` : 'donut chart'}>
      {segs.map((sg, i) => {
        const b = a + (2 * Math.PI * (sg.v || 0)) / tot;
        const d = sg.v > 0 ? arcPath(r, r, rm, a, Math.max(a + 0.001, b - 0.035)) : null;
        a = b;
        return d ? <path key={i} d={d} stroke={sg.c} strokeWidth={th} fill="none" /> : null;
      })}
      {center != null && (
        <text x={r} y={r + s * 0.06 - (cl ? 7 : 0)} textAnchor="middle" fontSize={Math.round(s * 0.17)} fontWeight="700" fill={C.ink}>
          {center}
        </text>
      )}
      {cl && (
        <text x={r} y={r + s * 0.06 + 10} textAnchor="middle" fontSize="10.5" fill={C.mut}>
          {cl}
        </text>
      )}
    </svg>
  );
}

// series: [{ d:[…], c:'#hex', l:'label', area, dash, dots, sw }]
export function Line({ series, w = 520, h = 180, max = 100, min = 0, xl, legend }) {
  const pd = 8;
  const n = Math.max(2, (series[0] && series[0].d.length) || 2);
  const X = (i) => pd + ((w - 2 * pd) * i) / (n - 1);
  const Y = (v) => h - pd - ((h - 2 * pd) * ((v == null ? min : v) - min)) / (max - min || 1);
  return (
    <div className="g-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ aspectRatio: `${w} / ${h}` }} role="img" aria-label={legend ? series.map((z) => z.l).join(' vs ') : 'line chart'}>
        {[0, 1, 2, 3, 4].map((k) => {
          const y = pd + ((h - 2 * pd) * k) / 4;
          return <line key={k} x1="0" y1={y} x2={w} y2={y} stroke={C.ln} strokeWidth="1" />;
        })}
        {series.map((z, si) => {
          const pts = z.d.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
          return (
            <g key={si}>
              {z.area && <path d={`M${X(0)},${h - pd} L${pts.join(' L')} L${X(z.d.length - 1)},${h - pd} Z`} fill={z.c} fillOpacity="0.12" />}
              <polyline points={pts.join(' ')} fill="none" stroke={z.c} strokeWidth={z.sw || 2.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={z.dash ? '6 5' : undefined} vectorEffect="non-scaling-stroke" />
              {z.dots && z.d.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r="3.5" fill="#fff" stroke={z.c} strokeWidth="2" />)}
            </g>
          );
        })}
      </svg>
      {xl && (
        <div className="g-xl">
          {xl.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      )}
      {legend && (
        <div className="g-leg">
          {series.map((z, i) => (
            <span key={i} className="g-leg-i">
              <span className="g-leg-line" style={{ background: z.c }} />
              {z.l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Bars({ d, w = 520, h = 160, max, c = C.pri, cf, goal, xl, bwr = 0.56, title }) {
  const n = Math.max(1, d.length);
  const mx = max || Math.max(1, ...d, goal || 0);
  const bw = (w / n) * bwr;
  return (
    <div className="g-chart">
      <svg viewBox={`0 0 ${w} ${h}`} style={{ aspectRatio: `${w} / ${h}` }} role="img" aria-label={title || 'bar chart'}>
        {[0, 1, 2, 3].map((k) => {
          const y = Math.min((h * k) / 3, h - 0.5);
          return <line key={k} x1="0" y1={y} x2={w} y2={y} stroke={C.ln} />;
        })}
        {d.map((v, i) => {
          const bh = Math.max(2, ((h - 4) * (v || 0)) / mx);
          const x = (w / n) * i + (w / n - bw) / 2;
          return (
            <rect key={i} x={x} y={h - bh} width={bw} height={bh} rx="4" fill={cf ? cf(v, i) : c}>
              <title>{`${xl ? xl[i] : i + 1}: ${v}`}</title>
            </rect>
          );
        })}
        {goal != null && <line x1="0" y1={h - ((h - 4) * goal) / mx} x2={w} y2={h - ((h - 4) * goal) / mx} stroke={C.wa} strokeWidth="1.5" strokeDasharray="5 4" />}
      </svg>
      {xl && (
        <div className="g-xl eq">
          {xl.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// axes: ['Python', …]; sets: [{ d:[0-100…], c, fo, dash }]
export function Radar({ axes, sets, s = 300 }) {
  const cxp = s / 2;
  const R = s / 2 - 50;
  const n = axes.length || 1;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cxp + ((R * v) / 100) * Math.cos(a), cxp + ((R * v) / 100) * Math.sin(a)];
  };
  return (
    <svg width="100%" viewBox={`0 0 ${s} ${s}`} style={{ maxWidth: s }} role="img" aria-label={`Skill radar: ${axes.join(', ')}`}>
      {[25, 50, 75, 100].map((l) => (
        <polygon key={l} points={axes.map((_, i) => pt(i, l).join(',')).join(' ')} fill="none" stroke={C.ln} />
      ))}
      {axes.map((_, i) => {
        const p = pt(i, 100);
        return <line key={i} x1={cxp} y1={cxp} x2={p[0]} y2={p[1]} stroke={C.ln} />;
      })}
      {sets.map((z, si) => (
        <polygon key={si} points={z.d.map((v, i) => pt(i, Math.max(0, Math.min(100, v || 0))).join(',')).join(' ')} fill={z.c} fillOpacity={z.fo == null ? 0.18 : z.fo} stroke={z.c} strokeWidth="2" strokeDasharray={z.dash ? '5 4' : undefined} />
      ))}
      {axes.map((a, i) => {
        const p = pt(i, 124);
        return (
          <text key={a} x={p[0]} y={p[1] + 4} textAnchor="middle" fontSize="11" fontWeight="500" fill={C.sub}>
            {a}
          </text>
        );
      })}
    </svg>
  );
}

// GitHub-style heatmap. days: [{ date:'YYYY-MM-DD', v:minutes }] — oldest first.
export const HEAT = [C.bg2, '#cffafe', '#67e8f9', '#06b6d4', '#0e7490'];
// same buckets as the 3A legend: 0 · <30m · 30–60m · 1–2h · 2h+
export const heatLevel = (min) => (!min ? 0 : min < 30 ? 1 : min < 60 ? 2 : min < 120 ? 3 : 4);
export function Heat({ days, cell = 12, unit = 'min' }) {
  const gp = 3;
  // align to weeks starting Monday
  const first = days.length ? new Date(`${days[0].date}T00:00:00`) : new Date();
  const lead = (first.getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...days];
  const weeks = Math.ceil(cells.length / 7) || 1;
  const W = weeks * (cell + gp) + 30;
  const H = 7 * (cell + gp) + 18;
  const months = [];
  for (let wk = 0; wk < weeks; wk++) {
    const d = cells[wk * 7] || cells[wk * 7 + 6];
    if (!d) continue;
    const m = new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
    if (!months.length || months[months.length - 1].m !== m) months.push({ m, wk });
  }
  return (
    <div className="g-heat">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Activity heatmap">
        {['Mon', 'Wed', 'Fri'].map((d, i) => (
          <text key={d} x="0" y={18 + (i * 2 + 1) * (cell + gp) + 9} fontSize="9" fill={C.fa}>
            {d}
          </text>
        ))}
        {months.map(({ m, wk }) => (
          <text key={`${m}${wk}`} x={30 + wk * (cell + gp)} y="9" fontSize="9" fill={C.fa}>
            {m}
          </text>
        ))}
        {cells.map((d, idx) => {
          if (!d) return null;
          const wk = Math.floor(idx / 7);
          const dy = idx % 7;
          return (
            <rect key={d.date} x={30 + wk * (cell + gp)} y={18 + dy * (cell + gp)} width={cell} height={cell} rx="3" fill={HEAT[heatLevel(d.v)]}>
              <title>{`${d.date}: ${d.v || 0} ${unit}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

// items: [[label, colour, value?], …]
export function Leg({ items, g = 14, col }) {
  return (
    <div className="g-leg" style={{ gap: g, ...(col ? { flexDirection: 'column' } : {}) }}>
      {items.map(([l, c, v], i) => (
        <span key={i} className="g-leg-i">
          <span className="g-leg-d" style={{ background: c }} />
          {l}
          {v != null && <b>{v}</b>}
        </span>
      ))}
    </div>
  );
}

export const Toggle = ({ on, onChange, disabled, label }) => (
  <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={cx('g-toggle', on && 'on')} disabled={disabled} onClick={() => onChange && onChange(!on)} />
);

export function Tabs({ items, act, onChange }) {
  return (
    <div className="g-tabs" role="tablist">
      {items.map((t) => {
        const [k, l] = Array.isArray(t) ? t : [t, t];
        return (
          <button key={k} type="button" role="tab" aria-selected={k === act} className={k === act ? 'on' : ''} onClick={() => onChange && onChange(k)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Steps({ steps, cur, sub, iw = 104, lw = 28 }) {
  return (
    <div className="g-steps" role="list">
      {steps.map((s, i) => {
        const done = i < cur;
        const on = i === cur;
        return (
          <React.Fragment key={s}>
            <div className={cx('g-step', done && 'done', on && 'on')} style={{ width: iw }} role="listitem" aria-current={on ? 'step' : undefined}>
              <span className="g-step-d">{done ? <I n="check" c="#fff" s={14} /> : i + 1}</span>
              <span className="g-step-l">{s}</span>
              {sub && sub[i] && <span className="g-step-s">{sub[i]}</span>}
            </div>
            {i < steps.length - 1 && <span className={cx('g-step-line', done && 'done')} style={{ width: lw }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export const Check = ({ label, on, onChange, s }) => (
  <button type="button" role="checkbox" aria-checked={!!on} className={cx('g-check', on && 'on')} style={s ? { fontSize: s } : undefined} onClick={() => onChange && onChange(!on)}>
    <span className="g-check-b">{on && <I n="check" c="#fff" s={11} sw={3} />}</span>
    {label}
  </button>
);

export const Slider = ({ value, onChange, min = 0, max = 100, col = C.pri, label }) => (
  <input
    type="range"
    className="g-slider"
    min={min}
    max={max}
    value={value}
    aria-label={label}
    onChange={(e) => onChange && onChange(Number(e.target.value))}
    style={{ '--sv': `${((value - min) / (max - min || 1)) * 100}%`, '--sc': col }}
  />
);

export const Note = ({ children, tone = 'pri', i = 'alert', style, role }) => (
  <div className={cx('g-note', `t-${tone}`)} style={style} role={role}>
    <I n={i} s={16} />
    <span>{children}</span>
  </div>
);

export const Lbl = ({ children, style }) => (
  <div className="g-lbl" style={style}>
    {children}
  </div>
);

export const KV = ({ k, v, c }) => (
  <div className="g-kv">
    <span>{k}</span>
    {typeof v === 'string' || typeof v === 'number' ? <b style={c ? { color: c } : undefined}>{v}</b> : v}
  </div>
);

// d/h/m countdown tile. tone by time left — see timerTone().
export function Timer({ d = 0, h = 0, m = 0, tone = 'ok', label, i = 'timer', foot, big, style, live }) {
  return (
    <div className={cx('g-timer', `t-${tone}`, big && 'big')} style={style} role="timer" aria-live={live ? 'polite' : undefined}>
      <div className="g-timer-h">
        <I n={i} s={16} />
        {label}
      </div>
      <div className="g-timer-n">
        {[
          [d, 'd'],
          [h, 'h'],
          [m, 'm'],
        ].map(([v, u]) => (
          <span key={u} className="g-timer-u">
            <b>{String(Math.max(0, v)).padStart(2, '0')}</b>
            <i>{u}</i>
          </span>
        ))}
      </div>
      {foot && <div className="g-timer-f">{foot}</div>}
    </div>
  );
}

// Timer colour by time left (design system "Deadline timer states")
export function timerTone(msLeft, stopped) {
  if (stopped) return ['mut', 'Stopped · time taken'];
  const h = msLeft / 3600000;
  if (h <= 0) return ['er', 'Deadline passed'];
  if (h < 1) return ['er', '< 1 h · hurry'];
  if (h < 24) return ['or', '< 24 h left'];
  if (h < 48) return ['wa', '24–48 h left'];
  return ['ok', '> 48 h · on track'];
}
export const splitMs = (ms) => {
  const t = Math.max(0, Math.floor(ms / 60000));
  return { d: Math.floor(t / 1440), h: Math.floor((t % 1440) / 60), m: t % 60 };
};

export function ScoreCard({ i, name, val, tone, lines = [], weight, foot = true }) {
  const v = val == null ? null : Math.round(val);
  return (
    <div className={cx('g-card g-score', `t-${tone}`)}>
      <div className="g-card-h">
        <IB n={i} tone={tone} box={38} s={19} />
        <div className="g-card-ht">
          <span className="g-s13 g-sb6">{name}</span>
          <span className="g-s11 g-mut">Weight {weight}%</span>
        </div>
        <span className="g-score-v">
          <b>{v == null ? '—' : v}</b>
          <i>/100</i>
        </span>
      </div>
      <Bar pct={v || 0} tone={tone} />
      {lines.map(([k, vv]) => (
        <KV key={k} k={k} v={vv} />
      ))}
      {foot && (
        <div className="g-score-f">
          <span>Contribution to hire-readiness</span>
          <b>+{(((v || 0) * weight) / 100).toFixed(1)} pts</b>
        </div>
      )}
    </div>
  );
}

// Screen = the Figma Screen's main column: (QA banner) + topbar + content.
// The LMS shell around it already gives the sidebar, search, bell and user.
// The QA banner (Figma) says "masked dummy data · NOT production" — only true on
// a real QA host (qa.…). On the live CRM these screens run on real data, so the
// banner stays hidden there (2026-11-24).
const ON_QA_HOST = typeof window !== 'undefined' && /^qa\./i.test(window.location.hostname);

export function Screen({ crumb, title, actions, qa, children, contentStyle, className }) {
  return (
    <div className={cx('g-root', className)}>
      {qa && ON_QA_HOST && (
        <div className="g-qa-banner" role="note">
          <I n="alert" s={15} />
          QA ENVIRONMENT · qa.clcone.careerlabconsulting.com · masked dummy data · NOT production
        </div>
      )}
      <div className="g-top">
        <div className="g-top-t">
          <span className="g-crumb">{crumb}</span>
          <h1 className="g-h">{title}</h1>
        </div>
        {actions && <div className="g-top-a">{actions}</div>}
      </div>
      <div className="g-content" style={contentStyle}>
        {children}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, children, width = 520, label }) {
  if (!open) return null;
  return (
    <div className="g-root" style={{ minHeight: 0, background: 'transparent' }}>
      <div className="g-modal-mask" onClick={onClose} role="presentation">
        <div className="g-modal" style={{ width }} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Loading({ text = 'Loading…' }) {
  return (
    <div className="g-root">
      <div className="g-content">
        <div className="g-empty">{text}</div>
      </div>
    </div>
  );
}

export function ErrorBox({ text }) {
  return (
    <div className="g-root">
      <div className="g-content">
        <Note tone="er">{text}</Note>
      </div>
    </div>
  );
}

// small data hook: run(load) → { data, error, loading, reload }
export function useData(load, deps) {
  const [st, setSt] = React.useState({ data: null, error: null, loading: true });
  const run = React.useCallback(async () => {
    setSt((s) => ({ ...s, loading: true }));
    try {
      const r = await load();
      if (r && r.success === false) setSt({ data: null, error: r.message || 'Could not load.', loading: false });
      else setSt({ data: r && 'result' in r ? r.result : r, error: null, loading: false });
    } catch (e) {
      setSt({ data: null, error: (e && e.message) || 'Could not load.', loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  React.useEffect(() => {
    run();
  }, [run]);
  return { ...st, reload: run };
}

export const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtHM = (min) => {
  const m = Math.round(min || 0);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};
export const ago = (d) => {
  if (!d) return 'never';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
