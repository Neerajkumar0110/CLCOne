import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/config/serverApiConfig';
import api from '../api';
import { Modal, clock, useToast } from '../ui';

// Desktop agent setup (user ask 2026-11-28): on the first portal sign-in the
// employee is asked for permission; "Allow" → the installer downloads → they
// run it → "Connect this laptop" pairs it in one click (clcagent:// link, the
// 6-digit code still works by hand). From then on laptop activity is counted.
// A browser can never install a program by itself — the employee runs the
// downloaded file once.

const absApi = () => new URL(API_BASE_URL, window.location.origin);
export const agentDownloadUrl = (os = 'win') => {
  const custom = import.meta.env.VITE_AGENT_DOWNLOAD_URL;
  if (custom) return custom.replace('{os}', os === 'mac' ? 'mac' : 'windows');
  return new URL(`erp-agent-public/download/${os === 'mac' ? 'mac' : 'win'}`, absApi()).toString();
};
// the server the agent talks to (/api/erp-agent-public/*)
export const agentServer = () => absApi().origin;
const isMac = () => /Mac/i.test(navigator.platform || navigator.userAgent);
// Start the installer download without leaving the portal: check the file is
// there first (else show why), then download through a hidden frame.
export async function startAgentDownload(os) {
  const url = agentDownloadUrl(os || (isMac() ? 'mac' : 'win'));
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) {
      let msg = 'The installer is not available yet. Ask HR.';
      try {
        const j = await (await fetch(url)).json();
        if (j && j.message) msg = j.message;
      } catch (e) {
        /* keep the default */
      }
      return { ok: false, message: msg };
    }
  } catch (e) {
    /* a cross-site release link may refuse HEAD — just try the download */
  }
  const f = document.createElement('iframe');
  f.style.display = 'none';
  f.src = url;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 120000);
  return { ok: true };
}

const STEPS = ['Permission', 'Install', 'Connect'];
const RECORDS = [
  [true, 'Whether the keyboard / mouse was used — yes or no, every 30 s'],
  [true, 'Laptop on, locked, sleep, shut down, and the laptop name'],
  [true, 'Each time there is no input for 5 min: from, to, how long'],
  [false, 'Never the keys you press, passwords, messages or typed text'],
  [false, 'Never screenshots, screen recording, camera or microphone'],
  [false, 'Never your files, browser history or app names'],
];

export default function AgentSetup({ open, onClose, start = 'ask', onDone }) {
  const toast = useToast();
  const [step, setStep] = useState(start);
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState(null);
  const [paired, setPaired] = useState(false);
  const poll = useRef(null);

  useEffect(() => {
    if (open) {
      setStep(start === 'connect' ? 'install' : start);
      setPair(null);
      setPaired(false);
      if (start === 'connect') connect(); // "Connect this laptop" — straight to pairing
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, start]);

  // once a code exists, watch for the laptop to connect
  useEffect(() => {
    clearInterval(poll.current);
    if (!open || !pair || paired) return undefined;
    poll.current = setInterval(async () => {
      const r = await api.get('me/agent/consent');
      if (r.success && r.result.paired && !r.result.codePending) {
        setPaired(true);
        clearInterval(poll.current);
        onDone && onDone();
      }
    }, 4000);
    return () => clearInterval(poll.current);
  }, [open, pair, paired, onDone]);

  const download = async () => {
    const r = await startAgentDownload();
    if (!r.ok) toast.err('Download not available', r.message);
    return r.ok;
  };
  const allow = async () => {
    setBusy(true);
    const r = await api.post('me/agent/consent', { allow: true });
    setBusy(false);
    if (!r.success) return toast.err(r.message || 'Could not save');
    await download();
    setStep('install');
  };
  const later = async () => {
    await api.post('me/agent/consent', { allow: false });
    onClose();
  };
  const connect = async () => {
    setBusy(true);
    const r = await api.post('me/agent/pair-code');
    setBusy(false);
    if (!r.success) return toast.err(r.message || 'Could not make a code');
    const p = { ...r.result, issuedAt: new Date().toISOString() };
    setPair(p);
    setStep('connect');
    // opens the installed agent, which pairs on its own
    window.location.href = `clcagent://pair?code=${encodeURIComponent(p.code)}&server=${encodeURIComponent(agentServer())}`;
  };

  const idx = step === 'ask' ? 0 : step === 'install' ? 1 : 2;
  return (
    <Modal open={open} onClose={() => !busy && onClose()} label="Desktop agent setup">
      <div className="e-agsteps">
        {STEPS.map((s, i) => (
          <span key={s} className={i < idx || paired ? 'done' : i === idx ? 'on' : ''}>
            <i>{i < idx || paired ? '✓' : i + 1}</i>
            {s}
          </span>
        ))}
      </div>

      {step === 'ask' && (
        <>
          <h2 className="e-ct" style={{ fontSize: 18, margin: '4px 0 6px' }}>
            Allow the CLC Desktop Agent?
          </h2>
          <p className="e-cs" style={{ marginBottom: 12 }}>
            It counts your work in other apps too (Excel, dialer, WhatsApp Desktop), not only this browser tab — so your active time is right. It starts with your laptop and sits in the tray.
          </p>
          <div className="e-agrec">
            {RECORDS.map(([yes, t]) => (
              <div key={t}>
                <i className={yes ? 'y' : 'n'}>{yes ? '✓' : '✕'}</i>
                {t}
              </div>
            ))}
          </div>
          <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="e-btn" disabled={busy} onClick={later}>
              Not now
            </button>
            <button type="button" className="e-btn p" disabled={busy} onClick={allow}>
              {busy ? 'Saving…' : 'Allow & download'}
            </button>
          </div>
        </>
      )}

      {step === 'install' && (
        <>
          <h2 className="e-ct" style={{ fontSize: 18, margin: '4px 0 6px' }}>
            Install the agent
          </h2>
          <p className="e-cs" style={{ marginBottom: 12 }}>
            The download has started. Open <b>{isMac() ? 'CLC-Desktop-Agent.dmg' : 'CLC-Desktop-Agent-Setup.exe'}</b> from your downloads and let it install (one click). If Windows asks, choose <b>More info → Run anyway</b>.
          </p>
          <div className="e-note info">Nothing downloaded?{' '}
            <button type="button" className="e-btn sm ghost" style={{ padding: '0 6px', height: 22 }} onClick={download}>
              Download again
            </button></div>
          <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="e-btn" onClick={onClose}>
              Later
            </button>
            <button type="button" className="e-btn p" disabled={busy} onClick={connect}>
              I installed it — connect this laptop
            </button>
          </div>
        </>
      )}

      {step === 'connect' && (
        <>
          <h2 className="e-ct" style={{ fontSize: 18, margin: '4px 0 6px' }}>
            {paired ? 'Laptop connected ✓' : 'Connecting this laptop…'}
          </h2>
          {paired ? (
            <p className="e-cs">Done. Your laptop activity is now counted. The agent keeps running in the tray and starts with your laptop.</p>
          ) : (
            <>
              <p className="e-cs" style={{ marginBottom: 12 }}>
                Your browser may ask to open <b>CLC Desktop Agent</b> — click <b>Open</b>. It connects on its own. Or type this code in the agent window:
              </p>
              {pair && <div className="e-agcode">{pair.code}</div>}
              {pair && <div className="e-note info" style={{ marginTop: 10 }}>Works once, valid till {clock(pair.expiresAt)}. You do not sign in on the laptop, so this browser stays logged in.</div>}
            </>
          )}
          <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            {!paired && (
              <button type="button" className="e-btn" disabled={busy} onClick={connect}>
                Try again
              </button>
            )}
            <button type="button" className="e-btn p" onClick={onClose}>
              {paired ? 'Done' : 'Close'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
