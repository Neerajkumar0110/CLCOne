const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Fills in the two real certificate PDFs the user supplied (not a
// from-scratch recreation — see assets/certificates/foundation.pdf and
// elite.pdf, exported from their own design) with just the one thing that's
// actually different per candidate: the name. Everything else on the page
// — program text, duration, sessions/hours, signatures — is already printed
// in the template exactly as given and is left untouched.

const TEMPLATES = {
  foundation: path.join(__dirname, 'assets', 'certificates', 'foundation.pdf'),
  elite: path.join(__dirname, 'assets', 'certificates', 'elite.pdf'),
};

// Calibrated against each template's actual page-1 layout (A4 portrait,
// 595.28 x 841.89pt) — center-x of the blank line under "This certificate
// is proudly presented to", baseline-y sitting just above that line.
const NAME_SPOT = {
  foundation: { y: 462, size: 24 },
  elite: { y: 378, size: 24 },
};

const INK = rgb(0.06, 0.12, 0.24);

async function renderCertificatePdf({ cert, course }) {
  const elite = !!(course && Number(course.durationHours) > 6);
  const key = elite ? 'elite' : 'foundation';
  const bytes = fs.readFileSync(TEMPLATES[key]);
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const page = doc.getPages()[0];
  const { width } = page.getSize();

  const name = (cert && cert.student) || '';
  const { y, size } = NAME_SPOT[key];
  const textWidth = font.widthOfTextAtSize(name, size);
  page.drawText(name, { x: width / 2 - textWidth / 2, y, size, font, color: INK });

  return Buffer.from(await doc.save());
}

module.exports = { renderCertificatePdf };
