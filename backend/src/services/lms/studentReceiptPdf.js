const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// A one-page enrollment receipt for a newly-added Student roster row —
// course, batch, fee breakdown (incl. the fixed 18% GST already computed on
// the Student doc — see models/appModels/Student.js), and the portal link.
//
// Built with pdfkit (pure JS, draws the PDF directly — no headless browser /
// PhantomJS binary involved) rather than html-pdf: html-pdf's PhantomJS
// dependency needs a platform-specific prebuilt binary that reliably fails
// to install on some Linux hosts, which was silently dropping this PDF from
// the enrollment email (the email itself still sent — see
// studentAccountService.sendEnrollmentEmail's try/catch — just without the
// attachment). pdfkit ships as plain JS, so it has nothing to fail to
// install.

const SITE_URL = 'https://clcone.careerlabconsulting.com/';
const TEAL = '#0e7490';
const TEAL_DARK = '#0b5b70';
const INK = '#17202c';
const MUTED = '#8b94a3';
const BORDER = '#e3e8ef';
const DUE = '#b45309';

const BENEFITS = [
  ['Live interactive classes', 'Join scheduled sessions with your mentor and classmates in real time.'],
  ['Recordings, anytime', "Missed a class? Every session is recorded and stays in your portal."],
  ['Assignments & progress tracking', 'Submit work, take quizzes, and track your progress module by module.'],
  ['Certificate on completion', 'Earn a verifiable certificate once you finish the course.'],
];

let LOGO_BUFFER = null;
let LOGO_ASPECT = 1489 / 367;
try {
  LOGO_BUFFER = fs.readFileSync(path.join(__dirname, 'assets', 'clc-logo.png'));
} catch (e) {
  console.error('[lms] receipt PDF logo missing:', e && e.message);
}

function inr(n) {
  const v = Number(n) || 0;
  return `Rs. ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return '—';
  }
}

const STATUS_LABEL = { paid: 'Paid', created: 'Due', upcoming: 'Upcoming' };

function renderReceiptPdf(student, { crmLink, rawPassword, plan, brand = 'Career Lab Consulting' } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const marginX = 48;
      const contentW = pageW - marginX * 2;

      // ── Header — logo and title share one row, vertically centered ────
      const bandH = 92;
      doc.rect(0, 0, pageW, bandH).fill(TEAL);
      const logoH = 30;
      const logoW = LOGO_BUFFER ? logoH * LOGO_ASPECT : 0;
      const rowCenterY = bandH / 2;
      let textX = marginX;
      if (LOGO_BUFFER) {
        try {
          doc.image(LOGO_BUFFER, marginX, rowCenterY - logoH / 2, { height: logoH });
          textX = marginX + logoW + 18;
          doc
            .moveTo(textX - 9, rowCenterY - 19)
            .lineTo(textX - 9, rowCenterY + 19)
            .lineWidth(1)
            .strokeColor('#ffffff')
            .strokeOpacity(0.35)
            .stroke()
            .strokeOpacity(1);
        } catch (e) {
          textX = marginX;
        }
      }
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text('Enrollment confirmed', textX, rowCenterY - 17, { lineBreak: false });
      doc
        .fillColor('#dff4f8')
        .font('Helvetica')
        .fontSize(10)
        .text('Fee receipt & enrollment summary', textX, rowCenterY + 6, { lineBreak: false });

      let y = bandH + 30;

      // ── Intro ────────────────────────────────────────────────────────
      doc
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(11.5)
        .text(
          `Welcome, ${student.name || 'there'} - you're officially enrolled. Details of your enrollment and fees are below.`,
          marginX,
          y,
          { width: contentW, lineGap: 3 }
        );
      y = doc.y + 20;

      // ── Info rows ────────────────────────────────────────────────────
      const infoRows = [
        ['Enrollment ID', student.enrollmentId],
        ['Course', student.course],
        ['Batch', student.batch],
      ];
      for (const [label, value] of infoRows) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(label, marginX, y, { width: 160 });
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(value || '—', marginX + 160, y - 0.5, { width: contentW - 160 });
        y += 20;
      }
      y += 14;

      // ── What you get — LMS benefits ─────────────────────────────────
      doc
        .fillColor(TEAL)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text("WHAT'S WAITING IN YOUR PORTAL", marginX, y, { characterSpacing: 0.4 });
      y += 18;
      for (const [title, desc] of BENEFITS) {
        doc.circle(marginX + 3, y + 5, 3).fill(TEAL);
        doc
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .text(title, marginX + 16, y, { width: contentW - 16, continued: false });
        y = doc.y + 1;
        doc
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(9.5)
          .text(desc, marginX + 16, y, { width: contentW - 16, lineGap: 1 });
        y = doc.y + 10;
      }
      y += 6;

      // ── Fee summary card — pulled live off the EMI plan when this
      // enrollment has one (see services/payments/plan.js's buildPlanSummary),
      // falling back to the Student doc's own snapshot fields otherwise.
      const feeGrandTotal = plan ? plan.planTotal : student.feeGrandTotal || 0;
      const feePaidTotal = plan ? plan.paidTotal : student.feePaid || 0;
      const feeDueTotal = plan ? plan.remaining : student.feeDue || 0;
      const feeBase = plan ? Math.round(feeGrandTotal / 1.18) : student.feeTotal || 0;
      const feeRows = [
        ['Course fee', inr(feeBase)],
        ['GST (18%)', inr(feeGrandTotal - feeBase)],
        ['Total payable', inr(feeGrandTotal), true],
        ['Amount paid', inr(feePaidTotal)],
        ['Balance due', inr(feeDueTotal), false, feeDueTotal > 0],
      ];
      const cardPad = 20;
      const rowH = 24;
      const cardH = 34 + feeRows.length * rowH;
      doc.roundedRect(marginX, y, contentW, cardH, 12).lineWidth(1).strokeColor(BORDER).fillAndStroke('#fafbfc', BORDER);
      doc
        .fillColor(TEAL)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('FEE SUMMARY', marginX + cardPad, y + 16, { characterSpacing: 0.4 });

      let fy = y + 40;
      feeRows.forEach(([label, value, isTotal, isDue]) => {
        if (isTotal) {
          doc
            .moveTo(marginX + cardPad, fy - 4)
            .lineTo(marginX + contentW - cardPad, fy - 4)
            .lineWidth(1)
            .strokeColor(INK)
            .stroke();
        }
        doc
          .fillColor(isTotal ? INK : MUTED)
          .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(isTotal ? 11.5 : 10)
          .text(label, marginX + cardPad, fy, { width: contentW / 2 });
        doc
          .fillColor(isDue ? DUE : INK)
          .font('Helvetica-Bold')
          .fontSize(isTotal ? 12 : 10.5)
          .text(value, marginX + cardPad, fy, { width: contentW - cardPad * 2, align: 'right' });
        fy += rowH;
      });
      y = y + cardH + 28;

      // ── Login credentials — only present the moment this account is
      // first created (see studentAccountService.provisionLogin); a later
      // receipt for an already-existing student never repeats a password.
      if (rawPassword) {
        const credH = 72;
        if (y + credH > doc.page.height - 80) {
          doc.addPage();
          y = 48;
        }
        doc.roundedRect(marginX, y, contentW, credH, 12).lineWidth(1).strokeColor(TEAL).fillAndStroke('#f0fafb', TEAL);
        doc
          .fillColor(TEAL)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('YOUR PORTAL LOGIN', marginX + cardPad, y + 14, { characterSpacing: 0.4 });
        doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text('Email', marginX + cardPad, y + 36, { width: 80 });
        doc
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .text(student.email || '—', marginX + cardPad + 80, y + 35, { width: contentW - cardPad * 2 - 80 });
        doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text('Password', marginX + cardPad, y + 53, { width: 80 });
        doc
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .text(rawPassword, marginX + cardPad + 80, y + 52, { width: contentW - cardPad * 2 - 80 });
        y += credH + 24;
      }

      // ── EMI schedule — every installment 1..count, including ones not
      // yet auto-created as their own payment request (see
      // services/payments/plan.js's buildPlanSummary) so the receipt always
      // shows the full picture, not just what's happened so far.
      if (plan && plan.installments && plan.installments.length > 1) {
        if (y + 40 > doc.page.height - 80) {
          doc.addPage();
          y = 48;
        }
        doc
          .fillColor(TEAL)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('EMI SCHEDULE', marginX, y, { characterSpacing: 0.4 });
        y += 18;

        const colNo = 34;
        const colAmt = 100;
        const colStatus = 90;
        const colMonth = contentW - colNo - colAmt - colStatus;
        let cx = marginX;
        doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5);
        doc.text('NO', cx, y, { width: colNo });
        cx += colNo;
        doc.text('MONTH', cx, y, { width: colMonth });
        cx += colMonth;
        doc.text('STATUS', cx, y, { width: colStatus });
        cx += colStatus;
        doc.text('AMOUNT', cx, y, { width: colAmt, align: 'right' });
        y += 13;
        doc.moveTo(marginX, y).lineTo(marginX + contentW, y).lineWidth(1).strokeColor(BORDER).stroke();
        y += 6;

        plan.installments.forEach((inst) => {
          if (y > doc.page.height - 90) {
            doc.addPage();
            y = 48;
          }
          const statusLabel = STATUS_LABEL[inst.status] || (inst.status || '').replace(/^./, (c) => c.toUpperCase());
          const statusColor = inst.status === 'paid' ? TEAL : inst.status === 'created' ? DUE : MUTED;
          cx = marginX;
          doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(String(inst.installmentNo), cx, y, { width: colNo });
          cx += colNo;
          doc.text(inst.paidAt ? fmtDate(inst.paidAt) : fmtDate(inst.dueAt), cx, y, { width: colMonth });
          cx += colMonth;
          doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(9.5).text(statusLabel, cx, y, { width: colStatus });
          cx += colStatus;
          doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(inr(inst.amount), cx, y, { width: colAmt, align: 'right' });
          y += 19;
        });
        y += 14;
      }

      // ── CTA ──────────────────────────────────────────────────────────
      if (crmLink) {
        const btnW = 210;
        const btnH = 34;
        const btnX = marginX + (contentW - btnW) / 2;
        doc.roundedRect(btnX, y, btnW, btnH, 8).fill(TEAL_DARK);
        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .text('Open your student portal', btnX, y + 11, { width: btnW, align: 'center' });
        doc.link(btnX, y, btnW, btnH, crmLink);
        y += btnH + 24;
      }

      // ── Footer ───────────────────────────────────────────────────────
      doc.moveTo(marginX, y).lineTo(pageW - marginX, y).lineWidth(1).strokeColor('#eef1f5').stroke();
      y += 16;
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8.5)
        .text(`This is an automated receipt from ${brand}. Keep it for your records.`, marginX, y);
      y += 14;
      doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(9).text(SITE_URL, marginX, y);
      doc.link(marginX, y, doc.widthOfString(SITE_URL), 12, SITE_URL);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { renderReceiptPdf };
