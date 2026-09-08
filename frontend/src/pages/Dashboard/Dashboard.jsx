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
export default function Dashboard() {
  const navigate = useNavigate();
  const currentAdmin = useSelector(selectCurrentAdmin);
  const { tickets, addTicket } = useTickets();
  const [ticketOpen, setTicketOpen] = useState(false);

  const myOpen = tickets.filter(
    (t) => t.createdBy === currentAdmin?._id && t.status !== "Resolved"
  ).length;

  return (
    <>
      <DashboardShell
        module="overview"
        config={DASH_CONFIGS.overview}
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
