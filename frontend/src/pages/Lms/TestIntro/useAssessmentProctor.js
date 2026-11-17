import { useEffect, useRef, useState } from 'react';
import lmsApi from '@/pages/Lms/api';

// Ported from python-test-platform's frontend/hooks/useProctor.js.
// Browser events: TAB_SWITCH (tab hidden — ends the test at once on the
// server), WINDOW_BLUR / FULLSCREEN_EXIT (warnings; 3 end the test).
// `reportViolation(type, { detail, snapshot })` is also what the AI
// proctoring (useAiProctor) and the camera / screen-share watchers call.
// The server decides: proctorController ends the test at once for
// TAB_SWITCH, CAMERA_OFF, SCREEN_SHARE_STOPPED, MULTIPLE_PERSONS,
// PHONE_DETECTED and LOUD_NOISE.
const SEVERE = ['TAB_SWITCH', 'CAMERA_OFF', 'SCREEN_SHARE_STOPPED', 'MULTIPLE_PERSONS', 'PHONE_DETECTED', 'LOUD_NOISE'];

export default function useAssessmentProctor(attemptId, { onSuspended, onWarning } = {}) {
  const [warningCount, setWarningCount] = useState(0);
  const lastReportRef = useRef(0);
  const suspendedRef = useRef(false);

  async function report(type, extra) {
    if (suspendedRef.current || !attemptId) return;

    const now = Date.now();
    // debounce duplicate warnings; a test-ending event always goes through
    if (!SEVERE.includes(type) && now - lastReportRef.current < 1000) return;
    lastReportRef.current = now;

    try {
      const res = await lmsApi.reportAssessmentProctorEvent(attemptId, type, extra);
      const result = res && res.result;
      if (!result) return;
      setWarningCount(result.warningCount);
      if (result.suspended) {
        suspendedRef.current = true;
        onSuspended?.(result.reason || '');
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
    // A tab switch fires blur first, then visibilitychange — wait a moment so
    // it is reported once, as the TAB_SWITCH it really is, not as a warning.
    function handleBlur() {
      setTimeout(() => {
        if (!document.hidden) report('WINDOW_BLUR');
      }, 400);
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
