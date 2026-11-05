// Which of the Sales sections, filters and pages the search box's text points
// at. Forgives a small spelling slip ("attendence"), which the records search
// on the server can't. Exact matches come first; sections keep their order.
const ROWS_PER_GROUP = 5;

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

// How far off a word may be: short words are only ever one letter out.
const looksLike = (word, token) => {
  const allowed = word.length >= 7 ? 2 : 1;
  return word.length >= 4 && Math.abs(word.length - token.length) <= allowed && editDistance(word, token) <= allowed;
};

function rankOf(item, words) {
  const title = item.title.toLowerCase();
  const sub = (item.sub || "").toLowerCase();
  const near = (text, word) => text.split(/[^a-z0-9]+/).some((t) => looksLike(word, t));
  let rank = 0;
  for (const word of words) {
    if (title.includes(word)) continue;
    if (sub.includes(word)) rank += 1;
    else if (near(title, word)) rank += 2;
    else if (near(sub, word)) rank += 3;
    else return null;
  }
  return rank;
}

// [{ key, label, rows }], one per item.group, the order the items came in.
export default function matchShortcuts(items, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const groups = new Map();
  items.forEach((item) => {
    const rank = rankOf(item, words);
    if (rank === null) return;
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push({ item, rank });
  });
  return [...groups].map(([label, found]) => ({
    key: label,
    label,
    rows: found.sort((a, b) => a.rank - b.rank).slice(0, ROWS_PER_GROUP).map((x) => x.item),
  }));
}
