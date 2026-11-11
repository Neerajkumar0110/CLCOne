import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, InputNumber, Popconfirm, Segmented, Spin, Switch, Table, Tag, message } from 'antd';
import { SendOutlined, UndoOutlined, SaveOutlined, DeleteOutlined } from '@ant-design/icons';
import emailApi, { renderTemplate } from './api';
import ScheduleFields from './ScheduleFields';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

// Shown like a mail client: From / To / Subject, then the email itself.
// The iframe gets no scripts (sandbox without allow-scripts) — same-origin is
// only allowed so its height can follow the email's own length.
function Preview({ subject, html, to, images = {} }) {
  // inline (cid:) images that travel as attachments — shown here from the server
  const shown = Object.entries(images).reduce((h, [cid, src]) => h.split(cid).join(src), html || '');
  const ref = useRef(null);
  const fit = () => {
    try {
      const doc = ref.current && ref.current.contentDocument;
      if (doc && doc.body) ref.current.style.height = `${Math.min(Math.max(doc.documentElement.scrollHeight, 200), 2400)}px`;
    } catch (e) {
      /* keep the default height */
    }
  };
  return (
    <div className="ec-preview">
      <div className="ec-preview-subject">
        <div className="ec-mail-subject">{subject || '—'}</div>
        <div className="ec-mail-meta">
          <b>Career Lab Consulting</b> &lt;info@careerlabconsulting.com&gt;
          <br />
          to {to || 'the recipient'}
        </div>
      </div>
      <iframe ref={ref} title="Email preview" sandbox="allow-same-origin" onLoad={fit} srcDoc={shown || '<p style="font-family:sans-serif;color:#888">Nothing to show yet.</p>'} />
    </div>
  );
}

// One email inside the accordion: how it goes out, a preview, the editor,
// and the last sends. Loads its own detail when it is opened.
export default function EmailDetail({ itemKey, onChanged, onDeleted }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState('preview');
  const [which, setWhich] = useState('design');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);

  const load = async () => {
    const r = await emailApi.item(itemKey);
    if (!r.success) return setErr(r.message);
    setD(r.result);
    setDraft({ subject: r.result.subject || '', html: r.result.html || '', enabled: r.result.enabled, timingValue: r.result.timing ? r.result.timing.value : null, name: r.result.name, schedule: r.result.schedule, audience: r.result.audience });
    return null;
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  const live = useMemo(() => (d && draft ? { subject: renderTemplate(draft.subject, d.sampleVars), html: renderTemplate(draft.html, d.sampleVars) } : null), [d, draft]);

  if (err) return <Alert type="error" showIcon message={err} />;
  if (!d || !draft) return <div className="ec-loading"><Spin /></div>;

  const custom = d.kind === 'custom';
  const dirty = draft.subject !== (d.subject || '') || draft.html !== (d.html || '') || draft.enabled !== d.enabled || (d.timing && draft.timingValue !== d.timing.value) || (custom && (draft.name !== d.name || JSON.stringify(draft.schedule) !== JSON.stringify(d.schedule) || JSON.stringify(draft.audience) !== JSON.stringify(d.audience)));

  const insertVar = (v) => {
    const el = bodyRef.current && bodyRef.current.resizableTextArea && bodyRef.current.resizableTextArea.textArea;
    const token = `{{${v}}}`;
    if (!el) return setDraft({ ...draft, html: draft.html + token });
    const { selectionStart: a, selectionEnd: b } = el;
    setDraft({ ...draft, html: draft.html.slice(0, a) + token + draft.html.slice(b) });
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    }, 0);
    return null;
  };

  const save = async () => {
    setBusy(true);
    const body = { enabled: draft.enabled };
    const textChanged = draft.subject !== (d.subject || '') || draft.html !== (d.html || '');
    if (textChanged || custom) Object.assign(body, { subject: draft.subject, html: draft.html });
    if (d.timing) body.timingValue = draft.timingValue;
    if (custom) Object.assign(body, { name: draft.name, schedule: draft.schedule, audience: draft.audience });
    const r = await emailApi.save(itemKey, body);
    setBusy(false);
    if (!r.success) return message.error(r.message);
    message.success(textChanged && !custom ? 'Saved — the next email goes out with this text.' : 'Saved.');
    setD(r.result);
    onChanged && onChanged();
    return null;
  };
  const reset = async () => {
    const r = await emailApi.reset(itemKey);
    if (!r.success) return message.error(r.message);
    message.success('Back to the system’s own email.');
    await load();
    onChanged && onChanged();
    return null;
  };
  const test = async () => {
    const r = await emailApi.test(itemKey, { subject: draft.subject, html: draft.html });
    if (!r.success) return message.error(r.message);
    return message.success(r.message);
  };
  const remove = async () => {
    const r = await emailApi.remove(itemKey);
    if (!r.success) return message.error(r.message);
    message.success('Deleted.');
    return onDeleted && onDeleted();
  };

  const views = [
    { value: 'preview', label: 'Email (as received)' },
    { value: 'how', label: 'How & when it goes' },
    ...(d.locked ? [] : [{ value: 'edit', label: 'Edit template' }]),
    { value: 'log', label: `Sent (${d.recent.length})` },
  ];

  return (
    <div className="ec-detail">
      <Segmented value={view} onChange={setView} options={views} />

      {view === 'how' && (
        <div className="ec-how">
          <dl>
            <dt>Goes to</dt>
            <dd>{d.to}</dd>
            <dt>When</dt>
            <dd>{d.when}</dd>
            {d.timing && (
              <>
                <dt>{d.timing.label}</dt>
                <dd>
                  <InputNumber min={d.timing.min} max={d.timing.max} value={draft.timingValue} disabled={d.locked} onChange={(v) => setDraft({ ...draft, timingValue: v })} />{' '}
                  <span className="ec-muted">default {d.timing.default}</span>
                </dd>
              </>
            )}
            <dt>Status</dt>
            <dd>
              <Switch checked={draft.enabled} disabled={d.locked} onChange={(v) => setDraft({ ...draft, enabled: v })} /> <span className="ec-muted">{draft.enabled ? 'Sending' : 'Switched off — this email is not sent'}</span>
              {d.locked && <div className="ec-muted">Login codes always go out — they cannot be edited or switched off.</div>}
            </dd>
            <dt>Template</dt>
            <dd>{d.override ? <Tag color="blue">Edited{d.updatedByName ? ` by ${d.updatedByName}` : ''}</Tag> : custom ? <Tag color="purple">Custom</Tag> : <Tag>System default</Tag>}</dd>
            <dt>Variables</dt>
            <dd className="ec-vars">{d.vars.map((v) => <code key={v}>{`{{${v}}}`}</code>)}</dd>
            {d.lastRunAt && (
              <>
                <dt>Last run</dt>
                <dd>{fmt(d.lastRunAt)}</dd>
              </>
            )}
          </dl>
          {custom && <ScheduleFields schedule={draft.schedule} audience={draft.audience} onChange={(x) => setDraft({ ...draft, ...x })} />}
          {d.versions.length > 0 && (
            <div className="ec-versions">
              <b>History</b>
              {d.versions.map((v, i) => (
                <div key={i} className="ec-muted">{fmt(v.at)} · {v.byName} · {v.note}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'preview' && (
        <>
          {d.sample && (
            <Segmented
              size="small"
              value={which}
              onChange={setWhich}
              options={[
                { value: 'design', label: d.override || custom ? 'What goes now' : 'The email' },
                { value: 'last', label: `Last one sent (${fmt(d.sample.at)})` },
              ]}
            />
          )}
          <div className="ec-muted ec-gap">
            {which === 'last' && d.sample
              ? `Exactly as it went to ${d.sample.to} on ${fmt(d.sample.at)}.`
              : d.override || custom
                ? 'Your saved version, filled with sample values — this is what goes out next.'
                : 'The email exactly as the system sends it, filled with sample values (names, dates and amounts change per person).'}
          </div>
          {which === 'last' && d.sample ? (
            <Preview subject={d.sample.subject} html={d.sample.html} to={d.sample.to} images={d.images} />
          ) : d.override || custom || !d.example ? (
            <Preview subject={renderTemplate(d.subject, d.sampleVars)} html={renderTemplate(d.html, d.sampleVars)} to={d.to} images={d.images} />
          ) : (
            <Preview subject={d.example.subject} html={d.example.html} to={d.to} images={d.images} />
          )}
        </>
      )}

      {view === 'edit' && !d.locked && (
        <div className="ec-edit">
          {!custom && !d.override && <Alert type="info" showIcon message="This is the system’s full email. Change any text, colour or button, keep the {{…}} placeholders where the person’s details go, and Save — the next email goes out like this." />}
          {d.dataBody && <Alert type="warning" showIcon message={`The table in this email is built from live data each time and sits in {{${d.dataBody}}}. You can change the subject and add or change text around it.`} />}
          {custom && (
            <label className="ec-field">
              <span>Name (only you see this)</span>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
          )}
          <label className="ec-field">
            <span>Subject</span>
            <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </label>
          <div className="ec-vars">
            <span className="ec-muted">Insert:</span>
            {d.vars.map((v) => (
              <button type="button" key={v} className="ec-chip" onClick={() => insertVar(v)}>{`{{${v}}}`}</button>
            ))}
          </div>
          <div className="ec-split">
            <label className="ec-field">
              <span>Email body (HTML)</span>
              <Input.TextArea ref={bodyRef} className="ec-code" value={draft.html} onChange={(e) => setDraft({ ...draft, html: e.target.value })} autoSize={{ minRows: 16, maxRows: 30 }} />
            </label>
            <div>
              <div className="ec-muted ec-gap">Live preview with sample values</div>
              <Preview subject={live.subject} html={live.html} images={d.images} />
            </div>
          </div>
        </div>
      )}

      {view === 'log' && (
        <Table
          size="small"
          rowKey={(r) => r._id}
          dataSource={d.recent}
          pagination={false}
          locale={{ emptyText: 'Nothing sent yet.' }}
          columns={[
            { title: 'Sent', dataIndex: 'sentAt', render: fmt, width: 170 },
            { title: 'To', dataIndex: 'recipient' },
            { title: 'Subject', dataIndex: 'subject', ellipsis: true },
            { title: 'Status', dataIndex: 'status', width: 110, render: (s, r) => (s === 'sent' ? <Tag color="green">Sent</Tag> : <Tag color="red" title={r.error}>Failed</Tag>) },
          ]}
        />
      )}

      {!d.locked && (
        <div className="ec-actions">
          {custom && (
            <Popconfirm title="Delete this email? It stops being sent." onConfirm={remove}>
              <Button danger icon={<DeleteOutlined />}>Delete</Button>
            </Popconfirm>
          )}
          {d.override && (
            <Popconfirm title="Go back to the system’s own email?" onConfirm={reset}>
              <Button icon={<UndoOutlined />}>Reset to default</Button>
            </Popconfirm>
          )}
          <Button icon={<SendOutlined />} onClick={test} disabled={!draft.subject || !draft.html}>Send test to me</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={busy} disabled={!dirty} onClick={save}>Save</Button>
        </div>
      )}
    </div>
  );
}
