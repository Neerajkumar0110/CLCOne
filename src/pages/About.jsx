import React, { useEffect, useState } from "react";
import {
  DashboardOutlined,
  PhoneOutlined,
  AimOutlined,
  BarChartOutlined,
  TeamOutlined,
  MessageOutlined,
  GlobalOutlined,
  BookOutlined,
  MailOutlined,
  CustomerServiceOutlined,
  CopyrightOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import logo from "@/style/images/Horizontal-1-transparent.png";
import { request } from "@/request";

const FEATURES = [
  { icon: <DashboardOutlined />, title: "Live Dashboard", desc: "Real-time KPIs, call trends, and team performance at a glance." },
  { icon: <PhoneOutlined />, title: "Call Management", desc: "Live dialer, call logs, recordings, and an auto-dialer campaign engine." },
  { icon: <AimOutlined />, title: "Lead Management", desc: "Track leads end-to-end, capture forms, import/export, duplicate detection." },
  { icon: <BarChartOutlined />, title: "Advanced Reporting", desc: "Team and individual performance, talk-time and number lookup reports." },
  { icon: <TeamOutlined />, title: "User Management", desc: "Roles & permissions, teams, shifts, and a built-in support desk." },
  { icon: <MessageOutlined />, title: "Communication Hub", desc: "Email, WhatsApp templates, and internal team chat." },
];

const TECH_STACK = ["React", "Vite", "Node.js", "Express", "MongoDB", "Ant Design"];

export default function About() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    request.get({ entity: "about/info" }).then((res) => {
      if (res?.success) setInfo(res.result);
    });
  }, []);

  const systemInfo = [
    ["Version", info?.version ?? "…"],
    ["Environment", info ? info.environment[0].toUpperCase() + info.environment.slice(1) : "…"],
    ["Server Uptime", info?.uptime ?? "…"],
    ["Registered Users", info?.totalUsers ?? "…"],
    ["License", info?.license ?? "…"],
  ];

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>About</h2>
          <p>What's inside this CRM, and where to get help</p>
        </div>
      </div>

      <div className="hub-card about-hero">
        <img src={logo} alt="Career Lab Consulting" className="about-hero-logo" />

        <div style={{ flex: 1, minWidth: 240, position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>
            Career Lab Consulting CRM
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <CheckCircleOutlined style={{ color: "#4ade80" }} /> Version {info?.version ?? "…"} · Built for sales, calls, and lead management
          </div>
        </div>

        <a
          href="https://www.careerlabconsulting.com"
          target="_blank"
          rel="noreferrer"
          className="hub-btn hub-btn-primary"
          style={{ textDecoration: "none", position: "relative", zIndex: 1 }}
        >
          <GlobalOutlined /> Visit Website
        </a>
      </div>

      <div className="hub-card-header" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 16 }}>What's inside</h3>
      </div>

      <div className="hub-grid-3" style={{ marginBottom: 20 }}>
        {FEATURES.map((f) => (
          <div className="hub-card" key={f.title}>
            <div style={{ fontSize: 22, color: "var(--hub-blue)", marginBottom: 10 }}>{f.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{f.title}</div>
            <div style={{ fontSize: 12.5, color: "#667085", lineHeight: 1.5 }}>{f.desc}</div>
          </div>
        ))}
      </div>

      <div className="hub-grid-2" style={{ marginBottom: 20 }}>
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Built With</h3>
          </div>
          <div className="hub-btn-group">
            {TECH_STACK.map((t) => (
              <span key={t} className="hub-badge hub-badge-blue">{t}</span>
            ))}
          </div>
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3>System Information</h3>
          </div>
          {systemInfo.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: "1px solid #f2f4f7",
                fontSize: 12.5,
              }}
            >
              <span style={{ color: "#667085" }}>{label}</span>
              <span style={{ fontWeight: 600, color: "#101828" }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="hub-grid-2">
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><BookOutlined /> Documentation</h3>
          </div>
          <div style={{ fontSize: 13, color: "#667085", marginBottom: 14, lineHeight: 1.6 }}>
            Guides for every module — Calls, Leads, Reports, and more.
          </div>
          <a
            href="https://www.careerlabconsulting.com"
            target="_blank"
            rel="noreferrer"
            className="hub-btn"
            style={{ textDecoration: "none" }}
          >
            <BookOutlined /> View Docs
          </a>
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3><CustomerServiceOutlined /> Need Help?</h3>
          </div>
          <div style={{ fontSize: 13, color: "#667085", marginBottom: 14, lineHeight: 1.6 }}>
            Raise a ticket from <strong>User Management → Support</strong> for
            any issue, or reach out to us directly.
          </div>
          <button
            type="button"
            className="hub-btn hub-btn-primary"
            onClick={() => window.open("https://www.careerlabconsulting.com/contact-us/")}
          >
            <MailOutlined /> Contact Us
          </button>
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: 11.5, color: "#98a2b3", marginTop: 24, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <CopyrightOutlined /> 2026 Career Lab Consulting. All rights reserved.
      </div>
    </div>
  );
}