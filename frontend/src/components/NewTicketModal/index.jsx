import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { request } from "@/request";
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
  // Support / admin: raise it on behalf of a learner (they get the confirmation)
  const me = useSelector(selectCurrentAdmin) || {};
  const canBehalf = ["owner", "Super Admin", "Admin", "Support"].includes(me.role);
  const [who, setWho] = useState(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const timer = useRef(null);
  const search = (v) => {
    setQ(v);
    setWho(null);
    clearTimeout(timer.current);
    if (v.trim().length < 2) return setFound([]);
    timer.current = setTimeout(async () => {
      const r = await request.get({ entity: `lms/announcements/learners?q=${encodeURIComponent(v.trim())}` }).catch(() => null);
      setFound((r && r.success && r.result) || []);
    }, 250);
  };

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
      ...(who ? { onBehalfOf: who.id } : {}),
    });
    if (res?.success) {
      setSubject("");
      setDescription("");
      setWho(null);
      setQ("");
      setFound([]);
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
      {canBehalf && (
        <div className="hub-form-row" style={{ position: "relative" }}>
          <label>On behalf of (optional)</label>
          <input className="hub-input" value={who ? `${who.name} · ${who.email}` : q} onChange={(e) => search(e.target.value)} placeholder="Learner name or the start of the email — leave empty for yourself" />
          {!who && found.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 20px rgba(15,23,42,.12)", maxHeight: 220, overflow: "auto" }}>
              {found.map((p) => (
                <button key={p.id} type="button" onClick={() => { setWho(p); setFound([]); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: 0, background: "none", cursor: "pointer", fontSize: 13 }}>
                  <b>{p.name}</b> <span style={{ color: "#64748b" }}>· {p.email}</span>
                </button>
              ))}
            </div>
          )}
          {who && <small style={{ color: "#0e7490" }}>They get the confirmation email and see the ticket in their LMS.</small>}
        </div>
      )}
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
