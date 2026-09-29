import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusOutlined, ProfileOutlined } from "@ant-design/icons";
import { useSelector } from "react-redux";
import NewTicketModal from "@/components/NewTicketModal";
import { useTickets } from "@/context/ticketsContext";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { DASH_CONFIGS } from "@/components/dashboard/configs";

// Route "/" — the executive overview on the shared analytics shell. The
// Raise-Ticket / My-Tickets shortcuts from the previous dashboard are kept as
// header actions.
//
// A Support-role user has no sales pipeline of their own — the company-wide
// "overview" module (calls/leads/deals) always scopes them down to their
// auto-created "Support" team, which owns zero of that data, so it rendered
// an all-zero dashboard. They land on the Support ticket-queue analytics
// module instead (see analyticsController/modules/support.js), which is
// deliberately NOT scoped down — Support already has full visibility into
// every ticket (ticketController/scope.js).
export default function Dashboard() {
  const navigate = useNavigate();
  const currentAdmin = useSelector(selectCurrentAdmin);
  const { tickets, addTicket } = useTickets();
  const [ticketOpen, setTicketOpen] = useState(false);
  const isSupport = currentAdmin?.role === "Support";

  const myOpen = tickets.filter(
    (t) => t.createdBy === currentAdmin?._id && t.status !== "Resolved"
  ).length;

  return (
    <>
      <DashboardShell
        module={isSupport ? "support" : "overview"}
        config={isSupport ? DASH_CONFIGS.support : DASH_CONFIGS.overview}
        live
        extraActions={
          <>
            <button type="button" className="hub-btn" onClick={() => navigate("/support")}>
              <ProfileOutlined /> My Tickets{myOpen ? ` (${myOpen})` : ""}
            </button>
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setTicketOpen(true)}>
              <PlusOutlined /> Raise Ticket
            </button>
          </>
        }
      />
      <NewTicketModal open={ticketOpen} onClose={() => setTicketOpen(false)} onAdd={addTicket} />
    </>
  );
}
