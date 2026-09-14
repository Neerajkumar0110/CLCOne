const { execFile } = require('child_process');

// Re-encodes an uploaded class recording to a smaller, web-friendly MP4
// (capped at 720p, moderate CRF) before it's ever handed to a student —
// teachers upload whatever their screen-recorder produced (often huge,
// near-lossless files), and this keeps both storage and the student's
// download small. `nice` keeps it from competing for CPU with the VPS's
// other live services (VICIdial, the CRM API itself) — this box only has
// 2 cores.
function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'nice',
      [
        '-n', '15',
        'ffmpeg', '-y',
        '-i', inputPath,
        '-vf', 'scale=-2:min(720\\,ih)',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath,
      ],
      { maxBuffer: 1024 * 1024 * 20, timeout: 30 * 60 * 1000 },
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

module.exports = { compressVideo };
