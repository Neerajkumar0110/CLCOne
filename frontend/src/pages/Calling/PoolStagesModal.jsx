import React, { useEffect, useState } from "react";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import { ArrowUpOutlined, ArrowDownOutlined, CloseOutlined } from "@ant-design/icons";

// Calls page → Instant Lead Pool → "Dialing stages". Management picks up to
// `max` stages IN ORDER: the pool dials #1 first, moves to #2 once #1's leads
// run out, and so on (backend: jobs/leadPoolSyncTick.js advanceAndQueue).
// Click a stage to add it at the end of the order; arrows reorder; × removes.
const RESULT_LABEL = { Connected: "connected", Completed: "completed", Callback: "callback", "No Answer": "no answer", Busy: "busy", Failed: "failed", Dialing: "dialing now", Voicemail: "voicemail", DNC: "DNC" };

// One stage's progress under the saved order: "Finished" / "Dialing now",
// dialed vs left, and what the dialed ones came to.
function StageLine({ st }) {
  if (!st) return null;
  if (!st.order) {
    return <div style={{ fontSize: 11.5, color: "var(--hub-muted)" }}>{st.available} leads to dial</div>;
  }
  const res = Object.entries(st.results || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${RESULT_LABEL[k] || k}`)
    .join(" · ");
  return (
    <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 2 }}>
      {st.finished ? (
        <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ Finished</span>
      ) : st.active ? (
        <span style={{ color: "#2563eb", fontWeight: 700 }}>● Dialing now</span>
      ) : (
        <span style={{ fontWeight: 700 }}>Waiting</span>
      )}
      {" · "}
      <b>{st.dialed}</b> dialed · <b>{st.left}</b> left
      {res && <div style={{ marginTop: 1 }}>{res}</div>}
    </div>
  );
}

export default function PoolStagesModal({ open, onClose, onSave, options = [], current = [], max = 5, saving }) {
  const [picked, setPicked] = useState([]);
  // Per stage: leads the pool can dial, and for the stages in the saved
  // order how this round went (backend leadPool.js stageStats).
  const [stats, setStats] = useState({});

  useEffect(() => {
    if (!open) return;
    setPicked(current.length ? [...current] : ["New Lead"]);
    request.get({ entity: "calling/lead-pool/stage-stats" }).then((r) => {
      if (r?.success) setStats(Object.fromEntries((r.result?.stages || []).map((x) => [x.stage, x])));
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (s) =>
    setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : p.length >= max ? p : [...p, s]));
  const move = (i, d) =>
    setPicked((p) => {
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const n = [...p];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const unchanged = picked.length === current.length && picked.every((s, i) => s === current[i]);

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="Dialing stages"
      subtitle={`Pick up to ${max} stages in order — #1 dials first, then #2 when #1 runs out, and so on.`}
      width={560}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="hub-btn hub-btn-primary"
            disabled={saving || !picked.length || unchanged}
            onClick={() => onSave(picked)}
          >
            {saving ? "Saving…" : "Save order"}
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Order ({picked.length}/{max})</label>
        {picked.length === 0 && <div className="hub-empty" style={{ padding: 12 }}>Pick at least one stage below.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {picked.map((s, i) => (
            <div
              key={s}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                border: "1px solid var(--hub-border)", borderRadius: 10,
                background: i === 0 ? "rgba(37,99,235,.06)" : "var(--hub-surface)",
              }}
            >
              <span style={{
                width: 24, height: 24, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: "var(--hub-blue, #2563eb)", color: "#fff", fontSize: 12, fontWeight: 800, flex: "0 0 auto",
              }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{s}</span>
                <StageLine st={stats[s]} />
              </span>
              <button type="button" className="hub-btn" style={{ padding: "2px 8px" }} disabled={i === 0} onClick={() => move(i, -1)} title="Move up"><ArrowUpOutlined /></button>
              <button type="button" className="hub-btn" style={{ padding: "2px 8px" }} disabled={i === picked.length - 1} onClick={() => move(i, 1)} title="Move down"><ArrowDownOutlined /></button>
              <button type="button" className="hub-btn" style={{ padding: "2px 8px" }} onClick={() => toggle(s)} title="Remove"><CloseOutlined /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="hub-form-row">
        <label>Add a stage {picked.length >= max ? `(max ${max} reached)` : ""}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {options.filter((s) => !picked.includes(s)).map((s) => (
            <button
              key={s}
              type="button"
              disabled={picked.length >= max}
              onClick={() => toggle(s)}
              style={{
                padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                cursor: picked.length >= max ? "not-allowed" : "pointer",
                border: "1px solid var(--hub-border)", background: "var(--hub-surface)", color: "var(--hub-text-soft)",
                opacity: picked.length >= max ? 0.5 : 1,
              }}
            >
              + {s}
              {stats[s] && <span style={{ marginLeft: 6, color: "var(--hub-muted)", fontWeight: 600 }}>({stats[s].available})</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--hub-muted)", lineHeight: 1.5 }}>
        Counts under each stage are for this round (since the order was last saved). Saving restarts the queue: leads
        still waiting from the current order are dropped and re-picked from #1.
        New Lead dials only unassigned leads. If new leads land in an earlier stage, the pool goes back to it first.
      </div>
    </HubModal>
  );
}
