import React, { useState } from 'react';
import api from '../api';
import { B, Modal, ModalHead, Skeleton, ago, clock, hmShort, todayKey, useLoad, useNow, useToast } from '../ui';
import AgentSetup, { startAgentDownload } from './AgentSetup';

// E9 · Desktop agent + my inactivity records (Profile › Desktop agent)

export default function Agent() {
  const toast = useToast();
  const now = useNow(5000);
  const ag = useLoad(() => api.get('me/agent'), [], { poll: 30000 });
  const idle = useLoad(() => api.get('me/idle', { date: todayKey() }), [], { poll: 60000 });
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState('');
  const devices = ag.data || [];
  const dev = devices.find((d) => d.online) || devices[0];
  const running = dev && dev.online;
  // Download → the installer + the setup steps; Connect → one-click pairing
  const [setup, setSetup] = useState(null); // 'install' | 'connect'
  const download = async (os) => {
    await api.post('me/agent/consent', { allow: true });
    const r = await startAgentDownload(os);
    if (!r.ok) return toast.err('Download not available', r.message);
    setSetup('install');
  };
  const sendNote = async () => {
    const r = await api.post(`me/idle/${noteFor._id}/note`, { note });
    toast.res(r, 'Note sent to HR');
    if (r.success) {
      setNoteFor(null);
      setNote('');
      idle.reload(true);
    }
  };
  const rows = (idle.data && idle.data.list) || [];
  return (
    <div className="e-page">
      <div>
        <h1 className="e-h1">Desktop agent &amp; my inactivity</h1>
        <p className="e-sub">Profile › Desktop agent. The agent lets your work in other apps (Excel, dialer, WhatsApp Desktop) count, not just the CRM tab.</p>
      </div>
      <div className="e-row" style={{ gap: 20, alignItems: 'stretch' }}>
        <section className="e-card pad" style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 14, padding: 22 }}>
          {ag.loading && !ag.data ? (
            <Skeleton rows={2} />
          ) : (
            <>
              <div className="e-row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--e-priS)', color: 'var(--e-pri)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flex: 'none' }}>CL</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 className="e-ct">CLC Desktop Agent</h2>
                  <div style={{ fontSize: 12, color: 'var(--e-mut)' }}>{dev ? `v${dev.agentVersion || '?'} · ${dev.hostname || 'Laptop'} · ${dev.os || ''}` : 'Not installed on this account yet'}</div>
                </div>
                <B kind={running ? 'g' : 'o'}>{running ? 'Connected' : dev ? 'Not running' : 'Not installed'}</B>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
                <div className="ep-st">
                  <span>Last keyboard use</span>
                  <b style={{ fontSize: 15 }}>{running && dev.lastKbAt ? ago(dev.lastKbAt, now) : '—'}</b>
                </div>
                <div className="ep-st">
                  <span>Last mouse use</span>
                  <b style={{ fontSize: 15 }}>{running && dev.lastMouseAt ? ago(dev.lastMouseAt, now) : '—'}</b>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--e-mut)', lineHeight: '18px' }}>It starts with Windows and sits in the tray. After installing, click “Connect this laptop” — it connects in one click (or type the 6-digit code into the agent). No sign-in on the laptop, so this browser stays logged in. If it is closed or removed, HR gets an alert and your time falls back to browser-only tracking.</div>
              <div className="e-row" style={{ marginTop: 'auto' }}>
                <button type="button" className="e-btn ok" onClick={() => setSetup('connect')}>
                  Connect this laptop
                </button>
                <button type="button" className="e-btn p" onClick={() => download('win')}>
                  Download for Windows
                </button>
                <button type="button" className="e-btn" onClick={() => download('mac')}>
                  Download for macOS
                </button>
              </div>
            </>
          )}
        </section>
        <section className="e-card pad" style={{ flex: '1 1 380px', padding: 22 }}>
          <h2 className="e-ct" style={{ marginBottom: 8 }}>
            What the agent records
          </h2>
          {[
            [true, 'Whether the keyboard was used (yes / no every 30 s)'],
            [true, 'Whether the mouse was used (yes / no every 30 s)'],
            [true, 'Laptop on, locked, sleep, shut down, and the laptop name'],
            [true, 'Each time there’s no input for 5 min: from, to, how long'],
            [false, 'Never the keys you press, passwords or messages'],
            [false, 'Never screenshots, screen recording, camera or mic'],
            [false, 'Never your files, browser history or app names'],
          ].map(([yes, t]) => (
            <div key={t} className="e-row" style={{ gap: 10, fontSize: 13, lineHeight: '20px', color: 'var(--e-ink2)', padding: '6px 0', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <i style={{ flex: 'none', width: 20, height: 20, borderRadius: 6, fontStyle: 'normal', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: yes ? 'rgba(22,163,74,.13)' : 'rgba(220,38,38,.11)', color: yes ? '#15803D' : '#B91C1C' }}>{yes ? '✓' : '✕'}</i>
              {t}
            </div>
          ))}
        </section>
      </div>
      <section className="e-card">
        <div className="e-ch">
          <div>
            <h2 className="e-ct">My inactive times today</h2>
            <p className="e-cs">
              {rows.length} time{rows.length === 1 ? '' : 's'} · {hmShort(idle.data ? idle.data.total : 0)}, not counted as work. Were you working away from the laptop? Add a note and HR can count it.
            </p>
          </div>
          <B kind="a">{hmShort(idle.data ? idle.data.total : 0)} inactive</B>
        </div>
        {idle.loading && !idle.data && <Skeleton rows={3} />}
        {idle.data && rows.length === 0 && <p className="e-cs" style={{ padding: 20 }}>No inactive time today. Nice!</p>}
        {rows.map((p) => (
          <div key={p._id} className="e-row" style={{ gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--e-line2)', background: p.employeeNote ? 'rgba(79,70,229,.03)' : undefined }}>
            <b style={{ width: 120, fontSize: 14 }}>
              {clock(p.startAt)} – {p.endAt ? clock(p.endAt) : 'now'}
            </b>
            <span style={{ width: 60, fontWeight: 600 }}>{p.minutes}m</span>
            <span style={{ flex: 1, minWidth: 160, fontSize: 13, color: p.employeeNote ? 'var(--e-ink2)' : 'var(--e-mut)' }}>{p.employeeNote ? `Note: “${p.employeeNote}”` : `No keyboard / mouse${p.laptop ? ` · ${p.laptop.toLowerCase()}` : ''}`}</span>
            {p.countedAsWork ? <B kind="g">Counted as work</B> : p.employeeNote ? <B kind="a">{p.endAt ? 'HR: not counted yet' : 'Still inactive'}</B> : p.endAt ? (
              <button type="button" className="e-btn sm" onClick={() => setNoteFor(p)}>
                Add note
              </button>
            ) : (
              <B kind="r">Still inactive</B>
            )}
          </div>
        ))}
      </section>
      {dev && !running && (
        <section className="e-card pad e-row" style={{ gap: 16, borderColor: '#FDE68A', background: 'rgba(245,158,11,.05)' }}>
          <B kind="r">Agent not running</B>
          <div style={{ flex: 1, minWidth: 280, fontSize: 13, color: 'var(--e-ink2)', lineHeight: '20px' }}>
            <b>The desktop agent isn't running, so only CRM tab activity is counted right now.</b> Last seen {dev.lastSeenAt ? `${clock(dev.lastSeenAt)}` : 'never'}.
          </div>
          <button type="button" className="e-btn p" onClick={() => toast.info('Start “CLC Desktop Agent” from the Start menu', 'It connects again on its own.')}>
            Start agent
          </button>
        </section>
      )}
      <AgentSetup
        open={!!setup}
        start={setup || 'install'}
        onClose={() => {
          setSetup(null);
          ag.reload(true);
        }}
        onDone={() => ag.reload(true)}
      />
      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} label="Add note">
        <ModalHead title="Add a note for HR" sub={noteFor ? `${clock(noteFor.startAt)} – ${clock(noteFor.endAt)} · ${noteFor.minutes} min` : ''} onClose={() => setNoteFor(null)} />
        <textarea className="e-fld" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Team stand-up in the meeting room" autoFocus />
        <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="e-btn" onClick={() => setNoteFor(null)}>
            Cancel
          </button>
          <button type="button" className="e-btn p" disabled={!note.trim()} onClick={sendNote}>
            Send note
          </button>
        </div>
      </Modal>
    </div>
  );
}
