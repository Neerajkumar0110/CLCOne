const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// Learner 360° PDF (Figma 1F "Downloadable PDF report (A4)"). Same blocks,
// same colours as the design, drawn with pdfkit from the live report data.
// The board is 794 px wide = A4; 1 px here ≈ 0.75 pt.

const C = {
  pri: '#0e7490', priM: '#a5f3fc', ink: '#0f172a', sub: '#475569', mut: '#64748b', fa: '#94a3b8', ln: '#e2e8f0', bg: '#f8fafc', bg2: '#f1f5f9',
  ok: '#16a34a', okD: '#166534', wa: '#d97706', waD: '#92400e', er: '#dc2626', erD: '#991b1b', pu: '#7c3aed', ind: '#4f46e5', sky: '#0284c7', w: '#ffffff',
};
const TONE = { ok: C.ok, wa: C.wa, er: C.er, mut: C.mut };
const fmt = (d, o) => (d ? new Date(d).toLocaleString('en-IN', o || { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
const n = (v) => (v == null ? '—' : String(Math.round(v)));

function arc(doc, cx, cy, r, a0, a1, color, width) {
  const steps = Math.max(8, Math.ceil(((a1 - a0) / Math.PI) * 48));
  doc.save().lineWidth(width).strokeColor(color).lineCap('butt');
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) doc.moveTo(x, y);
    else doc.lineTo(x, y);
  }
  doc.stroke().restore();
}

function gauge(doc, x, y, s, v, color, label) {
  const r = s / 2;
  const th = r * 0.16;
  const a0 = 0.75 * Math.PI;
  const sp = 1.5 * Math.PI;
  arc(doc, x + r, y + r, r - th / 2, a0, a0 + sp, C.bg2, th);
  if (v) arc(doc, x + r, y + r, r - th / 2, a0, a0 + (sp * Math.min(100, v)) / 100, color, th);
  doc.font('Helvetica-Bold').fontSize(s * 0.24).fillColor(C.ink).text(n(v), x, y + r - s * 0.16, { width: s, align: 'center' });
  doc.font('Helvetica').fontSize(Math.max(6.5, s * 0.075)).fillColor(C.mut).text(label, x, y + r + s * 0.1, { width: s, align: 'center' });
}

function line(doc, x, y, w, h, series, min = 0, max = 100) {
  for (let k = 0; k <= 4; k++) {
    const yy = y + 6 + ((h - 12) * k) / 4;
    doc.save().lineWidth(0.5).strokeColor(C.ln).moveTo(x, yy).lineTo(x + w, yy).stroke().restore();
  }
  for (const s of series) {
    const pts = s.d.map((v, i) => (v == null ? null : [x + 6 + ((w - 12) * i) / Math.max(1, s.d.length - 1), y + h - 6 - ((h - 12) * (Math.max(min, Math.min(max, v)) - min)) / (max - min)]));
    const valid = pts.filter(Boolean);
    if (valid.length < 2) continue;
    if (s.area) {
      doc.save().fillOpacity(0.12).fillColor(s.c);
      doc.moveTo(valid[0][0], y + h - 6);
      valid.forEach((p) => doc.lineTo(p[0], p[1]));
      doc.lineTo(valid[valid.length - 1][0], y + h - 6).closePath().fill().restore();
    }
    doc.save().lineWidth(s.dash ? 1.2 : 1.8).strokeColor(s.c);
    if (s.dash) doc.dash(4, { space: 3 });
    valid.forEach((p, i) => (i ? doc.lineTo(p[0], p[1]) : doc.moveTo(p[0], p[1])));
    doc.stroke().undash().restore();
  }
}

function radar(doc, cx, cy, R, axes, vals, color) {
  const n2 = axes.length;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n2;
    return [cx + ((R * v) / 100) * Math.cos(a), cy + ((R * v) / 100) * Math.sin(a)];
  };
  [25, 50, 75, 100].forEach((l) => {
    doc.save().lineWidth(0.5).strokeColor(C.ln);
    axes.forEach((_, i) => {
      const p = pt(i, l);
      if (i) doc.lineTo(p[0], p[1]);
      else doc.moveTo(p[0], p[1]);
    });
    doc.closePath().stroke().restore();
  });
  axes.forEach((_, i) => {
    const p = pt(i, 100);
    doc.save().lineWidth(0.5).strokeColor(C.ln).moveTo(cx, cy).lineTo(p[0], p[1]).stroke().restore();
  });
  doc.save().fillOpacity(0.18).fillColor(color).strokeColor(color).lineWidth(1.5);
  axes.forEach((_, i) => {
    const p = pt(i, vals[i] || 0);
    if (i) doc.lineTo(p[0], p[1]);
    else doc.moveTo(p[0], p[1]);
  });
  doc.closePath().fillAndStroke().restore();
  axes.forEach((a, i) => {
    const p = pt(i, 124);
    doc.font('Helvetica').fontSize(7.5).fillColor(C.sub).text(a, p[0] - 30, p[1] - 4, { width: 60, align: 'center' });
  });
}

function label(doc, t, x, y) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.mut).text(String(t).toUpperCase(), x, y, { characterSpacing: 0.4 });
}

async function footer(doc, verifyUrl, page, pages) {
  const y = doc.page.height - 50;
  doc.save().lineWidth(0.5).strokeColor(C.ln).moveTo(0, y - 10).lineTo(doc.page.width, y - 10).stroke().restore();
  try {
    const png = await QRCode.toBuffer(verifyUrl, { margin: 0, width: 132, color: { dark: C.ink, light: '#ffffff' } });
    doc.image(png, 24, y - 4, { width: 33, height: 33 });
  } catch (_) {
    doc.rect(24, y - 4, 33, 33).fill(C.ink);
  }
  doc.font('Helvetica').fontSize(8).fillColor(C.mut).text(`Verify at ${verifyUrl.replace(/^https?:\/\//, '')} · Page ${page} of ${pages}`, 66, y + 8, { width: 380 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.pri).text('CareerLab Consulting', doc.page.width - 160, y + 8, { width: 136, align: 'right' });
}

async function render(rep, { at = new Date(), verifyUrl }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Learner 360° Report — ${rep.learner.name}`, Author: 'CareerLab LMS' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const L = rep.learner;
  const lvColor = TONE[rep.level.tone] || C.mut;

  // header band
  doc.rect(0, 0, W, 62).fill(C.pri);
  doc.roundedRect(24, 17, 27, 27, 6).fill(C.w);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.pri).text('CLC', 24, 26, { width: 27, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(13.5).fillColor(C.w).text('Learner 360° Report', 60, 17);
  doc.font('Helvetica').fontSize(8).fillColor(C.priM).text(`CareerLab LMS · generated ${fmt(at, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })} IST`, 60, 35);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.w).text(L.learnerId || '', W - 184, 26, { width: 160, align: 'right' });

  // learner block
  let y = 86;
  doc.circle(24 + 21, y + 21, 21).fill(C.pri);
  const ini = String(L.name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  doc.font('Helvetica-Bold').fontSize(14).fillColor(C.w).text(ini, 24, y + 14, { width: 42, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(13.5).fillColor(C.ink).text(L.name, 78, y + 4, { width: 360 });
  const meta = [L.course, L.batch ? `Batch ${L.batch}` : '', L.mentor ? `Mentor ${L.mentor}` : '', L.enrolledOn ? `Enrolled ${fmt(L.enrolledOn)}` : ''].filter(Boolean).join(' · ');
  doc.font('Helvetica').fontSize(8.6).fillColor(C.sub).text(meta, 78, y + 24, { width: 360 });
  gauge(doc, W - 24 - 72, y - 6, 72, rep.total, lvColor, rep.level.label);

  // component table
  y = 168;
  const cols = [
    ['Component', 24, 250],
    ['Weight', 274, 60],
    ['Score', 334, 55],
    ['Batch avg', 389, 70],
    ['Points', 459, 112],
  ];
  doc.roundedRect(24, y, W - 48, 22 + 5 * 20, 6).lineWidth(0.6).strokeColor(C.ln).stroke();
  doc.rect(24.5, y + 0.5, W - 49, 21).fill(C.bg);
  cols.forEach(([t, x, w]) => label(doc, t, x + 10, y + 8, w));
  const comp = [
    ['Attendance', 'attendance'],
    ['Assessment', 'assessment'],
    ['Coding', 'coding'],
    ['Project', 'project'],
  ];
  comp.forEach(([t, k], i) => {
    const yy = y + 22 + i * 20;
    doc.save().lineWidth(0.5).strokeColor(C.ln).moveTo(24, yy).lineTo(W - 24, yy).stroke().restore();
    const pts = rep.scores[k] == null ? null : (rep.scores[k] * rep.weights[k]) / 100;
    const vals = [t, `${rep.weights[k]}%`, n(rep.scores[k]), n(rep.batchAvg[k]), pts == null ? '—' : pts.toFixed(1)];
    vals.forEach((v, ci) => doc.font(ci === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(ci === 0 ? C.ink : C.sub).text(v, cols[ci][1] + 10, yy + 6, { width: cols[ci][2] - 12 }));
  });
  const yt = y + 22 + 4 * 20;
  doc.save().lineWidth(0.5).strokeColor(C.ln).moveTo(24, yt).lineTo(W - 24, yt).stroke().restore();
  ['Hire-readiness', '100%', rep.total == null ? '—' : String(Math.round(rep.total)), n(rep.batchAvg.total), rep.total == null ? '—' : rep.total.toFixed(1)].forEach((v, ci) =>
    doc.font(ci === 1 || ci === 3 ? 'Helvetica' : 'Helvetica-Bold').fontSize(9).fillColor(ci === 1 || ci === 3 ? C.sub : C.ink).text(v, cols[ci][1] + 10, yt + 6, { width: cols[ci][2] - 12 })
  );

  // progress + radar
  y = 300;
  label(doc, `Progress · ${rep.history.weeks.length} weeks`, 24, y);
  line(doc, 24, y + 14, 300, 98, [
    { d: rep.history.you, c: C.pri, area: true },
    { d: rep.history.batch, c: C.fa, dash: true },
  ], 30, 100);
  doc.font('Helvetica').fontSize(7.5).fillColor(C.sub).text('—  You      - -  Batch average', 24, y + 116);
  label(doc, 'Skills', 344, y);
  radar(doc, 344 + 113, y + 112, 74, rep.radar.axes.map((a) => a.replace('Statistics', 'Stats').replace('AI Agents', 'Agents')), rep.radar.you.map((v) => v || 0), C.pri);

  // strengths / improve
  y = 548;
  label(doc, 'Strengths', 24, y);
  label(doc, 'Areas to improve', 310, y);
  (rep.insights.strengths.length ? rep.insights.strengths : ['Not enough data yet']).forEach((t, i) => doc.font('Helvetica').fontSize(9).fillColor(C.ink).text(`•  ${t}`, 24, y + 16 + i * 16, { width: 270 }));
  (rep.insights.improve.length ? rep.insights.improve : ['Keep going — nothing flagged']).forEach((t, i) => doc.font('Helvetica').fontSize(9).fillColor(C.ink).text(`•  ${t}`, 310, y + 16 + i * 16, { width: 260 }));

  // mentor remarks
  y = 630;
  label(doc, 'Mentor remarks', 24, y);
  const rm = rep.remarks.filter((r) => r.showOnReport).slice(0, 2);
  if (!rm.length) doc.font('Helvetica').fontSize(9).fillColor(C.mut).text('No mentor remarks yet.', 24, y + 16);
  let yy = y + 16;
  rm.forEach((r) => {
    doc.font('Helvetica').fontSize(9).fillColor(C.sub).text(`"${r.text}" — ${r.by || 'Mentor'}, ${fmt(r.at)}`, 24, yy, { width: W - 48, lineGap: 2 });
    yy = doc.y + 8;
  });
  await footer(doc, verifyUrl, 1, 2);

  // ── page 2: projects, engagement, badges ──
  doc.addPage({ size: 'A4', margin: 0 });
  doc.rect(0, 0, W, 40).fill(C.pri);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.w).text(`${L.name} · Learner 360° Report`, 24, 14);
  y = 64;
  label(doc, 'Projects (mentor-reviewed)', 24, y);
  y += 16;
  if (!rep.projects.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.mut).text('No reviewed projects yet.', 24, y);
    y += 20;
  }
  rep.projects.slice(-8).forEach((p) => {
    doc.roundedRect(24, y, W - 48, 36, 6).fill(C.bg);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text(p.title, 34, y + 7, { width: 360 });
    doc.font('Helvetica').fontSize(8).fillColor(C.mut).text([p.stack, p.github, p.demo].filter(Boolean).join(' · ') || fmt(p.at), 34, y + 21, { width: 400 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(p.qualified ? C.okD : C.waD).text(`${p.qualified ? 'Qualified' : 'Reviewed'} · ${p.score}`, W - 170, y + 13, { width: 136, align: 'right' });
    y += 42;
  });
  y += 8;
  label(doc, 'Engagement', 24, y);
  y += 16;
  const e = rep.engagement;
  const tiles = [
    ['Engagement', e && e.score != null ? String(e.score) : '—'],
    ['Level', e ? e.level.label : '—'],
    ['Streak', e ? `${e.streak} d` : '—'],
    ['This week', e ? `${Math.floor(e.weekMin / 60)}h ${String(e.weekMin % 60).padStart(2, '0')}m` : '—'],
  ];
  tiles.forEach(([k, v], i) => {
    const x = 24 + i * ((W - 48) / 4);
    doc.roundedRect(x, y, (W - 48) / 4 - 8, 40, 6).fill(C.bg);
    doc.font('Helvetica').fontSize(8).fillColor(C.mut).text(k, x + 10, y + 7);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(v, x + 10, y + 20, { width: (W - 48) / 4 - 24 });
  });
  y += 56;
  label(doc, 'Certificates & badges', 24, y);
  y += 16;
  if (!rep.badges.length) doc.font('Helvetica').fontSize(9).fillColor(C.mut).text('None yet.', 24, y);
  rep.badges.slice(0, 12).forEach((b, i) => doc.font('Helvetica').fontSize(9).fillColor(C.ink).text(`•  ${b.label}`, 24 + (i % 2) * 270, y + Math.floor(i / 2) * 15, { width: 260 }));
  await footer(doc, verifyUrl, 2, 2);
  doc.end();
  return done;
}

module.exports = { render };
