import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

/**
 * Tween a number from its previous value to `target` on change.
 * Respects prefers-reduced-motion (jumps straight to the value).
 * @param {number} target
 * @param {{duration?:number, enabled?:boolean}} opts
 * @returns {number} the current animated value
 */
export default function useCountUp(target, { duration = 700, enabled = true } = {}) {
  const [value, setValue] = useState(target || 0);
  const fromRef = useRef(target || 0);
  const rafRef = useRef(null);

  useEffect(() => {
    const end = Number(target) || 0;
    const start = fromRef.current;

    if (!enabled || prefersReducedMotion() || start === end) {
      fromRef.current = end;
      setValue(end);
      return undefined;
    }

    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const v = start + (end - start) * easeOutQuart(p);
      setValue(v);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = end;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = end;
    };
  }, [target, duration, enabled]);

  return value;
}
