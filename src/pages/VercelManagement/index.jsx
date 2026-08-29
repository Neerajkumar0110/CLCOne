import React, { useEffect, useState, useCallback } from "react";
import { message } from "antd";
import {
  CloudServerOutlined,
  PlusOutlined,
  DisconnectOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import request from "@/request/request";
import CreateProjectModal from "./CreateProjectModal";
import ProjectDetail from "./ProjectDetail";

function ProjectCard({ project, onOpen }) {
  return (
    <div className="hub-card" style={{ cursor: "pointer" }} onClick={() => onOpen(project)}>
      <div className="hub-card-header">
        <h3><CloudServerOutlined style={{ fontSize: 13 }} /> {project.name}</h3>
        {project.framework && <span className="hub-badge hub-badge-blue">{project.framework}</span>}
      </div>
      <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 14, minHeight: 18 }}>
        {project.link ? `${project.link.type} · ${project.link.repo || project.link.org || ""}` : "No repository linked"}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#8c8c8c" }}>
        {project.productionUrl && (
          <span><GlobalOutlined /> {project.productionUrl}</span>
        )}
        <span>Updated {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : "—"}</span>
      </div>
    </div>
  );
}

function ConnectPanel({ onConnect, connecting }) {
  return (
    <div className="hub-card" style={{ textAlign: "center", padding: "48px 24px" }}>
      <CloudServerOutlined style={{ fontSize: 40, marginBottom: 14 }} />
      <h3 style={{ marginBottom: 6 }}>Connect your Vercel account</h3>
      <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 18, maxWidth: 420, marginInline: "auto" }}>
        Every teammate connects their own Vercel account here, so projects, deployments and environment
        variables shown match exactly what you have access to on Vercel.
      </div>
      <button type="button" className="hub-btn hub-btn-primary" onClick={onConnect} disabled={connecting}>
        {connecting ? "Opening Vercel…" : "Connect Vercel"}
      </button>
    </div>
  );
}

export default function VercelManagement() {
  const [connection, setConnection] = useState(null);
  const [connLoading, setConnLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const [projects, setProjects] = useState({ data: [], loading: false, loaded: false });
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);

  const loadConnection = useCallback(() => {
    setConnLoading(true);
    return request
      .get({ entity: "vercel/connection" })
      .then((res) => {
        if (res.success) setConnection(res.result);
      })
      .finally(() => setConnLoading(false));
  }, []);

  useEffect(() => {
    loadConnection();
  }, [loadConnection]);

  const loadProjects = useCallback(() => {
    setProjects((p) => ({ ...p, loading: true }));
    request.get({ entity: "vercel/projects" }).then((res) => {
      setProjects({ data: res.success ? res.result : [], loading: false, loaded: true });
    });
  }, []);

  useEffect(() => {
    if (connection?.connected && !projects.loaded) loadProjects();
  }, [connection, projects.loaded, loadProjects]);

  useEffect(() => {
    const onMessage = (event) => {
      const data = event.data;
      if (!data || typeof data.type !== "string" || !data.type.startsWith("vercel-oauth")) return;
      setConnecting(false);
      if (data.type === "vercel-oauth-success") {
        message.success("Vercel connected");
        loadConnection();
      } else {
        message.error(data.message || "Could not connect Vercel");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadConnection]);

  const connect = async () => {
    setConnecting(true);
    // Opened synchronously, before the await below, so browsers still treat
    // it as a direct result of the click — window.open() called after an
    // await falls outside the click's "user activation" window and gets
    // silently popup-blocked (looked like "nothing happens on connect").
    const popup = window.open("", "vercel-oauth", "width=600,height=720");
    const res = await request.get({ entity: "vercel/connect" });
    if (!res.success || !res.result?.url) {
      setConnecting(false);
      popup?.close();
      return;
    }
    if (popup) popup.location.href = res.result.url;
    else window.open(res.result.url, "vercel-oauth", "width=600,height=720");
  };

  const disconnect = async () => {
    const res = await request.del({ entity: "vercel/connection" });
    if (res.success) {
      setConnection(res.result);
      setProjects({ data: [], loading: false, loaded: false });
    }
  };

  if (selectedProject) {
    return (
      <div className="hub-page">
        <ProjectDetail project={selectedProject} onBack={() => setSelectedProject(null)} />
      </div>
    );
  }

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Vercel Management</h2>
          <p>Deploy, roll back and manage your team's Vercel projects from inside the CRM</p>
        </div>
        {connection?.connected && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="hub-badge hub-badge-green">
              <CloudServerOutlined /> {connection.vercelUsername}
            </span>
            <button type="button" className="hub-btn" onClick={disconnect}>
              <DisconnectOutlined /> Disconnect
            </button>
          </div>
        )}
      </div>

      {connLoading ? (
        <div className="hub-empty">Loading…</div>
      ) : !connection?.connected ? (
        <ConnectPanel onConnect={connect} connecting={connecting} />
      ) : (
        <>
          <div className="hub-row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setCreateOpen(true)}>
              <PlusOutlined /> New Project
            </button>
          </div>

          {projects.loading ? (
            <div className="hub-empty">Loading projects…</div>
          ) : projects.data.length === 0 ? (
            <div className="hub-empty">No Vercel projects found here.</div>
          ) : (
            <div className="hub-grid-2">
              {projects.data.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={setSelectedProject} />
              ))}
            </div>
          )}
        </>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => loadProjects()}
      />
    </div>
  );
}
