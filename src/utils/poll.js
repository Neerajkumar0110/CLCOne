// Visibility-aware polling.
//
// Runs fn() once now, then every intervalMs — but ONLY while the browser
// tab is visible. When the tab is hidden (user switched away, minimised,
// locked the screen) the interval is cleared so there is zero background
// traffic; when the tab becomes visible again fn() runs immediately to
// catch up and the interval restarts.
//
// Returns a stop() function — call it from a useEffect cleanup.
//
//   useEffect(() => startPoll(refresh, 10000), [dep]);
//
// (startPoll already fires the first call, so callers should NOT also
// invoke the loader themselves.)
export function startPoll(fn, intervalMs) {
  let timer = null;
  let stopped = false;

  const tick = () => {
    if (!stopped) fn();
  };

  const startTimer = () => {
    if (timer != null || stopped) return;
    timer = setInterval(tick, intervalMs);
  };
  const stopTimer = () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibility = () => {
    if (stopped) return;
    if (document.visibilityState === "visible") {
      tick(); // immediate catch-up
      startTimer();
    } else {
      stopTimer();
    }
  };

  // Initial run + timer (only if we're actually visible right now).
  tick();
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    startTimer();
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  return () => {
    stopped = true;
    stopTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
