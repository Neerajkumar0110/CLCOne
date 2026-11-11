import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Collapse, Input, Modal, Result, Spin, Tag, message } from 'antd';
import { MailOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import emailApi from './api';
import EmailDetail from './EmailDetail';
import ScheduleFields from './ScheduleFields';
import './emailCenter.css';

// Messenger › Email — the Email centre (admin only, backend /api/email-center).
// Every email the system sends, grouped: to whom, when, how many went out,
// the last real email, and an editor — a saved edit is what goes out next.
// Admins can also create their own emails on a date / daily / weekly /
// around enrolment or classes.

const STATUS_COLOR = { Default: 'default', Edited: 'blue', Off: 'red', Custom: 'purple', Locked: 'gold' };
const BLANK = {
  name: '',
  subject: '',
  html: '<div style="font:15px/1.6 Arial,sans-serif;color:#17202c;max-width:560px;margin:0 auto">\n  <p>Hi {{name}},</p>\n  <p>Write your message here.</p>\n  <p><a href="{{portalLink}}">Open your portal</a></p>\n</div>',
  schedule: { type: 'once' },
  audience: { type: 'all-learners' },
};

function Stat({ label, value, tone }) {
  return (
    <div className={`ec-stat ${tone || ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function NewEmail({ open, onClose, onCreated }) {
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF(BLANK);
  }, [open]);
  const create = async () => {
    setBusy(true);
    const r = await emailApi.create(f);
    setBusy(false);
    if (!r.success) return message.error(r.message);
    message.success('Email created — it goes out on its schedule.');
    return onCreated(r.result.key);
  };
  return (
    <Modal title="New email" open={open} onCancel={onClose} onOk={create} okText="Create" confirmLoading={busy} width={760} destroyOnClose>
      <div className="ec-fields">
        <label className="ec-field ec-span">
          <span>Name (only you see this)</span>
          <Input value={f.name} placeholder="e.g. Day-3 check-in" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
      </div>
      <ScheduleFields schedule={f.schedule} audience={f.audience} onChange={(x) => setF({ ...f, ...x })} />
      <div className="ec-fields">
        <label className="ec-field ec-span">
          <span>Subject</span>
          <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
        </label>
        <label className="ec-field ec-span">
          <span>Email body (HTML) — you can use {'{{name}} {{batch}} {{course}} {{portalLink}}'} and, for class emails, {'{{classTitle}} {{classTime}} {{joinLink}}'}</span>
          <Input.TextArea className="ec-code" autoSize={{ minRows: 8, maxRows: 18 }} value={f.html} onChange={(e) => setF({ ...f, html: e.target.value })} />
        </label>
      </div>
    </Modal>
  );
}

export default function EmailCenter() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState([]);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const r = await emailApi.list();
    if (!r.success) return setErr(r);
    setErr(null);
    setData(r.result);
    return null;
  };
  useEffect(() => {
    load();
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    const items = data.items.filter((i) => !term || `${i.name} ${i.to} ${i.when} ${i.group}`.toLowerCase().includes(term));
    const out = [];
    items.forEach((i) => {
      let g = out.find((x) => x.name === i.group);
      if (!g) out.push((g = { name: i.group, items: [] }));
      g.items.push(i);
    });
    return out;
  }, [data, q]);

  if (err && err.status === 403) return <Result status="403" title="Admins only" subTitle="Only an admin can see and edit the emails the system sends." />;
  if (err) return <Alert type="error" showIcon message={err.message} />;
  if (!data) return <div className="ec-loading"><Spin /></div>;

  const t = data.totals;
  return (
    <div className="ec-page">
      <div className="ec-stats">
        <Stat label="Sent today" value={t.today} />
        <Stat label="Last 7 days" value={t.week} />
        <Stat label="Last 30 days" value={t.month} />
        <Stat label="Failed (7 days)" value={t.failedWeek} tone={t.failedWeek ? 'bad' : ''} />
        <Stat label="Email types" value={data.items.length} />
      </div>
      {!data.mailReady && <Alert type="warning" showIcon message="Email is not configured on the server (GMAIL_USER / GMAIL_APP_PASSWORD) — nothing is being sent." />}

      <div className="ec-card">
        <div className="ec-toolbar">
          <div className="ec-title">
            <MailOutlined /> <b>All emails</b> <span className="ec-count">{data.items.length}</span>
          </div>
          <div className="ec-tools">
            <Input allowClear prefix={<SearchOutlined />} placeholder="Search emails…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
            <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>New email</Button>
          </div>
        </div>

        {groups.map((g) => (
          <div key={g.name} className="ec-group">
            <div className="ec-group-head">
              {g.name} <span className="ec-muted">· {g.items.length} email{g.items.length === 1 ? '' : 's'} · {g.items.reduce((s, i) => s + i.stats.week, 0)} sent this week</span>
            </div>
            <Collapse
              activeKey={open}
              onChange={(k) => setOpen(Array.isArray(k) ? k : [k])}
              items={g.items.map((i) => ({
                key: i.key,
                label: (
                  <div className="ec-row">
                    <div className="ec-row-main">
                      <b>{i.name}</b>
                      <span className="ec-muted">
                        To: {i.to} · {i.when}
                        {i.timing ? ` · ${i.timing.value} ${i.timing.label.toLowerCase()}` : ''}
                      </span>
                    </div>
                    <div className="ec-row-side">
                      <span className="ec-num" title="Sent in the last 7 days">{i.stats.week}<small>/7d</small></span>
                      {i.stats.failedWeek > 0 && <Tag color="red">{i.stats.failedWeek} failed</Tag>}
                      <Tag color={STATUS_COLOR[i.status]}>{i.status}</Tag>
                    </div>
                  </div>
                ),
                children: open.includes(i.key) ? (
                  <EmailDetail
                    itemKey={i.key}
                    onChanged={load}
                    onDeleted={() => {
                      setOpen(open.filter((x) => x !== i.key));
                      load();
                    }}
                  />
                ) : null,
              }))}
            />
          </div>
        ))}
        {groups.length === 0 && <div className="ec-empty">No email matches “{q}”.</div>}
        {t.other && t.other.month > 0 && <div className="ec-muted ec-gap">Plus {t.other.month} other email(s) in 30 days without a type (e.g. tests).</div>}
      </div>

      <NewEmail
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(key) => {
          setAdding(false);
          setOpen([...open, key]);
          load();
        }}
      />
    </div>
  );
}
