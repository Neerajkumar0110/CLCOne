// One Top performers card on Sales 360°: everyone with something to show, the
// highest first. People level on the number share a rank.
export default function rankRows(rows, valueOf, shown = 5) {
  const ranked = rows
    .map((row) => ({ row, value: valueOf(row) || 0 }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value || String(a.row.name).localeCompare(String(b.row.name)));
  ranked.forEach((x, i) => {
    x.rank = i > 0 && ranked[i - 1].value === x.value ? ranked[i - 1].rank : i + 1;
    x.pct = (x.value / ranked[0].value) * 100;
  });
  return {
    top: ranked.slice(0, shown),
    winners: ranked.filter((x) => x.rank === 1),
    more: Math.max(0, ranked.length - shown),
  };
}
