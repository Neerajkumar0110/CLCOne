import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import LeadPopup from "./LeadPopup";
import AgentPopup from "./AgentPopup";

// One place that opens the v3 lead / agent popups from any board (and from
// inside each other). Each open adds to a stack; the newest is on top.
const Ctx = createContext({ openLead: () => {}, openAgent: () => {} });
export const usePopups = () => useContext(Ctx);

export function PopupProvider({ children }) {
  const [stack, setStack] = useState([]);
  const close = useCallback((id) => setStack((s) => s.filter((x) => x.id !== id)), []);
  const openLead = useCallback((p) => setStack((s) => [...s, { id: Date.now() + Math.random(), kind: "lead", ...p }]), []);
  const openAgent = useCallback((p) => setStack((s) => [...s, { id: Date.now() + Math.random(), kind: "agent", ...p }]), []);
  const value = useMemo(() => ({ openLead, openAgent }), [openLead, openAgent]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {stack.map((p) =>
        p.kind === "lead" ? (
          <LeadPopup key={p.id} lead={p.lead} phone={p.phone} onClose={() => close(p.id)} onAgent={openAgent} />
        ) : (
          <AgentPopup key={p.id} adminId={p.adminId} name={p.name} onClose={() => close(p.id)} onLead={openLead} />
        )
      )}
    </Ctx.Provider>
  );
}

// A number / name that opens the lead popup.
export function LeadLnk({ phone, lead, children, ink }) {
  const { openLead } = usePopups();
  if (!phone && !lead) return children || "—";
  return (
    <button
      type="button"
      className={ink ? "lnk" : "lnk sv3-num"}
      title="Click for full details"
      onClick={(e) => {
        e.stopPropagation();
        openLead({ phone, lead });
      }}
    >
      {children || phone}
    </button>
  );
}

// A person's name that opens the agent popup (their whole day).
export function AgentLnk({ adminId, name, children }) {
  const { openAgent } = usePopups();
  if (!name && !adminId) return children || "—";
  return (
    <button
      type="button"
      className="lnk"
      title="Open this user's full day"
      onClick={(e) => {
        e.stopPropagation();
        openAgent({ adminId, name });
      }}
    >
      {children || name}
    </button>
  );
}
