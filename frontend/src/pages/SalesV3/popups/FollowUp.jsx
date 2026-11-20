import React, { useState } from "react";
import { Modal } from "../ui";

// v3 design — L4 Follow-up. The old popup only said "sent" without sending
// anything; this one really opens WhatsApp (wa.me) or the mail app with the
// message filled in — nothing is faked.
const TEMPLATES = {
  WhatsApp: [
    ["Quick check-in", "Hi {{name}}, just checking in — do you have a few minutes to chat about your career goals?"],
    ["Resource share", "Hi {{name}}, sharing a resource that might help with your search. Let me know if you have questions!"],
  ],
  Email: [
    ["Introduction", "Hi {{name}},\n\nThanks for your interest in Career Lab Consulting. I'd love to schedule a quick call to understand your goals.\n\nBest,\nTeam"],
    ["Follow-up reminder", "Hi {{name}},\n\nJust following up on our last conversation — would you like to move forward?\n\nBest,\nTeam"],
  ],
};

export default function FollowUp({ lead, onClose }) {
  const [channel, setChannel] = useState(lead.phone ? "WhatsApp" : "Email");
  const [idx, setIdx] = useState(0);
  const first = String(lead.name || "").split(" ")[0] || "there";
  const [text, setText] = useState(TEMPLATES[channel][0][1].replace("{{name}}", first));
  const pick = (c, i) => {
    setChannel(c);
    setIdx(i);
    setText(TEMPLATES[c][i][1].replace("{{name}}", first));
  };
  const digits = String(lead.phone || "").replace(/\D/g, "");
  const wa = digits ? `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(text)}` : "";
  const mail = lead.email ? `mailto:${lead.email}?subject=${encodeURIComponent("Career Lab Consulting")}&body=${encodeURIComponent(text)}` : "";
  const can = channel === "WhatsApp" ? !!wa : !!mail;

  return (
    <Modal
      title={`Follow up — ${lead.name || lead.phone}`}
      sub={channel === "WhatsApp" ? lead.phone || "No phone" : lead.email || "No email on this lead"}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className="btn g" onClick={onClose}>Cancel</button>
          <a
            className="btn p"
            style={{ textDecoration: "none", pointerEvents: can ? "auto" : "none", opacity: can ? 1 : 0.5 }}
            href={channel === "WhatsApp" ? wa : mail}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setTimeout(onClose, 300)}
          >
            Open {channel}
          </a>
        </>
      }
    >
      <div className="seg" role="group" aria-label="Channel">
        {["WhatsApp", "Email"].map((c) => (
          <button key={c} type="button" className={channel === c ? "on" : ""} onClick={() => pick(c, 0)}>{c}</button>
        ))}
      </div>
      <label className="fld">Template
        <select className="sel" value={idx} onChange={(e) => pick(channel, Number(e.target.value))}>
          {TEMPLATES[channel].map(([n], i) => <option key={n} value={i}>{n}</option>)}
        </select>
      </label>
      <label className="fld">Message
        <textarea className="in" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {!can && <div className="warn">{channel === "WhatsApp" ? "This lead has no phone number." : "This lead has no email address."}</div>}
    </Modal>
  );
}
