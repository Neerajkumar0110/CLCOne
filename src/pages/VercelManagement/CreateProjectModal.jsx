import React, { useEffect, useState } from "react";
import HubModal from "@/components/HubModal";
import request from "@/request/request";

// Reuses Git Management's own connection — if the same employee has also
// connected GitHub there, this lets them pick straight from their repos
// instead of typing "owner/name" by hand.
function useGitRepos() {
  const [repos, setRepos] = useState([]);
  const [gitConnected, setGitConnected] = useState(false);

  useEffect(() => {
    request.get({ entity: "git/connection" }).then((res) => {
      if (!res.success || !res.result?.connected) return;
      setGitConnected(true);
      request.get({ entity: "git/repos/all" }).then((r) => {
        if (r.success) setRepos(r.result);
      });
    });
  }, []);

  return { repos, gitConnected };
}

export default function CreateProjectModal({ open, onClose, onCreated }) {
  const { repos, gitConnected } = useGitRepos();
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setRepo("");
  };

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const res = await request.post({
      entity: "vercel/projects",
      jsonData: { name: name.trim(), repo: repo || undefined },
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
      title="New Vercel Project"
      subtitle="Creates a real project on Vercel. Link it to a repo so pushes deploy automatically."
      width={460}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Creating…" : "Create Project"}
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Project Name</label>
        <input className="hub-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. crm-marketing-site" />
      </div>

      <div className="hub-form-row">
        <label>Git Repository (optional)</label>
        {gitConnected ? (
          <select className="hub-select" value={repo} onChange={(e) => setRepo(e.target.value)}>
            <option value="">No repository</option>
            {repos.map((r) => (
              <option key={r.fullName} value={r.fullName}>{r.fullName}</option>
            ))}
          </select>
        ) : (
          <input
            className="hub-input"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo — connect Git Management to pick from a list"
          />
        )}
      </div>
    </HubModal>
  );
}
