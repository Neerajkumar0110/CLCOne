const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');

// Renders the two-page InternX-AI certificate (page 1: certificate of
// completion, page 2: assessment & performance record) as a PDF, matching
// the Foundation (6-month) / Elite (12-month) template designs the user
// supplied. Nothing here is generated ahead of time and stored — every call
// recomputes the candidate's real metrics fresh from the DB and draws the
// PDF on the spot (see certificates.js#downloadMine/#downloadForManager),
// so the only thing "pre-filled" is the candidate's name on the issued
// Certificate row itself; everything else (scores, sessions, hours) is
// whatever is true *right now*, never a stored snapshot that could go stale.

const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

const NAVY = '#0f1f3d';
const NAVY_SOFT = '#1c3360';
const GOLD = '#b8902f';
const GOLD_LIGHT = '#d9b85c';
const CREAM = '#fdf8ee';
const INK = '#1a2436';
const MUTED = '#5c6a85';

let LOGO_BUFFER = null;
let LOGO_ASPECT = 1489 / 367;
try {
  LOGO_BUFFER = fs.readFileSync(path.join(__dirname, 'assets', 'clc-logo.png'));
} catch (e) {
  console.error('[lms] certificate PDF logo missing:', e && e.message);
}

function gradeFor(pct) {
  if (pct === null || pct === undefined) return '—';
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  return 'Pass';
}
function performanceLabel(pct) {
  if (pct === null || pct === undefined) return 'Pending';
  if (pct >= 90) return 'Outstanding';
  if (pct >= 80) return 'Excellent';
  if (pct >= 70) return 'Very Good';
  if (pct >= 60) return 'Good';
  return 'Satisfactory';
}
function pctStr(v) {
  return v === null || v === undefined ? '—' : `${v}%`;
}
function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return '—';
  }
}

// ── real metrics: assessment scores, capstone project, class hours ───────
// Technical Assessments = BASIC + MAJOR(python/sql) tests; Practical
// Projects = the two applied/micro tests (SQL-backed DB, NLP-on-SERP);
// Autonomous Agent Assessment = NLP_MAJOR (NLP fundamentals & intro to
// LLMs) — the only one of the five real assessment-suite tests (see
// frontend AssessmentDashboard's TESTS) that's actually about AI/LLM
// agents, so it's the one real score that slot can honestly be filled with.
// Any test the candidate never attempted stays null -> printed as "—",
// never a fabricated 0%.
async function buildMetrics({ adminId, adminEmail, course, batchName }) {
  const AssessmentAttempt = mongoose.model('AssessmentAttempt');
  const Project = mongoose.model('Project');

  const or = [];
  if (adminId) or.push({ candidate: adminId });
  if (adminEmail) or.push({ candidateEmail: rxEq(adminEmail) });
  const attempts = or.length
    ? await AssessmentAttempt.find({ status: 'SUBMITTED', $or: or }).select('testType score totalCount submittedAt').lean()
    : [];

  const latestByType = {};
  attempts.forEach((a) => {
    const prev = latestByType[a.testType];
    if (!prev || new Date(a.submittedAt) > new Date(prev.submittedAt)) latestByType[a.testType] = a;
  });
  const pctOf = (t) => {
    const a = latestByType[t];
    return a && a.totalCount ? Math.round((a.score / a.totalCount) * 100) : null;
  };
  const avg = (vals) => {
    const xs = vals.filter((v) => v !== null && v !== undefined);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };

  const technicalPct = avg([pctOf('BASIC'), pctOf('MAJOR')]);
  const practicalPct = avg([pctOf('MICRO'), pctOf('NLP_MICRO')]);
  const agentPct = pctOf('NLP_MAJOR');

  let capstoneTitle = '';
  let capstoneScore = null;
  let capstoneGrade = '';
  if (course && adminId) {
    const project = await Project.findOne({ course: course._id, student: adminId, removed: false }).sort({ updated: -1 }).lean();
    if (project) {
      capstoneTitle = project.title || '';
      capstoneScore = typeof project.finalScore === 'number' ? Math.round(project.finalScore) : null;
      capstoneGrade = project.finalGrade || (capstoneScore !== null ? gradeFor(capstoneScore) : '');
    }
  }

  const overallParts = [technicalPct, practicalPct, agentPct, capstoneScore].filter((v) => v !== null && v !== undefined);
  const overallPct = overallParts.length ? Math.round(overallParts.reduce((a, b) => a + b, 0) / overallParts.length) : null;

  // Same "countable" class statuses as the Attendance page / liveScope.js's
  // ATTENDANCE_COUNTABLE_STATUSES, so "Total Sessions/Hours" here agrees
  // with what the candidate already sees on My Attendance.
  let totalSessions = 0;
  let totalHours = 0;
  if (batchName) {
    const Batch = mongoose.model('Batch');
    const LmsLiveSession = mongoose.model('LmsLiveSession');
    const batchDoc = await Batch.findOne({ name: batchName, removed: false }).select('_id').lean();
    if (batchDoc) {
      const sessions = await LmsLiveSession.find({
        removed: false,
        batch: batchDoc._id,
        status: { $in: ['ended', 'recording_processing', 'recording_available'] },
      }).select('durationMin').lean();
      totalSessions = sessions.length;
      totalHours = Math.round((sessions.reduce((a, s) => a + (s.durationMin || 0), 0) / 60) * 10) / 10;
    }
  }

  return {
    technicalPct, practicalPct, agentPct,
    capstoneTitle, capstoneScore, capstoneGrade,
    overallPct, finalGrade: gradeFor(overallPct), performance: performanceLabel(overallPct),
    totalSessions, totalHours,
  };
}

// ── drawing helpers ────────────────────────────────────────────────────
// The bundled logo's wordmark is light-colored (built for a dark band — see
// services/lms/studentReceiptPdf.js's comment) and disappears on this
// certificate's cream background, so it gets its own small navy backdrop
// here rather than sitting directly on the page. Returns the badge's total
// width so callers can center/layout around it.
function drawLogoBadge(doc, x, y, h) {
  if (!LOGO_BUFFER) return 0;
  const w = h * LOGO_ASPECT;
  const padX = 14;
  const padY = 8;
  const totalW = w + padX * 2;
  doc.roundedRect(x, y - padY, totalW, h + padY * 2, 8).fill(NAVY);
  try { doc.image(LOGO_BUFFER, x + padX, y, { height: h }); } catch (e) { /* noop */ }
  return totalW;
}
function smallSeal(doc, cx, cy, r) {
  doc.circle(cx, cy, r).lineWidth(1.4).strokeColor(GOLD).stroke();
  if (LOGO_BUFFER) {
    const h = r * 1.1;
    const w = h * LOGO_ASPECT;
    try { doc.image(LOGO_BUFFER, cx - Math.min(w, r * 1.6) / 2, cy - h / 2, { fit: [r * 1.6, h] }); } catch (e) { /* noop */ }
  }
}
function flanked(doc, text, x, y, width, font, size, color) {
  doc.font(font).fontSize(size).fillColor(color);
  const tw = doc.widthOfString(text);
  const cx = x + width / 2;
  doc.text(text, cx - tw / 2, y, { lineBreak: false });
  const lineY = y + size * 0.4;
  const gap = tw / 2 + 14;
  doc.moveTo(cx - gap - 26, lineY).lineTo(cx - gap, lineY).lineWidth(1).strokeColor(color).stroke();
  doc.moveTo(cx + gap, lineY).lineTo(cx + gap + 26, lineY).lineWidth(1).strokeColor(color).stroke();
}
function infoBox(doc, x, y, w, h, label, value, elite) {
  if (elite) {
    doc.roundedRect(x, y, w, h, 6).fill(NAVY);
    doc.fillColor(GOLD_LIGHT).font('Helvetica-Bold').fontSize(8.5).text(label, x, y + 14, { width: w, align: 'center', characterSpacing: 0.5 });
    doc.fillColor('#ffffff').font('Helvetica').fontSize(9.5).text(value || '—', x + 10, y + h - 26, { width: w - 20, align: 'center' });
  } else {
    doc.roundedRect(x, y, w, h, 6).lineWidth(1).strokeColor(GOLD).stroke();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5).text(label, x, y + 14, { width: w, align: 'center', characterSpacing: 0.5 });
    doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(value || '—', x + 10, y + h - 26, { width: w - 20, align: 'center' });
  }
}
function sectionTitle(doc, text, x, width, y) {
  flanked(doc, text.toUpperCase(), x, y, width, 'Times-Bold', 15, NAVY);
  return y + 26;
}
function signatureBlock(doc, x, w, y, name, role1, role2) {
  doc.font('Times-Italic').fontSize(16).fillColor(NAVY_SOFT).text(name, x, y, { width: w, align: 'center' });
  doc.moveTo(x + w * 0.15, y + 24).lineTo(x + w * 0.85, y + 24).lineWidth(1).strokeColor(GOLD).stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(role1, x, y + 30, { width: w, align: 'center', characterSpacing: 0.3 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(role2, x, y + 42, { width: w, align: 'center' });
}

// ── page 1: certificate ────────────────────────────────────────────────
function drawCertificatePage(doc, { studentName, programLabel, trackLabel, certificateId, issuedOn, elite }) {
  const W = doc.page.width;
  const H = doc.page.height;
  doc.rect(0, 0, W, H).fill(CREAM);

  doc.roundedRect(22, 22, W - 44, H - 44, 4).lineWidth(elite ? 2.4 : 1.6).strokeColor(NAVY).stroke();
  doc.roundedRect(32, 32, W - 64, H - 64, 4).lineWidth(1).strokeColor(GOLD).stroke();
  [[40, 40], [W - 40, 40], [40, H - 40], [W - 40, H - 40]].forEach(([cx, cy]) => {
    doc.circle(cx, cy, 3).fill(GOLD);
  });

  let y = 56;
  const logoH = 34;
  const logoBadgeW = logoH * LOGO_ASPECT + 28;
  drawLogoBadge(doc, W / 2 - logoBadgeW / 2, y, logoH);
  y += logoH + 26;

  flanked(doc, 'INTERNX-AI', 60, y, W - 120, 'Helvetica-Bold', 13, NAVY);
  y += 30;

  doc.font('Times-Bold').fontSize(40).fillColor(NAVY).text('CERTIFICATE', 60, y, { width: W - 120, align: 'center' });
  y = doc.y + 2;
  flanked(doc, 'OF COMPLETION', 60, y, W - 120, 'Times-Bold', 15, GOLD);
  y += 36;

  doc.font('Times-Italic').fontSize(12).fillColor(MUTED).text('This certificate is proudly presented to', 60, y, { width: W - 120, align: 'center' });
  y = doc.y + 18;

  doc.font('Times-BoldItalic').fontSize(28).fillColor(NAVY).text(studentName || '—', 60, y, { width: W - 120, align: 'center' });
  const nameW = doc.widthOfString(studentName || '—');
  const nameLineY = doc.y + 4;
  doc.moveTo(W / 2 - Math.max(nameW, 160) / 2, nameLineY).lineTo(W / 2 + Math.max(nameW, 160) / 2, nameLineY).lineWidth(1).strokeColor(GOLD).stroke();
  y = nameLineY + 22;

  doc.font('Times-Italic').fontSize(12).fillColor(MUTED).text('For successfully completing the', 60, y, { width: W - 120, align: 'center' });
  y = doc.y + 6;
  doc.font('Times-Bold').fontSize(19).fillColor(NAVY).text(`INTERNX-AI ${programLabel.toUpperCase()} PROGRAM`, 60, y, { width: W - 120, align: 'center' });
  y = doc.y + 14;

  const desc = elite
    ? 'and demonstrating advanced expertise in Artificial Intelligence, its applications, and solving real-world challenges with innovation and excellence.'
    : 'and demonstrating a strong understanding of Artificial Intelligence, its foundations, and real-world applications.';
  doc.font('Times-Italic').fontSize(10.5).fillColor(MUTED).text(desc, 90, y, { width: W - 180, align: 'center', lineGap: 2 });
  y = doc.y + 26;

  const boxW = (W - 120 - 24) / 3;
  infoBox(doc, 60, y, boxW, 64, 'PROGRAM', trackLabel, elite);
  infoBox(doc, 60 + boxW + 12, y, boxW, 64, 'CERTIFICATE ID', certificateId, elite);
  infoBox(doc, 60 + (boxW + 12) * 2, y, boxW, 64, 'DATE OF COMPLETION', fmtDate(issuedOn), elite);
  y += 64 + 36;

  const sigW = (W - 120) / 3;
  signatureBlock(doc, 60, sigW, y, 'Varun Kapoor', 'GLOBAL PROGRAM COORDINATOR', 'VARUN KAPOOR');
  smallSeal(doc, W / 2, y + 18, 26);
  signatureBlock(doc, 60 + sigW * 2, sigW, y, 'Chirag Mathur', 'GLOBAL PROGRAM DIRECTOR', 'CHIRAG MATHUR');
}

// ── page 2: assessment & performance record ───────────────────────────
function drawRecordPage(doc, { programLabel, trackLabel, durationLabel, issuedOn, metrics, elite }) {
  const W = doc.page.width;
  const H = doc.page.height;
  doc.rect(0, 0, W, H).fill(CREAM);
  doc.roundedRect(22, 22, W - 44, H - 44, 4).lineWidth(elite ? 2.4 : 1.6).strokeColor(NAVY).stroke();
  doc.roundedRect(32, 32, W - 64, H - 64, 4).lineWidth(1).strokeColor(GOLD).stroke();

  let y = 50;
  const logoH = 24;
  drawLogoBadge(doc, 60, y, logoH);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Powered by Career Lab Consulting', 60, y + logoH + 14);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('INTERNX-AI', W - 180, y + 6, { width: 120, align: 'right' });
  y += logoH + 34;

  y = sectionTitle(doc, 'Assessment & Performance Record', 60, W - 120, y) + 6;

  const rows = [
    ['Technical Assessments', pctStr(metrics.technicalPct)],
    ['Practical Projects', pctStr(metrics.practicalPct)],
    ['Autonomous Agent Assessment', pctStr(metrics.agentPct)],
    ['Final Capstone Project', metrics.capstoneScore !== null ? `${pctStr(metrics.capstoneScore)} (${metrics.capstoneGrade || gradeFor(metrics.capstoneScore)})` : '—'],
  ];
  const tableX = 60;
  const tableW = W - 120;
  const rowH = 28;
  doc.roundedRect(tableX, y, tableW, rowH * rows.length + rowH, 8).lineWidth(1).strokeColor(GOLD).stroke();
  rows.forEach(([label, value], i) => {
    const ry = y + i * rowH;
    if (i > 0) doc.moveTo(tableX, ry).lineTo(tableX + tableW, ry).lineWidth(0.5).strokeColor('#e8d9b0').stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(label.toUpperCase(), tableX + 18, ry + 9, { width: tableW * 0.6 });
    doc.font('Helvetica').fontSize(10).fillColor(NAVY_SOFT).text(value, tableX + tableW * 0.6, ry + 9, { width: tableW * 0.4 - 18, align: 'right' });
  });
  const overallY = y + rowH * rows.length;
  doc.rect(tableX + 1, overallY, tableW - 2, rowH).fill('#f3e3b8');
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text('OVERALL PERFORMANCE', tableX + 18, overallY + 9, { width: tableW * 0.6 });
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(`${pctStr(metrics.overallPct)} (${metrics.finalGrade})`, tableX + tableW * 0.6, overallY + 9, { width: tableW * 0.4 - 18, align: 'right' });
  y = overallY + rowH + 28;

  y = sectionTitle(doc, 'Final Result', 60, W - 120, y) + 4;
  const fBoxW = (tableW - 18) / 4;
  const finals = [
    ['FINAL GRADE', metrics.finalGrade],
    ['PERFORMANCE', metrics.performance],
    ['COMPLETION STATUS', 'Successfully Completed'],
    ['DATE OF COMPLETION', fmtDate(issuedOn)],
  ];
  finals.forEach(([label, value], i) => {
    infoBox(doc, tableX + i * (fBoxW + 6), y, fBoxW, 58, label, value, elite);
  });
  y += 58 + 24;

  y = sectionTitle(doc, 'Remarks', 60, W - 120, y) + 2;
  doc.roundedRect(tableX, y, tableW, 54, 8).lineWidth(1).strokeColor(GOLD).stroke();
  y += 54 + 22;

  y = sectionTitle(doc, 'Capstone Project', 60, W - 120, y) + 2;
  doc.roundedRect(tableX, y, tableW, 32, 8).lineWidth(1).strokeColor(GOLD).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('PROJECT TITLE', tableX + 16, y + 11, { width: 100 });
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(metrics.capstoneTitle || '—', tableX + 120, y + 10, { width: tableW - 140 });
  y += 32 + 22;

  y = sectionTitle(doc, 'Program Record', 60, W - 120, y) + 4;
  const pBoxW = (tableW - 18) / 4;
  const records = [
    ['PROGRAM', `InternX-AI\n${trackLabel}`],
    ['DURATION', durationLabel],
    ['TOTAL SESSIONS', String(metrics.totalSessions)],
    ['TOTAL HOURS', String(metrics.totalHours)],
  ];
  records.forEach(([label, value], i) => {
    infoBox(doc, tableX + i * (pBoxW + 6), y, pBoxW, 54, label, value, elite);
  });
  y += 54 + 28;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('AUTHORIZED BY', tableX, y, { width: tableW, align: 'center', characterSpacing: 1 });
  y += 18;
  const sigW = tableW / 2;
  signatureBlock(doc, tableX, sigW, y, 'Varun Kapoor', 'GLOBAL PROGRAM COORDINATOR', 'VARUN KAPOOR');
  signatureBlock(doc, tableX + sigW, sigW, y, 'Chirag Mathur', 'GLOBAL PROGRAM DIRECTOR', 'CHIRAG MATHUR');
  y += 56;

  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    'This record is an integral part of the certificate and is issued for academic and verification purposes.',
    tableX, y, { width: tableW, align: 'center' }
  );
}

// ── entry point ────────────────────────────────────────────────────────
// cert: the issued Certificate row. course: its Course doc (for durationHours
// -> track). adminId/adminEmail/batchName: the candidate, for pulling their
// real assessment/project/attendance metrics.
async function renderCertificatePdf({ cert, course, adminId, adminEmail, batchName }) {
  const elite = !!(course && Number(course.durationHours) > 6);
  const programLabel = elite ? 'Elite' : 'Foundation';
  const trackLabel = elite ? 'Elite Program' : 'Foundation Program';
  const durationLabel = elite ? '12 Months' : '6 Months';
  const metrics = await buildMetrics({ adminId, adminEmail, course, batchName });

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.addPage();
      drawCertificatePage(doc, {
        studentName: cert.student,
        programLabel,
        trackLabel,
        certificateId: cert.certificateId,
        issuedOn: cert.issuedOn,
        elite,
      });

      doc.addPage();
      drawRecordPage(doc, { programLabel, trackLabel, durationLabel, issuedOn: cert.issuedOn, metrics, elite });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { renderCertificatePdf, buildMetrics };
