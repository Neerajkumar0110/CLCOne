const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, PDFName, StandardFonts, rgb } = require('pdf-lib');

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
//
// The template files carry a second page with no name blank, so only page 1
// is sent. The same filling is used on an UPLOADED PDF when its first page is
// one of these two templates (matched by the artwork image itself).

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

// sha1 of every image drawn on a page (to recognise our artwork in an upload)
function pageImageHashes(doc, page) {
  const out = [];
  const res = page.node.Resources();
  const xo = res && res.lookup(PDFName.of('XObject'));
  if (!xo) return out;
  for (const [, ref] of xo.entries()) {
    const o = doc.context.lookup(ref);
    if (o && o.dict && String(o.dict.get(PDFName.of('Subtype'))) === '/Image' && o.contents) {
      out.push(crypto.createHash('sha1').update(Buffer.from(o.contents)).digest('hex'));
    }
  }
  return out;
}

let ARTWORK = null; // { foundation: Set(hash), elite: Set(hash) } of page 1 — read once
async function artwork() {
  if (ARTWORK) return ARTWORK;
  ARTWORK = {};
  for (const key of Object.keys(TEMPLATES)) {
    const doc = await PDFDocument.load(fs.readFileSync(TEMPLATES[key]));
    // the big full-page artwork is the distinguishing one; keep every image hash of page 1
    ARTWORK[key] = new Set(pageImageHashes(doc, doc.getPages()[0]));
  }
  return ARTWORK;
}

// Which template (if any) is page 1 of this PDF? Needs most of page 1's images to match.
async function detectTemplate(doc) {
  const page = doc.getPages()[0];
  if (!page) return null;
  const mine = pageImageHashes(doc, page);
  if (!mine.length) return null;
  const art = await artwork();
  let best = null;
  for (const [key, set] of Object.entries(art)) {
    const hit = mine.filter((h) => set.has(h)).length;
    if (hit >= Math.min(2, set.size) && (!best || hit > best.hit)) best = { key, hit };
  }
  return best ? best.key : null;
}

// draw name (+ certificate ID and date when given) on page 1 of a template-shaped doc
async function fillPage(doc, key, { name, certificateId, issuedOn }) {
  const L = LAYOUT[key];
  const page = doc.getPages()[0];
  const { width } = page.getSize();
  const nameFont = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (clean) {
    let size = L.name.size;
    while (size > 14 && nameFont.widthOfTextAtSize(clean, size) > L.name.maxWidth) size -= 0.5;
    const w = nameFont.widthOfTextAtSize(clean, size);
    page.drawText(clean, { x: width / 2 - w / 2, y: L.name.y, size, font: nameFont, color: INK });
  }
  const small = await doc.embedFont(StandardFonts.TimesRomanBold);
  const id = certificateId && certificateId !== 'PREVIEW' ? String(certificateId) : '';
  const date = issuedOn ? fmtDate(issuedOn) : '';
  for (const [text, cx] of [[id, L.idX], [date, L.dateX]]) {
    if (!text) continue;
    const w = small.widthOfTextAtSize(text, L.small.size);
    page.drawText(text, { x: cx - w / 2, y: L.small.y, size: L.small.size, font: small, color: L.small.color });
  }
}

// our template for the course, page 1 only, with the candidate filled in
async function renderCertificatePdf({ cert, course }) {
  const key = templateKey(course);
  const doc = await PDFDocument.load(fs.readFileSync(TEMPLATES[key]));
  while (doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  await fillPage(doc, key, { name: cert && cert.student, certificateId: cert && cert.certificateId, issuedOn: cert && cert.issuedOn });
  return Buffer.from(await doc.save());
}

// An uploaded PDF: when page 1 is one of our templates, print the name / ID /
// date on it like renderCertificatePdf does. → { bytes, template: key | null }
async function fillUploadedPdf(bytes, fields) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const key = await detectTemplate(doc);
  if (!key) return { bytes, template: null };
  await fillPage(doc, key, fields);
  return { bytes: Buffer.from(await doc.save()), template: key };
}

module.exports = { renderCertificatePdf, fillUploadedPdf, detectTemplate, templateKey };
