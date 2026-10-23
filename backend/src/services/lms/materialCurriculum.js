const mongoose = require('mongoose');

// Study Material → curriculum order. Each file is matched by NAME to the
// internship's chapters (Course → CourseModule → Chapter), so the list can
// read Unit 01 / S1, S2–3 … in teaching order instead of A–Z. Files that
// don't match any chapter (research papers, trainer guides …) come last.

const STOP = new Set(['and', 'the', 'a', 'an', 'of', 'in', 'with', 'to', 'for', 'on', 'your', 'how']);
const ALIAS = [
  [/\boop\b/g, 'object oriented programming'],
  [/\bml\b/g, 'machine learning'],
  [/\bllms?\b/g, 'large language models'],
  [/\bi o\b/g, 'io'],
];
const MIN_SCORE = 0.62;

function norm(s) {
  let t = String(s || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '') // file extension
    .replace(/\(\d+\)\s*$/, '') // "… (1)" duplicate suffix
    .replace(/\b(s|session)\s*\d+(\s*[–-]\s*s?\d+)?\b/g, ' ') // S2–3 / S40–S41
    .replace(/[^a-z0-9]+/g, ' ');
  for (const [rx, rep] of ALIAS) t = t.replace(rx, rep);
  return t
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .join('');
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}
function score(file, chapter) {
  if (!file || !chapter) return 0;
  // "Variables" / "Data Types" are each a piece of "Variables, Data Types & Operators"
  if (file.length >= 6 && chapter.includes(file)) return Math.max(0.9, dice(file, chapter));
  // …and a file covering several chapters ("Lists, Tuples and Sets,
  // Dictionaries, and JSON") lands on the first of them (ties keep the earlier).
  if (chapter.length >= 8 && file.includes(chapter)) return 0.9;
  return dice(file, chapter);
}

// courseId -> [{ unit, unitTitle, order, label, chapter, key }]
async function outlineFor(courseIds) {
  const ids = [...new Set(courseIds.map(String))].filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return new Map();
  const [mods, chs] = await Promise.all([
    mongoose.model('CourseModule').find({ course: { $in: ids }, removed: false }).select('course title order').sort({ order: 1 }).lean(),
    mongoose.model('Chapter').find({ course: { $in: ids }, removed: false }).select('course module title sessionLabel order').sort({ order: 1 }).lean(),
  ]);
  const out = new Map();
  for (const id of ids) {
    const units = mods.filter((m) => String(m.course) === id);
    const list = [];
    units.forEach((m, ui) => {
      chs
        .filter((c) => String(c.module) === String(m._id))
        .forEach((c) => list.push({ unit: ui + 1, unitTitle: m.title, order: list.length + 1, label: c.sessionLabel || '', chapter: c.title, key: norm(c.title) }));
    });
    out.set(id, list);
  }
  return out;
}

// rows: serialized materials ({ title, course, batch }). Adds `curriculum`
// to each matched row and returns them in curriculum order.
async function arrange(rows) {
  if (!rows.length) return rows;
  // batch-scoped material → that batch's internship
  const batchNames = [...new Set(rows.filter((r) => !r.course && r.batch).map((r) => r.batch))];
  const batchCourse = new Map();
  if (batchNames.length) {
    const batches = await mongoose.model('Batch').find({ name: { $in: batchNames }, removed: false }).select('name course').lean();
    const titles = [...new Set(batches.map((b) => b.course).filter(Boolean))];
    const courses = titles.length ? await mongoose.model('Course').find({ title: { $in: titles }, removed: false }).select('title').lean() : [];
    const idByTitle = new Map(courses.map((c) => [c.title, String(c._id)]));
    for (const b of batches) if (idByTitle.has(b.course)) batchCourse.set(b.name, idByTitle.get(b.course));
  }
  const courseOf = (r) => r.course || batchCourse.get(r.batch) || '';
  const outlines = await outlineFor(rows.map(courseOf).filter(Boolean));

  for (const r of rows) {
    const list = outlines.get(courseOf(r));
    if (!list || !list.length) continue;
    const key = norm(r.title);
    let best = null;
    let bestScore = 0;
    for (const c of list) {
      const s = score(key, c.key);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best && bestScore >= MIN_SCORE) {
      r.curriculum = { courseId: courseOf(r), unit: best.unit, unitTitle: best.unitTitle, order: best.order, label: best.label, chapter: best.chapter };
      // within one chapter: the order its parts appear in the chapter name
      // ("Variables, Data Types & Operators" → Variables, Data Types, Operators)
      r._pos = Math.max(0, best.key.indexOf(key));
    }
  }
  rows.sort((a, b) => {
    const ca = a.curriculum;
    const cb = b.curriculum;
    if (ca && cb) return ca.courseId.localeCompare(cb.courseId) || ca.unit - cb.unit || ca.order - cb.order || a._pos - b._pos || a.title.localeCompare(b.title);
    if (ca) return -1;
    if (cb) return 1;
    return a.title.localeCompare(b.title);
  });
  for (const r of rows) delete r._pos;
  return rows;
}

module.exports = { arrange, norm, score, MIN_SCORE };
