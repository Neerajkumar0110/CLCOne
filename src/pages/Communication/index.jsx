import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import HubTabs from "@/components/HubTabs";
import HubModal from "@/components/HubModal";
import { useSocket } from "@/context/socketContext";
import { useMessages } from "@/context/messagesContext";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { request } from "@/request";
import { silentGet } from "@/request/silent";
import { BASE_URL } from "@/config/serverApiConfig";
import { initials, colorForName, displayName } from "@/utils/adminDisplay";
import { PaperClipOutlined, SendOutlined, CloseOutlined, RollbackOutlined } from "@ant-design/icons";

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// A sent message reaches the thread through two independent paths — the
// REST response to sendText/sendFile, and the "message:new" socket echo —
// and there's no guaranteed order between them (the socket push often wins
// the race). Both call this so whichever arrives second is a no-op instead
// of a duplicate bubble.
function appendMessage(prev, msg) {
  if (!prev) return prev;
  if (prev.messages.some((m) => m._id === msg._id)) return prev;
  return { ...prev, messages: [...prev.messages, msg] };
}

// Renders an image inline, a video player inline, or a plain download link
// for anything else — matches the three fileType buckets messageController/
// uploadMessage.js sorts every upload into.
function Attachment({ attachment }) {
  const url = BASE_URL + attachment.url;
  if (attachment.fileType === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={attachment.fileName} style={{ maxWidth: 240, maxHeight: 240, borderRadius: 10, display: "block" }} />
      </a>
    );
  }
  if (attachment.fileType === "video") {
    return <video src={url} controls style={{ maxWidth: 280, borderRadius: 10, display: "block" }} />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "underline" }}
    >
      <PaperClipOutlined /> {attachment.fileName}
    </a>
  );
}

// Also rendered on its own as the Messenger section's "Team Chat" tab
// (pages/ModuleScaffold SectionHub) — it has no hub-page wrapper of its own,
// so it embeds cleanly.
export function TeamChat() {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const { onlineIds } = useSocket();
  const { conversations, markConversationRead, bumpConversationPreview, setActiveConversationId } = useMessages();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeUserId, setActiveUserId] = useState(null);
  const [thread, setThread] = useState(null);
  const [draft, setDraft] = useState("");
  const [sendingFile, setSendingFile] = useState(false);
  // The message currently being replied to (WhatsApp-style quote-and-reply)
  // — { _id, text, attachment, fromName } or null.
  const [replyingTo, setReplyingTo] = useState(null);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);
  const draftInputRef = useRef(null);

  const activeConversation = conversations.find((c) => c.user._id === activeUserId);

  const openThread = async (userId) => {
    setActiveUserId(userId);
    setActiveConversationId(userId);
    setReplyingTo(null);
    markConversationRead(userId);
    const res = await request.get({ entity: "message/thread/" + userId });
    if (res?.success) setThread(res.result);
  };

  // Tell the shared context which thread is on screen, and clear it again
  // on unmount/navigate-away, so notifications elsewhere resume counting
  // this conversation's unread messages once you leave this page.
  useEffect(() => {
    return () => setActiveConversationId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link from the notification bell (?dm=<userId>) — open that
  // conversation once the directory has loaded, otherwise fall back to the
  // first one.
  useEffect(() => {
    if (!conversations.length || activeUserId) return;
    const dmUserId = searchParams.get("dm");
    const target = dmUserId && conversations.some((c) => c.user._id === dmUserId) ? dmUserId : conversations[0].user._id;
    openThread(target);
    if (dmUserId) {
      searchParams.delete("dm");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length]);

  // Near-real-time for the open thread: re-fetch it on a short interval
  // (the backend has no live socket on serverless — see context/
  // socketContext). GET /message/thread also marks incoming messages read
  // server-side, so keeping it open flips the other side's ticks too.
  // Merge rather than replace so an optimistic just-sent bubble isn't
  // dropped in the gap before the server round-trips it back.
  useEffect(() => {
    if (!activeUserId) return undefined;
    let cancelled = false;

    const poll = async () => {
      const res = await silentGet("message/thread/" + activeUserId);
      if (cancelled || !res?.success) return;
      setThread((prev) => {
        if (!prev || !prev.messages) return res.result;
        const byId = new Map(res.result.messages.map((m) => [m._id, m]));
        for (const m of prev.messages) if (!byId.has(m._id)) byId.set(m._id, m);
        const messages = [...byId.values()].sort(
          (a, b) => new Date(a.createdAt || a.created) - new Date(b.createdAt || b.created)
        );
        return { ...res.result, messages };
      });
    };

    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages?.length]);

  const sendingRef = useRef(false);

  const sendText = async () => {
    // Guards against a held/auto-repeating Enter key (or a fast double
    // click on Send) firing this twice before the first request settles —
    // a ref instead of state so the check is synchronous, not delayed a render.
    if (sendingRef.current) return;
    if (!draft.trim() || !activeUserId) return;
    sendingRef.current = true;
    const text = draft.trim();
    const replyToId = replyingTo?._id;
    setDraft("");
    setReplyingTo(null);
    try {
      const res = await request.post({
        entity: "message/create",
        jsonData: { to: activeUserId, text, ...(replyToId ? { replyTo: replyToId } : {}) },
      });
      if (res?.success) {
        setThread((prev) => appendMessage(prev, res.result));
        bumpConversationPreview(res.result, activeUserId);
      }
    } finally {
      sendingRef.current = false;
    }
  };

  const sendFile = async (file) => {
    if (!file || !activeUserId) return;
    setSendingFile(true);
    const replyToId = replyingTo?._id;
    setReplyingTo(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("to", activeUserId);
    if (replyToId) formData.append("replyTo", replyToId);
    const res = await request.post({ entity: "message/upload", jsonData: formData });
    setSendingFile(false);
    if (res?.success) {
      setThread((prev) => appendMessage(prev, res.result));
      bumpConversationPreview(res.result, activeUserId);
    }
  };

  const startReply = (message) => {
    const fromName = message.from === currentAdmin?._id ? "You" : displayName(activeConversation?.user);
    setReplyingTo({
      _id: message._id,
      text: message.text || "",
      attachmentFileName: message.attachment?.fileName || null,
      fromName,
    });
    draftInputRef.current?.focus();
  };

  return (
    <div className="hub-card" style={{ padding: 0, overflow: "hidden" }}>
      {/* A fixed height (not minHeight) is what makes the inner overflowY:
          "auto" panels below actually scroll — with only a minHeight, the
          flex column just kept growing taller as more messages arrived
          instead of clipping and scrolling internally. */}
      <div style={{ display: "flex", height: 560 }}>
        {/* Contact list — every registered admin, not just a fixed team */}
        <div style={{ width: 240, borderRight: "1px solid #f0f0f0", flexShrink: 0, overflowY: "auto" }}>
          <div style={{ padding: "14px 16px", fontSize: 12.5, fontWeight: 700, color: "#8c8c8c" }}>
            PEOPLE
          </div>

          {conversations.length === 0 && (
            <div style={{ padding: "10px 16px", fontSize: 12.5, color: "#8c8c8c" }}>No other users yet.</div>
          )}

          {conversations.map((c) => {
            const name = displayName(c.user);
            const online = onlineIds.has(c.user._id);
            const preview = c.lastMessage
              ? c.lastMessage.attachment
                ? `📎 ${c.lastMessage.attachment.fileName}`
                : c.lastMessage.text
              : "No messages yet";
            return (
              <div
                key={c.user._id}
                onClick={() => openThread(c.user._id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  cursor: "pointer",
                  background: activeUserId === c.user._id ? "#f0f6ff" : "transparent",
                  borderLeft: activeUserId === c.user._id ? "3px solid #2563eb" : "3px solid transparent",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ position: "relative" }}>
                  <div className="hub-avatar" style={{ background: colorForName(name) }}>
                    {initials(name)}
                  </div>
                  <span
                    style={{
                      position: "absolute",
                      bottom: -1,
                      right: -1,
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: online ? "#52c41a" : "#d9d9d9",
                      border: "2px solid #fff",
                    }}
                  />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#8c8c8c",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {preview}
                  </div>
                </div>
                {c.unreadCount > 0 && (
                  <span className="hub-badge hub-badge-red" style={{ flexShrink: 0 }}>{c.unreadCount}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Thread */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {!activeConversation ? (
            <div className="hub-empty" style={{ margin: "auto" }}>Pick someone on the left to start chatting.</div>
          ) : (
            <>
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid #f0f0f0",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div className="hub-avatar" style={{ background: colorForName(displayName(activeConversation.user)) }}>
                  {initials(displayName(activeConversation.user))}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{displayName(activeConversation.user)}</div>
                  <div style={{ fontSize: 11, color: onlineIds.has(activeConversation.user._id) ? "#52c41a" : "#8c8c8c" }}>
                    {onlineIds.has(activeConversation.user._id) ? "Online" : "Offline"}
                  </div>
                </div>
              </div>

              <div style={{ flex: 1, padding: 18, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
                {(thread?.messages || []).map((m) => {
                  const mine = m.from === currentAdmin?._id;
                  const replyBtn = (
                    <button
                      type="button"
                      className="hub-chat-reply-btn"
                      onClick={() => startReply(m)}
                      title="Reply"
                    >
                      <RollbackOutlined style={{ fontSize: 12 }} />
                    </button>
                  );
                  return (
                    <div
                      key={m._id}
                      className="hub-chat-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        alignSelf: mine ? "flex-end" : "flex-start",
                        maxWidth: "70%",
                        animation: "hub-fade-up 0.3s ease backwards",
                      }}
                    >
                      {mine && replyBtn}
                      <div>
                        <div
                          style={{
                            background: mine ? "#2563eb" : "#f0f2f5",
                            color: mine ? "#fff" : "#1f1f1f",
                            padding: m.attachment ? 6 : "8px 12px",
                            borderRadius: 12,
                            borderBottomRightRadius: mine ? 4 : 12,
                            borderBottomLeftRadius: mine ? 12 : 4,
                            fontSize: 13,
                          }}
                        >
                          {m.replyTo && (
                            <div
                              style={{
                                borderLeft: `3px solid ${mine ? "rgba(255,255,255,0.6)" : "#2563eb"}`,
                                background: mine ? "rgba(255,255,255,0.15)" : "rgba(37,99,235,0.06)",
                                borderRadius: 6,
                                padding: "4px 8px",
                                marginBottom: 6,
                              }}
                            >
                              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.9 }}>{m.replyTo.fromName}</div>
                              <div
                                style={{
                                  fontSize: 11.5,
                                  opacity: 0.85,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  maxWidth: 220,
                                }}
                              >
                                {m.replyTo.text || (m.replyTo.attachmentFileName ? `📎 ${m.replyTo.attachmentFileName}` : "")}
                              </div>
                            </div>
                          )}
                          {m.attachment && <Attachment attachment={m.attachment} />}
                          {m.text && <div style={{ padding: m.attachment ? "6px 4px 0" : 0 }}>{m.text}</div>}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "#8c8c8c",
                            marginTop: 3,
                            textAlign: mine ? "right" : "left",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: mine ? "flex-end" : "flex-start",
                            gap: 4,
                          }}
                        >
                          {fmtTime(m.created)}
                          {mine && (
                            <span style={{ color: m.readAt ? "#2563eb" : "#8c8c8c", fontSize: 12, letterSpacing: -2 }}>
                              {m.readAt ? "✓✓" : "✓"}
                            </span>
                          )}
                        </div>
                      </div>
                      {!mine && replyBtn}
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {replyingTo && (
                <div
                  style={{
                    padding: "8px 14px",
                    borderTop: "1px solid #f0f0f0",
                    background: "#f8f9fb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ borderLeft: "3px solid #2563eb", paddingLeft: 8, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "#2563eb" }}>Replying to {replyingTo.fromName}</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#667085",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {replyingTo.text || (replyingTo.attachmentFileName ? `📎 ${replyingTo.attachmentFileName}` : "")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="hub-btn"
                    style={{ padding: "4px 8px", flexShrink: 0 }}
                    onClick={() => setReplyingTo(null)}
                    title="Cancel reply"
                  >
                    <CloseOutlined />
                  </button>
                </div>
              )}

              <div style={{ padding: 14, borderTop: "1px solid #f0f0f0", display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) sendFile(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="hub-btn"
                  disabled={sendingFile}
                  onClick={() => fileInputRef.current?.click()}
                  title="Send an image, video or file"
                >
                  <PaperClipOutlined />
                </button>
                <input
                  ref={draftInputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendText();
                    }
                  }}
                  placeholder={`Message ${displayName(activeConversation.user).split(" ")[0]}...`}
                  style={{
                    flex: 1,
                    padding: "9px 14px",
                    border: "1px solid #e3e9f5",
                    borderRadius: 20,
                    fontSize: 13,
                    outline: "none",
                  }}
                />
                <button className="hub-btn hub-btn-primary" type="button" onClick={sendText}>
                  <SendOutlined /> Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NewTemplateModal({ open, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("Email");
  const [body, setBody] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), channel, usage: 0 });
    setName("");
    setBody("");
    onClose();
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="New Message Template"
      width={420}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit}>
            Save Template
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Template Name</label>
        <input className="hub-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Renewal Reminder" />
      </div>

      <div className="hub-form-row">
        <label>Channel</label>
        <select className="hub-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="Email">Email</option>
          <option value="WhatsApp">WhatsApp</option>
        </select>
      </div>

      <div className="hub-form-row">
        <label>Message Body</label>
        <textarea
          className="hub-input"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hi {{name}}, ..."
          style={{ resize: "vertical", fontFamily: "inherit" }}
        />
      </div>
    </HubModal>
  );
}

function EmailWhatsapp() {
  const [connected, setConnected] = useState({ email: true, whatsapp: false });
  const [templates, setTemplates] = useState([
    { name: "Welcome Email", channel: "Email", usage: 412 },
    { name: "Follow-up Reminder", channel: "Email", usage: 268 },
    { name: "Quote Sent", channel: "WhatsApp", usage: 190 },
    { name: "Payment Reminder", channel: "WhatsApp", usage: 134 },
  ]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  return (
    <div className="hub-stack">
      <div className="hub-grid-2">
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>📧 Email</h3>
            <span className={`hub-badge ${connected.email ? "hub-badge-green" : "hub-badge-gray"}`}>
              {connected.email ? "Connected" : "Not Connected"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 14 }}>
            Send and receive email directly from leads and customers.
          </div>
          <button
            className={`hub-btn ${connected.email ? "" : "hub-btn-primary"}`}
            type="button"
            onClick={() => setConnected((p) => ({ ...p, email: !p.email }))}
          >
            {connected.email ? "Disconnect" : "Connect Email"}
          </button>
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3>💬 WhatsApp</h3>
            <span className={`hub-badge ${connected.whatsapp ? "hub-badge-green" : "hub-badge-gray"}`}>
              {connected.whatsapp ? "Connected" : "Not Connected"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 14 }}>
            Message leads on WhatsApp using approved templates.
          </div>
          <button
            className={`hub-btn ${connected.whatsapp ? "" : "hub-btn-primary"}`}
            type="button"
            onClick={() => setConnected((p) => ({ ...p, whatsapp: !p.whatsapp }))}
          >
            {connected.whatsapp ? "Disconnect" : "Connect WhatsApp"}
          </button>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Message Templates</h3>
          <button
            className="hub-btn hub-btn-primary"
            type="button"
            onClick={() => setTemplateModalOpen(true)}
          >
            + New Template
          </button>
        </div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Channel</th>
                <th>Times Used</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td>
                    <span className={`hub-badge ${t.channel === "Email" ? "hub-badge-blue" : "hub-badge-green"}`}>
                      {t.channel}
                    </span>
                  </td>
                  <td>{t.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <NewTemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onAdd={(t) => setTemplates((prev) => [...prev, t])}
      />
    </div>
  );
}

export default function Communication() {
  const [tab, setTab] = useState("chat");

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Communication</h2>
          <p>Chat with your sales team internally, and manage Email & WhatsApp outreach</p>
        </div>
      </div>

      <HubTabs
        tabs={[
          { key: "chat", label: "Team Chat" },
          { key: "channels", label: "Email & WhatsApp" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "chat" ? <TeamChat /> : <EmailWhatsapp />}
    </div>
  );
}