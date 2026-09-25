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
import { startPoll } from "@/utils/poll";
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

    // Visibility-aware: no thread polling while the tab is in the background.
    const stop = startPoll(poll, 3000);
    return () => {
      cancelled = true;
      stop();
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
        <div className="hub-chat-people-list" style={{ width: 240, flexShrink: 0, overflowY: "auto" }}>
          <div className="hub-chat-people-heading">
            PEOPLE
          </div>

          {conversations.length === 0 && (
            <div className="hub-chat-people-empty">No other users yet.</div>
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
                className={`hub-chat-person ${activeUserId === c.user._id ? "active" : ""}`}
                onClick={() => openThread(c.user._id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
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
                      background: online ? "var(--hub-green)" : "var(--hub-muted)",
                      border: "2px solid var(--hub-surface)",
                    }}
                  />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="hub-chat-person-name">{name}</div>
                  <div className="hub-chat-person-preview">
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
                  borderBottom: "1px solid var(--hub-border)",
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
                  <div style={{ fontSize: 11, color: onlineIds.has(activeConversation.user._id) ? "var(--hub-green)" : "var(--hub-muted)" }}>
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
                            background: mine ? "var(--hub-blue)" : "var(--hub-surface-2)",
                            color: mine ? "#fff" : "var(--hub-text)",
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
                                borderLeft: `3px solid ${mine ? "rgba(255,255,255,0.6)" : "var(--hub-blue)"}`,
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
                            color: "var(--hub-muted)",
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
                            <span style={{ color: m.readAt ? "var(--hub-blue)" : "var(--hub-muted)", fontSize: 12, letterSpacing: -2 }}>
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
                    borderTop: "1px solid var(--hub-border)",
                    background: "var(--hub-surface-2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ borderLeft: "3px solid var(--hub-blue)", paddingLeft: 8, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--hub-blue)" }}>Replying to {replyingTo.fromName}</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--hub-muted)",
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

              <div style={{ padding: 14, borderTop: "1px solid var(--hub-border)", display: "flex", gap: 10, alignItems: "center" }}>
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
                    border: "1px solid var(--hub-border)",
                    borderRadius: 20,
                    fontSize: 13,
                    outline: "none",
                    background: "var(--hub-surface)",
                    color: "var(--hub-text)",
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

// WhatsApp isn't offered here — no approved WhatsApp Business/API provider is
// configured for this deployment (see communication.js's connectionStatus),
// so a "WhatsApp template" option would silently never be sendable.
function NewTemplateModal({ open, onClose, onSave, saving }) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), subject, html: body });
  };

  useEffect(() => {
    if (!open) {
      setName("");
      setSubject("");
      setBody("");
    }
  }, [open]);

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="New Email Template"
      width={460}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Saving…" : "Save Template"}
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Template Name</label>
        <input className="hub-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Renewal Reminder" />
      </div>

      <div className="hub-form-row">
        <label>Subject</label>
        <input className="hub-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hi {{name}}, your..." />
      </div>

      <div className="hub-form-row">
        <label>Message Body (HTML)</label>
        <textarea
          className="hub-input"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="<p>Hi {{name}}, ...</p>"
          style={{ resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 4 }}>
          Use {"{{variable}}"} placeholders — they're detected automatically when you save.
        </div>
      </div>
    </HubModal>
  );
}

// Real backend behind this now (communication.js) — previously "Connect/
// Disconnect" just flipped local component state and the template list was
// a hardcoded array, with zero server calls of any kind.
function EmailWhatsapp() {
  const [status, setStatus] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, t, d] = await Promise.all([
        request.get({ entity: "lms/admin/communication/status" }),
        request.get({ entity: "lms/admin/communication/templates" }),
        request.get({ entity: "lms/admin/communication/delivery-summary?days=7" }),
      ]);
      setStatus(s?.result || null);
      setTemplates(t?.result || []);
      setDelivery(d?.result || null);
    } catch (e) {
      /* best-effort — cards below handle null state */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveTemplate = async (t) => {
    setSaving(true);
    try {
      await request.post({ entity: "lms/admin/communication/templates", jsonData: t });
      setTemplateModalOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hub-stack">
      <div className="hub-grid-2">
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>📧 Email</h3>
            <span className={`hub-badge ${status?.email?.connected ? "hub-badge-green" : "hub-badge-gray"}`}>
              {loading ? "Checking…" : status?.email?.connected ? "Connected" : "Not Connected"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 14 }}>
            {status?.email?.connected
              ? `Sending via ${status.email.provider}. Configured in backend/.env (GMAIL_USER / GMAIL_APP_PASSWORD).`
              : "Not configured — set GMAIL_USER / GMAIL_APP_PASSWORD in the backend environment."}
          </div>
          {delivery && (
            <div style={{ fontSize: 12.5 }}>
              Last {delivery.days}d: <b>{delivery.totalSent}</b> sent, <b>{delivery.totalFailed}</b> failed
              {delivery.totalSent + delivery.totalFailed > 0 ? ` (${delivery.failureRate}% failure rate)` : ""}
            </div>
          )}
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3>💬 WhatsApp</h3>
            <span className="hub-badge hub-badge-gray">Not Connected</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 14 }}>
            {status?.whatsapp?.note || "No WhatsApp Business/API provider is configured for this deployment."}
          </div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Email Templates</h3>
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
                <th>Subject</th>
                <th>Variables</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 && !loading && (
                <tr><td colSpan={3} style={{ color: "var(--hub-muted)" }}>No templates yet — create one above.</td></tr>
              )}
              {templates.map((t) => (
                <tr key={t._id}>
                  <td>{t.name}</td>
                  <td>{t.subject}</td>
                  <td>{(t.variables || []).map((v) => `{{${v}}}`).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <NewTemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onSave={saveTemplate}
        saving={saving}
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