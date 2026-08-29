import React, { useEffect, useState } from "react";
import HubModal from "@/components/HubModal";
import { TICKET_CATEGORY_MODULES } from "@/config/permissionModules";

// Every project module can be picked as the ticket's category — single
// source of truth shared with the per-module tabs on the Support page.
export const TICKET_CATEGORIES = TICKET_CATEGORY_MODULES;
export const TICKET_PRIORITY = ["Low", "Medium", "High", "Urgent"];

// Shared by Dashboard's "+ Raise Ticket" button, User Management > Support,
// and the Support page's per-module tabs — all write into the same
// TicketsContext. `initialCategory` preselects the dropdown (e.g. a module's
// own "Raise Ticket" button defaults to that module).
export default function NewTicketModal({ open, onClose, onAdd, initialCategory }) {
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState(initialCategory || TICKET_CATEGORIES[0]);
  const [priority, setPriority] = useState("Medium");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) setCategory(initialCategory || TICKET_CATEGORIES[0]);
  }, [open, initialCategory]);

  const submit = async () => {
    if (!subject.trim()) return;
    const res = await onAdd({
      subject: subject.trim(),
      category,
      priority,
      description: description.trim(),
    });
    if (res?.success) {
      setSubject("");
      setDescription("");
      onClose();
    }
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="Raise a Support Ticket"
      subtitle="Describe any problem — technical, billing, access, or anything else"
      width={460}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit}>
            Submit Ticket
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Subject</label>
        <input className="hub-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Briefly describe the problem" />
      </div>

      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Category</label>
          <select className="hub-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="hub-form-row">
          <label>Priority</label>
          <select className="hub-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {TICKET_PRIORITY.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <div className="hub-form-row">
        <label>Description</label>
        <textarea
          className="hub-input"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add any extra detail that will help resolve this faster…"
          style={{ resize: "vertical", fontFamily: "inherit" }}
        />
      </div>
    </HubModal>
  );
}
