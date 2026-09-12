const fs = require('fs');
const path = require('path');
const pdf = require('html-pdf');

// A one-page enrollment receipt for a newly-added Student roster row —
// course, batch, fee breakdown (incl. the fixed 18% GST already computed on
// the Student doc — see models/appModels/Student.js), and the portal link.
// Rendered inline (no pug/settings dependency, unlike the Invoice/Quote PDFs
// in controllers/pdfController) since this doesn't need per-tenant currency
// formatting — just a plain receipt attached to the enrollment email.

const SITE_URL = 'https://clcone.careerlabconsulting.com/';

// The same wordmark used across the Admin/Teacher/LMS panels — embedded as a
// data URI so the PDF renders it standalone, with no dependency on the CRM
// being reachable from wherever html-pdf's headless renderer runs.
let LOGO_DATA_URI = '';
try {
  const logoBuf = fs.readFileSync(path.join(__dirname, 'assets', 'clc-logo.png'));
  LOGO_DATA_URI = `data:image/png;base64,${logoBuf.toString('base64')}`;
} catch (e) {
  console.error('[lms] receipt PDF logo missing:', e && e.message);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function inr(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function buildReceiptHtml(student, { crmLink, brand = 'Career Lab Consulting' } = {}) {
  const feeRows = [
    ['Course fee', inr(student.feeTotal)],
    ['GST (18%)', inr((student.feeGrandTotal || 0) - (student.feeTotal || 0))],
    ['Total payable', inr(student.feeGrandTotal), true],
    ['Amount paid', inr(student.feePaid)],
    ['Balance due', inr(student.feeDue), false, student.feeDue > 0],
  ]
    .map(
      ([label, value, isTotal, isDue]) => `<tr style="${isTotal ? 'border-top:1.5px solid #17202c;' : ''}">
        <td style="padding:9px 0;color:#5b6472;font-size:13px;${isTotal ? 'font-weight:700;color:#17202c;padding-top:12px;' : ''}">${esc(label)}</td>
        <td style="padding:9px 0;text-align:right;font-variant-numeric:tabular-nums;font-size:13.5px;color:${isDue ? '#b45309' : '#17202c'};${isTotal ? 'font-weight:700;font-size:15px;padding-top:12px;' : 'font-weight:600;'}">${value}</td>
      </tr>`
    )
    .join('');

  const infoRows = [
    ['Enrollment ID', student.enrollmentId],
    ['Course', student.course],
    ['Batch', student.batch],
  ]
    .map(
      ([label, value]) => `<tr>
        <td style="padding:6px 0;color:#8b94a3;font-size:12px;width:38%;">${esc(label)}</td>
        <td style="padding:6px 0;font-weight:700;font-size:13px;color:#17202c;">${esc(value) || '—'}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;margin:0;padding:0;background:#f4f6f9;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">

    <div style="background:linear-gradient(135deg,#0e7490,#0891b2);padding:28px 36px;">
      ${LOGO_DATA_URI ? `<img src="${LOGO_DATA_URI}" alt="${esc(brand)}" style="height:34px;display:block;margin-bottom:14px;" />` : `<div style="color:#fff;font-size:19px;font-weight:700;margin-bottom:14px;">${esc(brand)}</div>`}
      <div style="color:#fff;font-size:19px;font-weight:700;letter-spacing:-0.2px;">Enrollment confirmed</div>
      <div style="color:rgba(255,255,255,.85);font-size:12.5px;margin-top:3px;">Fee receipt &amp; enrollment summary</div>
    </div>

    <div style="padding:32px 36px 8px;">
      <p style="font-size:14.5px;margin:0 0 22px;">Welcome, <strong>${esc(student.name)}</strong> — you're officially enrolled. Details of your enrollment and fees are below.</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">${infoRows}</table>

      <div style="border:1px solid #e3e8ef;border-radius:14px;padding:18px 20px;margin-bottom:26px;background:#fafbfc;">
        <p style="margin:0 0 4px;font-weight:700;font-size:13px;color:#0e7490;text-transform:uppercase;letter-spacing:.4px;">Fee summary</p>
        <table style="width:100%;border-collapse:collapse;">${feeRows}</table>
      </div>

      ${
        crmLink
          ? `<div style="text-align:center;margin-bottom:28px;">
              <a href="${esc(crmLink)}" style="display:inline-block;background:#0e7490;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:13.5px;">Open your student portal</a>
            </div>`
          : ''
      }
    </div>

    <div style="border-top:1px solid #eef1f5;padding:18px 36px 26px;">
      <p style="color:#8b94a3;font-size:11px;margin:0 0 4px;">This is an automated receipt from ${esc(brand)}. Keep it for your records.</p>
      <p style="color:#0e7490;font-size:11.5px;margin:0;font-weight:600;">${SITE_URL}</p>
    </div>

  </div>
</body></html>`;
}

function renderPdfBuffer(html) {
  return new Promise((resolve, reject) => {
    pdf.create(html, { format: 'A4', border: '0' }).toBuffer((err, buffer) => {
      if (err) reject(err);
      else resolve(buffer);
    });
  });
}

module.exports = { buildReceiptHtml, renderPdfBuffer };
