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
// an all-zero dashboard. They get their own combined view instead: the
// Support ticket-queue analytics (deliberately NOT scoped down — Support
// already has full visibility into every ticket, see ticketController/
// scope.js) stacked with the LMS/students analytics that used to live on a
// separate "LMS ▸ Overview" tab (now hidden for this role — see
// NavigationContainer.jsx — since it's folded into this one page), so
// everything they have permission to see lives on one "/" dashboard.
const LMS_SECTION_CONFIG = {
  ...DASH_CONFIGS.interns,
  title: "LMS — Candidates & Courses",
  subtitle: "Enrolment, progress and completion, folded in from LMS ▸ Overview.",
};

// "Good Morning, Mamta Kumari" instead of a generic "Executive Overview" —
// based on the viewer's own local clock, not a fixed server timezone, since
// it's a greeting for whoever's actually looking at the screen right now.
function greetingFor(date) {
  const h = date.getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const currentAdmin = useSelector(selectCurrentAdmin);
  const { tickets, addTicket } = useTickets();
  const [ticketOpen, setTicketOpen] = useState(false);
  const isSupport = currentAdmin?.role === "Support";

  const fullName = [currentAdmin?.name, currentAdmin?.surname].filter(Boolean).join(" ");
  const baseConfig = isSupport ? DASH_CONFIGS.support : DASH_CONFIGS.overview;
  const greetedConfig = {
    ...baseConfig,
    title: fullName ? `${greetingFor(new Date())}, ${fullName}` : baseConfig.title,
    subtitle: currentAdmin?.role ? `${currentAdmin.role} · ${baseConfig.subtitle}` : baseConfig.subtitle,
  };

  const myOpen = tickets.filter(
    (t) => t.createdBy === currentAdmin?._id && t.status !== "Resolved"
  ).length;

  const raiseTicketActions = (
    <>
      <button type="button" className="hub-btn" onClick={() => navigate("/support")}>
        <ProfileOutlined /> My Tickets{myOpen ? ` (${myOpen})` : ""}
      </button>
      <button type="button" className="hub-btn hub-btn-primary" onClick={() => setTicketOpen(true)}>
        <PlusOutlined /> Raise Ticket
      </button>
    </>
  );

  return (
    <>
      <DashboardShell
        module={isSupport ? "support" : "overview"}
        config={greetedConfig}
        live
        extraActions={raiseTicketActions}
      />
      {isSupport && (
        <div style={{ marginTop: 28 }}>
          <DashboardShell module="interns" config={LMS_SECTION_CONFIG} live />
        </div>
      )}
      <NewTicketModal open={ticketOpen} onClose={() => setTicketOpen(false)} onAdd={addTicket} />
    </>
  );
}
