import React, { useEffect, useState } from 'react';
import api from '../api';
import { Av, B, Card, Empty, ErrorState, Name, Search, Select, Skeleton, Trunc, ago, clock, hmShort, useErpLive, useLoad, useNow } from '../ui';
import { ExportMenu, deptOptions, useLite } from './shared';

// A13 · System tracking — laptop (CLC Desktop Agent) + keyboard + mouse
const HC = { K: '#16A34A', M: '#86EFAC', I: '#FCD34D', L: '#C4B5FD', O: '#E2E8F0' };
const HT = { K: 'keyboard + mouse', M: 'mouse only / active', I: 'no input 5+ min', L: 'locked / lunch', O: 'laptop off / not signed in' };
const POWER = { on: 'On', locked: 'Locked', sleep: 'Sleep', off: 'Off' };
const dotC = (d, now) => {
  if (!d) return '#CBD5E1';
  const s = (now - new Date(d)) / 1000;
  return s < 60 ? '#16A34A' : s < 300 ? '#F59E0B' : '#DC2626';
};

export default function SystemTracking({ globalQ, setTab }) {
  const lite = useLite();
  const now = useNow(5000);
  const [q, setQ] = useState(globalQ || '');
  const [state, setState] = useState('All');
  const [dept, setDept] = useState('All');
  const [agent, setAgent] = useState('All');
  const [sel, setSel] = useState(null);
  const { data, loading, error, reload } = useLoad(() => api.get('admin/system', { q, state, dept, agent }), [q, state, dept, agent], { poll: 30000 });
  useErpLive(() => reload(true));
  useEffect(() => {
    if (data && data.list.length && !sel) setSel(String((data.list.find((x) => x.device) || data.list[0]).employee._id));
  }, [data, sel]);
  const day = useLoad(() => (sel ? api.get(`admin/system/${sel}`) : Promise.resolve({ success: true, result: null })), [sel], { poll: 60000 });
  if (loading && !data) return <Skeleton kpis={7} rows={8} />;
  if (error && !data) return <ErrorState onRetry={() => reload()} />;
  const k = data.kpis;
  const D = day.data;
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">System tracking: laptop, keyboard and mouse</h1>
          <p className="e-sub">
            The small <b>CLC Desktop Agent</b> on each laptop reads the computer's own idle time. Keyboard or mouse use in <b>any app</b> (Excel, WhatsApp Desktop, the dialer) counts, not just the CRM tab. It also records power on, lock, sleep and shutdown. It never reads keys, text, screens or files.
          </p>
        </div>
        <div className="e-row">
          <button
            type="button"
            className="e-btn"
            onClick={() => {
              const link = `${window.location.origin}/employee/agent`;
              navigator.clipboard && navigator.clipboard.writeText(link);
              window.alert(`Send employees this link — they download and connect the agent there:\n${link}`);
            }}
          >
            Agent download link
          </button>
          <ExportMenu kind="idle" primary />
        </div>
      </div>
      <div className="e-kpis sm">
        <div className="e-kpi">
          <div className="e-kl">Laptops with agent</div>
          <div className="e-kv">
            {k.withAgent}
            <span style={{ fontSize: 14, color: 'var(--e-mut)', fontWeight: 500 }}> / {k.total}</span>
          </div>
          <div className="e-ks">{k.total - k.withAgent} not installed</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">Agent online</div>
          <div className="e-kv" style={{ color: '#15803D' }}>
            {k.agentOnline}
          </div>
          <div className="e-ks">heartbeat &lt; 1 min</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">Keyboard / mouse in use</div>
          <div className="e-kv" style={{ color: '#15803D' }}>
            {k.inUse}
          </div>
          <div className="e-ks">input in last 5 min</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">No input 5+ min</div>
          <div className="e-kv" style={{ color: '#B45309' }}>
            {k.idle5}
          </div>
          <div className="e-ks">signed in, nobody using it</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">Locked / sleep</div>
          <div className="e-kv" style={{ color: '#6D28D9' }}>
            {k.locked}
          </div>
          <div className="e-ks">Win+L or lid closed</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">Shut down / off</div>
          <div className="e-kv" style={{ color: '#475569' }}>
            {k.off}
          </div>
          <div className="e-ks">laptops with the agent</div>
        </div>
        <div className="e-kpi" style={k.alerts ? { borderColor: '#FECACA' } : undefined}>
          <div className="e-kl">Agent alerts</div>
          <div className="e-kv" style={{ color: k.alerts ? '#B91C1C' : undefined }}>
            {k.alerts}
          </div>
          <div className="e-ks">stopped · clock changed</div>
        </div>
      </div>
      <div className="e-row">
        <Search value={q} onChange={setQ} placeholder="Search employee or laptop name" />
        <Select label="Device state" value={state} onChange={setState} options={['All', 'In use', 'Idle 5+ min', 'Locked / sleep', 'Off']} />
        <Select label="Department" value={dept} onChange={setDept} options={deptOptions(lite)} />
        <Select label="Agent" value={agent} onChange={setAgent} options={['All', 'Online', 'Offline', 'Stopped', 'Not installed']} />
        <button
          type="button"
          className="e-btn ghost"
          onClick={() => {
            setQ('');
            setState('All');
            setDept('All');
            setAgent('All');
          }}
        >
          Reset
        </button>
      </div>
      <Card
        title="Devices right now"
        sub={`Updates live from the agent every 30 s · ${clock(now)}`}
        right={
          <span className="e-lg">
            <span>
              <i style={{ background: '#16A34A', borderRadius: '50%' }} />
              used &lt; 1 min ago
            </span>
            <span>
              <i style={{ background: '#F59E0B', borderRadius: '50%' }} />
              1–5 min
            </span>
            <span>
              <i style={{ background: '#DC2626', borderRadius: '50%' }} />
              5+ min
            </span>
          </span>
        }
        flush
      >
        {data.list.length === 0 ? (
          <Empty title="No devices match" text="Change or reset the filters." icon="laptop" />
        ) : (
          <div className="e-tw">
            <table className="e-tbl" style={{ minWidth: 1000 }}>
              <colgroup>
                <col style={{ width: '20%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Laptop</th>
                  <th>Power</th>
                  <th>Keyboard</th>
                  <th>Mouse</th>
                  <th>No input for</th>
                  <th>5-min idles today</th>
                  <th>Agent</th>
                </tr>
              </thead>
              <tbody>
                {data.list.map((x) => {
                  const id = String(x.employee._id);
                  const on = x.agent === 'Online';
                  return (
                    <tr key={id} style={{ cursor: 'pointer', background: sel === id ? 'rgba(79,70,229,.05)' : undefined }} onClick={() => setSel(id)}>
                      <td>
                        <Name name={x.employee.name} sub={x.employee.department || x.employee.role} photo={x.employee.photo} />
                      </td>
                      <td>
                        <Trunc as="b" text={x.device ? x.device.hostname || 'Laptop' : '—'} style={{ fontWeight: 500, color: 'var(--e-ink)' }} />
                        <small style={{ fontSize: 11, color: 'var(--e-mut)' }}>{x.device ? x.device.os : x.session && x.session.device ? `${x.session.device.browser} · browser only` : ''}</small>
                      </td>
                      <td>{x.power ? <B>{POWER[x.power]}</B> : '—'}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <i style={{ width: 8, height: 8, borderRadius: '50%', background: on || x.live ? dotC(x.kbAt, now) : '#CBD5E1' }} />
                          {x.kbAt ? ago(x.kbAt, now) : '—'}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <i style={{ width: 8, height: 8, borderRadius: '50%', background: on || x.live ? dotC(x.mouseAt, now) : '#CBD5E1' }} />
                          {x.mouseAt ? ago(x.mouseAt, now) : '—'}
                        </span>
                      </td>
                      <td style={x.noInputMin >= 5 ? { color: '#B91C1C', fontWeight: 600 } : undefined}>{x.noInputMin == null ? '—' : x.noInputMin < 1 ? '—' : `${x.noInputMin} min`}</td>
                      <td>
                        <b style={{ color: 'var(--e-ink)' }}>{x.idleCount}</b> <span style={{ color: 'var(--e-mut)' }}>· {hmShort(x.idleMin)}</span>
                      </td>
                      <td>
                        <B>{x.agent}</B>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {D && D.employee && (
        <div className="e-split">
          <section className="e-card main">
            <div className="e-ch">
              <Av name={D.employee.name} size={34} photo={D.employee.photo} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <h2 className="e-ct">
                  {D.employee.name}
                  {D.device ? ` · ${D.device.hostname || 'Laptop'}` : ''}
                </h2>
                <p className="e-cs">{D.device ? `${D.device.os || ''} · Agent v${D.device.agentVersion || '?'} · installed ${new Date(D.device.installedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · device ID locked to this employee` : 'No desktop agent — browser tracking only (CRM / portal tabs).'}</p>
              </div>
              <B>{D.live === 'active' ? 'In use' : D.status}</B>
            </div>
            <div className="e-cb">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Keyboard and mouse today (each box = 10 min)</div>
              <div className="e-hm">
                <span />
                {[':00', ':10', ':20', ':30', ':40', ':50'].map((x) => (
                  <span key={x}>{x}</span>
                ))}
                {D.heat.map((r) => (
                  <React.Fragment key={r.hour}>
                    <span>{r.hour}</span>
                    {r.cells.map((c) => (
                      <span key={c.key} className="c" style={{ background: HC[c.state] }} title={`${c.key} · ${HT[c.state]}${c.k || c.m ? ` · ${c.k} keyboard / ${c.m} mouse pings` : ''}`} />
                    ))}
                  </React.Fragment>
                ))}
              </div>
              <div className="e-lg" style={{ marginTop: 12 }}>
                {Object.keys(HC).map((s) => (
                  <span key={s}>
                    <i style={{ background: HC[s] }} />
                    {HT[s]}
                  </span>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginTop: 16 }}>
                <div className="ep-st">
                  <span>Keyboard used</span>
                  <b>{hmShort(D.stats.kbMin)}</b>
                </div>
                <div className="ep-st">
                  <span>Mouse used</span>
                  <b>{hmShort(D.stats.msMin)}</b>
                </div>
                <div className="ep-st" style={{ background: 'rgba(245,158,11,.1)' }}>
                  <span>No input 5+ min</span>
                  <b>
                    {D.stats.idleCount} times · {hmShort(D.stats.idleMin)}
                  </b>
                </div>
                <div className="ep-st" style={{ background: 'rgba(124,58,237,.08)' }}>
                  <span>Locked / lunch</span>
                  <b>{hmShort(D.stats.lockedMin + D.stats.lunchMin)}</b>
                </div>
              </div>
            </div>
          </section>
          <aside className="side">
            <section className="e-card pad">
              <h2 className="e-ct" style={{ marginBottom: 8 }}>
                Laptop events today
              </h2>
              {D.timeline.length === 0 && <p className="e-cs">No events today.</p>}
              {D.timeline.map((e, i) => (
                <div key={i} className="e-ev2">
                  <b>{clock(e.at)}</b>
                  <span style={{ flex: 1, color: e.kind === 'idle' ? '#B45309' : ['lock', 'sleep'].includes(e.kind) ? '#6D28D9' : undefined }}>{e.text}</span>
                </div>
              ))}
              <button type="button" className="e-btn ghost" style={{ padding: 0, marginTop: 8 }} onClick={() => setTab('idle')}>
                Open inactivity log →
              </button>
            </section>
            <section className="e-card pad" style={data.alerts.length ? { borderColor: '#FECACA' } : undefined}>
              <h2 className="e-ct" style={{ marginBottom: 10 }}>
                Agent alerts
              </h2>
              {data.alerts.length === 0 && <p className="e-cs">No alerts. Every agent is reporting normally.</p>}
              {data.alerts.map((a, i) => (
                <div key={i} style={{ fontSize: 13, color: 'var(--e-ink2)', lineHeight: '20px', marginTop: i ? 10 : 0 }}>
                  <b>{a.name}:</b> {a.text}
                </div>
              ))}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
