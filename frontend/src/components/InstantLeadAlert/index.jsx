import { useEffect } from "react";
import { notification } from "antd";
import { useSelector } from "react-redux";
import { getSocket } from "@/socket";
import { selectCurrentAdmin } from "@/redux/auth/selectors";

// Live "new Facebook lead → who got it" notice for every Sales user and
// admin (backend services/calling/instantLeads.js emits `lead:instant` the
// moment a fresh lead is handed to an active agent and their call starts).
export default function InstantLeadAlert() {
  const me = useSelector(selectCurrentAdmin);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onLead = (p) => {
      if (!p) return;
      const mine = me && p.agentName && `${me.name || ""} ${me.surname || ""}`.trim() === p.agentName;
      notification.open({
        key: `instant-${p.leadId}`,
        placement: "top",
        duration: 10,
        message: mine ? "🔔 New lead for you — your phone is ringing" : "🔔 New Facebook lead",
        description: `${p.name || "New lead"}${p.form ? ` · ${p.form}` : ""} → assigned to ${p.agentName}`,
        style: { borderLeft: `4px solid ${mine ? "#16a34a" : "#1877F2"}` },
      });
    };
    socket.on("lead:instant", onLead);
    return () => socket.off("lead:instant", onLead);
  }, [me?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
