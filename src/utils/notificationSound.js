// A short two-tone "ping" synthesized with the Web Audio API — no binary
// asset to ship, works everywhere. Browsers block audio before the user has
// interacted with the page at all; that's an unavoidable autoplay policy,
// not a bug — by the time a real notification fires the user has almost
// always clicked/typed something already.
let audioCtx;

export function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch (err) {
    // A silent notification beats a crashed chat page.
  }
}
