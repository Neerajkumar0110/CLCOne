const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// The single-page "title slide" BBB shows in the whiteboard the moment a
// meeting opens — replaces BBB's generic bundled "Welcome To BigBlueButton"
// demo deck (which otherwise shows because no presentation was uploaded)
// with a branded one that names the class's trainer instead. BBB's
// presentation is shared by the whole room (there is no per-viewer slide),
// so this names the teacher — the one constant "host" identity for the
// class — rather than whoever happens to be joining.

const TEAL = '#0e7490';
const TEAL_DARK = '#0b5b70';
const INK = '#17202c';
const MUTED = '#5b6674';

let LOGO_BUFFER = null;
let LOGO_ASPECT = 1489 / 367;
try {
  LOGO_BUFFER = fs.readFileSync(path.join(__dirname, '..', 'assets', 'clc-logo.png'));
} catch (e) {
  console.error('[lms] welcome slide logo missing:', e && e.message);
}

function renderWelcomeSlidePdf({ courseTitle, batchName, teacherName, brand = 'Career Lab Consulting' }) {
  return new Promise((resolve, reject) => {
    try {
      const W = 960;
      const H = 540;
      const doc = new PDFDocument({ size: [W, H], margin: 0 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.rect(0, 0, W, H).fill('#ffffff');
      doc.rect(0, 0, W, 10).fill(TEAL);

      const cx = W / 2;
      let y = 108;

      if (LOGO_BUFFER) {
        const logoH = 46;
        const logoW = logoH * LOGO_ASPECT;
        try {
          doc.image(LOGO_BUFFER, cx - logoW / 2, y, { height: logoH });
        } catch (e) {
          /* noop */
        }
        y += logoH + 46;
      } else {
        y += 46;
      }

      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(30)
        .text(batchName || courseTitle || 'Live Class', 60, y, { width: W - 120, align: 'center' });
      y = doc.y + 14;

      if (batchName && courseTitle && batchName !== courseTitle) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(15).text(courseTitle, 60, y, { width: W - 120, align: 'center' });
        y = doc.y + 22;
      } else {
        y += 10;
      }

      doc
        .moveTo(cx - 36, y)
        .lineTo(cx + 36, y)
        .lineWidth(2)
        .strokeColor(TEAL)
        .stroke();
      y += 26;

      doc
        .fillColor(TEAL_DARK)
        .font('Helvetica-Bold')
        .fontSize(17)
        .text(teacherName ? `Trainer: ${teacherName}` : 'Live class', 60, y, { width: W - 120, align: 'center' });

      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(10.5)
        .text(brand, 0, H - 34, { width: W, align: 'center' });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Writes (or overwrites, to pick up the latest teacher/batch name) the slide
// for this meeting under backend/src/public/lms-welcome/<meetingId>/slide.pdf
// and returns its public URL, or null if it couldn't be built — callers
// treat that as "just fall back to no preUploadedPresentation".
async function ensureWelcomeSlideUrl({ meetingId, courseTitle, batchName, teacherName, crmBaseUrl }) {
  if (!meetingId || !crmBaseUrl) return null;
  try {
    const buf = await renderWelcomeSlidePdf({ courseTitle, batchName, teacherName });
    const dir = path.join(process.cwd(), 'src', 'public', 'lms-welcome', String(meetingId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'slide.pdf'), buf);
    return `${crmBaseUrl.replace(/\/$/, '')}/public/lms-welcome/${encodeURIComponent(meetingId)}/slide.pdf`;
  } catch (e) {
    console.error('[lms] could not build welcome slide:', e && e.message);
    return null;
  }
}

module.exports = { ensureWelcomeSlideUrl };
