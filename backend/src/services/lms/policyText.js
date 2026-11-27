// Policy document → plain text, so a learner reads an uploaded PDF policy as
// text inside the consent modal (2026-11-27).
//
// Uses the optional `pdf-parse` package. If it isn't installed yet this
// returns '' and the learner app shows the PDF itself instead — nothing
// breaks. Install once (`npm i pdf-parse@1.1.1` in backend/) and every PDF
// policy gets its text on the next read; the result is cached on the
// PolicyDocument (fileText) so each file is parsed only once.
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

let parser;
function getParser() {
  if (parser !== undefined) return parser;
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    parser = require('pdf-parse/lib/pdf-parse.js'); // the lib path skips the package's self-test on require
  } catch (e) {
    parser = null;
  }
  return parser;
}

// "https://host/public/uploads/policies/x.pdf" → <backend>/src/public/uploads/policies/x.pdf
function localPathFor(fileUrl) {
  const m = String(fileUrl || '').match(/\/public\/uploads\/policies\/([^/?#]+)$/i);
  if (!m) return null;
  const name = path.basename(decodeURIComponent(m[1]));
  const candidates = [
    path.join(__dirname, '../../public/uploads/policies', name),
    path.join(process.cwd(), 'src/public/uploads/policies', name),
    path.join(process.cwd(), 'public/uploads/policies', name),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const clean = (t) =>
  String(t || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 200000);

const failed = new Set(); // don't retry a file that can't be read, until restart

async function textFor(doc) {
  if (!doc) return '';
  if (doc.fileText) return doc.fileText;
  if (!/\.pdf(\?.*)?$/i.test(String(doc.fileUrl || ''))) return '';
  const key = String(doc._id);
  if (failed.has(key)) return '';
  const file = localPathFor(doc.fileUrl);
  if (!file) {
    failed.add(key);
    return '';
  }
  try {
    const text = await textOfFile(file);
    if (text) await mongoose.model('PolicyDocument').updateOne({ _id: doc._id }, { $set: { fileText: text } });
    else failed.add(key);
    return text;
  } catch (e) {
    failed.add(key);
    return '';
  }
}

// pdf-parse when installed, else the built-in parser (services/lms/pdfText.js)
async function textOfFile(file) {
  const buf = fs.readFileSync(file);
  const pdf = getParser();
  if (pdf) {
    try {
      const out = await pdf(buf);
      const t = clean(out && out.text);
      if (t) return t;
    } catch (e) { /* fall back */ }
  }
  return clean(require('./pdfText').extract(buf));
}

module.exports = { textFor, textOfFile, localPathFor };
