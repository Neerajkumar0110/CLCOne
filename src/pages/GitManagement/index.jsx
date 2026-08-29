import React, { useEffect, useState, useCallback } from "react";
import { message } from "antd";
import {
  GithubOutlined,
  PlusOutlined,
  StarOutlined,
  LockOutlined,
  GlobalOutlined,
  DisconnectOutlined,
} from "@ant-design/icons";
import HubTabs from "@/components/HubTabs";
import request from "@/request/request";
import CreateRepoModal from "./CreateRepoModal";
import RepoDetail from "./RepoDetail";

function RepoCard({ repo, onOpen }) {
  return (
    <div className="hub-card" style={{ cursor: "pointer" }} onClick={() => onOpen(repo)}>
      <div className="hub-card-header">
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {repo.private ? <LockOutlined style={{ fontSize: 13 }} /> : <GlobalOutlined style={{ fontSize: 13 }} />}
          {repo.name}
        </h3>
        <span className={`hub-badge ${repo.private ? "hub-badge-gray" : "hub-badge-green"}`}>
          {repo.private ? "Private" : "Public"}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 14, minHeight: 18 }}>
        {repo.description || "No description"}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#8c8c8c" }}>
        <span><StarOutlined /> {repo.stars ?? 0}</span>
        <span>{repo.language || "—"}</span>
        <span>Updated {repo.updatedAt ? new Date(repo.updatedAt).toLocaleDateString() : "—"}</span>
      </div>
    </div>
  );
}

function RepoGrid({ repos, loading, onOpen }) {
  if (loading) return <div className="hub-empty">Loading repositories…</div>;
  if (repos.length === 0) return <div className="hub-empty">No repositories found here.</div>;
  return (
    <div className="hub-grid-2">
      {repos.map((r) => (
        <RepoCard key={r.id} repo={r} onOpen={onOpen} />
      ))}
    </div>
  );
}

function ConnectPanel({ onConnect, connecting }) {
  return (
    <div className="hub-card" style={{ textAlign: "center", padding: "48px 24px" }}>
      <GithubOutlined style={{ fontSize: 40, marginBottom: 14 }} />
      <h3 style={{ marginBottom: 6 }}>Connect your GitHub account</h3>
      <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 18, maxWidth: 420, marginInline: "auto" }}>
        Every teammate connects their own GitHub account here, so repositories, branches, pull requests
        and issues shown match exactly what you have access to on GitHub.
      </div>
      <button type="button" className="hub-btn hub-btn-primary" onClick={onConnect} disabled={connecting}>
        {connecting ? "Opening GitHub…" : "Connect GitHub"}
      </button>
    </div>
  );
}

export default function GitManagement() {
  const [connection, setConnection] = useState(null);
  const [connLoading, setConnLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const [tab, setTab] = useState("my");
  const [myRepos, setMyRepos] = useState({ data: [], loading: false, loaded: false });
  const [allRepos, setAllRepos] = useState({ data: [], loading: false, loaded: false });
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState(null);

  const loadConnection = useCallback(() => {
    setConnLoading(true);
    return request
      .get({ entity: "git/connection" })
      .then((res) => {
        if (res.success) setConnection(res.result);
      })
      .finally(() => setConnLoading(false));
  }, []);

  useEffect(() => {
    loadConnection();
  }, [loadConnection]);

  const loadRepos = useCallback(
    (which) => {
      const setState = which === "my" ? setMyRepos : setAllRepos;
      const entity = which === "my" ? "git/repos" : "git/repos/all";
      setState((p) => ({ ...p, loading: true }));
      request.get({ entity }).then((res) => {
        setState({
          data: res.success ? res.result : [],
          loading: false,
          loaded: true,
        });
      });
    },
    []
  );

  useEffect(() => {
    if (!connection?.connected) return;
    if (tab === "my" && !myRepos.loaded) loadRepos("my");
    if (tab === "all" && !allRepos.loaded) loadRepos("all");
  }, [tab, connection, myRepos.loaded, allRepos.loaded, loadRepos]);

  useEffect(() => {
    const onMessage = (event) => {
      const data = event.data;
      if (!data || typeof data.type !== "string" || !data.type.startsWith("github-oauth")) return;
      setConnecting(false);
      if (data.type === "github-oauth-success") {
        message.success("GitHub connected");
        loadConnection();
      } else {
        message.error(data.message || "Could not connect GitHub");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadConnection]);

  const connect = async () => {
    setConnecting(true);
    const res = await request.get({ entity: "git/connect" });
    if (!res.success || !res.result?.url) {
      setConnecting(false);
      return;
    }
    window.open(res.result.url, "github-oauth", "width=600,height=720");
  };

  const disconnect = async () => {
    const res = await request.del({ entity: "git/connection" });
    if (res.success) {
      setConnection(res.result);
      setMyRepos({ data: [], loading: false, loaded: false });
      setAllRepos({ data: [], loading: false, loaded: false });
    }
  };

  const openRepo = (repo) => {
    const [owner, name] = repo.fullName.split("/");
    setSelectedRepo({ owner, name });
  };

  if (selectedRepo) {
    return (
      <div className="hub-page">
        <RepoDetail owner={selectedRepo.owner} repoName={selectedRepo.name} onBack={() => setSelectedRepo(null)} />
      </div>
    );
  }

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Git Management</h2>
          <p>Browse your team's GitHub repositories, branches, pull requests and issues from inside the CRM</p>
        </div>
        {connection?.connected && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="hub-badge hub-badge-green">
              <GithubOutlined /> {connection.githubUsername}
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
          <div className="hub-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <HubTabs
              tabs={[
                { key: "my", label: "My Repositories" },
                { key: "all", label: "All Repositories" },
              ]}
              active={tab}
              onChange={setTab}
            />
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setCreateOpen(true)}>
              <PlusOutlined /> New Repository
            </button>
          </div>

          {tab === "my" ? (
            <RepoGrid repos={myRepos.data} loading={myRepos.loading} onOpen={openRepo} />
          ) : (
            <RepoGrid repos={allRepos.data} loading={allRepos.loading} onOpen={openRepo} />
          )}
        </>
      )}

      <CreateRepoModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setMyRepos({ data: [], loading: false, loaded: false });
          setTab("my");
        }}
      />
    </div>
  );
}
