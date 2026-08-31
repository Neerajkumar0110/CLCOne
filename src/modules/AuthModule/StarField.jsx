import { useEffect, useRef } from 'react';

// Dense 3D depth star-field — the viewer slowly flies FORWARD through a
// huge field of tiny stars. Each star has a real (x, y, z); z decreases
// every frame and the star is perspective-projected to the screen
// (px = cx + x * focal / z). As z shrinks the star eases outward from the
// centre, grows a little and brightens; once it passes the camera or
// leaves the frame it is reborn as a faint speck at the far plane — an
// endless, seamless back-to-front cycle. Slow and calm, never warp speed.
//
// Tuned to stay DENSE and clearly visible across the whole viewport: high
// particle count, a brightness floor so mid/far stars remain visible, and
// a world spread wide enough that far stars still reach the edges. No
// halos, trails, streaks, sparkles or 2D sideways drift. HTML canvas +
// requestAnimationFrame, one canvas, DPR-capped, resize-aware. Honours
// prefers-reduced-motion with a single static frame.
export default function StarField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const Z_FAR = 1400; // spawn depth
    const Z_NEAR = 1; // camera plane
    const SPEED = 65; // world units / second the camera advances — calm

    let width = 0;
    let height = 0;
    let focal = 300;
    let spreadX = 0;
    let spreadY = 0;
    let stars = [];
    let raf = 0;
    let last = 0;

    // fill=true seeds a star anywhere in the depth volume (first frame);
    // otherwise it's recycled, reborn at the far plane as a new speck.
    const makeStar = (fill) => ({
      x: (Math.random() * 2 - 1) * spreadX,
      y: (Math.random() * 2 - 1) * spreadY,
      z: fill ? Z_NEAR + Math.random() * (Z_FAR - Z_NEAR) : Z_FAR,
      size: 0.5 + Math.pow(Math.random(), 2) * 0.9, // mostly tiny, a few larger
      lum: 0.5 + Math.pow(Math.random(), 1.8) * 0.5, // subtle but visible
      phase: Math.random() * Math.PI * 2,
      tw: 0.4 + Math.random() * 0.9, // per-star twinkle rate (not synced)
    });

    const seed = () => {
      // Responsive density: mobile ~380, tablet ~640, desktop ~1000,
      // lightly scaled by height; never sparse, capped for performance.
      const base = width <= 640 ? 380 : width <= 1024 ? 640 : 1000;
      const scale = Math.min(1.3, Math.max(0.8, height / 850));
      const count = Math.min(1200, Math.round(base * scale));
      stars = Array.from({ length: count }, () => makeStar(true));
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      focal = Math.max(260, Math.min(width, height) * 0.8);
      // Wide enough that far stars still project out to the edges — keeps
      // the field filling the viewport, not clustering at the centre.
      spreadX = width * 1.05;
      spreadY = height * 1.05;
      seed();
    };

    const drawStar = (px, py, r, alpha, white) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = white ? '#ffffff' : '#dbe4f2';
      if (r < 1.3) {
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
      } else {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const animate = (time) => {
      if (!last) last = time;
      let dt = (time - last) / 1000;
      last = time;
      if (dt > 0.05) dt = 0.05; // clamp after a tab-switch / GC pause

      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];

        s.z -= SPEED * dt; // <-- forward travel, every frame
        if (s.z <= Z_NEAR) {
          stars[i] = makeStar(false);
          continue;
        }

        const k = focal / s.z;
        const px = cx + s.x * k;
        const py = cy + s.y * k;

        // Swept past the camera and out of view — reborn far away.
        if (px < -4 || px > width + 4 || py < -4 || py > height + 4) {
          stars[i] = makeStar(false);
          continue;
        }

        const depth = 1 - s.z / Z_FAR; // 0 far, ~1 at the camera
        const r = Math.max(0.6, 0.5 + depth * depth * 2.2 * s.size);

        // Ease in from the far plane, ease out on the final approach — the
        // rest of the journey is full strength, which keeps it dense.
        let fade = Math.min(1, depth * 8);
        if (s.z < 55) fade *= s.z / 55;

        // Brightness floor: far stars ~0.45, near stars 1.0.
        const vis = 0.45 + 0.55 * depth;
        const twinkle = 0.8 + 0.2 * Math.sin(s.phase + time * 0.001 * s.tw);
        const alpha = Math.min(1, vis * s.lum * twinkle * fade);

        drawStar(px, py, r, alpha, r > 1.5);
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(animate);
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      for (const s of stars) {
        const k = focal / s.z;
        const px = cx + s.x * k;
        const py = cy + s.y * k;
        if (px < 0 || px > width || py < 0 || py > height) continue;
        const depth = 1 - s.z / Z_FAR;
        const r = Math.max(0.6, 0.5 + depth * depth * 2.2 * s.size);
        drawStar(px, py, r, Math.min(1, (0.45 + 0.55 * depth) * s.lum), r > 1.5);
      }
      ctx.globalAlpha = 1;
    };

    resize();
    if (reduceMotion) {
      drawStatic();
    } else {
      raf = requestAnimationFrame(animate);
    }

    const onResize = () => {
      resize();
      if (reduceMotion) drawStatic();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="auth-star-canvas" aria-hidden="true" />;
}
