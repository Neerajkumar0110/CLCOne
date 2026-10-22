const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// PDF for Advanced Reporting → User Activity (data from userActivity.js).
// pdfkit draws everything directly (no headless browser on the VPS): a
// branded header, KPI cards, bar charts, and tables that page-break with
// their header row repeated. Noto Sans (installed on the VPS) carries ₹ and
// Indian names; Helvetica is the fallback anywhere it's missing.

const BRAND = '#2f5fd0';
const INK = '#17202c';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const SOFT = '#f5f7fb';
const GREEN = '#16a34a';
const AMBER = '#d97706';
const RED = '#dc2626';

const FONT_DIRS = ['/usr/share/fonts/truetype/noto', path.join(__dirname, 'fonts')];
function findFont(file) {
  for (const d of FONT_DIRS) {
    const p = path.join(d, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const REG = findFont('NotoSans-Regular.ttf');
const BOLD = findFont('NotoSans-Bold.ttf');
const DEVA = findFont('NotoSansDevanagari-Regular.ttf');
let LOGO = null;
try {
  LOGO = fs.readFileSync(path.join(__dirname, '..', 'lms', 'assets', 'clc-logo.png'));
} catch (e) {
  LOGO = null;
}

// ── formatting ───────────────────────────────────────────────────────────
const IST = 330 * 60000;
const ist = (d) => new Date(new Date(d).getTime() + IST);
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => (d ? `${pad(ist(d).getUTCHours())}:${pad(ist(d).getUTCMinutes())}` : '—');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (k) => {
  const d = new Date(`${k}T12:00:00+05:30`);
  return `${pad(ist(d).getUTCDate())} ${MON[ist(d).getUTCMonth()]} ${ist(d).getUTCFullYear()}`;
};
const fmtDT = (d) => (d ? `${fmtDay(ist(d).toISOString().slice(0, 10))}, ${fmtTime(d)}` : '—');
const fmtDur = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(s % 60)}s`;
  return `${s}s`;
};
const fmtMin = (m) => fmtDur((m || 0) * 60);
const money = (n) => `${REG ? '₹' : 'Rs.'}${Number(n || 0).toLocaleString('en-IN')}`;
// Stylised Unicode (𝙈𝙖…) → plain letters; drop what no font can draw.
const clean = (s) =>
  String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[ㅤᅟᅠ​-‍﻿]/g, '')
    .replace(REG ? /[^\u0000-ɏऀ-ॿ -⃏←-⇿•…]/g : /[^\u0000-ÿ]/g, '')
    .trim();

class Report {
  constructor(title, subtitle) {
    this.doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: title, Author: 'Career Lab Consulting CRM' } });
    if (REG) this.doc.registerFont('reg', REG);
    if (BOLD) this.doc.registerFont('bold', BOLD);
    if (DEVA) this.doc.registerFont('deva', DEVA);
    this.title = title;
    this.subtitle = subtitle;
    this.left = 40;
    this.right = this.doc.page.width - 40;
    this.width = this.right - this.left;
    this.header(true);
  }
  font(bold) {
    if (bold) this.doc.font(BOLD ? 'bold' : 'Helvetica-Bold');
    else this.doc.font(REG ? 'reg' : 'Helvetica');
    return this.doc;
  }
  // Text with a Devanagari switch for Hindi strings.
  text(s, x, y, opts = {}, bold = false) {
    const str = clean(s);
    if (DEVA && /[ऀ-ॿ]/.test(str)) this.doc.font('deva');
    else this.font(bold);
    this.doc.text(str, x, y, opts);
  }
  header(first) {
    const d = this.doc;
    d.rect(0, 0, d.page.width, first ? 92 : 46).fill(first ? INK : SOFT);
    if (first) {
      if (LOGO) {
        try {
          d.image(LOGO, this.left, 26, { height: 34 });
        } catch (e) {
          /* bad logo file — skip it */
        }
      }
      d.fillColor('#ffffff');
      this.font(true).fontSize(17).text(this.title, this.left + 150, 26, { width: this.width - 150, align: 'right' });
      this.font().fontSize(9.5).fillColor('#cbd5e1').text(this.subtitle, this.left + 150, 50, { width: this.width - 150, align: 'right' });
      d.y = 112;
    } else {
      d.fillColor(MUTED);
      this.font(true).fontSize(9).text(this.title, this.left, 18, { width: this.width / 2 });
      this.font().fontSize(8.5).text(this.subtitle, this.left + this.width / 2, 18, { width: this.width / 2, align: 'right' });
      d.y = 64;
    }
    d.fillColor(INK);
  }
  ensure(h) {
    if (this.doc.y + h > this.doc.page.height - 56) {
      this.doc.addPage();
      this.header(false);
      return true;
    }
    return false;
  }
  section(title, note, keep = 60) {
    this.ensure(keep);
    const d = this.doc;
    d.moveDown(0.6);
    const y = d.y;
    d.rect(this.left, y + 2, 4, 14).fill(BRAND);
    d.fillColor(INK);
    this.font(true).fontSize(12.5).text(title, this.left + 12, y, { width: this.width - 12 });
    if (note) {
      d.fillColor(MUTED);
      this.font().fontSize(8.5).text(note, this.left + 12, d.y + 1, { width: this.width - 12 });
    }
    d.fillColor(INK);
    d.y += 8;
  }
  // Grid of KPI cards: [[label, value, hint?, color?]]
  kpis(items, cols = 4) {
    const d = this.doc;
    const gap = 8;
    const w = (this.width - gap * (cols - 1)) / cols;
    const h = 52;
    for (let i = 0; i < items.length; i += cols) {
      this.ensure(h + gap);
      const y = d.y;
      items.slice(i, i + cols).forEach(([label, value, hint, color], j) => {
        const x = this.left + j * (w + gap);
        d.roundedRect(x, y, w, h, 6).fillAndStroke(SOFT, LINE);
        d.fillColor(MUTED);
        this.font(true).fontSize(7.5).text(String(label).toUpperCase(), x + 9, y + 8, { width: w - 18, characterSpacing: 0.3 });
        d.fillColor(color || INK);
        this.font(true).fontSize(15).text(String(value), x + 9, y + 20, { width: w - 18 });
        if (hint) {
          d.fillColor(MUTED);
          this.font().fontSize(7.5).text(String(hint), x + 9, y + 39, { width: w - 18 });
        }
      });
      d.y = y + h + gap;
    }
    d.fillColor(INK);
  }
  // Vertical bars: [{label, a, b?}] — a = main (brand), b = overlay (green)
  bars(data, { height = 120, legend } = {}) {
    if (!data.length) return;
    const d = this.doc;
    this.ensure(height + 46);
    const top = d.y + 6;
    const max = Math.max(1, ...data.map((x) => x.a));
    const n = data.length;
    const slot = this.width / n;
    const bw = Math.max(2, Math.min(26, slot * 0.62));
    d.moveTo(this.left, top + height).lineTo(this.right, top + height).lineWidth(0.6).stroke(LINE);
    data.forEach((x, i) => {
      const cx = this.left + i * slot + slot / 2;
      const ha = (x.a / max) * height;
      if (ha) d.rect(cx - bw / 2, top + height - ha, bw, ha).fill(BRAND);
      if (x.b) {
        const hb = (x.b / max) * height;
        d.rect(cx - bw / 2, top + height - hb, bw, hb).fill(GREEN);
      }
      if (x.a && n <= 31) {
        d.fillColor(INK);
        this.font().fontSize(6.5).text(String(x.a), cx - 15, top + height - ha - 9, { width: 30, align: 'center' });
      }
      const every = Math.ceil(n / 16);
      if (i % every === 0) {
        d.fillColor(MUTED);
        this.font().fontSize(6.5).text(x.label, cx - 22, top + height + 4, { width: 44, align: 'center' });
      }
    });
    d.y = top + height + 18;
    if (legend) {
      d.fillColor(MUTED);
      this.font().fontSize(7.5).text(legend, this.left, d.y, { width: this.width });
    }
    d.fillColor(INK);
    d.y += 6;
  }
  // Horizontal bars: [[label, value, color?]]
  hbars(rows) {
    const d = this.doc;
    const max = Math.max(1, ...rows.map((r) => r[1]));
    const labelW = 150;
    const barW = this.width - labelW - 50;
    for (const [label, value, color] of rows) {
      this.ensure(16);
      const y = d.y;
      d.fillColor(INK);
      this.font().fontSize(8.5);
      d.fontSize(8.5);
      this.text(label, this.left, y + 1, { width: labelW - 8, lineBreak: false, ellipsis: true });
      d.roundedRect(this.left + labelW, y + 2, barW, 9, 3).fill(SOFT);
      const w = Math.max(2, (value / max) * barW);
      d.roundedRect(this.left + labelW, y + 2, w, 9, 3).fill(color || BRAND);
      d.fillColor(INK);
      this.font(true).fontSize(8.5).text(String(value), this.left + labelW + barW + 6, y + 1, { width: 44 });
      d.y = y + 15;
    }
    d.y += 4;
  }
  // Table with repeated header row on page breaks.
  table(cols, rows, { fontSize = 8, zebra = true, empty = 'Nothing in this range.' } = {}) {
    const d = this.doc;
    const total = cols.reduce((a, c) => a + c.w, 0);
    const scale = this.width / total;
    const ws = cols.map((c) => c.w * scale);
    const head = () => {
      const y = d.y;
      d.rect(this.left, y, this.width, 18).fill(INK);
      let x = this.left;
      cols.forEach((c, i) => {
        d.fillColor('#ffffff');
        this.font(true).fontSize(7.5).text(c.label.toUpperCase(), x + 5, y + 5, { width: ws[i] - 10, align: c.align || 'left', lineBreak: false });
        x += ws[i];
      });
      d.y = y + 18;
      d.fillColor(INK);
    };
    this.ensure(40);
    head();
    if (!rows.length) {
      d.fillColor(MUTED);
      this.font().fontSize(8.5).text(empty, this.left + 6, d.y + 6, { width: this.width - 12 });
      d.fillColor(INK);
      d.y += 12;
      return;
    }
    rows.forEach((r, ri) => {
      this.font().fontSize(fontSize);
      const heights = cols.map((c, i) => d.heightOfString(clean(r[i]) || '—', { width: ws[i] - 10 }));
      const h = Math.max(15, Math.max(...heights) + 7);
      if (this.ensure(h)) head();
      const y = d.y;
      if (zebra && ri % 2) d.rect(this.left, y, this.width, h).fill(SOFT);
      let x = this.left;
      cols.forEach((c, i) => {
        d.fillColor(c.color ? c.color(r[i], r) || INK : INK);
        this.text(r[i] == null || r[i] === '' ? '—' : r[i], x + 5, y + 4, { width: ws[i] - 10, align: c.align || 'left' }, !!c.bold);
        x += ws[i];
      });
      d.moveTo(this.left, y + h).lineTo(this.right, y + h).lineWidth(0.4).stroke(LINE);
      d.y = y + h;
    });
    d.fillColor(INK);
    d.y += 6;
  }
  keyValues(pairs, cols = 2) {
    const d = this.doc;
    const w = this.width / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      this.ensure(30);
      const y = d.y;
      let maxH = 0;
      pairs.slice(i, i + cols).forEach(([k, v], j) => {
        const x = this.left + j * w;
        d.fillColor(MUTED);
        this.font(true).fontSize(7.5).text(String(k).toUpperCase(), x, y, { width: w - 12 });
        d.fillColor(INK);
        this.text(v == null || v === '' ? '—' : v, x, y + 10, { width: w - 12 }, true);
        maxH = Math.max(maxH, d.y - y);
      });
      d.y = y + Math.max(maxH, 24) + 4;
    }
  }
  finish() {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      d.switchToPage(i);
      // Writing below the bottom margin makes pdfkit add a page — the
      // footer lives there, so lift the margin while drawing it.
      d.page.margins.bottom = 0;
      const y = d.page.height - 30;
      d.moveTo(this.left, y - 6).lineTo(this.right, y - 6).lineWidth(0.5).stroke(LINE);
      d.fillColor(MUTED);
      this.font().fontSize(7.5).text('Career Lab Consulting · Confidential — internal use only', this.left, y, { width: this.width / 2, lineBreak: false });
      this.font().fontSize(7.5).text(`Page ${i + 1} of ${range.count}`, this.left + this.width / 2, y, { width: this.width / 2, align: 'right', lineBreak: false });
    }
    d.end();
    return d;
  }
}

const OUTCOME_COLOR = (v) => (v === 'Connected' ? GREEN : v === 'Missed by agent' ? RED : v === 'Not picked up' ? AMBER : null);

// ── one user ─────────────────────────────────────────────────────────────
function renderUser(R, data, { compact = false } = {}) {
  const p = data.profile;
  const s = data.summary;
  R.section(compact ? p.name : 'Profile & access', compact ? `${p.role} · ${p.email}` : null);
  if (!compact) {
    R.keyValues([
      ['Name', p.name],
      ['Role', p.subRole ? `${p.role} · ${p.subRole}` : p.role],
      ['Email', p.email],
      ['Phone', p.phone],
      ['Team', p.team ? `${p.team}${p.teamLead ? ` (lead: ${p.teamLead})` : ''}` : null],
      ['Reports to', p.manager],
      ['Business', p.business],
      ['Account', p.deleted ? 'Deleted' : p.enabled ? 'Active — can log in' : 'Deactivated'],
      ['Joined', fmtDT(p.joined)],
      ['Last seen', fmtDT(p.lastSeenAt)],
    ]);
  }

  R.section('At a glance', `${fmtDay(data.range.from)} – ${fmtDay(data.range.to)}`);
  R.kpis([
    ['CRM open time', fmtDur(s.onlineSeconds), `${s.sessions} sittings`],
    ['Lead pool time', fmtMin(s.poolMinutes), `${s.poolOns} ON · ${s.poolOffs} OFF`],
    ['Calls', s.calls, `${s.connectRate}% connected`],
    ['Connected', s.connected, `${s.notPicked} not picked · ${s.missed} missed`, GREEN],
    ['Talk time', fmtDur(s.talkSeconds), `avg ${fmtDur(s.avgTalk)} · longest ${fmtDur(s.longestCall)}`],
    ['Missed by agent', s.missed, 'routed, not picked up', s.missed ? RED : null],
    ['Stage moves', s.stageMoves, 'leads moved in the pipeline'],
    ['Demos', s.demosBooked, `${s.demosAttended} attended`],
    ['Payments paid', s.paidCount, money(s.paidAmount)],
    ['Callbacks', data.callbacks.total, Object.entries(data.callbacks.byStatus).map(([k, v]) => `${v} ${k}`).join(' · ') || '—'],
    ['Finance KYC', data.finance.created, `${data.finance.submitted} submitted`],
    ['Tickets raised', data.tickets.raised, `${data.tickets.open} open`],
  ]);

  if (s.calls) {
    R.section('Calls per day', 'Blue = all calls · green = connected', 200);
    R.bars(data.timeline.map((t) => ({ label: fmtDay(t.day).slice(0, 6), a: t.calls, b: t.connected })));
    if (!compact) {
      R.section('Calls by hour of day (IST)', null, 170);
      R.bars(data.calls.byHour.map((n, h) => ({ label: `${pad(h)}:00`, a: n })), { height: 90 });
    }
    R.section('Responses saved (disposition)', null, 120);
    R.hbars(data.calls.byDisposition.slice(0, 14).map((x) => [x.disposition, x.count, x.disposition === 'No disposition' ? AMBER : BRAND]));
    R.section('Where the calls came from');
    R.hbars(Object.entries(data.calls.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]));
  }

  R.section('Day by day');
  R.table(
    [
      { label: 'Date', w: 80, bold: true },
      { label: 'First in', w: 48, align: 'center' },
      { label: 'Last out', w: 48, align: 'center' },
      { label: 'CRM open', w: 58, align: 'right' },
      { label: 'Pool', w: 50, align: 'right' },
      { label: 'Calls', w: 40, align: 'right' },
      { label: 'Conn.', w: 40, align: 'right' },
      { label: 'Talk', w: 56, align: 'right' },
      { label: 'Moves', w: 42, align: 'right' },
    ],
    data.timeline.map((t) => [
      fmtDay(t.day),
      t.firstLogin ? fmtTime(t.firstLogin) : '—',
      t.lastLogout ? fmtTime(t.lastLogout) : '—',
      t.onlineSeconds ? fmtDur(t.onlineSeconds) : '—',
      t.poolMinutes ? fmtMin(t.poolMinutes) : '—',
      t.calls || '—',
      t.connected || '—',
      t.talkSeconds ? fmtDur(t.talkSeconds) : '—',
      t.stageMoves || '—',
    ])
  );

  if (!compact) {
    R.section('Access in the CRM', data.access ? 'What this account can open, change and delete.' : `No custom permissions — the ${p.role} defaults apply.`);
    if (data.access) {
      R.table(
        [
          { label: 'Module', w: 220, bold: true },
          { label: 'View', w: 60, align: 'center' },
          { label: 'Edit', w: 60, align: 'center' },
          { label: 'Delete', w: 60, align: 'center' },
        ],
        data.access.map((a) => [a.module, a.view ? 'Yes' : '—', a.edit ? 'Yes' : '—', a.delete ? 'Yes' : '—'])
      );
    }
  }

  R.section(`Every call (${data.calls.list.length}${data.calls.list.length >= 500 ? ', latest 500' : ''})`);
  R.table(
    [
      { label: 'When', w: 78 },
      { label: 'Contact', w: 100 },
      { label: 'Type', w: 58 },
      { label: 'Outcome', w: 66, color: OUTCOME_COLOR },
      { label: 'Talk', w: 40, align: 'right' },
      { label: 'Response / notes', w: 160 },
    ],
    (compact ? data.calls.list.slice(0, 150) : data.calls.list).map((c) => [
      fmtDT(c.at),
      `${c.name || '—'}\n${c.phone || ''}`,
      c.type,
      c.outcome,
      c.durationSec ? fmtDur(c.durationSec) : '—',
      [c.disposition, c.notes].filter(Boolean).join(' — '),
    ]),
    { fontSize: 7.5 }
  );

  if (data.stageMoves.length) {
    R.section(`Pipeline moves (${data.stageMoves.length})`);
    R.table(
      [
        { label: 'When', w: 80 },
        { label: 'Lead', w: 110 },
        { label: 'From', w: 90 },
        { label: 'To', w: 130, bold: true },
        { label: 'Remarks', w: 110 },
      ],
      (compact ? data.stageMoves.slice(0, 80) : data.stageMoves).map((m) => [
        fmtDT(m.at),
        `${m.name || '—'}\n${m.phone || ''}`,
        m.from,
        m.sub ? `${m.to} / ${m.sub}` : m.to,
        m.remarks,
      ]),
      { fontSize: 7.5 }
    );
  }

  if (data.payments.list.length) {
    R.section('Payment links raised');
    R.table(
      [
        { label: 'When', w: 90 },
        { label: 'Candidate', w: 130 },
        { label: 'Internship', w: 150 },
        { label: 'Amount', w: 70, align: 'right' },
        { label: 'Status', w: 60, color: (v) => (v === 'paid' ? GREEN : null) },
      ],
      data.payments.list.map((x) => [fmtDT(x.at), x.name, x.course, money(x.amount), x.status])
    );
  }

  const presence = data.events.filter((e) => e.kind !== 'call' && e.kind !== 'stage');
  if (!compact && presence.length) {
    R.section('Presence timeline', 'Every sitting in the CRM, lead-pool ON/OFF and break, in order (calls and pipeline moves are listed above).');
    R.table(
      [
        { label: 'When', w: 90 },
        { label: 'What', w: 60 },
        { label: 'Detail', w: 370 },
      ],
      presence.map((e) => [
        fmtDT(e.at),
        { login: 'Login', logout: 'Logout', pool_on: 'Pool ON', pool_off: 'Pool OFF', break_start: 'Break', break_end: 'Break end', call: 'Call', stage: 'Stage' }[e.kind] || e.kind,
        e.text,
      ]),
      { fontSize: 7.5 }
    );
  }
  const tracked = new Date(data.activityTrackedFrom);
  if (new Date(`${data.range.from}T00:00:00+05:30`) < tracked) {
    R.doc.moveDown(0.5);
    R.doc.fillColor(MUTED);
    R.font().fontSize(7.5).text(`Lead-pool ON/OFF and breaks are recorded from ${fmtDay(tracked.toISOString().slice(0, 10))}; earlier days show no pool time.`, R.left, R.doc.y, { width: R.width });
    R.doc.fillColor(INK);
  }
}

function renderUserPdf(data) {
  const R = new Report(`${clean(data.profile.name)} — Activity Report`, `${fmtDay(data.range.from)} – ${fmtDay(data.range.to)} · generated ${fmtDT(data.generatedAt)}`);
  renderUser(R, data);
  return R.finish();
}

// ── everyone ─────────────────────────────────────────────────────────────
function renderAllPdf(all, details = []) {
  const R = new Report('Team Activity Report', `${fmtDay(all.range.from)} – ${fmtDay(all.range.to)} · generated ${fmtDT(all.generatedAt)}`);
  const t = all.totals;
  R.section('Team at a glance', `${t.activeUsers} of ${t.users} users active in this range`);
  R.kpis([
    ['CRM open time', fmtDur(t.onlineSeconds), `${t.sessions} sittings`],
    ['Lead pool time', fmtMin(t.poolMinutes), `${t.poolOns} times ON`],
    ['Calls', t.calls, `${t.connectRate}% connected`],
    ['Connected', t.connected, `${t.missed} missed by agents`, GREEN],
    ['Talk time', fmtDur(t.talkSeconds)],
    ['Stage moves', t.stageMoves],
    ['Demos booked', t.demosBooked],
    ['Payments paid', t.paidCount, money(t.paidAmount)],
  ]);
  if (t.calls) {
    R.section('Team calls per day', 'Blue = all calls · green = connected', 200);
    R.bars(all.daily.map((d) => ({ label: fmtDay(d.day).slice(0, 6), a: d.calls, b: d.connected })));
  }
  R.section('Every user');
  R.table(
    [
      { label: 'User', w: 120, bold: true },
      { label: 'Role', w: 80 },
      { label: 'CRM open', w: 56, align: 'right' },
      { label: 'Pool', w: 46, align: 'right' },
      { label: 'Calls', w: 38, align: 'right' },
      { label: 'Conn.', w: 38, align: 'right' },
      { label: 'Rate', w: 34, align: 'right' },
      { label: 'Talk', w: 52, align: 'right' },
      { label: 'Moves', w: 38, align: 'right' },
      { label: 'Paid', w: 58, align: 'right' },
    ],
    all.rows.map((r) => [
      `${r.name}${r.deleted ? ' (deleted)' : !r.enabled ? ' (deactivated)' : ''}`,
      r.role,
      r.onlineSeconds ? fmtDur(r.onlineSeconds) : '—',
      r.poolMinutes ? fmtMin(r.poolMinutes) : '—',
      r.calls || '—',
      r.connected || '—',
      r.calls ? `${r.connectRate}%` : '—',
      r.talkSeconds ? fmtDur(r.talkSeconds) : '—',
      r.stageMoves || '—',
      r.paidCount ? money(r.paidAmount) : '—',
    ])
  );
  for (const d of details) {
    R.doc.addPage();
    R.header(false);
    renderUser(R, d, { compact: true });
  }
  return R.finish();
}

module.exports = { renderUserPdf, renderAllPdf };
