// Repairs text that was UTF-8 but got read as Windows-1252 somewhere on the
// way in (CSV imports, some Facebook form names) — e.g. "ð™ˆð™–ð™" is really a
// stylised "𝙈𝙖…" name, "ã…¤" an invisible Hangul filler. Re-encodes the
// characters back to their single bytes and decodes those as UTF-8; anything
// that doesn't round-trip cleanly is returned untouched, so a normal name is
// never changed.

// Windows-1252's 0x80–0x9F block (the only part that differs from Latin-1).
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
// A UTF-8 lead byte (shown as Â–ô) followed by a continuation byte.
const SUSPECT = /[Â-ô][\u0080-¿Œ-™]/;
const decoder = new TextDecoder('utf-8', { fatal: true });

function fixMojibake(s) {
  if (typeof s !== 'string' || !SUSPECT.test(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c <= 0xff) bytes.push(c);
    else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
    else return s;
  }
  try {
    const out = decoder.decode(Uint8Array.from(bytes));
    return out.replace(/[ㅤᅟᅠ​-‍﻿]/g, '').trim() || s;
  } catch (e) {
    return s;
  }
}

module.exports = { fixMojibake };
