import React, { useState } from "react";
import HubModal from "@/components/HubModal";
import request from "@/request/request";

export default function CreateRepoModal({ open, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [org, setOrg] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setIsPrivate(true);
    setOrg("");
  };

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const res = await request.post({
      entity: "git/repos",
      jsonData: { name: name.trim(), description, private: isPrivate, org: org.trim() || undefined },
    });
    setSaving(false);
    if (res.success) {
      reset();
      onClose();
      onCreated?.(res.result);
    }
  };

  return (
    <HubModal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New Repository"
      subtitle="Creates a real repository on GitHub under your connected account (or an org, if given)."
      width={460}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Creating…" : "Create Repository"}
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Repository Name</label>
        <input className="hub-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. crm-mobile-app" />
      </div>

      <div className="hub-form-row">
        <label>Description</label>
        <input className="hub-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </div>

      <div className="hub-form-row">
        <label>Organization (optional)</label>
        <input className="hub-input" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Leave blank to create under your own account" />
      </div>

      <div className="hub-form-row">
        <label>Visibility</label>
        <select className="hub-select" value={isPrivate ? "private" : "public"} onChange={(e) => setIsPrivate(e.target.value === "private")}>
          <option value="private">Private</option>
          <option value="public">Public</option>
        </select>
      </div>
    </HubModal>
  );
}
