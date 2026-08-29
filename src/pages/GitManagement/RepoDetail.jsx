import React, { useEffect, useState } from "react";
import { message } from "antd";
import {
  ArrowLeftOutlined,
  CopyOutlined,
  BranchesOutlined,
  HistoryOutlined,
  PullRequestOutlined,
  ExclamationCircleOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  CloudDownloadOutlined,
} from "@ant-design/icons";
import HubTabs from "@/components/HubTabs";
import request from "@/request/request";

function copy(text) {
  navigator.clipboard.writeText(text);
  message.success("Copied to clipboard");
}

function CommandLine({ label, command }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 4 }}>{label}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#0f1117",
          color: "#e6e6e6",
          borderRadius: 8,
          padding: "8px 10px",
          fontFamily: "monospace",
          fontSize: 12.5,
        }}
      >
        <code style={{ flex: 1, overflowX: "auto", whiteSpace: "pre" }}>{command}</code>
        <button
          type="button"
          className="hub-btn"
          style={{ padding: "3px 10px" }}
          onClick={() => copy(command)}
        >
          <CopyOutlined />
        </button>
      </div>
    </div>
  );
}

function Overview({ repo }) {
  if (!repo) return null;
  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><CloudDownloadOutlined /> Clone / Pull</h3>
        </div>
        <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 14 }}>
          Run these from your own machine — the CRM shows you the repo, actual clone/pull/push still
          happens with your local Git client using your connected GitHub account.
        </div>
        <CommandLine label="Clone (HTTPS)" command={`git clone ${repo.cloneUrl}`} />
        <CommandLine label="Clone (SSH)" command={`git clone ${repo.sshUrl}`} />
        <CommandLine label="Pull latest changes" command={`git pull origin ${repo.defaultBranch}`} />
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3><ThunderboltOutlined /> Push</h3>
        </div>
        <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 14 }}>
          Push happens locally too — commit your changes, then run:
        </div>
        <CommandLine label="Push to default branch" command={`git push origin ${repo.defaultBranch}`} />
        <CommandLine label="Push a new branch" command={`git push -u origin your-branch-name`} />
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Repository Info</h3>
        </div>
        <div className="hub-form-row"><label>Full name</label><div>{repo.fullName}</div></div>
        <div className="hub-form-row"><label>Visibility</label><div>{repo.private ? "Private" : "Public"}</div></div>
        <div className="hub-form-row"><label>Default branch</label><div>{repo.defaultBranch}</div></div>
        <div className="hub-form-row"><label>Description</label><div>{repo.description || "—"}</div></div>
        <div className="hub-form-row">
          <label>On GitHub</label>
          <div><a href={repo.htmlUrl} target="_blank" rel="noreferrer">{repo.htmlUrl}</a></div>
        </div>
      </div>
    </div>
  );
}

function useTabData(owner, repoName, tabKey, endpoint, active) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || data) return;
    let cancelled = false;
    setLoading(true);
    request
      .get({ entity: `git/repos/${owner}/${repoName}/${endpoint}` })
      .then((res) => {
        if (cancelled) return;
        if (res.success) setData(res.result || []);
        else setData([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [active, owner, repoName, endpoint, data]);

  return { data: data || [], loading };
}

function Branches({ owner, repoName, active }) {
  const { data, loading } = useTabData(owner, repoName, "branches", "branches", active);
  return (
    <div className="hub-card">
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Branch</th><th>Protected</th><th>SHA</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={3}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={3}><div className="hub-empty">No branches.</div></td></tr>}
            {data.map((b) => (
              <tr key={b.name}>
                <td>{b.name}</td>
                <td>{b.protected ? <span className="hub-badge hub-badge-blue">Protected</span> : "—"}</td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{(b.sha || "").slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Commits({ owner, repoName, active }) {
  const { data, loading } = useTabData(owner, repoName, "commits", "commits", active);
  return (
    <div className="hub-card">
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Message</th><th>Author</th><th>Date</th><th>SHA</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={4}><div className="hub-empty">No commits.</div></td></tr>}
            {data.map((c) => (
              <tr key={c.sha}>
                <td>
                  <a href={c.htmlUrl} target="_blank" rel="noreferrer">
                    {(c.message || "").split("\n")[0]}
                  </a>
                </td>
                <td>{c.author}</td>
                <td>{c.date ? new Date(c.date).toLocaleString() : "—"}</td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{(c.sha || "").slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pulls({ owner, repoName, active }) {
  const { data, loading } = useTabData(owner, repoName, "pulls", "pulls", active);
  return (
    <div className="hub-card">
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>#</th><th>Title</th><th>State</th><th>By</th><th>Updated</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={5}><div className="hub-empty">No pull requests.</div></td></tr>}
            {data.map((p) => (
              <tr key={p.number}>
                <td>#{p.number}</td>
                <td><a href={p.htmlUrl} target="_blank" rel="noreferrer">{p.title}</a></td>
                <td>
                  <span className={`hub-badge ${p.mergedAt ? "hub-badge-purple" : p.state === "open" ? "hub-badge-green" : "hub-badge-gray"}`}>
                    {p.mergedAt ? "Merged" : p.state}
                  </span>
                </td>
                <td>{p.user}</td>
                <td>{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Issues({ owner, repoName, active }) {
  const { data, loading } = useTabData(owner, repoName, "issues", "issues", active);
  return (
    <div className="hub-card">
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>#</th><th>Title</th><th>State</th><th>By</th><th>Comments</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={5}><div className="hub-empty">No issues.</div></td></tr>}
            {data.map((i) => (
              <tr key={i.number}>
                <td>#{i.number}</td>
                <td><a href={i.htmlUrl} target="_blank" rel="noreferrer">{i.title}</a></td>
                <td>
                  <span className={`hub-badge ${i.state === "open" ? "hub-badge-green" : "hub-badge-gray"}`}>{i.state}</span>
                </td>
                <td>{i.user}</td>
                <td>{i.comments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Releases({ owner, repoName, active }) {
  const { data, loading } = useTabData(owner, repoName, "releases", "releases", active);
  return (
    <div className="hub-card">
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Release</th><th>Tag</th><th>Status</th><th>Published</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={4}><div className="hub-empty">No releases.</div></td></tr>}
            {data.map((r) => (
              <tr key={r.tagName}>
                <td><a href={r.htmlUrl} target="_blank" rel="noreferrer">{r.name}</a></td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.tagName}</td>
                <td>
                  {r.draft && <span className="hub-badge hub-badge-gray">Draft</span>}
                  {r.prerelease && <span className="hub-badge hub-badge-yellow">Pre-release</span>}
                  {!r.draft && !r.prerelease && <span className="hub-badge hub-badge-green">Published</span>}
                </td>
                <td>{r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Activity({ owner, repoName, active }) {
  const { data, loading } = useTabData(owner, repoName, "activity", "activity", active);
  return (
    <div className="hub-card">
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Event</th><th>By</th><th>When</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={3}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={3}><div className="hub-empty">No recent activity.</div></td></tr>}
            {data.map((e) => (
              <tr key={e.id}>
                <td>{(e.type || "").replace("Event", "")}</td>
                <td>{e.actor}</td>
                <td>{e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RepoDetail({ owner, repoName, onBack }) {
  const [tab, setTab] = useState("overview");
  const [repo, setRepo] = useState(null);

  useEffect(() => {
    setRepo(null);
    setTab("overview");
    request.get({ entity: `git/repos/${owner}/${repoName}` }).then((res) => {
      if (res.success) setRepo(res.result);
    });
  }, [owner, repoName]);

  return (
    <div className="hub-stack">
      <button type="button" className="hub-btn" onClick={onBack} style={{ alignSelf: "flex-start" }}>
        <ArrowLeftOutlined /> Back to repositories
      </button>

      <div className="hub-header" style={{ padding: 0 }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>{repo ? repo.fullName : `${owner}/${repoName}`}</h2>
          <p>{repo?.description || " "}</p>
        </div>
      </div>

      <HubTabs
        tabs={[
          { key: "overview", label: "Clone / Pull / Push", icon: <CloudDownloadOutlined /> },
          { key: "branches", label: "Branches", icon: <BranchesOutlined /> },
          { key: "commits", label: "Commits", icon: <HistoryOutlined /> },
          { key: "pulls", label: "Pull Requests", icon: <PullRequestOutlined /> },
          { key: "issues", label: "Issues", icon: <ExclamationCircleOutlined /> },
          { key: "releases", label: "Releases", icon: <TagsOutlined /> },
          { key: "activity", label: "Activity", icon: <ThunderboltOutlined /> },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "overview" && <Overview repo={repo} />}
      <div style={{ display: tab === "branches" ? "block" : "none" }}>
        <Branches owner={owner} repoName={repoName} active={tab === "branches"} />
      </div>
      <div style={{ display: tab === "commits" ? "block" : "none" }}>
        <Commits owner={owner} repoName={repoName} active={tab === "commits"} />
      </div>
      <div style={{ display: tab === "pulls" ? "block" : "none" }}>
        <Pulls owner={owner} repoName={repoName} active={tab === "pulls"} />
      </div>
      <div style={{ display: tab === "issues" ? "block" : "none" }}>
        <Issues owner={owner} repoName={repoName} active={tab === "issues"} />
      </div>
      <div style={{ display: tab === "releases" ? "block" : "none" }}>
        <Releases owner={owner} repoName={repoName} active={tab === "releases"} />
      </div>
      <div style={{ display: tab === "activity" ? "block" : "none" }}>
        <Activity owner={owner} repoName={repoName} active={tab === "activity"} />
      </div>
    </div>
  );
}
