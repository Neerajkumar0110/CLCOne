import React, { useState } from "react";
import { CopyOutlined, LinkOutlined, FormOutlined } from "@ant-design/icons";
import { BASE_URL } from "@/config/serverApiConfig";

// Marketing › Capture Form › Website: the detailed enquiry form
// (backend corePublicControllers/enquiryForm.js) — name, mobile, email, city,
// what they do (student / working / career restart / business), education,
// college / company, goal, program, start time. Answers fill the lead's
// profile fields the agents use; the same phone is updated, never duplicated.
const SOURCES = ["WhatsApp", "Facebook", "Instagram", "Google Ads", "YouTube", "Website", "Referral", "Other"];

export default function EnquiryFormLink() {
  const [source, setSource] = useState("WhatsApp");
  const [campaign, setCampaign] = useState("");
  const [msg, setMsg] = useState("");
  const qs = new URLSearchParams();
  if (source) qs.set("utm_source", source);
  if (campaign.trim()) qs.set("utm_campaign", campaign.trim().replace(/\s+/g, "-").toLowerCase());
  const url = `${BASE_URL}public/enquiry${qs.toString() ? `?${qs}` : ""}`;
  const copy = async (text, done) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(done);
    } catch {
      setMsg("Copy failed — select the text manually.");
    }
    setTimeout(() => setMsg(""), 2500);
  };
  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3><FormOutlined /> Detailed enquiry form — know the customer before you call</h3>
        <span className="hub-badge hub-badge-green">Fills the lead profile</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 12, lineHeight: 1.6 }}>
        A 3-step, mobile-friendly form: <b>name, mobile, email, city / state, gender</b> → <b>what they do</b> (student, working, career
        restart, business) with <b>education, college / company, role, experience, salary</b> → <b>goal, program, when they can start,
        call language and time</b>. Answers go straight into the lead (persona, education, college, role, CTC, goal…). The same mobile
        already in the CRM is updated, not duplicated. In the Ad chat inbox, the 📄 button sends each customer their own link.
      </div>
      <div className="hub-form-row" style={{ display: "grid", gridTemplateColumns: "1fr 170px", gap: 10 }}>
        <div>
          <label>Campaign name (optional)</label>
          <input className="hub-input" placeholder="e.g. data-science-nov" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </div>
        <div>
          <label>Where you&rsquo;ll share it</label>
          <select className="hub-select" value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 12, background: "var(--hub-bg-soft)", border: "1px solid var(--hub-border)", borderRadius: 8, padding: "10px 12px", wordBreak: "break-all", color: "var(--hub-text)" }}>
        {url}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="hub-btn hub-btn-primary" onClick={() => copy(url, "Link copied!")}>
          <CopyOutlined /> Copy link
        </button>
        <button type="button" className="hub-btn" onClick={() => copy(`Please fill this 2-minute form so our counsellor can guide you better: ${url}`, "Message copied — paste it in WhatsApp")}>
          <CopyOutlined /> Copy WhatsApp message
        </button>
        <a className="hub-btn" href={url} target="_blank" rel="noreferrer">
          <LinkOutlined /> Open / preview
        </a>
        {msg && <span className="hub-badge hub-badge-blue">{msg}</span>}
      </div>
    </div>
  );
}
