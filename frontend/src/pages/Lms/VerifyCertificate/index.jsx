import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE_URL } from '@/config/serverApiConfig';
import '../StudentDashboard/StudentHome.css';
import './verify.css';

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
  return (
    <div className="sh-root vf-root">
      <header className="vf-brand">Career Lab Consulting · Certificate verification</header>
      <main className="vf-main">
        <h1>Kya ye certificate asli hai?</h1>
        <p className="sh-sub">
          Certificate ID daalein ya certificate par bana QR scan karein. Login ki zaroorat nahi. Sirf zaroori jaankari dikhegi — marks, contact ya internal notes
          kabhi nahi.
        </p>
        <form className="vf-form" onSubmit={submit}>
          <label htmlFor="vf-id">Certificate ID</label>
          <div className="vf-row">
            <input id="vf-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="CLC-2026-XXXXXXXX" autoComplete="off" />
            <button type="submit" disabled={!id.trim() || state === 'loading'}>
              {state === 'loading' ? 'Checking…' : 'Verify'}
            </button>
          </div>
        </form>

        {state && state.error && (
          <section className="sh-card vf-result bad" role="status">
            <b>{state.error === 'notfound' ? 'No certificate found with this ID' : 'Could not check right now'}</b>
            <span className="sh-muted">
              {state.error === 'notfound' ? 'Check the ID for typos. If it was issued recently, try again later or contact Career Lab Consulting.' : state.message || 'Please try again in a moment.'}
            </span>
          </section>
        )}

        {r && (
          <section className={`sh-card vf-result ${r.valid ? 'ok' : 'bad'}`} role="status">
            <div className="vf-head">
              <span className="vf-ic" aria-hidden="true">
                {r.valid ? '✓' : '!'}
              </span>
              <span>
                <b>{r.valid ? 'Valid certificate' : 'This certificate has been revoked'}</b>
                <span className="sh-muted" style={{ display: 'block' }}>
                  {r.valid ? 'Issued by Career Lab Consulting and currently valid.' : 'It is no longer valid. Contact Career Lab Consulting for details.'}
                </span>
              </span>
            </div>
            <dl className="vf-facts">
              <dt>Certificate</dt>
              <dd>{r.title}</dd>
              <dt>Issued to</dt>
              <dd>{r.issuedTo}</dd>
              <dt>Issue date</dt>
              <dd>{day(r.issuedOn)}</dd>
              {r.validUntil && (
                <>
                  <dt>Valid until</dt>
                  <dd>{day(r.validUntil)}</dd>
                </>
              )}
              <dt>Certificate ID</dt>
              <dd>{r.certificateId}</dd>
            </dl>
            <span className="sh-muted">Verified {day(r.checkedAt)} · verification request logged</span>
          </section>
        )}
      </main>
    </div>
  );
}
