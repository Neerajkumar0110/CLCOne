const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Crop the fully-transparent border off an uploaded PNG, in place.
//
// Why this exists: the logo slots size the image by CSS height, so how big
// the logo looks depends entirely on how much of the file is actually the
// logo. The bundled wordmark is trimmed tight — its artwork fills 100% of
// the canvas. A logo exported from a design tool usually is not: one
// uploaded here was a 602x500 file whose artwork was only 535x132, i.e. 26%
// of the height, with transparent bands above and below. Scaled to a 56px
// box that left a 15px logo, and it read as "the CSS is not being applied".
//
// CSS cannot fix that — object-fit sees the canvas, not the ink. Trimming on
// upload means any logo anyone exports behaves like the bundled one, and the
// existing styling keeps working untouched.
//
// PNG only. JPEG has no transparency to trim, and an SVG carries its own
// viewBox so it already scales to its artwork.

// Alpha at or below this counts as empty. Not 0: some exporters leave a
// faint anti-aliased halo that would otherwise defeat the trim.
const ALPHA_FLOOR = 16;

// Refuse to trim away almost everything — a corrupt or near-empty file
// should be left exactly as uploaded rather than reduced to a few pixels.
const MIN_REMAINING_PX = 8;

function trimTransparentPng(absPath) {
  if (path.extname(absPath).toLowerCase() !== '.png') return { trimmed: false, reason: 'not a png' };

  let png;
  try {
    png = PNG.sync.read(fs.readFileSync(absPath));
  } catch (e) {
    return { trimmed: false, reason: `unreadable: ${e.message}` };
  }

  const { width, height, data } = png;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(width * y + x) * 4 + 3] > ALPHA_FLOOR) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Wholly transparent — nothing to anchor a crop to.
  if (maxX < 0) return { trimmed: false, reason: 'fully transparent' };

  const newWidth = maxX - minX + 1;
  const newHeight = maxY - minY + 1;

  if (newWidth === width && newHeight === height) return { trimmed: false, reason: 'already tight' };
  if (newWidth < MIN_REMAINING_PX || newHeight < MIN_REMAINING_PX) {
    return { trimmed: false, reason: 'crop would leave almost nothing' };
  }

  const out = new PNG({ width: newWidth, height: newHeight });
  PNG.bitblt(png, out, minX, minY, newWidth, newHeight, 0, 0);
  fs.writeFileSync(absPath, PNG.sync.write(out));

  return {
    trimmed: true,
    from: `${width}x${height}`,
    to: `${newWidth}x${newHeight}`,
  };
}

module.exports = { trimTransparentPng };
