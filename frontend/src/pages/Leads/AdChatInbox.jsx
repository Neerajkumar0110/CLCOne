import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { request } from "@/request";
import { getSocket } from "@/socket";
import { API_BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";
import HubModal from "@/components/HubModal";
import LeadFullDetailModal from "@/components/LeadFullDetail";
import "./adChatInbox.css";

// Ad chat inbox — owner + Super Admin read AND answer every connected chat
// (backend facebookController/chats.js). Messages go out through Meta's
// Messenger Send API (WhatsApp: the connected DeroPo number); new messages come
// in live (socket "lead:chat") and the open chat re-reads itself every few
// seconds. Each chat looks like its own app (user ask 2026-11-16): WhatsApp
// chats like WhatsApp, Messenger like Messenger, Instagram like Instagram, with
// a WhatsApp-style "Contact info" panel of everything the CRM knows.

const CH = {
  messenger: { label: "Messenger", color: "#0084FF", cls: "ms" },
  instagram: { label: "Instagram", color: "#E1306C", cls: "ig" },
  whatsapp: { label: "WhatsApp", color: "#25D366", cls: "wa" },
};
const EMOJI = "😀 😁 😂 🤣 😊 😍 😘 😎 🤔 😅 🙂 🙃 😉 😇 🥳 😢 😭 😡 👍 👎 👏 🙏 💪 👌 ✌️ 🤝 👋 ❤️ 💙 💯 🔥 ✨ 🎉 ✅ ❌ ⭐ 📞 📧 📅 ⏰ 💼 🎓 📚 💻 🚀 📍 ➡️".split(" ");
const SAVED_KEY = "adChatSavedReplies";
const DEFAULT_SAVED = [
  "Hi! Thanks for reaching out to Career Lab Consulting. How can we help you?",
  "Could you please share your phone number? Our counsellor will call you shortly.",
  "Our next batch starts soon — would you like the fee details and syllabus?",
  "Please fill the form so our counsellor can get back to you.",
];
// Defaults added later reach people who already saved their own list (once).
const ADDED_DEFAULTS = { 2: ["Please fill the form so our counsellor can get back to you."] };
const DEFAULTS_VER = 2;
const DEFAULTS_VER_KEY = "adChatSavedRepliesVer";
const INFO_KEY = "adChatShowInfo";

const ANON = /^(Messenger|Instagram|WhatsApp) user$/i;
const AV_COLORS = ["#00a884", "#0084ff", "#e1306c", "#7c3aed", "#d97706", "#0891b2", "#dc2626", "#4f46e5", "#059669", "#be185d"];

const when = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
const clock = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
const dayKey = (d) => new Date(d).toDateString();
const dayLabel = (d) => {
  const t = new Date(d);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (t.toDateString() === today.toDateString()) return "Today";
  if (t.toDateString() === y.toDateString()) return "Yesterday";
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: t.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};
// list time like WhatsApp: today → 10:08 am, yesterday → Yesterday, else 14/11/26
const listTime = (d) => {
  if (!d) return "";
  const t = new Date(d);
  const l = dayLabel(d);
  if (l === "Today") return clock(t);
  if (l === "Yesterday") return l;
  return t.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" });
};
const left = (d) => {
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "0m";
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return p || "";
};
const loadSaved = () => {
  try {
    let v = JSON.parse(window.localStorage.getItem(SAVED_KEY) || "null");
    if (!(Array.isArray(v) && v.length)) return DEFAULT_SAVED;
    const ver = Number(window.localStorage.getItem(DEFAULTS_VER_KEY) || 1);
    if (ver < DEFAULTS_VER) {
      for (let k = ver + 1; k <= DEFAULTS_VER; k += 1) for (const t of ADDED_DEFAULTS[k] || []) if (!v.includes(t)) v = [...v, t];
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(v));
      window.localStorage.setItem(DEFAULTS_VER_KEY, String(DEFAULTS_VER));
    }
    return v;
  } catch {
    return DEFAULT_SAVED;
  }
};
const readInfoPref = () => {
  try {
    const v = window.localStorage.getItem(INFO_KEY);
    return v == null ? true : v === "1";
  } catch {
    return true;
  }
};

async function sendForm(leadId, form) {
  const token = storePersist.get("auth")?.current?.token;
  try {
    const res = await axios.post(`${API_BASE_URL}facebook/chats/${leadId}/send`, form, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.data;
  } catch (e) {
    return e?.response?.data || { success: false, message: e.message };
  }
}

// ── icons (inline, so they take the theme colour) ──
const I = {
  search: <svg className="aci-ico" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>,
  emoji: <svg className="aci-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-3.5-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 17.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" /></svg>,
  clip: <svg className="aci-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 6v11.5a4 4 0 1 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 1 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z" /></svg>,
  saved: <svg className="aci-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2zm0 15-5-2.18L7 18V5h10v13z" /></svg>,
  send: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" /></svg>,
  phone: <svg className="aci-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z" /></svg>,
  info: <svg className="aci-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" /></svg>,
  lead: <svg className="aci-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>,
  open: <svg className="aci-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" /></svg>,
  close: <svg className="aci-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>,
  check: <svg viewBox="0 0 16 11" fill="currentColor"><path d="M11.07.65 10.4.1a.38.38 0 0 0-.53.06L4.6 6.78 2.13 4.47a.38.38 0 0 0-.53.01l-.6.6a.38.38 0 0 0 0 .54l3.3 3.13c.16.15.4.14.55-.03l6.28-7.53a.38.38 0 0 0-.06-.54z" /></svg>,
  clock: <svg viewBox="0 0 16 15" fill="currentColor"><path d="M8 1.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 10.8a4.8 4.8 0 1 1 0-9.6 4.8 4.8 0 0 1 0 9.6zM8.6 4.5H7.4v3.6l3 1.8.6-1-2.4-1.4z" /></svg>,
};
const BRAND = {
  whatsapp: <svg viewBox="0 0 24 24" fill="#fff"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07a8.1 8.1 0 0 1-2.4-1.48 9 9 0 0 1-1.66-2.07c-.17-.3 0-.46.13-.6l.45-.52c.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49 2.5 1.07 3 .86 3.55.8.54-.05 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.58-.35zM12.04 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.56.93.95-3.47-.23-.36a9.38 9.38 0 0 1-1.44-5.01 9.44 9.44 0 0 1 16.12-6.66 9.36 9.36 0 0 1 2.76 6.67c0 5.2-4.24 9.42-9.45 9.42z" /></svg>,
  messenger: <svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.15.26.35.27.57l.05 1.78c.02.57.6.94 1.12.71l1.98-.87c.17-.08.36-.09.53-.04.91.25 1.88.38 2.91.38 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm6 7.46-2.94 4.66a1.5 1.5 0 0 1-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63L8.92 9.9a1.5 1.5 0 0 1 2.17-.4l2.34 1.75a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.18.69.63z" /></svg>,
  instagram: <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="#fff" /></svg>,
};

function Avatar({ name, channel, size = 49, badge = false }) {
  const anon = !name || ANON.test(name);
  const c = CH[channel] || CH.messenger;
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const initials = anon ? "" : ((parts[0] || "")[0] || "") + ((parts[1] || "")[0] || "");
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={`aci-av ${anon ? "is-anon" : ""}`} style={{ width: size, height: size, fontSize: size * 0.38, background: anon ? undefined : AV_COLORS[h % AV_COLORS.length] }} aria-hidden="true">
      {anon ? (
        // WhatsApp's default "no photo" person
        <svg className="aci-person" viewBox="0 0 212 212">
          <path fill="#fff" d="M173.6 172.5c-4.3-5.8-9.5-10.9-15.4-15.1-11.2-8-24.2-13.4-38-15.6 14.2-5.5 23.8-19.2 23.8-34.5 0-20.4-16.6-37-37-37s-37 16.6-37 37c0 15.3 9.6 29 23.8 34.5-13.8 2.2-26.8 7.6-38 15.6-5.9 4.2-11.1 9.3-15.4 15.1A105.7 105.7 0 0 0 106 212c27.1 0 51.9-10.3 67.6-39.5z" />
        </svg>
      ) : (
        initials.toUpperCase()
      )}
      {badge && (
        <span className="aci-av-badge" style={{ background: channel === "instagram" ? "linear-gradient(45deg,#f09433,#dc2743,#bc1888)" : c.color }}>
          {BRAND[channel] || BRAND.messenger}
        </span>
      )}
    </span>
  );
}

function Attachment({ a }) {
  const t = String(a.type || "");
  if (a.url && (t.startsWith("image") || t === "image"))
    return (
      <a className="aci-att" href={a.url} target="_blank" rel="noreferrer">
        <img src={a.preview || a.url} alt={a.name || "image"} />
      </a>
    );
  if (a.url && t.startsWith("video")) return <video className="aci-att" src={a.url} controls />;
  if (a.url && t.startsWith("audio")) return <audio className="aci-att" src={a.url} controls style={{ maxWidth: 260 }} />;
  return a.url ? (
    <a className="aci-att" href={a.url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
      📎 {a.name || "attachment"}
    </a>
  ) : (
    <span className="aci-att">📎 {a.name || "attachment"}</span>
  );
}

// the click-to-WhatsApp ad preview WhatsApp shows on the first message
function AdRef({ ad }) {
  if (!ad) return null;
  const img = ad.thumb || ad.imageUrl;
  const Tag = ad.sourceUrl ? "a" : "div";
  return (
    <Tag className="aci-adref" {...(ad.sourceUrl ? { href: ad.sourceUrl, target: "_blank", rel: "noreferrer" } : {})}>
      {img && <img src={img} alt="" />}
      <span style={{ minWidth: 0 }}>
        <div className="aci-adref-t">{ad.title || "Ad"}</div>
        {ad.body && <div className="aci-adref-b">{ad.body}</div>}
        <div className="aci-adref-src">Ad · {ad.app === "instagram" ? "Instagram" : ad.app === "facebook" ? "Facebook" : "Meta"}</div>
      </span>
    </Tag>
  );
}

function ContactInfo({ sel, profile, link, onClose, onOpenLead }) {
  const c = CH[sel.chatChannel] || CH.messenger;
  const p = profile || {};
  const name = p.name || sel.name;
  const phone = p.phone || sel.phone;
  const ad = p.ad;
  const adImg = ad && (ad.thumb || ad.imageUrl);
  const kv = (k, v) =>
    v ? (
      <div className="aci-kv">
        <span>{k}</span>
        <span>{v}</span>
      </div>
    ) : null;
  return (
    <aside className="aci-info" aria-label="Contact info">
      <div className="aci-info-head">
        <button type="button" className="aci-icon-btn" onClick={onClose} aria-label="Close contact info">
          {I.close}
        </button>
        {sel.chatChannel === "whatsapp" ? "Contact info" : "Profile"}
      </div>
      <div className="aci-info-body">
        <div className="aci-info-card aci-info-top">
          <Avatar name={name} channel={sel.chatChannel} size={110} badge />
          <div className="aci-info-name">{name}</div>
          <div className="aci-info-num">{phone ? fmtPhone(phone) : sel.chatChannel === "whatsapp" ? "Number hidden by WhatsApp" : `${c.label} user`}</div>
          <div className="aci-info-acts">
            {phone && (
              <a className="aci-info-act" href={`tel:${phone}`}>
                {I.phone}Call
              </a>
            )}
            <button type="button" className="aci-info-act" onClick={onOpenLead}>
              {I.lead}Lead
            </button>
            {link && (
              <a className="aci-info-act" href={link} target="_blank" rel="noreferrer">
                {I.open}Meta
              </a>
            )}
          </div>
        </div>

        {ad && (
          <div className="aci-info-card aci-info-ad">
            <div className="aci-info-label">Came from this ad</div>
            {adImg && <img src={adImg} alt="Ad" />}
            <div className="aci-info-ad-t">{ad.title || "Ad"}</div>
            {ad.body && <div className="aci-info-ad-b">{ad.body}</div>}
            <div className="aci-info-note" style={{ marginTop: 6 }}>
              {ad.app === "instagram" ? "Instagram" : ad.app === "facebook" ? "Facebook" : "Meta"} ad{ad.sourceId ? ` · ad id ${ad.sourceId}` : ""}
            </div>
            {ad.sourceUrl && (
              <a className="aci-info-link" href={ad.sourceUrl} target="_blank" rel="noreferrer">
                Open the ad post ↗
              </a>
            )}
          </div>
        )}

        <div className="aci-info-card">
          <div className="aci-info-label">In the CRM</div>
          {kv("Stage", p.stage || sel.stage ? <span className="aci-stage">{p.stage || sel.stage}</span> : null)}
          {kv("Status", p.subStatus)}
          {kv("Assigned to", p.assignedTo || "Not assigned")}
          {kv("Email", p.email)}
          {kv("Profile", [p.persona, p.education].filter(Boolean).join(" · "))}
          {kv("City", p.city)}
          {kv("Source", p.source)}
          {kv("Follow-up", p.nextFollowUp ? when(p.nextFollowUp) : null)}
          {kv("Lead created", when(p.createdAt))}
        </div>

        <div className="aci-info-card">
          <div className="aci-info-label">Chat</div>
          {kv("Channel", c.label)}
          {kv("Started", when(p.startedAt || sel.chatStartedAt))}
          {kv("Last message", when(sel.chatLastAt))}
          {kv("We last replied", p.repliedAt || sel.chatRepliedAt ? when(p.repliedAt || sel.chatRepliedAt) : "Not yet")}
          {p.ourNumbers && p.ourNumbers.length > 0 && kv("Our number", p.ourNumbers.map((n) => `${n.label}${n.connected ? "" : " (offline)"}`).join(", "))}
        </div>

        <div className="aci-info-card aci-info-note">
          {sel.chatChannel === "whatsapp"
            ? "WhatsApp doesn't share the customer's profile photo or name with our number's connection — only the number and the ad they came from."
            : "Meta shares the customer's name; their profile photo needs Meta App Review (advanced messaging access), so initials are shown instead."}
        </div>
      </div>
    </aside>
  );
}

export default function AdChatInbox({ open, onClose, initialChannel, initialLead }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [sel, setSel] = useState(null);
  const [conv, setConv] = useState(null);
  const [convErr, setConvErr] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewLead, setViewLead] = useState(null);
  const [showInfo, setShowInfo] = useState(readInfoPref);
  // composer
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState([]); // optimistic bubbles
  const [sendErr, setSendErr] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [saved, setSaved] = useState(loadSaved);
  const [, tick] = useState(0);

  const selRef = useRef(null);
  selRef.current = sel;
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const typingAt = useRef(0);
  const inputRef = useRef(null);

  const loadList = async () => {
    setLoading(true);
    const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(channel ? { channel } : {}) }).toString();
    const res = await request.get({ entity: `facebook/chats${qs ? `?${qs}` : ""}` });
    setLoading(false);
    if (res?.success) {
      setRows(res.result.rows);
      setTotal(res.result.total);
      setUnread(res.result.unread || 0);
      setErr("");
    } else setErr(res?.message || "Could not load the chats.");
  };

  const loadConv = async (lead, quiet) => {
    if (!quiet) setConvErr("");
    const res = await request.get({ entity: `facebook/chats/${lead._id}/messages` });
    if (selRef.current && String(selRef.current._id) !== String(lead._id)) return; // switched meanwhile
    if (res?.success) {
      setConv(res.result);
      setPending((p) => p.filter((x) => x.failed)); // real messages replaced the optimistic ones
    } else if (!quiet) {
      setConv(null);
      setConvErr(res?.message || "Could not load this chat.");
    }
  };

  const action = (lead, a) => request.post({ entity: `facebook/chats/${lead._id}/action`, jsonData: { action: a } }).catch(() => {});

  // Opened from the header's channel icons: jump to that channel / chat.
  useEffect(() => {
    if (!open) return;
    if (initialChannel !== undefined) setChannel(initialChannel || "");
    if (initialLead) setSel(initialLead);
  }, [open, initialChannel, initialLead]);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(loadList, q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, channel]);

  // open a chat: load it, tell Meta it was seen, then keep it fresh every 6 s
  useEffect(() => {
    setConv(null);
    setPending([]);
    setSendErr("");
    setText("");
    setFile(null);
    setShowEmoji(false);
    setShowSaved(false);
    if (!sel) return undefined;
    loadConv(sel);
    action(sel, "mark_seen");
    setRows((rs) => rs.map((r) => (String(r._id) === String(sel._id) ? { ...r, unread: false } : r)));
    const iv = setInterval(() => loadConv(sel, true), 6000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conv, pending]);

  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 60000); // window countdown
    return () => clearInterval(iv);
  }, []);

  // grow the reply box with its text, like the apps
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // live: any chat moved → refresh the list (and the open chat if it's that one)
  useEffect(() => {
    if (!open) return undefined;
    const s = getSocket();
    if (!s) return undefined;
    let t = null;
    const on = (p) => {
      clearTimeout(t);
      t = setTimeout(() => {
        loadList();
        if (selRef.current && String(selRef.current._id) === String(p.id)) loadConv(selRef.current, true);
      }, 600);
    };
    s.on("lead:chat", on);
    return () => {
      clearTimeout(t);
      s.off("lead:chat", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, channel]);

  const win = conv?.window;
  const isWa = sel?.chatChannel === "whatsapp";
  const canSend = sel && (isWa || !win || win.open || win.humanAgent);
  const theme = (CH[sel?.chatChannel] || CH.messenger).cls;

  const toggleInfo = (v) => {
    const next = typeof v === "boolean" ? v : !showInfo;
    setShowInfo(next);
    try {
      window.localStorage.setItem(INFO_KEY, next ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  const onType = (v) => {
    setText(v);
    if (sel && v && Date.now() - typingAt.current > 5000) {
      typingAt.current = Date.now();
      action(sel, "typing_on");
    }
  };

  const send = async (retry) => {
    if (!sel || sending) return;
    const body = retry ? retry.text : text.trim();
    const f = retry ? retry.file : file;
    if (!body && !f) return;
    const key = `p${Date.now()}`;
    setPending((p) => [...p.filter((x) => x.key !== retry?.key), { key, text: body, file: f, at: new Date() }]);
    if (!retry) {
      setText("");
      setFile(null);
    }
    setSending(true);
    setSendErr("");
    const form = new FormData();
    if (body) form.append("text", body);
    if (f) form.append("file", f);
    const res = await sendForm(sel._id, form);
    setSending(false);
    if (res?.success) {
      setTimeout(() => loadConv(sel, true), 1200);
    } else {
      setPending((p) => p.map((x) => (x.key === key ? { ...x, failed: true } : x)));
      setSendErr(res?.message || "Could not send.");
    }
    action(sel, "typing_off");
  };

  const saveCurrent = () => {
    const v = text.trim();
    if (!v) return;
    const next = [v, ...saved.filter((s) => s !== v)].slice(0, 20);
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  const removeSaved = (s) => {
    const next = saved.filter((x) => x !== s);
    setSaved(next.length ? next : DEFAULT_SAVED);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  // messages + optimistic ones, laid out like the apps: day separators, and
  // runs of bubbles from the same side grouped (first / last of a run)
  const items = useMemo(() => {
    const msgs = [
      ...((conv && conv.messages) || []).map((m) => ({ ...m, mine: !m.fromCustomer })),
      ...pending.map((p) => ({ text: p.text, at: p.at, mine: true, pending: p, attachments: p.file ? [{ name: p.file.name }] : [] })),
    ];
    const firstCustomer = msgs.findIndex((m) => !m.mine);
    return msgs.map((m, i) => {
      const prev = msgs[i - 1];
      const next = msgs[i + 1];
      const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
      const near = (a, b) => a && b && a.mine === b.mine && Math.abs(new Date(b.at) - new Date(a.at)) < 5 * 60e3 && dayKey(a.at) === dayKey(b.at);
      const out = { ...m, newDay, first: !near(prev, m), last: !near(m, next), adRef: i === firstCustomer };
      // Messenger shows a time line after a long pause
      out.timeBreak = !newDay && prev && new Date(m.at) - new Date(prev.at) > 60 * 60e3;
      return out;
    });
  }, [conv, pending]);

  const shown = onlyUnread ? rows.filter((r) => r.unread) : rows;
  const profile = conv?.profile;
  const headName = profile?.name || sel?.name;
  const headSub = sel
    ? isWa
      ? sel.phone
        ? fmtPhone(sel.phone)
        : "WhatsApp"
      : `${(CH[sel.chatChannel] || CH.messenger).label}${win ? (win.open ? " · active chat" : "") : ""}`
    : "";

  const waTicks = (m) => {
    if (m.pending) return m.pending.failed ? <span className="fail">!</span> : <span className="ok">{I.clock}</span>;
    if (m.status === "failed") return <span className="fail">!</span>;
    if (m.status === "sending") return <span className="ok">{I.clock}</span>;
    return <span className="ok">{I.check}</span>;
  };

  return (
    <HubModal open={open} onClose={onClose} title="Ad chat inbox" subtitle={`${total} chats · ${unread} unread · owner & Super Admin`} width={sel && showInfo ? 1380 : 1180}>
      <div className={`aci ${sel && showInfo ? "with-info" : ""}`}>
        {/* ── chat list ── */}
        <div className="aci-side">
          <div className="aci-side-top">
            <label className="aci-search">
              {I.search}
              <input placeholder="Search name, number or message" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
            </label>
            <div className="aci-chips">
              {[["", "All"], ["whatsapp", "WhatsApp"], ["messenger", "Messenger"], ["instagram", "Instagram"]].map(([k, l]) => (
                <button key={k} type="button" className={`aci-chip ${channel === k ? "on" : ""}`} onClick={() => setChannel(k)}>
                  {k && <span className="dot" style={{ background: CH[k].color }} />}
                  {l}
                </button>
              ))}
              <button type="button" className={`aci-chip ${onlyUnread ? "on" : ""}`} onClick={() => setOnlyUnread((v) => !v)}>
                Unread{unread ? ` ${unread}` : ""}
              </button>
            </div>
          </div>
          <div className="aci-list">
            {err && <div className="aci-err">{err}</div>}
            {!err && !shown.length && <div className="aci-empty">{loading ? "Loading chats…" : "No chats."}</div>}
            {shown.map((r) => {
              const on = sel && String(sel._id) === String(r._id);
              const meta = [r.phone ? fmtPhone(r.phone) : null, r.stage].filter(Boolean).join(" · ");
              return (
                <button key={r._id} type="button" className={`aci-item ${on ? "on" : ""} ${r.unread ? "unread" : ""}`} onClick={() => setSel(r)}>
                  <Avatar name={r.name} channel={r.chatChannel} badge />
                  <span className="aci-item-body">
                    <span className="aci-item-row">
                      <span className="aci-item-name">{r.name}</span>
                      <span className="aci-item-time">{listTime(r.chatLastAt)}</span>
                    </span>
                    <span className="aci-item-row">
                      <span className="aci-item-msg">
                        {r.chatRepliedAt && new Date(r.chatRepliedAt) >= new Date(r.chatLastAt || 0) ? "You: " : ""}
                        {r.chatLastMessage || "—"}
                      </span>
                      {r.unread && <span className="aci-unread" aria-label="unread" />}
                    </span>
                    {meta && <span className="aci-item-meta" style={{ display: "block" }}>{meta}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── conversation ── */}
        <div className={`aci-main ${sel ? theme : ""}`}>
          {!sel ? (
            <div className="aci-blank">
              <svg width="72" height="72" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.35 }}><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H5.17L4 17.17V4h16v12z" /></svg>
              <b>Ad chat inbox</b>
              Pick a chat to read and reply — WhatsApp, Messenger and Instagram in one place.
            </div>
          ) : (
            <>
              <div className="aci-head">
                <button type="button" className="aci-head-who" onClick={() => toggleInfo(true)} title="Contact info" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar name={headName} channel={sel.chatChannel} size={40} />
                  <span style={{ minWidth: 0 }}>
                    <div className="aci-head-name">{headName}</div>
                    <div className="aci-head-sub">{headSub}</div>
                  </span>
                </button>
                {sel.phone && (
                  <a className="aci-icon-btn" href={`tel:${sel.phone}`} title="Call" aria-label="Call">
                    {I.phone}
                  </a>
                )}
                {conv?.link && (
                  <a className="aci-icon-btn" href={conv.link} target="_blank" rel="noreferrer" title="Open in Meta inbox" aria-label="Open in Meta inbox">
                    {I.open}
                  </a>
                )}
                <button type="button" className="aci-icon-btn" onClick={() => setViewLead(sel)} title="Open lead" aria-label="Open lead">
                  {I.lead}
                </button>
                <button type="button" className={`aci-icon-btn ${showInfo ? "on" : ""}`} onClick={() => toggleInfo()} title="Contact info" aria-label="Contact info">
                  {I.info}
                </button>
              </div>

              <div className="aci-body">
                {convErr && <div className="aci-notice">{convErr}</div>}
                {!conv && !convErr && <div className="aci-loading">Loading conversation…</div>}
                {conv && isWa && (
                  <div className="aci-notice">🔒 Messages come from the customer&rsquo;s WhatsApp to our connected number.</div>
                )}
                {items.map((m, i) => {
                  const showMsAv = theme !== "wa" && !m.mine && m.last;
                  return (
                    <React.Fragment key={m.pending ? m.pending.key : i}>
                      {m.newDay && <div className="aci-day">{theme === "wa" ? dayLabel(m.at) : when(m.at)}</div>}
                      {m.timeBreak && theme !== "wa" && <div className="aci-day">{when(m.at)}</div>}
                      <div className={`aci-row ${m.mine ? "mine" : ""} ${m.first ? "first" : ""} ${m.last ? "last" : ""} ${m.first && i > 0 && !m.newDay ? "gap" : ""}`}>
                        {theme !== "wa" && !m.mine && (
                          <span className="aci-ms-av">{showMsAv && <Avatar name={headName} channel={sel.chatChannel} size={28} />}</span>
                        )}
                        <div
                          className="aci-bubble"
                          title={theme !== "wa" ? `${m.mine && m.fromName ? `${m.fromName} · ` : ""}${when(m.at)}` : undefined}
                          style={m.pending && m.pending.failed && theme !== "wa" ? { background: "#dc2626", color: "#fff" } : m.pending && theme !== "wa" ? { opacity: 0.7 } : undefined}
                        >
                          {isWa && m.adRef && profile?.ad && <AdRef ad={profile.ad} />}
                          {m.text}
                          {m.attachments?.map((a, j) => (
                            <div key={j} className={m.text || j ? "aci-att-gap" : ""}>
                              <Attachment a={a} />
                            </div>
                          ))}
                          {!m.text && !m.attachments?.length && "—"}
                          {theme === "wa" && (
                            <span className="aci-wa-meta">
                              {clock(m.at)}
                              {m.mine && waTicks(m)}
                            </span>
                          )}
                        </div>
                      </div>
                      {m.pending && m.pending.failed && (
                        <div className="aci-ms-status" style={{ color: "#dc2626" }}>
                          Not sent ·{" "}
                          <button type="button" className="aci-retry" onClick={() => send(m.pending)}>
                            Retry
                          </button>
                        </div>
                      )}
                      {theme !== "wa" && m.pending && !m.pending.failed && <div className="aci-ms-status">Sending…</div>}
                    </React.Fragment>
                  );
                })}
                {theme !== "wa" && items.length > 0 && items[items.length - 1].mine && !items[items.length - 1].pending && <div className="aci-ms-status">Sent</div>}
                <div ref={endRef} />
              </div>

              {/* reply window (Meta's 24 h / 7 day rule) */}
              {isWa ? (
                <div className="aci-window ok">Replies go from your connected WhatsApp business number (text only).</div>
              ) : (
                win && (
                  <div className={`aci-window ${win.open ? "ok" : win.humanAgent ? "warn" : "closed"}`}>
                    {win.open
                      ? `Reply window open — closes in ${left(win.endsAt)}`
                      : win.humanAgent
                      ? `Over 24 h since their last message — your reply goes with Meta's Human Agent tag (allowed until ${when(win.humanAgentEndsAt)}).`
                      : "Meta allows replies only within 7 days of the customer's last message — wait for them to write again."}
                  </div>
                )
              )}

              {/* composer */}
              <div className="aci-compose">
                {sendErr && <div className="aci-send-err">{sendErr}</div>}
                {file && (
                  <div className="aci-file">
                    📎 {file.name} <span style={{ opacity: 0.6 }}>{Math.ceil(file.size / 1024)} KB</span>
                    <button type="button" aria-label="Remove file" onClick={() => setFile(null)}>
                      ×
                    </button>
                  </div>
                )}
                {showEmoji && (
                  <div className="aci-pop aci-emoji">
                    {EMOJI.map((e) => (
                      <button key={e} type="button" onClick={() => setText((t) => t + e)}>
                        {e}
                      </button>
                    ))}
                  </div>
                )}
                {showSaved && (
                  <div className="aci-pop aci-saved">
                    <div className="aci-saved-head">
                      <b>Saved replies</b>
                      <button type="button" className="aci-mini-btn" disabled={!text.trim()} onClick={saveCurrent}>
                        + Save what I typed
                      </button>
                    </div>
                    {saved.map((s) => (
                      <div key={s} className="aci-saved-row">
                        <button
                          type="button"
                          onClick={() => {
                            setText(s);
                            setShowSaved(false);
                            inputRef.current?.focus();
                          }}
                        >
                          {s}
                        </button>
                        <button type="button" aria-label="Delete saved reply" onClick={() => removeSaved(s)}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="aci-compose-row">
                  <button type="button" className={`aci-icon-btn ${showEmoji ? "on" : ""}`} aria-label="Emoji" disabled={!canSend} onClick={() => { setShowEmoji((v) => !v); setShowSaved(false); }}>
                    {I.emoji}
                  </button>
                  <button type="button" className="aci-icon-btn" aria-label="Attach a file" disabled={!canSend || isWa} title={isWa ? "WhatsApp replies are text only for now" : "Attach a file"} onClick={() => fileRef.current?.click()}>
                    {I.clip}
                  </button>
                  <button type="button" className={`aci-icon-btn ${showSaved ? "on" : ""}`} aria-label="Saved replies" title="Saved replies" disabled={!canSend} onClick={() => { setShowSaved((v) => !v); setShowEmoji(false); }}>
                    {I.saved}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setFile(f);
                      e.target.value = "";
                    }}
                  />
                  <label className="aci-input">
                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={text}
                      disabled={!canSend}
                      placeholder={canSend ? (theme === "wa" ? "Type a message" : "Aa") : "Replying is not possible for this chat"}
                      aria-label="Reply"
                      onChange={(e) => onType(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                  </label>
                  <button type="button" className="aci-send" aria-label="Send" title="Send (Enter)" disabled={!canSend || sending || (!text.trim() && !file)} onClick={() => send()}>
                    {I.send}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {sel && showInfo && <ContactInfo sel={sel} profile={profile} link={conv?.link} onClose={() => toggleInfo(false)} onOpenLead={() => setViewLead(sel)} />}
      </div>
      {viewLead && <LeadFullDetailModal lead={viewLead} onClose={() => setViewLead(null)} />}
    </HubModal>
  );
}
