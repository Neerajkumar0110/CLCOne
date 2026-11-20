import React from "react";

// Design pager (Sales One Place): "1–20 of 340 leads", rows per page, ‹ 1 2 3 ›.
// Look only — it calls the same page / size handlers the old Prev / Next did.
// `size` unknown → "340 leads · page 2 of 17"; `count` unknown → "Page 2 of 17".
export default function SuPager({ page, pages, count, size, sizes, onSize, onPage, noun = "rows" }) {
  const total = Math.max(1, pages || 1);
  const from = count && size ? (page - 1) * size + 1 : 0;
  const to = size ? Math.min(page * size, count) : count;
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const nums = [];
  for (let i = start; i <= Math.min(total, start + 4); i++) nums.push(i);
  const label =
    count == null
      ? `Page ${page} of ${total}`
      : !count
      ? `0 ${noun}`
      : size
      ? `${from}–${to} of ${count} ${noun}`
      : `${count} ${noun} · page ${page} of ${total}`;
  return (
    <div className="su-pager">
      <span>{label}</span>
      <div className="su-pp">
        {onSize && (
          <label className="su-pp-size">
            Rows per page
            <select className="hub-select" value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Rows per page">
              {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="su-pb" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
        {nums.map((n) => (
          <button key={n} type="button" className={n === page ? "su-pb on" : "su-pb"} aria-current={n === page ? "page" : undefined} onClick={() => n !== page && onPage(n)}>
            {n}
          </button>
        ))}
        <button type="button" className="su-pb" disabled={page >= total} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
      </div>
    </div>
  );
}
