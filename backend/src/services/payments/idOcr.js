// Best-effort text extraction from a scanned Aadhar/PAN photo, using
// tesseract.js (bundled OCR engine, no external API/account/credentials —
// runs entirely on this server). This is a pre-fill convenience, never an
// authority: the candidate always sees the extracted values in an editable
// field and can correct anything OCR got wrong before submitting. Accuracy
// depends heavily on photo quality/lighting/angle — expect it to sometimes
// return partial or empty results, which callers must treat as normal.
const { createWorker } = require('tesseract.js');

async function ocrText(absolutePath) {
  const worker = await createWorker('eng');
  try {
    const {
      data: { text },
    } = await worker.recognize(absolutePath);
    return text || '';
  } finally {
    await worker.terminate();
  }
}

function cleanLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const PAN_NUMBER_RE = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/;
const DATE_RE = /\b(\d{2}\/\d{2}\/\d{4})\b/;
const PAN_STOP_WORDS = /income\s*tax|govt|government|permanent\s*account|signature|date\s*of\s*birth|father|^name$/i;

// PAN layout: header lines, the PAN number, then — in order — Name,
// Father's Name, Date of Birth, each usually its own line. Field labels
// are frequently dropped or garbled by OCR, so this leans on card-layout
// ORDER (the first two clean name-shaped lines after the PAN number)
// rather than trying to match label text.
function parsePan(text) {
  const lines = cleanLines(text);
  const result = { panNumber: '', name: '', fatherName: '', dob: '' };

  const panMatch = text.match(PAN_NUMBER_RE);
  if (panMatch) result.panNumber = panMatch[1];

  const panIdx = lines.findIndex((l) => PAN_NUMBER_RE.test(l));
  const afterPan = panIdx >= 0 ? lines.slice(panIdx + 1) : lines;
  const nameLines = afterPan.filter((l) => /^[A-Za-z][A-Za-z. ]{2,39}$/.test(l) && !PAN_STOP_WORDS.test(l));
  if (nameLines[0]) result.name = nameLines[0];
  if (nameLines[1]) result.fatherName = nameLines[1];

  const dobMatch = text.match(DATE_RE);
  if (dobMatch) result.dob = dobMatch[1];

  return result;
}

const PINCODE_RE = /\b(\d{6})\b/;

// Aadhar layout varies a lot more than PAN (old vs new print formats,
// bilingual Hindi+English) — this only tries for an address block (the
// lines between an "Address"/"S/O"/"D/O"/"W/O" marker and the 6-digit
// pincode) plus the pincode itself. Name/DOB are left to the PAN parse or
// manual entry, since Aadhar's photo/QR layout makes OCR line order for
// those much less reliable.
function parseAadhar(text) {
  const lines = cleanLines(text);
  const result = { address: '', pincode: '' };

  const pinMatch = text.match(PINCODE_RE);
  if (pinMatch) result.pincode = pinMatch[1];

  const startIdx = lines.findIndex((l) => /^(address|s\/o|d\/o|w\/o)/i.test(l));
  const endIdx = lines.findIndex((l) => PINCODE_RE.test(l));
  if (startIdx >= 0 && endIdx >= startIdx) {
    result.address = lines
      .slice(startIdx, endIdx + 1)
      .join(', ')
      .replace(/^(address|s\/o|d\/o|w\/o)[:\s]*/i, '');
  }

  return result;
}

module.exports = { ocrText, parsePan, parseAadhar };
