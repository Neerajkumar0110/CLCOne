const fs = require('fs');

// Project document → project details (LMS testing report #7 "project metadata
// fetch"): the text of an uploaded .docx / .txt / .md is split into a title,
// a description and the bullet points under a Requirements / Deliverables /
// Workflow / Steps / Tasks heading. PDFs are not read (no PDF text library on
// the server) — the caller says so.

function docxText(buf) {
  const { unzipSync, strFromU8 } = require('fflate');
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === 'word/document.xml' });
  const xml = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : '';
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:numPr>/g, '• ') // list paragraphs → bullets
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

const BULLET = /^\s*(?:[•\-*–▪●◦]|\d{1,2}[.)]|[a-z][.)])\s+/i;
const LIST_HEAD = /^(requirements?|deliverables?|workflow|steps?|tasks?|features?|scope|what to (build|submit)|milestones?|objectives?)\b[:\s-]*$/i;
const STACK_HEAD = /^(tech(nology)?\s*stack|tools?|technologies)\b[:\s-]*(.*)$/i;

function parse(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const title = lines[0].replace(BULLET, '').replace(/^(project( title)?|title)\s*[:-]\s*/i, '').slice(0, 120);
  const deliverables = [];
  const stack = [];
  const desc = [];
  let inList = false;
  for (const l of lines.slice(1)) {
    const st = STACK_HEAD.exec(l);
    if (st) {
      if (st[3]) st[3].split(/[,/|]/).map((x) => x.trim()).filter(Boolean).forEach((x) => stack.push(x));
      inList = false;
      continue;
    }
    if (LIST_HEAD.test(l)) {
      inList = true;
      continue;
    }
    if (inList && (BULLET.test(l) || (l.length < 160 && !/^[A-Za-z][A-Za-z ]{1,24}:/.test(l)))) {
      deliverables.push(l.replace(BULLET, '').slice(0, 200));
      continue;
    }
    if (BULLET.test(l) && desc.length) {
      deliverables.push(l.replace(BULLET, '').slice(0, 200));
      continue;
    }
    inList = false;
    desc.push(l);
  }
  return {
    title,
    description: desc.join('\n').slice(0, 4000),
    deliverables: [...new Set(deliverables)].slice(0, 25),
    stack: [...new Set(stack)].slice(0, 15),
  };
}

// diskPath of an uploaded file → { title, description, deliverables, stack } | { unsupported }
function extract(diskPath, name) {
  const ext = String(name || diskPath).split('.').pop().toLowerCase();
  try {
    if (ext === 'docx') return parse(docxText(fs.readFileSync(diskPath)));
    if (ext === 'txt' || ext === 'md') return parse(fs.readFileSync(diskPath, 'utf8'));
  } catch (e) {
    return { unsupported: true, reason: 'Could not read this document.' };
  }
  return { unsupported: true, reason: 'Details can be read from a Word (.docx), .txt or .md file — a PDF is kept as a resource only.' };
}

module.exports = { extract, parse };
