import React, { useEffect, useState } from "react";
import { Collapse, ConfigProvider } from "antd";
import { request } from "@/request";

// Calling › Team Overview — management-only: every team's agents, their
// number of contacts worked and connected/disconnected call counts. Ported
// from the old Sales "Calls" tab's Team Overview, kept on the same
// `call/agent-stats` endpoint (legacy Call model).
export default function TeamOverview() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await request.get({ entity: "call/agent-stats" });
      setTeams(res?.success ? res.result : []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header" style={{ marginBottom: 16 }}>
          <h3>Team Overview</h3>
        </div>

        {loading && <div className="hub-empty">Loading team stats…</div>}
        {!loading && teams.length === 0 && <div className="hub-empty">No teams yet.</div>}

        {!loading && teams.length > 0 && (
          <ConfigProvider theme={{ token: { colorPrimary: "#2563eb", borderRadius: 10 } }}>
            <Collapse
              expandIconPosition="end"
              items={teams.map((t) => ({
                key: t.team,
                label: (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.color || "#2563eb", flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t.team}</span>
                    <span className="hub-badge hub-badge-blue">
                      {t.members.length} agent{t.members.length === 1 ? "" : "s"}
                    </span>
                  </div>
                ),
                children: (
                  <div className="hub-table-wrapper">
                    <table className="hub-table">
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Numbers</th>
                          <th>Connected</th>
                          <th>Disconnected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.members.length === 0 && (
                          <tr>
                            <td colSpan={4}>
                              <div className="hub-empty">No members in this team yet.</div>
                            </td>
                          </tr>
                        )}
                        {t.members.map((m) => (
                          <tr key={m.name}>
                            <td>
                              <div className="hub-person">
                                <div className="hub-avatar" style={{ background: "#2563EB" }}>
                                  {m.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                                </div>
                                {m.name}
                              </div>
                            </td>
                            <td>{m.numbers}</td>
                            <td>
                              <span className="hub-badge hub-badge-green">{m.connected}</span>
                            </td>
                            <td>
                              <span className="hub-badge hub-badge-red">{m.disconnected}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ),
              }))}
            />
          </ConfigProvider>
        )}
      </div>
    </div>
  );
}
