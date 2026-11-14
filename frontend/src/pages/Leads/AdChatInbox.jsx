import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { request } from "@/request";
import { getSocket } from "@/socket";
import { API_BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";
import HubModal from "@/components/HubModal";
import LeadFullDetailModal from "@/components/LeadFullDetail";

// Ad chat inbox — owner + Super Admin read AND answer every connected chat
// (backend facebookController/chats.js). Messages go out through Meta's
// Messenger Send API; new messages come in live (socket "lead:chat" from the
// webhook / 20 s poller) and the open chat re-reads itself every few seconds.

const CH = {
  messenger: { label: "Messenger", color: "#0084FF" },
  instagram: { label: "Instagram", color: "#E1306C" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
};
const EMOJI = "😀 😁 😂 🤣 😊 😍 😘 😎 🤔 😅 🙂 🙃 😉 😇 🥳 😢 😭 😡 👍 👎 👏 🙏 💪 👌 ✌️ 🤝 👋 ❤️ 💙 💯 🔥 ✨ 🎉 ✅ ❌ ⭐ 📞 📧 📅 ⏰ 💼 🎓 📚 💻 🚀 📍 ➡️".split(" ");
const SAVED_KEY = "adChatSavedReplies";
const DEFAULT_SAVED = [
  "Hi! Thanks for reaching out to Career Lab Consulting. How can we help you?",
  "Could you please share your phone number? Our counsellor will call you shortly.",
  "Our next batch starts soon — would you like the fee details and syllabus?",
];

const when = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
const left = (d) => {
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "0m";
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const loadSaved = () => {
  try {
    const v = JSON.parse(window.localStorage.getItem(SAVED_KEY) || "null");
    return Array.isArray(v) && v.length ? v : DEFAULT_SAVED;
  } catch {
    return DEFAULT_SAVED;
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

function Attachment({ a, mine }) {
  const t = String(a.type || "");
  if (a.url && (t.startsWith("image") || t === "image"))
    return (
      <a href={a.url} target="_blank" rel="noreferrer">
        <img src={a.preview || a.url} alt={a.name || "image"} style={{ maxWidth: 260, maxHeight: 260, borderRadius: 10, display: "block" }} />
      </a>
    );
  if (a.url && t.startsWith("video")) return <video src={a.url} controls style={{ maxWidth: 300, borderRadius: 10 }} />;
  if (a.url && t.startsWith("audio")) return <audio src={a.url} controls style={{ maxWidth: 260 }} />;
  return a.url ? (
    <a href={a.url} target="_blank" rel="noreferrer" style={{ color: mine ? "#fff" : "var(--hub-blue)", textDecoration: "underline" }}>
      📎 {a.name || "attachment"}
    </a>
  ) : (
    <span>📎 {a.name || "attachment"}</span>
  );
}

export default function AdChatInbox({ open, onClose }) {
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
  const canSend = sel && sel.chatChannel !== "whatsapp" && (!win || win.open || win.humanAgent);

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

  const shown = onlyUnread ? rows.filter((r) => r.unread) : rows;
  const bubble = (mine) => ({
    padding: "8px 12px",
    borderRadius: 14,
    fontSize: 13,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: mine ? "#0084FF" : "var(--hub-bg)",
    color: mine ? "#fff" : "var(--hub-text)",
    border: mine ? "none" : "1px solid var(--hub-border)",
  });

  return (
    <HubModal open={open} onClose={onClose} title="Ad chat inbox" subtitle={`${total} chats · ${unread} unread · owner & Super Admin`} width={1180}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) minmax(0, 1fr)", gap: 12, height: "74vh", minHeight: 460 }}>
        {/* ── list ── */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, border: "1px solid var(--hub-border)", borderRadius: 12 }}>
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--hub-border)" }}>
            <input placeholder="Search name, phone, message…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats"
              style={{ width: "100%", minHeight: 34, borderRadius: 8, border: "1px solid var(--hub-border)", padding: "0 10px", background: "var(--hub-bg)", color: "var(--hub-text)", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["", "All"], ["messenger", "Messenger"], ["instagram", "Instagram"], ["whatsapp", "WhatsApp"]].map(([k, l]) => (
                <button key={k} type="button" className="hub-btn" onClick={() => setChannel(k)}
                  style={{ padding: "2px 10px", minHeight: 28, ...(channel === k ? { background: "var(--hub-blue)", color: "#fff", borderColor: "var(--hub-blue)" } : {}) }}>{l}</button>
              ))}
              <button type="button" className="hub-btn" onClick={() => setOnlyUnread((v) => !v)}
                style={{ padding: "2px 10px", minHeight: 28, ...(onlyUnread ? { background: "#dc2626", color: "#fff", borderColor: "#dc2626" } : {}) }}>Unread {unread ? `(${unread})` : ""}</button>
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {err && <div style={{ padding: 12, color: "#b91c1c", fontSize: 12.5 }}>{err}</div>}
            {!err && !shown.length && <div style={{ padding: 12, color: "var(--hub-muted)", fontSize: 12.5 }}>{loading ? "Loading…" : "No chats."}</div>}
            {shown.map((r) => {
              const c = CH[r.chatChannel] || CH.messenger;
              const on = sel && String(sel._id) === String(r._id);
              return (
                <button key={r._id} type="button" onClick={() => setSel(r)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: 0, borderBottom: "1px solid var(--hub-border)", cursor: "pointer",
                    background: on ? "var(--hub-bg-soft)" : "transparent", boxShadow: on ? `inset 3px 0 0 ${c.color}` : "none", color: "var(--hub-text)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: r.unread ? 800 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.unread && <span aria-label="unread" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "#0084FF", marginRight: 6 }} />}
                      {r.name}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--hub-muted)", whiteSpace: "nowrap" }}>{when(r.chatLastAt)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: r.unread ? "var(--hub-text)" : "var(--hub-muted)", fontWeight: r.unread ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                    {r.chatLastMessage || "—"}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: 11, flexWrap: "wrap" }}>
                    <span style={{ color: c.color, fontWeight: 700 }}>{c.label}</span>
                    {r.phone && <span style={{ color: "#15803d", fontWeight: 600 }}>· {r.phone}</span>}
                    {r.stage && <span style={{ color: "var(--hub-muted)" }}>· {r.stage}</span>}
                    {r.chatRepliedAt && <span style={{ color: "var(--hub-muted)" }}>· replied</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── conversation ── */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, border: "1px solid var(--hub-border)", borderRadius: 12 }}>
          {!sel ? (
            <div style={{ margin: "auto", color: "var(--hub-muted)", fontSize: 13 }}>Pick a chat to read and reply.</div>
          ) : (
            <>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--hub-border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <b>{sel.name}</b>
                  <div style={{ fontSize: 12, color: "var(--hub-muted)" }}>
                    {(CH[sel.chatChannel] || CH.messenger).label} · started {when(sel.chatStartedAt)}{sel.phone ? ` · ${sel.phone}` : " · no phone yet"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {sel.phone && <a className="hub-btn" href={`tel:${sel.phone}`}>Call</a>}
                  <button type="button" className="hub-btn" onClick={() => setViewLead(sel)}>Open lead</button>
                  {conv?.link && <a className="hub-btn" href={conv.link} target="_blank" rel="noreferrer">Open in Meta inbox</a>}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8, background: "var(--hub-bg-soft)" }}>
                {convErr && <div style={{ color: "#b91c1c", fontSize: 12.5 }}>{convErr}</div>}
                {!conv && !convErr && <div style={{ color: "var(--hub-muted)", fontSize: 12.5 }}>Loading conversation…</div>}
                {conv?.messages?.map((m, i) => {
                  const mine = !m.fromCustomer;
                  return (
                    <div key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "75%" }}>
                      <div style={bubble(mine)}>
                        {m.text}
                        {m.attachments?.map((a, j) => (
                          <div key={j} style={{ marginTop: m.text ? 6 : 0 }}><Attachment a={a} mine={mine} /></div>
                        ))}
                        {!m.text && !m.attachments?.length && "—"}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--hub-muted)", marginTop: 2, textAlign: mine ? "right" : "left" }}>
                        {mine ? `${m.fromName || "Page"} · ` : ""}{when(m.at)}
                      </div>
                    </div>
                  );
                })}
                {pending.map((p) => (
                  <div key={p.key} style={{ alignSelf: "flex-end", maxWidth: "75%", opacity: p.failed ? 1 : 0.7 }}>
                    <div style={{ ...bubble(true), background: p.failed ? "#dc2626" : "#0084FF" }}>
                      {p.text}
                      {p.file && <div style={{ marginTop: p.text ? 6 : 0 }}>📎 {p.file.name}</div>}
                    </div>
                    <div style={{ fontSize: 10.5, color: p.failed ? "#b91c1c" : "var(--hub-muted)", marginTop: 2, textAlign: "right" }}>
                      {p.failed ? (
                        <>Not sent · <button type="button" onClick={() => send(p)} style={{ border: 0, background: "none", color: "#b91c1c", textDecoration: "underline", cursor: "pointer", padding: 0 }}>Retry</button></>
                      ) : "Sending…"}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              {/* reply window (Meta's 24 h / 7 day rule) */}
              {sel.chatChannel === "whatsapp" ? (
                <div style={{ padding: "8px 14px", fontSize: 12, background: "rgba(37,211,102,.1)", borderTop: "1px solid var(--hub-border)" }}>Reply to WhatsApp chats from Messenger › WhatsApp.</div>
              ) : win && (
                <div style={{ padding: "6px 14px", fontSize: 12, borderTop: "1px solid var(--hub-border)",
                  background: win.open ? "rgba(22,163,74,.07)" : win.humanAgent ? "rgba(217,119,6,.08)" : "rgba(220,38,38,.07)",
                  color: win.open ? "#15803d" : win.humanAgent ? "#b45309" : "#b91c1c" }}>
                  {win.open ? `Reply window open — closes in ${left(win.endsAt)}`
                    : win.humanAgent ? `Over 24 h since their last message — your reply goes with Meta's Human Agent tag (allowed until ${when(win.humanAgentEndsAt)}).`
                    : "Meta allows replies only within 7 days of the customer's last message — wait for them to write again."}
                </div>
              )}

              {/* composer */}
              <div style={{ borderTop: "1px solid var(--hub-border)", padding: 10, position: "relative" }}>
                {sendErr && <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 6 }}>{sendErr}</div>}
                {file && (
                  <div style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "var(--hub-bg-soft)", border: "1px solid var(--hub-border)", marginBottom: 6 }}>
                    📎 {file.name} <span style={{ color: "var(--hub-muted)" }}>{Math.ceil(file.size / 1024)} KB</span>
                    <button type="button" aria-label="Remove file" onClick={() => setFile(null)} style={{ border: 0, background: "none", cursor: "pointer", fontSize: 14 }}>×</button>
                  </div>
                )}
                {showEmoji && (
                  <div style={{ position: "absolute", bottom: "100%", left: 10, background: "var(--hub-bg)", border: "1px solid var(--hub-border)", borderRadius: 12, padding: 8, display: "grid", gridTemplateColumns: "repeat(12, 30px)", gap: 2, boxShadow: "0 8px 24px rgba(0,0,0,.15)", zIndex: 5 }}>
                    {EMOJI.map((e) => (
                      <button key={e} type="button" onClick={() => setText((t) => t + e)} style={{ width: 30, height: 30, border: 0, background: "none", fontSize: 18, cursor: "pointer" }}>{e}</button>
                    ))}
                  </div>
                )}
                {showSaved && (
                  <div style={{ position: "absolute", bottom: "100%", left: 10, right: 10, background: "var(--hub-bg)", border: "1px solid var(--hub-border)", borderRadius: 12, padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,.15)", zIndex: 5, maxHeight: 260, overflowY: "auto" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <b style={{ fontSize: 12.5 }}>Saved replies</b>
                      <button type="button" className="hub-btn" disabled={!text.trim()} onClick={saveCurrent} style={{ minHeight: 26, padding: "0 8px", fontSize: 12 }}>+ Save what I typed</button>
                    </div>
                    {saved.map((s) => (
                      <div key={s} style={{ display: "flex", gap: 6, alignItems: "center", borderTop: "1px solid var(--hub-border)", padding: "6px 0" }}>
                        <button type="button" onClick={() => { setText(s); setShowSaved(false); }} style={{ flex: 1, textAlign: "left", border: 0, background: "none", cursor: "pointer", fontSize: 12.5, color: "var(--hub-text)" }}>{s}</button>
                        <button type="button" aria-label="Delete saved reply" onClick={() => removeSaved(s)} style={{ border: 0, background: "none", cursor: "pointer", color: "var(--hub-muted)" }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                  <button type="button" className="hub-btn" aria-label="Emoji" disabled={!canSend} onClick={() => { setShowEmoji((v) => !v); setShowSaved(false); }} style={{ minHeight: 38, padding: "0 10px" }}>😊</button>
                  <button type="button" className="hub-btn" aria-label="Attach a file" disabled={!canSend} onClick={() => fileRef.current?.click()} style={{ minHeight: 38, padding: "0 10px" }}>📎</button>
                  <button type="button" className="hub-btn" disabled={!canSend} onClick={() => { setShowSaved((v) => !v); setShowEmoji(false); }} style={{ minHeight: 38, padding: "0 10px", fontSize: 12 }}>Saved</button>
                  <input ref={fileRef} type="file" hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
                  <textarea
                    rows={1}
                    value={text}
                    disabled={!canSend}
                    placeholder={canSend ? "Write a reply… (Enter to send, Shift+Enter for a new line)" : "Replying is not possible for this chat"}
                    aria-label="Reply"
                    onChange={(e) => onType(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    style={{ flex: 1, resize: "none", minHeight: 38, maxHeight: 140, borderRadius: 10, border: "1px solid var(--hub-border)", padding: "9px 12px", font: "inherit", fontSize: 13, background: "var(--hub-bg)", color: "var(--hub-text)" }}
                  />
                  <button type="button" className="hub-btn" disabled={!canSend || sending || (!text.trim() && !file)} onClick={() => send()}
                    style={{ minHeight: 38, background: "#0084FF", color: "#fff", borderColor: "#0084FF" }}>{sending ? "Sending…" : "Send"}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {viewLead && <LeadFullDetailModal lead={viewLead} onClose={() => setViewLead(null)} />}
    </HubModal>
  );
}
