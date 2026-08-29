import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { request } from "@/request";

// Shared across Dashboard, Finance, User Management > Support and the
// Support page so a ticket raised from anywhere shows up in the same list.
// Backed by the /api/ticket API (backend/src/models/appModels/Ticket.js).
const TicketsContext = createContext(null);

function mapTicket(t) {
  return {
    id: t._id,
    // Short human-friendly label for the "Ticket" column — the real id
    // (t._id) is still what update/delete calls key off.
    code: `TCK-${t._id.slice(-6).toUpperCase()}`,
    subject: t.subject,
    description: t.description || "",
    category: t.category,
    priority: t.priority,
    status: t.status,
    createdBy: t.createdBy,
    raisedBy: t.raisedByName || "—",
    date: t.created ? new Date(t.created).toLocaleString() : "",
  };
}

export function TicketsProvider({ children }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshTickets = useCallback(async () => {
    setLoading(true);
    const res = await request.listAll({ entity: "ticket" });
    setTickets(res?.success ? res.result.map(mapTicket) : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshTickets();
  }, [refreshTickets]);

  // `ticket` is the raw form data (subject/category/priority/description) —
  // id, status and raisedBy are always assigned server-side.
  const addTicket = async (ticket) => {
    const res = await request.create({
      entity: "ticket",
      jsonData: {
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        description: ticket.description,
      },
    });
    if (res?.success) {
      setTickets((prev) => [mapTicket(res.result), ...prev]);
    }
    return res;
  };

  const updateTicketStatus = async (id, status) => {
    const res = await request.update({ entity: "ticket", id, jsonData: { status } });
    if (res?.success) {
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    }
    return res;
  };

  return (
    <TicketsContext.Provider value={{ tickets, loading, addTicket, updateTicketStatus, refreshTickets }}>
      {children}
    </TicketsContext.Provider>
  );
}

export function useTickets() {
  const ctx = useContext(TicketsContext);
  if (!ctx) {
    throw new Error("useTickets must be used within a TicketsProvider");
  }
  return ctx;
}
