// Minimal PDF → text, no dependencies (2026-11-27). Good enough for policy
// documents exported from Word / Google Docs / browsers: walks the page tree,
// inflates content streams (FlateDecode), follows the font's ToUnicode CMap
// (so Identity-H / CID fonts come out as real text) and reads Tj / TJ / ' / "
// with a line break on every new text line. Object streams (PDF 1.5+) are
// unpacked too. Scanned (image-only) PDFs have no text — returns ''.
const zlib = require('zlib');

function inflate(buf) {
  try { return zlib.inflateSync(buf); } catch (e) { /* try raw */ }
  try { return zlib.inflateRawSync(buf); } catch (e) { /* try sync flush */ }
  try { return zlib.inflateSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch (e) { return null; }
}

// ── object table ────────────────────────────────────────────────────
function readObjects(buf) {
  const s = buf.toString('latin1');
  const objs = new Map(); // id → { dict: string, body: string, stream: Buffer|null }
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const id = Number(m[1]);
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    const body = s.slice(start, end);
    let stream = null;
    let dict = body;
    const si = body.search(/stream\r?\n/);
    if (si >= 0 && /^\s*<</.test(body)) {
      dict = body.slice(0, si);
      const dataStart = start + si + body.slice(si).match(/stream\r?\n/)[0].length;
      let dataEnd = s.indexOf('endstream', dataStart);
      if (dataEnd < 0) dataEnd = end;
      const lenM = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      if (lenM && dataStart + Number(lenM[1]) <= dataEnd) dataEnd = dataStart + Number(lenM[1]);
      let raw = buf.slice(dataStart, dataEnd);
      if (/\/FlateDecode/.test(dict)) raw = inflate(raw) || Buffer.alloc(0);
      else if (/\/Filter/.test(dict)) raw = null; // DCT / JBIG2 / LZW … not text
      stream = raw;
    }
    objs.set(id, { dict, body, stream });
    re.lastIndex = end;
  }
  // object streams: <</Type/ObjStm /N n /First f>> holding more objects
  for (const [, o] of [...objs]) {
    if (!o.stream || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const first = Number((o.dict.match(/\/First\s+(\d+)/) || [])[1] || 0);
    const n = Number((o.dict.match(/\/N\s+(\d+)/) || [])[1] || 0);
    const txt = o.stream.toString('latin1');
    const head = txt.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i += 1) {
      const id = head[i * 2];
      const off = first + head[i * 2 + 1];
      const next = i + 1 < n ? first + head[(i + 1) * 2 + 1] : txt.length;
      if (!objs.has(id)) objs.set(id, { dict: txt.slice(off, next), body: txt.slice(off, next), stream: null });
    }
  }
  return objs;
}

const ref = (txt, key) => {
  const m = String(txt || '').match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`));
  return m ? Number(m[1]) : null;
};
const refs = (txt) => [...String(txt || '').matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));

// the <<...>> that follows /Key (balanced), or the object it references
function subDict(objs, txt, key) {
  const s = String(txt || '');
  const i = s.search(new RegExp(`/${key}\\b`));
  if (i < 0) return '';
  let j = i + key.length + 1;
  while (j < s.length && /\s/.test(s[j])) j += 1;
  if (s.startsWith('<<', j)) {
    let depth = 0;
    for (let k = j; k < s.length - 1; k += 1) {
      if (s[k] === '<' && s[k + 1] === '<') { depth += 1; k += 1; } else if (s[k] === '>' && s[k + 1] === '>') { depth -= 1; k += 1; if (!depth) return s.slice(j, k + 1); }
    }
    return s.slice(j);
  }
  const r = s.slice(j).match(/^(\d+)\s+\d+\s+R/);
  return r && objs.get(Number(r[1])) ? objs.get(Number(r[1])).dict : '';
}

// ── ToUnicode CMap ──────────────────────────────────────────────────
function hexToStr(h) {
  let out = '';
  for (let i = 0; i + 3 < h.length + 0; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
  if (h.length === 2) out = String.fromCharCode(parseInt(h, 16));
  return out;
}
function parseCMap(text) {
  const map = new Map();
  let bytes = 1;
  const cs = text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
  if (cs) bytes = cs[1].length / 2;
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(p[1], 16), hexToStr(p[2]));
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(p[1], 16);
      const hi = parseInt(p[2], 16);
      if (hi - lo > 65535) continue;
      if (p[4] !== undefined) {
        const base = p[4];
        const last = parseInt(base.slice(-4) || base, 16);
        const prefix = base.length > 4 ? hexToStr(base.slice(0, -4)) : '';
        for (let c = lo; c <= hi; c += 1) map.set(c, prefix + String.fromCharCode(last + (c - lo)));
      } else {
        const list = [...p[5].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hexToStr(x[1]));
        for (let c = lo; c <= hi; c += 1) map.set(c, list[c - lo] || '');
      }
    }
  }
  return { map, bytes };
}

// ── strings inside content streams ───────────────────────────────────
function literalBytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    const c = str[i];
    if (c !== '\\') { out.push(str.charCodeAt(i) & 255); continue; }
    i += 1;
    const n = str[i];
    if (n === 'n') out.push(10);
    else if (n === 'r') out.push(13);
    else if (n === 't') out.push(9);
    else if (n === 'b') out.push(8);
    else if (n === 'f') out.push(12);
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(str[i + 1])) { i += 1; oct += str[i]; }
      out.push(parseInt(oct, 8) & 255);
    } else if (n === '\r' || n === '\n') { if (n === '\r' && str[i + 1] === '\n') i += 1; } else out.push(str.charCodeAt(i) & 255);
  }
  return out;
}
const hexBytes = (h) => {
  const x = h.replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i < x.length; i += 2) out.push(parseInt((x[i] + (x[i + 1] || '0')), 16));
  return out;
};
function decode(bytes, font) {
  if (font && font.cmap) {
    const { map, bytes: w } = font.cmap;
    let s = '';
    for (let i = 0; i + w - 1 < bytes.length; i += w) {
      let code = 0;
      for (let k = 0; k < w; k += 1) code = code * 256 + bytes[i + k];
      s += map.has(code) ? map.get(code) : w === 1 ? String.fromCharCode(code) : '';
    }
    return s;
  }
  return bytes.map((b) => WIN_ANSI[b] || String.fromCharCode(b)).join('');
}

// WinAnsi 0x80–0x9F (simple fonts without a ToUnicode map)
const WIN_ANSI = { 0x80: '€', 0x82: '‚', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x89: '‰', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x99: '™' };

// tokenise one content stream and pull the text out
function streamText(content, fonts) {
  const s = content.toString('latin1');
  let out = '';
  let font = null;
  const stack = [];
  let i = 0;
  const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  while (i < s.length) {
    const c = s[i];
    if (c === '(') {
      let depth = 1;
      let j = i + 1;
      let buf = '';
      while (j < s.length && depth) {
        const ch = s[j];
        if (ch === '\\') { buf += ch + s[j + 1]; j += 2; continue; }
        if (ch === '(') depth += 1;
        else if (ch === ')') { depth -= 1; if (!depth) break; }
        buf += ch;
        j += 1;
      }
      stack.push({ t: 'str', v: literalBytes(buf) });
      i = j + 1;
    } else if (c === '<' && s[i + 1] !== '<') {
      const j = s.indexOf('>', i);
      stack.push({ t: 'str', v: hexBytes(s.slice(i + 1, j)) });
      i = j + 1;
    } else if (c === '[') { stack.push({ t: 'arr' }); i += 1; } else if (c === ']') {
      const items = [];
      while (stack.length && stack[stack.length - 1].t !== 'arr') items.unshift(stack.pop());
      stack.pop();
      stack.push({ t: 'list', v: items });
      i += 1;
    } else if (c === '/') {
      const m = s.slice(i).match(/^\/[^\s/<>[\]()]+/);
      stack.push({ t: 'name', v: m[0].slice(1) });
      i += m[0].length;
    } else if (/[\d.+-]/.test(c)) {
      const m = s.slice(i).match(/^[+-]?(\d+\.?\d*|\.\d+)/);
      if (!m) { i += 1; continue; }
      stack.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z'"*]/.test(c)) {
      const m = s.slice(i).match(/^[A-Za-z'"*]+/);
      const op = m[0];
      i += op.length;
      if (op === 'BI') { const e = s.indexOf('EI', i); i = e < 0 ? s.length : e + 2; stack.length = 0; continue; }
      if (op === 'Tf') { const nm = stack.filter((x) => x.t === 'name').pop(); font = nm ? fonts[nm.v] || null : null; } else if (op === 'Tj' || op === "'" || op === '"') {
        if (op !== 'Tj') nl();
        const st = stack.filter((x) => x.t === 'str').pop();
        if (st) out += decode(st.v, font);
      } else if (op === 'TJ') {
        const arr = stack.filter((x) => x.t === 'list').pop();
        if (arr) for (const it of arr.v) { if (it.t === 'str') out += decode(it.v, font); else if (it.t === 'num' && it.v < -180 && !out.endsWith(' ')) out += ' '; }
      } else if (op === 'Td' || op === 'TD') {
        const nums = stack.filter((x) => x.t === 'num');
        const ty = nums.length >= 2 ? nums[nums.length - 1].v : 0;
        const tx = nums.length >= 2 ? nums[nums.length - 2].v : 0;
        if (Math.abs(ty) > 0.5) nl(); else if (tx > 1 && out && !/\s$/.test(out)) out += ' ';
      } else if (op === 'T*') nl();
      else if (op === 'Tm') nl();
      else if (op === 'ET') { if (out && !/\s$/.test(out)) out += ' '; }
      stack.length = 0;
    } else i += 1;
  }
  return out;
}

function pageList(objs) {
  const root = [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  const pagesId = root ? ref(root.dict, 'Pages') : null;
  const pages = [];
  const seen = new Set();
  const walk = (id) => {
    if (id == null || seen.has(id)) return;
    seen.add(id);
    const o = objs.get(id);
    if (!o) return;
    if (/\/Type\s*\/Pages\b/.test(o.dict)) refs(subDictRaw(o.dict, 'Kids')).forEach(walk);
    else if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(o);
  };
  walk(pagesId);
  if (!pages.length) for (const o of objs.values()) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(o);
  return pages;
}
function subDictRaw(txt, key) {
  const m = String(txt).match(new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`));
  return m ? m[1] : '';
}

function extract(buf) {
  if (!Buffer.isBuffer(buf) || buf.slice(0, 5).toString() !== '%PDF-') return '';
  const objs = readObjects(buf);
  const fontCache = new Map();
  const fontFor = (id) => {
    if (fontCache.has(id)) return fontCache.get(id);
    const o = objs.get(id);
    let f = null;
    if (o) {
      const tu = ref(o.dict, 'ToUnicode');
      const cm = tu != null && objs.get(tu) && objs.get(tu).stream ? parseCMap(objs.get(tu).stream.toString('latin1')) : null;
      f = { cmap: cm && cm.map.size ? cm : /Identity-H/.test(o.dict) ? { map: new Map(), bytes: 2 } : null };
    }
    fontCache.set(id, f);
    return f;
  };
  let text = '';
  for (const page of pageList(objs)) {
    // resources may be inherited from a parent Pages node — fall back to any
    const res = subDict(objs, page.dict, 'Resources');
    const fontDict = subDict(objs, res, 'Font');
    const fonts = {};
    for (const m of fontDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) fonts[m[1]] = fontFor(Number(m[2]));
    const contentIds = (() => {
      const arr = subDictRaw(page.dict, 'Contents');
      if (arr) return refs(arr);
      const one = ref(page.dict, 'Contents');
      if (one == null) return [];
      const o = objs.get(one);
      // /Contents may point at an array object
      return o && !o.stream && /\[/.test(o.body) ? refs(o.body) : [one];
    })();
    const parts = contentIds.map((id) => objs.get(id)).filter((o) => o && o.stream).map((o) => o.stream);
    if (parts.length) text += `${streamText(Buffer.concat(parts), fonts)}\n\n`;
  }
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { extract };
