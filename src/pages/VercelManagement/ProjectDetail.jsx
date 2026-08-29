import React, { useEffect, useState } from "react";
import { Modal, message } from "antd";
import {
  ArrowLeftOutlined,
  ThunderboltOutlined,
  RollbackOutlined,
  StopOutlined,
  FileTextOutlined,
  GlobalOutlined,
  SettingOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import HubTabs from "@/components/HubTabs";
import HubModal from "@/components/HubModal";
import request from "@/request/request";

const STATE_BADGE = {
  READY: "hub-badge-green",
  ERROR: "hub-badge-red",
  CANCELED: "hub-badge-gray",
  DELETED: "hub-badge-gray",
  BUILDING: "hub-badge-blue",
  INITIALIZING: "hub-badge-blue",
  QUEUED: "hub-badge-yellow",
  BLOCKED: "hub-badge-yellow",
};

function StateBadge({ state }) {
  return <span className={`hub-badge ${STATE_BADGE[state] || "hub-badge-gray"}`}>{state}</span>;
}

function useEntity(entity, active, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    request
      .get({ entity })
      .then((res) => {
        if (cancelled) return;
        setData(res.success ? res.result : []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [active, entity, reloadKey, ...deps]);

  return { data: data || [], loading, reload: () => setReloadKey((k) => k + 1) };
}

function BuildLogsModal({ open, onClose, deploymentId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !deploymentId) return;
    setLoading(true);
    request
      .get({ entity: `vercel/deployments/${deploymentId}/logs` })
      .then((res) => setLogs(res.success ? res.result : []))
      .finally(() => setLoading(false));
  }, [open, deploymentId]);

  return (
    <HubModal open={open} onClose={onClose} title="Build Logs" width={720}>
      <div
        style={{
          background: "#0f1117",
          color: "#d6d6d6",
          borderRadius: 8,
          padding: 14,
          fontFamily: "monospace",
          fontSize: 12,
          maxHeight: 480,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {loading && "Loading logs…"}
        {!loading && logs.length === 0 && "No log output for this deployment."}
        {logs.map((l, i) => (
          <div key={i} style={{ color: l.level === "error" ? "#ff6b6b" : l.level === "warning" ? "#ffd166" : "#d6d6d6" }}>
            {l.text}
          </div>
        ))}
      </div>
    </HubModal>
  );
}

function Deployments({ project, active }) {
  const { data, loading, reload } = useEntity(`vercel/projects/${project.id}/deployments`, active);
  const [logsFor, setLogsFor] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const runAction = (id, label, action) => {
    Modal.confirm({
      title: `${label}?`,
      content: "This affects the real Vercel project — this action can't be undone from here.",
      okText: label,
      okButtonProps: { danger: label === "Cancel" },
      onOk: async () => {
        setBusyId(id);
        const res = await action();
        setBusyId(null);
        if (res.success) {
          message.success(res.message);
          reload();
        }
      },
    });
  };

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3><ClockCircleOutlined /> Deployment History</h3>
        <button
          type="button"
          className="hub-btn hub-btn-primary"
          disabled={busyId === "deploy"}
          onClick={() =>
            runAction("deploy", "Deploy", () => request.post({ entity: `vercel/projects/${project.id}/deploy`, jsonData: {} }))
          }
        >
          <ThunderboltOutlined /> Deploy Latest
        </button>
      </div>

      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Deployment</th>
              <th>Target</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={5}><div className="hub-empty">No deployments yet.</div></td></tr>}
            {data.map((d) => (
              <tr key={d.id}>
                <td>
                  <a href={`https://${d.url}`} target="_blank" rel="noreferrer">{d.url}</a>
                </td>
                <td>{d.target || "preview"}</td>
                <td><StateBadge state={d.state} /></td>
                <td>{d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}</td>
                <td>
                  <div className="hub-row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="hub-btn" style={{ padding: "3px 8px" }} onClick={() => setLogsFor(d.id)}>
                      <FileTextOutlined /> Logs
                    </button>
                    <button
                      type="button"
                      className="hub-btn"
                      style={{ padding: "3px 8px" }}
                      disabled={busyId === d.id}
                      onClick={() =>
                        runAction(d.id, "Redeploy", () => request.post({ entity: `vercel/deployments/${d.id}/redeploy`, jsonData: {} }))
                      }
                    >
                      Redeploy
                    </button>
                    {d.target === "production" && d.state === "READY" && (
                      <button
                        type="button"
                        className="hub-btn"
                        style={{ padding: "3px 8px" }}
                        disabled={busyId === d.id}
                        onClick={() =>
                          runAction(d.id, "Rollback", () =>
                            request.post({ entity: `vercel/projects/${project.id}/rollback/${d.id}`, jsonData: {} })
                          )
                        }
                      >
                        <RollbackOutlined /> Rollback to this
                      </button>
                    )}
                    {["QUEUED", "BUILDING", "INITIALIZING"].includes(d.state) && (
                      <button
                        type="button"
                        className="hub-btn"
                        style={{ padding: "3px 8px" }}
                        disabled={busyId === d.id}
                        onClick={() =>
                          runAction(d.id, "Cancel", () => request.post({ entity: `vercel/deployments/${d.id}/cancel`, jsonData: {} }))
                        }
                      >
                        <StopOutlined /> Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BuildLogsModal open={!!logsFor} onClose={() => setLogsFor(null)} deploymentId={logsFor} />
    </div>
  );
}

const TARGETS = ["production", "preview", "development"];

function AddEnvVarModal({ open, onClose, onAdd }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [targets, setTargets] = useState(["production", "preview", "development"]);
  const [saving, setSaving] = useState(false);

  const toggleTarget = (t) => setTargets((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const submit = async () => {
    if (!key.trim() || !targets.length || saving) return;
    setSaving(true);
    await onAdd({ key: key.trim(), value, target: targets });
    setSaving(false);
    setKey("");
    setValue("");
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="Add Environment Variable"
      width={440}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Saving…" : "Add Variable"}
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Key</label>
        <input className="hub-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. DATABASE_URL" />
      </div>
      <div className="hub-form-row">
        <label>Value</label>
        <input className="hub-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Secret value" />
      </div>
      <div className="hub-form-row">
        <label>Environments</label>
        <div className="hub-row" style={{ gap: 14 }}>
          {TARGETS.map((t) => (
            <label key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, textTransform: "capitalize" }}>
              <input type="checkbox" checked={targets.includes(t)} onChange={() => toggleTarget(t)} />
              {t}
            </label>
          ))}
        </div>
      </div>
    </HubModal>
  );
}

function EnvVars({ project, active }) {
  const { data, loading, reload } = useEntity(`vercel/projects/${project.id}/env`, active);
  const [modalOpen, setModalOpen] = useState(false);
  const [revealed, setRevealed] = useState({});

  const add = async (payload) => {
    const res = await request.post({ entity: `vercel/projects/${project.id}/env`, jsonData: payload });
    if (res.success) {
      message.success("Environment variable added");
      setModalOpen(false);
      reload();
    }
  };

  const remove = (envId) => {
    Modal.confirm({
      title: "Remove this environment variable?",
      okText: "Remove",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await request.del({ entity: `vercel/projects/${project.id}/env/${envId}` });
        if (res.success) reload();
      },
    });
  };

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3><SettingOutlined /> Environment Variables</h3>
        <button type="button" className="hub-btn hub-btn-primary" onClick={() => setModalOpen(true)}>
          <PlusOutlined /> Add Variable
        </button>
      </div>

      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Key</th><th>Value</th><th>Environments</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={4}><div className="hub-empty">No environment variables yet.</div></td></tr>}
            {data.map((e) => (
              <tr key={e.id}>
                <td style={{ fontFamily: "monospace" }}>{e.key}</td>
                <td style={{ fontFamily: "monospace", cursor: "pointer" }} onClick={() => setRevealed((p) => ({ ...p, [e.id]: !p[e.id] }))}>
                  {revealed[e.id] ? e.value : "••••••••"}
                </td>
                <td>
                  {e.target.map((t) => (
                    <span key={t} className="hub-badge hub-badge-blue" style={{ marginRight: 4, textTransform: "capitalize" }}>{t}</span>
                  ))}
                </td>
                <td>
                  <button type="button" className="hub-btn" style={{ padding: "3px 8px" }} onClick={() => remove(e.id)}>
                    <DeleteOutlined />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddEnvVarModal open={modalOpen} onClose={() => setModalOpen(false)} onAdd={add} />
    </div>
  );
}

function AddDomainModal({ open, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    await onAdd(name.trim());
    setSaving(false);
    setName("");
  };

  return (
    <HubModal
      open={open}
      onClose={onClose}
      title="Add Domain"
      width={420}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Adding…" : "Add Domain"}
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Domain</label>
        <input className="hub-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. app.example.com" />
      </div>
    </HubModal>
  );
}

function Domains({ project, active }) {
  const { data, loading, reload } = useEntity(`vercel/projects/${project.id}/domains`, active);
  const [modalOpen, setModalOpen] = useState(false);

  const add = async (name) => {
    const res = await request.post({ entity: `vercel/projects/${project.id}/domains`, jsonData: { name } });
    if (res.success) {
      message.success("Domain added");
      setModalOpen(false);
      reload();
    }
  };

  const remove = (name) => {
    Modal.confirm({
      title: `Remove ${name}?`,
      okText: "Remove",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await request.del({ entity: `vercel/projects/${project.id}/domains/${name}` });
        if (res.success) reload();
      },
    });
  };

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3><GlobalOutlined /> Domains</h3>
        <button type="button" className="hub-btn hub-btn-primary" onClick={() => setModalOpen(true)}>
          <PlusOutlined /> Add Domain
        </button>
      </div>

      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Domain</th><th>Verified</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={3}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={3}><div className="hub-empty">No custom domains.</div></td></tr>}
            {data.map((d) => (
              <tr key={d.name}>
                <td><a href={`https://${d.name}`} target="_blank" rel="noreferrer">{d.name}</a></td>
                <td>
                  <span className={`hub-badge ${d.verified ? "hub-badge-green" : "hub-badge-yellow"}`}>
                    {d.verified ? "Verified" : "Pending"}
                  </span>
                </td>
                <td>
                  <button type="button" className="hub-btn" style={{ padding: "3px 8px" }} onClick={() => remove(d.name)}>
                    <DeleteOutlined />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddDomainModal open={modalOpen} onClose={() => setModalOpen(false)} onAdd={add} />
    </div>
  );
}

function Activity({ project, active }) {
  const { data, loading } = useEntity(`vercel/projects/${project.id}/deployments`, active);
  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3><ClockCircleOutlined /> Activity</h3>
      </div>
      <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 14 }}>
        Vercel's full audit log needs an Enterprise plan — this feed is the real deployment activity available on
        this account: every deploy, who triggered it, and the result.
      </div>
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Event</th><th>By</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={4}><div className="hub-empty">No activity yet.</div></td></tr>}
            {data.map((d) => (
              <tr key={d.id}>
                <td>Deployment ({d.source || "git"}) to {d.target || "preview"}</td>
                <td>{d.creator || "—"}</td>
                <td><StateBadge state={d.state} /></td>
                <td>{d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ProjectDetail({ project, onBack }) {
  const [tab, setTab] = useState("deployments");

  return (
    <div className="hub-stack">
      <button type="button" className="hub-btn" onClick={onBack} style={{ alignSelf: "flex-start" }}>
        <ArrowLeftOutlined /> Back to projects
      </button>

      <div className="hub-header" style={{ padding: 0 }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>{project.name}</h2>
          <p>
            {project.link ? `${project.link.type} · ${project.link.repo || project.link.org || ""}` : "No repository linked"}
            {project.productionUrl ? ` · ${project.productionUrl}` : ""}
          </p>
        </div>
      </div>

      <HubTabs
        tabs={[
          { key: "deployments", label: "Deployments", icon: <ClockCircleOutlined /> },
          { key: "env", label: "Environment Variables", icon: <SettingOutlined /> },
          { key: "domains", label: "Domains", icon: <GlobalOutlined /> },
          { key: "activity", label: "Activity", icon: <FileTextOutlined /> },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ display: tab === "deployments" ? "block" : "none" }}>
        <Deployments project={project} active={tab === "deployments"} />
      </div>
      <div style={{ display: tab === "env" ? "block" : "none" }}>
        <EnvVars project={project} active={tab === "env"} />
      </div>
      <div style={{ display: tab === "domains" ? "block" : "none" }}>
        <Domains project={project} active={tab === "domains"} />
      </div>
      <div style={{ display: tab === "activity" ? "block" : "none" }}>
        <Activity project={project} active={tab === "activity"} />
      </div>
    </div>
  );
}
