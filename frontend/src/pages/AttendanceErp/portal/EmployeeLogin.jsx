import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { login, verifyOtp, resendOtp, cancelOtp } from '@/redux/auth/actions';
import { selectAuth } from '@/redux/auth/selectors';
import '../erp.css';

// E0 · /employee/login — same CRM account, same single-login rule
// (issueSession): signing in here signs any other device out, and today's
// attendance session continues (no second attendance is created).
// Login is by email + a one-time code (OTP) sent to that same email — the same
// passwordless login the CRM uses (user ask 2026-11-28; Sales accounts have no
// password). The ERP invite email links here with ?email= filled in.
const RESEND_AFTER = 30;

export default function EmployeeLogin() {
  const dispatch = useDispatch();
  const { search } = useLocation();
  const { isLoading, otpRequired, otpEmail } = useSelector(selectAuth);
  const [email, setEmail] = useState(() => new URLSearchParams(search).get('email') || '');
  const [otp, setOtp] = useState('');
  const [remember, setRemember] = useState(true);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (otpRequired) {
      setOtp('');
      setCooldown(RESEND_AFTER);
    }
  }, [otpRequired]);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    dispatch(login({ loginData: { email: email.trim(), remember } }));
  };
  const verify = (e) => {
    e.preventDefault();
    if (otp.trim().length < 4) return;
    dispatch(verifyOtp({ email: otpEmail, otp: otp.trim(), remember }));
  };
  const resend = async () => {
    await dispatch(resendOtp({ email: otpEmail }));
    setCooldown(RESEND_AFTER);
  };

  const formStyle = { width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 18 };
  return (
    <div className="erp" style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100vh', background: 'var(--e-card)' }}>
      <aside style={{ flex: '1 1 480px', background: '#0B1020', padding: 56, display: 'flex', flexDirection: 'column', gap: 28, minWidth: 0 }}>
        <div className="e-row" style={{ gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: '#4F46E5', color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>CL</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700 }}>CLC One</div>
            <div style={{ color: '#94A3B8', fontSize: 12 }}>Employee Portal</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20, maxWidth: 460 }}>
          <h1 style={{ margin: 0, color: '#fff', fontSize: 36, lineHeight: '44px' }}>Your day, your hours, your leaves. In one place.</h1>
          {['See your working time and what is left of today’s 8 hours.', 'Apply for leave and follow it to approval.', 'Your whole attendance history: daily, weekly, monthly.'].map((t, i) => (
            <div key={t} className="e-row" style={{ gap: 12, fontSize: 14, color: '#CBD5E1', lineHeight: '22px', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <i style={{ flex: 'none', width: 22, height: 22, borderRadius: 7, background: '#1E293B', color: '#A5B4FC', fontStyle: 'normal', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</i>
              {t}
            </div>
          ))}
          <div style={{ marginTop: 8, padding: '14px 16px', borderRadius: 12, background: '#111827', border: '1px solid #1F2937', fontSize: 13, color: '#94A3B8', lineHeight: '20px' }}>
            <b style={{ color: '#E2E8F0' }}>Privacy:</b> this portal only notices whether the mouse or keyboard was used, so it can tell active time from idle time. It never records what you type, your screen or your messages.
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#64748B' }}>{window.location.host}/employee</div>
      </aside>
      <main style={{ flex: '1 1 480px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', minWidth: 0 }}>
        {!otpRequired ? (
          <form onSubmit={sendCode} style={formStyle}>
            <div>
              <h2 style={{ margin: 0, fontSize: 26 }}>Sign in</h2>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--e-mut)' }}>Enter your work email. We will email you a one-time code — no password needed.</p>
            </div>
            <label>
              <span className="e-lbl" style={{ fontSize: 13 }}>
                Work email
              </span>
              <input className="e-fld" style={{ height: 46, fontSize: 14, borderRadius: 10 }} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--e-ink2)' }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in
            </label>
            <button type="submit" className="e-btn p lg" disabled={isLoading} style={{ height: 46, fontSize: 15 }}>
              {isLoading ? 'Sending code…' : 'Send login code'}
            </button>
            <div style={{ fontSize: 12, color: 'var(--e-mut)', textAlign: 'center' }}>Your attendance starts when you sign in. Login time comes from the server clock.</div>
            <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(245,158,11,.1)', border: '1px solid #FDE68A', fontSize: 13, color: '#92400E', lineHeight: '20px' }}>
              <b>Already signed in on another device?</b> Signing in here will sign the other device out. Today's session continues and no second attendance is created.
            </div>
          </form>
        ) : (
          <form onSubmit={verify} style={formStyle}>
            <div>
              <h2 style={{ margin: 0, fontSize: 26 }}>Enter your code</h2>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--e-mut)' }}>
                We sent a one-time code to <b style={{ color: 'var(--e-ink)' }}>{otpEmail}</b>. It is valid for 10 minutes.
              </p>
            </div>
            <label>
              <span className="e-lbl" style={{ fontSize: 13 }}>
                Login code (OTP)
              </span>
              <input
                className="e-fld"
                style={{ height: 52, fontSize: 22, letterSpacing: 8, textAlign: 'center', borderRadius: 10, fontVariantNumeric: 'tabular-nums' }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                autoFocus
                required
              />
            </label>
            <button type="submit" className="e-btn p lg" disabled={isLoading || otp.length < 4} style={{ height: 46, fontSize: 15 }}>
              {isLoading ? 'Signing in…' : 'Sign in and start my day'}
            </button>
            <div className="e-row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <button type="button" className="e-btn sm ghost" disabled={isLoading || cooldown > 0} onClick={resend}>
                {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
              </button>
              <button type="button" className="e-btn sm ghost" disabled={isLoading} onClick={() => dispatch(cancelOtp())}>
                Use another email
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
