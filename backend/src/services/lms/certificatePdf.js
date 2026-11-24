const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Fills in the two real certificate PDFs the user supplied (not a
// from-scratch recreation — see assets/certificates/foundation.pdf and
// elite.pdf, exported from their own design). Page 1 is one full-page
// artwork image (1086 x 1448 px over 595.25 x 841.87 pt) with three blanks:
// the name line under "This certificate is proudly presented to", and the
// CERTIFICATE ID / DATE OF COMPLETION lines in the box. Everything else —
// program text, signatures — is already printed and left untouched.
//
// Positions were measured on the artwork's pixels (2026-11-24): the gold
// name line sits at y 724 px (Foundation) / 757 px (Elite), the ID and date
// lines at 1185 / 1187 px. 1 px = 0.5481 pt across, 0.5814 pt down.

const TEMPLATES = {
  foundation: path.join(__dirname, 'assets', 'certificates', 'foundation.pdf'),
  elite: path.join(__dirname, 'assets', 'certificates', 'elite.pdf'),
};

const PAGE_H = 841.87;
const PX_X = 595.25 / 1086;
const PX_Y = PAGE_H / 1448;
const yOf = (px) => PAGE_H - px * PX_Y; // artwork pixel row → PDF baseline y

const LAYOUT = {
  // name: baseline a little above the gold line, centred, fits between the ornaments
  foundation: {
    name: { y: yOf(724.5) + 15, size: 30, maxWidth: 330 },
    small: { y: yOf(1185) + 5, size: 10.5, color: rgb(0.067, 0.094, 0.204) },
    idX: 540 * PX_X,
    dateX: 830 * PX_X,
  },
  elite: {
    name: { y: yOf(757) + 14, size: 29, maxWidth: 330 },
    // the ID / date box is dark navy here — light gold text, like its labels
    small: { y: yOf(1187) + 5, size: 10.5, color: rgb(0.93, 0.8, 0.52) },
    idX: 539 * PX_X,
    dateX: 809 * PX_X,
  },
};

// the artwork's navy (sampled from "CERTIFICATE")
const INK = rgb(0.067, 0.094, 0.204);

function templateKey(course) {
  if (course && /elite/i.test(course.title || '')) return 'elite';
  // Course.durationHours holds months for the InternX plans (6 / 12)
  return course && Number(course.durationHours) > 6 ? 'elite' : 'foundation';
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });

async function renderCertificatePdf({ cert, course }) {
  const key = templateKey(course);
  const L = LAYOUT[key];
  const doc = await PDFDocument.load(fs.readFileSync(TEMPLATES[key]));
  const page = doc.getPages()[0];
  const { width } = page.getSize();

  // name — serif italic like "This certificate is proudly presented to", shrunk to fit the line
  const nameFont = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const name = String((cert && cert.student) || '').trim().replace(/\s+/g, ' ');
  if (name) {
    let size = L.name.size;
    while (size > 14 && nameFont.widthOfTextAtSize(name, size) > L.name.maxWidth) size -= 0.5;
    const w = nameFont.widthOfTextAtSize(name, size);
    page.drawText(name, { x: width / 2 - w / 2, y: L.name.y, size, font: nameFont, color: INK });
  }

  // certificate ID + date of completion on their blank lines (not on a preview)
  const small = await doc.embedFont(StandardFonts.TimesRomanBold);
  const id = cert && cert.certificateId && cert.certificateId !== 'PREVIEW' ? String(cert.certificateId) : '';
  const date = cert && cert.issuedOn ? fmtDate(cert.issuedOn) : '';
  for (const [text, cx] of [[id, L.idX], [date, L.dateX]]) {
    if (!text) continue;
    const w = small.widthOfTextAtSize(text, L.small.size);
    page.drawText(text, { x: cx - w / 2, y: L.small.y, size: L.small.size, font: small, color: L.small.color });
  }

  return Buffer.from(await doc.save());
}

module.exports = { renderCertificatePdf, templateKey };
