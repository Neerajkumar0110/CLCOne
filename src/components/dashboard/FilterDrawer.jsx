import React, { useEffect, useState } from "react";
import { Drawer, Select, Input, InputNumber, Switch } from "antd";

// Resolve "@facetName" option refs against the summary payload's facets.
function resolveOptions(opt, facets) {
  if (Array.isArray(opt)) return opt.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  if (typeof opt === "string" && opt.startsWith("@")) {
    return (facets[opt.slice(1)] || []).map((v) => ({ value: v, label: v }));
  }
  return [];
}

export default function FilterDrawer({ open, onClose, fields = [], facets = {}, value = {}, onApply }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const clear = () => setDraft({});

  return (
    <Drawer
      title="Filters"
      placement="right"
      width={330}
      open={open}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="hub-btn" style={{ flex: 1 }} onClick={clear}>
            Reset
          </button>
          <button
            type="button"
            className="hub-btn hub-btn-primary"
            style={{ flex: 1 }}
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply Filters
          </button>
        </div>
      }
    >
      <div className="dash-drawer-fields">
        {fields.map((f) => (
          <div key={f.key} className="hub-form-row">
            <label>{f.label}</label>
            {f.kind === "text" && (
              <Input
                allowClear
                value={draft[f.key] || ""}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder || ""}
              />
            )}
            {(f.kind === "select" || f.kind === "multiselect") && (
              <Select
                mode={f.kind === "multiselect" ? "multiple" : undefined}
                allowClear
                style={{ width: "100%" }}
                value={draft[f.key] || (f.kind === "multiselect" ? [] : undefined)}
                onChange={(v) => set(f.key, v)}
                options={resolveOptions(f.options, facets)}
                placeholder={`Any ${f.label.toLowerCase()}`}
                maxTagCount="responsive"
              />
            )}
            {f.kind === "bool" && (
              <Switch
                checked={draft[f.key] === "1"}
                onChange={(v) => set(f.key, v ? "1" : "")}
              />
            )}
            {f.kind === "number" && (
              <InputNumber
                style={{ width: "100%" }}
                value={draft[f.key]}
                onChange={(v) => set(f.key, v == null ? "" : String(v))}
              />
            )}
          </div>
        ))}
        {fields.length === 0 && <div className="hub-empty">No extra filters for this dashboard.</div>}
      </div>
    </Drawer>
  );
}
