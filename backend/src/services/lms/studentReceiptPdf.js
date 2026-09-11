const pdf = require('html-pdf');

// A one-page enrollment receipt for a newly-added Student roster row —
// course, batch, fee breakdown (incl. the fixed 18% GST already computed on
// the Student doc — see models/appModels/Student.js), and the portal link.
// Rendered inline (no pug/settings dependency, unlike the Invoice/Quote PDFs
// in controllers/pdfController) since this doesn't need per-tenant currency
// formatting — just a plain receipt attached to the enrollment email.

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function inr(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function buildReceiptHtml(student, { crmLink, brand = 'Career Lab Consulting' } = {}) {
  const rows = [
    ['Course fee', inr(student.feeTotal)],
    ['GST (18%)', inr((student.feeGrandTotal || 0) - (student.feeTotal || 0))],
    ['Total payable', inr(student.feeGrandTotal)],
    ['Amount paid', inr(student.feePaid)],
    ['Balance due', inr(student.feeDue)],
  ]
    .map(
      ([label, value], i) => `<tr style="${i === 2 ? 'font-weight:700;border-top:1px solid #e3e8ef' : ''}">
        <td style="padding:7px 0;color:#445">${esc(label)}</td>
        <td style="padding:7px 0;text-align:right;color:#17202c">${value}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;margin:0;padding:36px;">
  <div style="max-width:520px;margin:0 auto;">
    <h1 style="font-size:20px;margin:0 0 4px;">${esc(brand)}</h1>
    <p style="color:#889;font-size:13px;margin:0 0 24px;">Enrollment confirmation &amp; fee receipt</p>

    <h2 style="font-size:16px;margin:0 0 12px;">Welcome, ${esc(student.name)}</h2>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13.5px;">
      <tr><td style="padding:5px 0;color:#889;width:40%;">Enrollment ID</td><td style="padding:5px 0;font-weight:600;">${esc(student.enrollmentId) || '—'}</td></tr>
      <tr><td style="padding:5px 0;color:#889;">Course</td><td style="padding:5px 0;font-weight:600;">${esc(student.course) || '—'}</td></tr>
      <tr><td style="padding:5px 0;color:#889;">Batch</td><td style="padding:5px 0;font-weight:600;">${esc(student.batch) || '—'}</td></tr>
    </table>

    <div style="border:1px solid #e3e8ef;border-radius:12px;padding:16px 18px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-weight:700;font-size:13.5px;">Fee summary</p>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;">${rows}</table>
    </div>

    ${
      crmLink
        ? `<p style="margin:0 0 24px;">
            <a href="${esc(crmLink)}" style="display:inline-block;background:#0e7490;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:13.5px;">Open your portal</a>
          </p>`
        : ''
    }

    <p style="color:#889;font-size:11.5px;margin:0;">This is an automated receipt from ${esc(brand)}. Keep it for your records.</p>
  </div>
</body></html>`;
}

function renderPdfBuffer(html) {
  return new Promise((resolve, reject) => {
    pdf.create(html, { format: 'A4', border: '10mm' }).toBuffer((err, buffer) => {
      if (err) reject(err);
      else resolve(buffer);
    });
  });
}

module.exports = { buildReceiptHtml, renderPdfBuffer };
