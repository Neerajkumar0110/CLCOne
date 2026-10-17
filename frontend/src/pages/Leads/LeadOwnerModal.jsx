import React, { useEffect, useMemo, useState } from "react";
import { message } from "antd";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import { DEPARTMENT_ROLES } from "@/config/roles";

// Lead Stages → Lead List → "Lead Owner". Management picks WHICH leads
// (the ticked rows, one lead, or every lead the list currently shows) and
// WHO owns them — one Sales user, several split evenly, or several with a
// count each. Backend: POST /api/lead/assign-owner (leadController/
// assignOwner.js), which re-applies the same list filter + visibility scope.
//
// props:
//   open, onClose, onDone()
//   admins          — every Admin (filtered here to active Sales users)
//   selectedIds     — ticked lead ids ([] = none)
//   single          — { _id, name, assignedUserName } when opened from one row
//   viewCount       — how many leads the list currently shows
//   viewFilter      — the list's current by-stage params
//   viewLabel       — e.g. "No Response · Ringing"

const fullName = (a) => `${a.name || ""} ${a.surname || ""}`.trim() || a.email;

export default function LeadOwnerModal({ open, onClose, onDone, admins, selectedIds, single, viewCount, viewFilter, viewLabel }) {
  const salesUsers = useMemo(
    () =>
      admins
        .filter((a) => a.enabled !== false && DEPARTMENT_ROLES.Sales.includes(a.role))
        .sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [admins]
  );

  const [target, setTarget] = useState("selected"); // selected | view
  const [limit, setLimit] = useState("");
  const [mode, setMode] = useState("equal"); // equal | custom
  const [picked, setPicked] = useState([]); // [{ userId, count }]
  const [unassign, setUnassign] = useState(false);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setTarget(single || selectedIds.length ? "selected" : "view");
    setLimit("");
    setMode("equal");
    setPicked([]);
    setUnassign(false);
    setQ("");
    setErr("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const leadIds = single ? [single._id] : selectedIds;
  const total = target === "selected" ? leadIds.length : Math.min(viewCount, Number(limit) || viewCount);
  const customSum = picked.reduce((t, p) => t + (Number(p.count) || 0), 0);
  const isPicked = (id) => picked.some((p) => p.userId === id);

  const toggleUser = (id) => {
    if (single) {
      setPicked([{ userId: id, count: 1 }]);
      return;
    }
    setPicked((list) => (list.some((p) => p.userId === id) ? list.filter((p) => p.userId !== id) : [...list, { userId: id, count: "" }]));
  };
  const setCount = (id, v) => setPicked((list) => list.map((p) => (p.userId === id ? { ...p, count: v.replace(/\D/g, "") } : p)));

  // Preview of who gets how many (mirrors the backend's split).
  const preview = useMemo(() => {
    if (unassign || !picked.length || !total) return [];
    if (mode === "custom") return picked.map((p) => ({ ...p, n: Number(p.count) || 0 }));
    const per = Math.floor(total / picked.length);
    const extra = total % picked.length;
    return picked.map((p, i) => ({ ...p, n: per + (i < extra ? 1 : 0) }));
  }, [picked, mode, total, unassign]);

  const nameOf = (id) => {
    const a = salesUsers.find((u) => u._id === id);
    return a ? fullName(a) : "—";
  };

  const shown = salesUsers.filter((a) => !q || `${fullName(a)} ${a.email} ${a.role}`.toLowerCase().includes(q.toLowerCase()));

  const submit = async () => {
    if (saving) return;
    setErr("");
    if (!total) return setErr("No leads to assign.");
    if (!unassign && !picked.length) return setErr("Pick at least one owner.");
    if (!unassign && mode === "custom") {
      if (picked.some((p) => !(Number(p.count) > 0))) return setErr("Enter how many leads each picked owner gets.");
      if (customSum > total) return setErr(`The counts add up to ${customSum}, but only ${total} lead(s) are in scope.`);
    }

    const body = {
      ...(target === "selected" ? { leadIds } : { filter: viewFilter, ...(Number(limit) ? { limit: Number(limit) } : {}) }),
      unassign,
      mode: single ? "equal" : mode,
      owners: picked.map((p) => ({ userId: p.userId, count: Number(p.count) || 0 })),
    };
    setSaving(true);
    const r = await request.post({ entity: "lead/assign-owner", jsonData: body });
    setSaving(false);
    if (r?.success) {
      message.success(r.message);
      onDone?.();
      onClose();
    } else {
      setErr(r?.message || "Could not change the owner.");
    }
  };

  const chip = (on) => ({
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    border: `1px solid ${on ? "var(--hub-blue, #2563eb)" : "var(--hub-border)"}`,
    background: on ? "var(--hub-blue, #2563eb)" : "var(--hub-surface)",
    color: on ? "#fff" : "var(--hub-text-soft)",
  });

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="Lead Owner"
      subtitle={single ? `${single.name} · now: ${single.assignedUserName || "Unassigned"}` : "Choose the leads, then who owns them"}
      width={620}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : unassign ? `Remove owner (${total})` : `Assign ${total} lead${total === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      {!single && (
        <div className="hub-form-row">
          <label>Which leads</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" style={chip(target === "selected")} disabled={!selectedIds.length} onClick={() => setTarget("selected")}>
              Selected ({selectedIds.length})
            </button>
            <button type="button" style={chip(target === "view")} disabled={!viewCount} onClick={() => setTarget("view")}>
              All in this list ({viewCount}){viewLabel ? ` · ${viewLabel}` : ""}
            </button>
          </div>
          {target === "view" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12.5, color: "var(--hub-muted)" }}>
              Only the first
              <input
                className="hub-input"
                style={{ width: 90 }}
                inputMode="numeric"
                placeholder={String(viewCount)}
                value={limit}
                onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
              />
              leads (newest first) — leave blank for all.
            </div>
          )}
        </div>
      )}

      <div className="hub-form-row">
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={unassign} onChange={(e) => setUnassign(e.target.checked)} />
          Remove the owner instead (make {single ? "this lead" : "these leads"} unassigned)
        </label>
      </div>

      {!unassign && (
        <>
          {!single && (
            <div className="hub-form-row">
              <label>How to split</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" style={chip(mode === "equal")} onClick={() => setMode("equal")}>Split equally</button>
                <button type="button" style={chip(mode === "custom")} onClick={() => setMode("custom")}>Set count per owner</button>
              </div>
            </div>
          )}

          <div className="hub-form-row">
            <label>{single ? "New owner" : `Owners (${picked.length} picked)`}</label>
            <input className="hub-input" placeholder="Search Sales users…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--hub-border)", borderRadius: 10, marginTop: 6 }}>
              {shown.length === 0 && <div className="hub-empty" style={{ padding: 16 }}>No Sales users found.</div>}
              {shown.map((a) => {
                const on = isPicked(a._id);
                const p = picked.find((x) => x.userId === a._id);
                return (
                  <div
                    key={a._id}
                    onClick={() => toggleUser(a._id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--hub-border)",
                      background: on ? "var(--hub-bg-soft, rgba(37,99,235,.06))" : undefined,
                    }}
                  >
                    <input type={single ? "radio" : "checkbox"} readOnly checked={on} style={{ pointerEvents: "none" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{fullName(a)}</div>
                      <div style={{ fontSize: 11.5, color: "var(--hub-muted)" }}>{a.role}</div>
                    </div>
                    {on && !single && mode === "custom" && (
                      <input
                        className="hub-input"
                        style={{ width: 80 }}
                        inputMode="numeric"
                        placeholder="Leads"
                        value={p.count}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setCount(a._id, e.target.value)}
                      />
                    )}
                    {on && !single && mode === "equal" && (
                      <span className="hub-badge hub-badge-blue">{preview.find((x) => x.userId === a._id)?.n ?? 0}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {!single && preview.length > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--hub-muted)", lineHeight: 1.6 }}>
              {mode === "custom" ? (
                <>
                  Total <b style={{ color: customSum > total ? "#dc2626" : "var(--hub-text)" }}>{customSum}</b> of {total} lead(s):{" "}
                </>
              ) : (
                <>{total} lead(s) → </>
              )}
              {preview.map((p) => `${nameOf(p.userId)} ${p.n}`).join(" · ")}
            </div>
          )}
        </>
      )}

      {err && (
        <div style={{ marginTop: 8 }}>
          <span className="hub-badge hub-badge-red">{err}</span>
        </div>
      )}
    </HubModal>
  );
}
