import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Button, Checkbox, Skeleton, message } from 'antd';
import { FileProtectOutlined, LockOutlined, CheckCircleOutlined, LogoutOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import lmsApi from '../api';
import './policyConsent.css';

// 2026-11-27 — the learner's policy consent, as a blocking modal over the
// whole LMS. Opens when a mandatory policy is pending: on login (new
// learner), the moment Admin / Support publishes one (socket → panel
// re-poll) or whenever the LMS is opened. Nothing behind it can be used
// until each pending policy is read and agreed — one at a time, each with
// its own version / time / IP record (POST /policies/:id/acknowledge).
// An uploaded PDF shows as text when the server could read it (fileText),
// else the PDF itself is shown inside the modal.
// Learners read the policy as text only — an uploaded PDF reaches them as
// the text read from it (filled into "Policy text" at upload, or fileText).
export function PolicyBody({ p, tall }) {
  const text = [p.content, p.fileText].filter((x) => x && String(x).trim()).join('\n\n');
  return (
    <div className="pcm-doc">
      <div className={`pcm-text${tall ? ' tall' : ''}`}>{text || 'The text of this policy is being prepared — please contact Support if it stays empty.'}</div>
    </div>
  );
}

export default function PolicyConsentModal({ open, onDone, onLogout, learnerName }) {
  const [rows, setRows] = useState(null);
  const [idx, setIdx] = useState(0);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    lmsApi
      .myPolicies()
      .then((r) => {
        const all = (r && r.result) || [];
        // mandatory first, then optional ones still pending
        const pend = all.filter((x) => x.status === 'pending').sort((a, b) => (b.mandatory !== false) - (a.mandatory !== false));
        setRows(pend);
        setIdx(0);
        setAgree(false);
      })
      .catch(() => setRows([]));
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const cur = rows && rows[Math.min(idx, rows.length - 1)];
  useEffect(() => {
    if (cur && !cur.openedAt) lmsApi.markPolicyOpened(cur.policyId).catch(() => {});
  }, [cur]);

  const accept = async () => {
    if (!cur) return;
    setBusy(true);
    const res = await lmsApi.acknowledgePolicy(cur.policyId).catch(() => null);
    setBusy(false);
    if (!res || res.success === false) {
      message.error((res && res.message) || 'Could not save your acceptance — please try again.');
      return;
    }
    const left = rows.filter((x) => x.id !== cur.id);
    setAgree(false);
    if (!left.some((x) => x.mandatory !== false)) {
      message.success('Thank you — your LMS is unlocked.');
      setRows(left);
      onDone();
      return;
    }
    message.success(`Accepted “${cur.title}”.`);
    setRows(left);
    setIdx(0);
  };

  const total = rows ? rows.length : 0;
  return (
    <Modal open={open} closable={false} maskClosable={false} keyboard={false} footer={null} width={860} centered rootClassName="pcm-root" zIndex={2000}>
      <div className="pcm">
        <div className="pcm-head">
          <span className="pcm-ic"><FileProtectOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="pcm-kicker"><LockOutlined /> Action needed{learnerName ? ` · ${learnerName}` : ''}</span>
            <h3>{cur ? cur.title : 'Policies to accept'}</h3>
            <span className="pcm-sub">Read and accept to continue — the LMS stays locked until you agree.</span>
          </div>
          {total > 1 && <span className="pcm-count">{Math.min(idx, total - 1) + 1} / {total}</span>}
        </div>

        {total > 1 && (
          <div className="pcm-steps">
            {rows.map((r, i) => (
              <span key={r.id} className={`pcm-step${i === idx ? ' on' : ''}`} title={r.title}>{i + 1}. {r.title}</span>
            ))}
          </div>
        )}

        <div className="pcm-body">
          {rows === null ? <Skeleton active paragraph={{ rows: 6 }} /> : !cur ? (
            <div className="pcm-done"><CheckCircleOutlined /> All policies accepted.</div>
          ) : (
            <>
              <div className="pcm-meta">
                <span className="pcm-chip v">v{cur.version}</span>
                {cur.category && <span className="pcm-chip">{cur.category}</span>}
                <span className={`pcm-chip ${cur.mandatory === false ? '' : 'req'}`}>{cur.mandatory === false ? 'Optional' : 'Mandatory'}</span>
                {cur.effectiveDate && <span className="pcm-chip">Effective {dayjs(cur.effectiveDate).format('D MMM YYYY')}</span>}
              </div>
              <PolicyBody p={cur} />
            </>
          )}
        </div>

        {cur && (
          <div className="pcm-foot">
            <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)}>
              I have read <b>{cur.title}</b> (v{cur.version}) and I agree to follow it.
            </Checkbox>
            <div className="pcm-foot-r">
              <Button type="text" icon={<LogoutOutlined />} onClick={onLogout}>Logout</Button>
              <Button type="primary" size="large" icon={<CheckCircleOutlined />} disabled={!agree} loading={busy} onClick={accept} className="pcm-agree">
                I agree{total > 1 ? ' & next' : ''}
              </Button>
            </div>
          </div>
        )}
        <div className="pcm-note">Saved with your acceptance: learner ID, policy version, date &amp; time (IST) and device — you can re-read every policy any time under <b>My Policies</b>.</div>
      </div>
    </Modal>
  );
}
