import React, { Suspense, lazy, useState } from "react";

// An agent's name as a link → that agent's full day (Sales 360° DayModal).
// The modal code is loaded only on click, so screens that show names don't
// pull in the whole Sales 360° page (and LeadFullDetail ↔ Sales360 never
// import each other).
const AgentDayModal = lazy(() => import("@/pages/WorkTracker/Sales360").then((m) => ({ default: m.AgentDayModal })));

export default function AgentLink({ adminId, name, children }) {
  const [open, setOpen] = useState(false);
  if (!name && !adminId) return children || "—";
  return (
    <>
      <button
        type="button"
        className="su-lnk su-ink"
        title="Open this user's full day"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children || name}
      </button>
      {open && (
        <Suspense fallback={null}>
          <AgentDayModal adminId={adminId} name={name} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
