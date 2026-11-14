import React, { useEffect, useRef, useState } from "react";
import { request } from "@/request";
import { getSocket } from "@/socket";
import HubModal from "@/components/HubModal";
import LeadFullDetailModal from "@/components/LeadFullDetail";

// Ad chat inbox — owner + Super Admin read every connected chat (Messenger,
// Instagram DM, WhatsApp): list of chat leads on the left, the full
// conversation (read live from Meta, backend facebookController/chats.js) on
// the right. New chats / messages arrive over the socket (lead:chat).

const CH = {
  messenger: { label: "Messenger", color: "#0084FF" },
  instagram: { label: "Instagram", color: "#E1306C" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
};

const when = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

export default function AdChatInbox({ open, onClose }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState("");
  const [sel, setSel] = useState(null);
  const [conv, setConv] = useState(null);
  const [convErr, setConvErr] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewLead, setViewLead] = useState(null);
  const selRef = useRef(null);
  selRef.current = sel;
  const endRef = useRef(null);

  const loadList = async () => {
    setLoading(true);
    const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(channel ? { channel } : {}) }).toString();
    const res = await request.get({ entity: `facebook/chats${qs ? `?${qs}` : ""}` });
    setLoading(false);
    if (res?.success) {
      setRows(res.result.rows);
      setTotal(res.result.total);
      setErr("");
    } else setErr(res?.message || "Could not load the chats.");
  };

  const loadConv = async (lead) => {
    setConvErr("");
    const res = await request.get({ entity: `facebook/chats/${lead._id}/messages` });
    if (res?.success) setConv(res.result);
    else {
      setConv(null);
      setConvErr(res?.message || "Could not load this chat.");
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(loadList, q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, channel]);

  useEffect(() => {
    if (sel) loadConv(sel);
    else setConv(null);
  }, [sel]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conv]);

  // live: refresh the list, and the open conversation if it's the one that moved
  useEffect(() => {
    if (!open) return undefined;
    const s = getSocket();
    if (!s) return undefined;
    let t = null;
    const on = (p) => {
      clearTimeout(t);
      t = setTimeout(() => {
        loadList();
        if (selRef.current && String(selRef.current._id) === String(p.id)) loadConv(selRef.current);
      }, 800);
    };
    s.on("lead:chat", on);
    return () => {
      clearTimeout(t);
      s.off("lead:chat", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, channel]);

  return (
    <HubModal open={open} onClose={onClose} title="Ad chat inbox" subtitle={`${total} chats · owner & Super Admin`} width={1100}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) minmax(0, 1fr)", gap: 12, height: "70vh", minHeight: 420 }}>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, border: "1px solid var(--hub-border)", borderRadius: 12 }}>
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--hub-border)" }}>
            <input
              className="hub-input"
              placeholder="Search name, phone, message…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search chats"
              style={{ width: "100%", minHeight: 34, borderRadius: 8, border: "1px solid var(--hub-border)", padding: "0 10px", background: "var(--hub-bg)", color: "var(--hub-text)" }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["", "All"], ["messenger", "Messenger"], ["instagram", "Instagram"], ["whatsapp", "WhatsApp"]].map(([k, l]) => (
                <button key={k} type="button" className="hub-btn" onClick={() => setChannel(k)}
                  style={{ padding: "2px 10px", minHeight: 28, ...(channel === k ? { background: "var(--hub-blue)", color: "#fff", borderColor: "var(--hub-blue)" } : {}) }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {err && <div style={{ padding: 12, color: "#b91c1c", fontSize: 12.5 }}>{err}</div>}
            {!err && !rows.length && <div style={{ padding: 12, color: "var(--hub-muted)", fontSize: 12.5 }}>{loading ? "Loading…" : "No chats."}</div>}
            {rows.map((r) => {
              const c = CH[r.chatChannel] || CH.messenger;
              const on = sel && String(sel._id) === String(r._id);
              return (
                <button key={r._id} type="button" onClick={() => setSel(r)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: 0, borderBottom: "1px solid var(--hub-border)", cursor: "pointer",
                    background: on ? "var(--hub-bg-soft)" : "transparent", boxShadow: on ? `inset 3px 0 0 ${c.color}` : "none", color: "var(--hub-text)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <b style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</b>
                    <span style={{ fontSize: 11, color: "var(--hub-muted)", whiteSpace: "nowrap" }}>{when(r.chatLastAt)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--hub-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                    {r.chatLastMessage || "—"}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: 11 }}>
                    <span style={{ color: c.color, fontWeight: 700 }}>{c.label}</span>
                    {r.phone && <span style={{ color: "#15803d", fontWeight: 600 }}>· {r.phone}</span>}
                    {r.stage && <span style={{ color: "var(--hub-muted)" }}>· {r.stage}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, border: "1px solid var(--hub-border)", borderRadius: 12 }}>
          {!sel ? (
            <div style={{ margin: "auto", color: "var(--hub-muted)", fontSize: 13 }}>Pick a chat to read it.</div>
          ) : (
            <>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--hub-border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <b>{sel.name}</b>
                  <div style={{ fontSize: 12, color: "var(--hub-muted)" }}>
                    {(CH[sel.chatChannel] || CH.messenger).label} · started {when(sel.chatStartedAt)}{sel.phone ? ` · ${sel.phone}` : " · no phone yet"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="hub-btn" onClick={() => setViewLead(sel)}>Open lead</button>
                  {conv?.link && <a className="hub-btn" href={conv.link} target="_blank" rel="noreferrer">Reply in Meta inbox</a>}
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8, background: "var(--hub-bg-soft)" }}>
                {convErr && <div style={{ color: "#b91c1c", fontSize: 12.5 }}>{convErr}</div>}
                {!conv && !convErr && <div style={{ color: "var(--hub-muted)", fontSize: 12.5 }}>Loading conversation…</div>}
                {conv?.messages?.map((m, i) => (
                  <div key={i} style={{ alignSelf: m.fromCustomer ? "flex-start" : "flex-end", maxWidth: "75%" }}>
                    <div style={{ padding: "8px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap",
                      background: m.fromCustomer ? "var(--hub-bg)" : "#0084FF", color: m.fromCustomer ? "var(--hub-text)" : "#fff",
                      border: m.fromCustomer ? "1px solid var(--hub-border)" : "none" }}>
                      {m.text || (m.attachments?.length ? "" : "—")}
                      {m.attachments?.map((a, j) => (
                        <div key={j} style={{ marginTop: m.text ? 6 : 0 }}>
                          {a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: m.fromCustomer ? "var(--hub-blue)" : "#fff", textDecoration: "underline" }}>{a.name || a.type || "attachment"}</a> : (a.name || "attachment")}
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--hub-muted)", marginTop: 2, textAlign: m.fromCustomer ? "left" : "right" }}>
                      {m.fromCustomer ? "" : `${m.fromName || "Page"} · `}{when(m.at)}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            </>
          )}
        </div>
      </div>
      {viewLead && <LeadFullDetailModal lead={viewLead} onClose={() => setViewLead(null)} />}
    </HubModal>
  );
}
