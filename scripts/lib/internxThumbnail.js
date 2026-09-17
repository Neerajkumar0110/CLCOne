// Branded SVG course-card thumbnail for the InternX-AI courses — generated
// rather than lifted from the source PDF (no PDF file access from this
// script), matching the PDF's cream/navy/bronze palette and the CLC logo's
// six-colour ring mark.

const W = 960;
const H = 540;
const CREAM = '#f5ecd9';
const NAVY = '#12283f';
const BRONZE = '#8a5a2c';
const BRONZE_DARK = '#6b431f';
const GOLD = '#c9992f';
const TEAL = '#0e7490';

const RING_COLORS = ['#e11d2e', '#f2811d', '#f2c40f', '#3aa655', '#2f6fed', '#7c3aed'];

function logoMark(cx, cy, r) {
  const segs = RING_COLORS.length;
  const step = (Math.PI * 2) / segs;
  let out = '';
  for (let i = 0; i < segs; i++) {
    const a0 = -Math.PI / 2 + i * step + 0.04;
    const a1 = -Math.PI / 2 + (i + 1) * step - 0.04;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const xi0 = cx + (r * 0.55) * Math.cos(a0);
    const yi0 = cy + (r * 0.55) * Math.sin(a0);
    const xi1 = cx + (r * 0.55) * Math.cos(a1);
    const yi1 = cy + (r * 0.55) * Math.sin(a1);
    out += `<path d="M ${xi0.toFixed(2)} ${yi0.toFixed(2)} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${(r * 0.55).toFixed(2)} ${(r * 0.55).toFixed(2)} 0 0 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z" fill="${RING_COLORS[i]}" />`;
  }
  return out;
}

function dotGrid(x, y, cols, rows, gap, color, opacity) {
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out += `<circle cx="${(x + c * gap).toFixed(1)}" cy="${(y + r * gap).toFixed(1)}" r="2" fill="${color}" opacity="${opacity}" />`;
    }
  }
  return out;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// track: 'Foundation' | 'Elite'
function buildInternXThumbnailSvg({ track, subtitle }) {
  const isElite = track === 'Elite';
  const badgeColor = isElite ? GOLD : TEAL;
  const badgeText = isElite ? 'ELITE · 12-MONTH' : 'FOUNDATION · 6-MONTH';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${CREAM}"/>
      <stop offset="1" stop-color="#efe1c4"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  ${dotGrid(40, 40, 6, 4, 16, BRONZE, 0.35)}
  ${dotGrid(W - 130, H - 90, 6, 4, 16, BRONZE, 0.35)}

  <path d="M0,${H} L0,${H - 90} C ${W * 0.25},${H - 40} ${W * 0.6},${H - 140} ${W},${H - 60} L${W},${H} Z" fill="${BRONZE}" opacity="0.10"/>

  <rect x="0" y="0" width="${W}" height="10" fill="${NAVY}"/>

  <g transform="translate(64,56)">
    ${logoMark(26, 20, 22)}
    <text x="62" y="16" font-family="Georgia, 'Times New Roman', serif" font-size="19" font-weight="700" fill="${NAVY}" letter-spacing="0.5">CAREER LAB</text>
    <text x="62" y="34" font-family="Georgia, 'Times New Roman', serif" font-size="12" fill="${BRONZE_DARK}" letter-spacing="3">CONSULTING</text>
  </g>

  <rect x="${W - 220}" y="46" width="156" height="34" rx="17" fill="${NAVY}"/>
  <text x="${W - 142}" y="68" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#f2d98a" text-anchor="middle" letter-spacing="1">2026 EDITION</text>

  <text x="${W / 2}" y="248" font-family="Arial Black, Arial, sans-serif" font-size="88" font-weight="900" fill="${NAVY}" text-anchor="middle" letter-spacing="1">InternX-AI</text>
  <text x="${W / 2}" y="292" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${BRONZE_DARK}" text-anchor="middle" letter-spacing="8">CURRICULUM</text>

  <rect x="${W / 2 - 140}" y="322" width="280" height="40" rx="20" fill="${badgeColor}"/>
  <text x="${W / 2}" y="348" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">${escapeXml(badgeText)}</text>

  <text x="${W / 2}" y="404" font-family="Georgia, 'Times New Roman', serif" font-size="16" font-style="italic" fill="${NAVY}" text-anchor="middle">${escapeXml(subtitle || 'Your Journey from Learning to Leading.')}</text>

  <rect x="0" y="${H - 10}" width="${W}" height="10" fill="${BRONZE}"/>
</svg>`;
}

module.exports = { buildInternXThumbnailSvg };
