import { useEffect, useRef, useState } from 'react';
import lmsApi from '@/pages/Lms/api';

// Ported from python-test-platform's frontend/hooks/useProctor.js. Reports
// only the 3 violation types that reference project's own frontend actually
// emits (TAB_SWITCH/WINDOW_BLUR/FULLSCREEN_EXIT) — CAMERA_OFF/MIC_OFF/
// SCREEN_SHARE_STOPPED/DEVTOOLS_OPEN are valid on the backend enum but were
// never wired up there either.
export default function useAssessmentProctor(attemptId, { onSuspended, onWarning } = {}) {
  const [warningCount, setWarningCount] = useState(0);
  const lastReportRef = useRef(0);
  const suspendedRef = useRef(false);

  async function report(type) {
    if (suspendedRef.current || !attemptId) return;

    const now = Date.now();
    if (now - lastReportRef.current < 1000) return; // debounce duplicate events
    lastReportRef.current = now;

    try {
      const res = await lmsApi.reportAssessmentProctorEvent(attemptId, type);
      const result = res && res.result;
      if (!result) return;
      setWarningCount(result.warningCount);
      if (result.suspended) {
        suspendedRef.current = true;
        onSuspended?.();
      } else {
        onWarning?.(result.warningCount);
      }
    } catch (err) {
      console.error('Failed to report proctor event:', err);
    }
  }

  useEffect(() => {
    if (!attemptId) return undefined;

    function handleVisibilityChange() {
      if (document.hidden) report('TAB_SWITCH');
    }
    function handleBlur() {
      if (!document.hidden) report('WINDOW_BLUR');
    }
    function handleFullscreenChange() {
      if (!document.fullscreenElement) report('FULLSCREEN_EXIT');
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  return { warningCount, reportViolation: report };
}
