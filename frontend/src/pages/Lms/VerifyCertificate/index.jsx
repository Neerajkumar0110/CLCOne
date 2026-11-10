import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE_URL } from '@/config/serverApiConfig';

// Public certificate verification (design L15) — no login. Shows only what a
// verifier needs; backend routes/appRoutes/lms/lmsCertVerifyPublicApi.js.

const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function VerifyCertificate() {
  const { certificateId } = useParams();
  const navigate = useNavigate();
  const [id, setId] = useState(certificateId || '');
  const [state, setState] = useState(null); // null | 'loading' | { ...result } | { error }

  const check = useCallback(async (value) => {
    const v = String(value || '').trim();
    if (!v) return;
    setState('loading');
    try {
      const r = await axios.get(`${API_BASE_URL}certificate-verify/${encodeURIComponent(v)}`);
      setState(r.data.result);
    } catch (e) {
      const msg = e.response && e.response.data && e.response.data.message;
      setState({ error: e.response && e.response.status === 404 ? 'notfound' : 'error', message: msg });
    }
  }, []);

  useEffect(() => {
    if (certificateId) check(certificateId);
  }, [certificateId, check]);

  const submit = (e) => {
    e.preventDefault();
    if (id.trim() && id.trim() !== certificateId) navigate(`/verify/${encodeURIComponent(id.trim())}`);
    else check(id);
  };

  const r = state && state !== 'loading' && !state.error ? state : null;
  const ok = r && r.valid;
  const banner = ok ? { background: '#f0fdf4', color: '#166534' } : { background: '#fef2f2', color: '#991b1b' };
  const row = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid #f1f5f9', fontSize: 15 };
  // design board L15 — navy brand bar, ID form on the left, result card on the right
  return (
    <div className="vf-root" style={{ minHeight: '100vh', background: '#f6f3ea', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' }}>
      <header style={{ minHeight: 68, background: '#0b1a33', display: 'flex', alignItems: 'center', padding: '0 40px', color: '#fff', fontWeight: 700, fontSize: 17, letterSpacing: '.04em' }}>
        CAREER LAB CONSULTING · <span style={{ color: '#e9c46a', marginLeft: 6 }}>Certificate verification</span>
      </header>
      <main className="vf-main" style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 40, padding: 'clamp(24px, 5vw, 48px) clamp(16px, 5vw, 72px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <h1 style={{ margin: 0, fontFamily: "'Playfair Display', Georgia, serif", fontSize: 44, fontWeight: 700, color: '#0b1a33', lineHeight: '52px' }}>Kya ye certificate asli hai?</h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: '25px', color: '#475569' }}>
            Certificate ID daalein ya certificate par bana QR scan karein. Login ki zaroorat nahi. Sirf zaroori jaankari dikhegi — marks, contact ya internal notes kabhi nahi.
          </p>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <label htmlFor="vf-id" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600, color: '#475569' }}>
              Certificate ID
              <input id="vf-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="CLC-2026-XXXXXXXX" autoComplete="off" style={{ height: 52, border: '1.5px solid #cbd5e1', borderRadius: 10, padding: '0 16px', fontFamily: 'inherit', fontSize: 18, letterSpacing: '.06em', background: '#fff' }} />
            </label>
            <button type="submit" disabled={!id.trim() || state === 'loading'} style={{ alignSelf: 'flex-start', height: 48, padding: '0 22px', borderRadius: 10, background: '#0b1a33', color: '#fff', fontWeight: 600, fontSize: 15, border: 0, fontFamily: 'inherit', cursor: 'pointer', opacity: !id.trim() ? 0.6 : 1 }}>
              {state === 'loading' ? 'Checking…' : 'Verify'}
            </button>
          </form>
          <div style={{ fontSize: 13, lineHeight: '20px', marginTop: 'auto', color: '#475569' }}>
            IBM / Microsoft jaise external certificates ko unke apne provider ke verification link se check karein — Career Lab third-party credential issue ya revoke nahi karta.
          </div>
        </div>

        {(r || (state && state.error)) && (
          <section className={`vf-result ${ok ? 'ok' : 'bad'}`} role="status" style={{ background: '#fff', borderRadius: 16, border: '1px solid #e7e1cf', padding: 32, display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, ...banner }}>
              <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', background: ok ? '#16a34a' : '#dc2626', flexShrink: 0 }}>{ok ? '✓' : '!'}</div>
              <div>
                <b style={{ fontSize: 18 }}>{r ? (ok ? 'Valid certificate' : r.status === 'replaced' ? 'This certificate was replaced by a corrected one' : 'This certificate has been revoked') : state.error === 'notfound' ? 'No certificate found with this ID' : 'Could not check right now'}</b>
                <div style={{ fontSize: 13 }}>
                  {r
                    ? ok
                      ? 'Issued by Career Lab Consulting and currently valid.'
                      : r.status === 'replaced' && r.replacedBy
                        ? <>The corrected certificate is <a href={`/verify/${encodeURIComponent(r.replacedBy)}`}>{r.replacedBy}</a>.</>
                        : 'It is no longer valid. Contact Career Lab Consulting for details.'
                    : state.error === 'notfound'
                      ? 'Check the ID for typos. If it was issued recently, try again later or contact Career Lab Consulting.'
                      : state.message || 'Please try again in a moment.'}
                </div>
              </div>
            </div>
            {r && (
              <>
                <div style={row}><span style={{ color: '#475569' }}>Certificate</span><b>{r.title}</b></div>
                <div style={row}><span style={{ color: '#475569' }}>Issued by</span><b>Career Lab Consulting Pvt. Ltd.</b></div>
                <div style={row}><span style={{ color: '#475569' }}>Issued to</span><b>{r.issuedTo}</b></div>
                <div style={row}><span style={{ color: '#475569' }}>Issue date</span><b>{day(r.issuedOn)}</b></div>
                {r.validUntil && <div style={row}><span style={{ color: '#475569' }}>Valid until</span><b>{day(r.validUntil)}</b></div>}
                <div style={row}><span style={{ color: '#475569' }}>Certificate ID</span><b>{r.certificateId}</b></div>
                <div style={{ fontSize: 12, marginTop: 10, color: '#475569' }}>Verified {day(r.checkedAt)} · verification request logged</div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
