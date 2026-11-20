import React, { Suspense, lazy, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePermission } from "@/context/permissionContext";
import SalesTheme from "@/components/SalesTheme";
import "./sv3.css";
import "./sv3-app.css";
import "./popups.css";
import { PopupProvider } from "./popups/Popups";
import HeaderContent from "@/apps/Header/HeaderContainer";
import useBrandLogo from "@/hooks/useBrandLogo";
import { logoSlot } from "@/config/logoSlots";
import { BASE_URL, FILE_BASE_URL } from "@/config/serverApiConfig";

// Sales One Place — the v3 design canvas (artifact 2qmjBmHf4MxsejNwSyxJiM,
// page v3) as its own full-screen app at /sales-v3, opened in a new tab from
// the CRM sidebar. Same APIs and data as the old Sales screens. Boards that
// are ported from the design render here directly; the rest show the real
// working screen inside the design shell until they are ported.
const Dashboard = lazy(() => import("./boards/Dashboard"));
const Leads = lazy(() => import("./boards/Leads"));
const AutoDialer = lazy(() => import("./boards/AutoDialer"));
const Dialer = lazy(() => import("./boards/Dialer"));
const AgentScreen = lazy(() => import("./boards/AgentScreen"));
const Callbacks = lazy(() => import("./boards/Callbacks"));
const CallHistory = lazy(() => import("./boards/CallHistory"));
const Recordings = lazy(() => import("./boards/Recordings"));
const Reports = lazy(() => import("./boards/CallReports"));
const More = lazy(() => import("./boards/More"));
const Deals = lazy(() => import("./boards/Deals"));
const Team = lazy(() => import("./boards/Team"));
const Payments = lazy(() => import("./boards/Payments"));
const AdChatInbox = lazy(() => import("@/pages/Leads/AdChatInbox"));
import { D, GROUPS, MY, MANAGEMENT, visibleGroups } from "./nav";

function Board({ k, ownOnly, go, keys }) {
  switch (k) {
    case "dashboard":
      return <Dashboard ownOnly={ownOnly} go={go} />;
    case "leads":
      return <Leads />;
    case "auto":
      return <AutoDialer />;
    case "dialer":
      return <Dialer go={go} />;
    case "agent":
      return <AgentScreen go={go} />;
    case "callbacks":
      return <Callbacks />;
    case "history":
      return <CallHistory />;
    case "recordings":
      return <Recordings />;
    case "team":
      return <Team ownOnly={ownOnly} />;
    case "payments":
      return <Payments />;
    case "demos":
      return <More k={k} go={go} keys={keys} />;
    case "reports":
      return <Reports />;
    case "pipeline":
      return <Deals k={k} go={go} keys={keys} />;
    case "callsdash":
      return <More k={k} go={go} keys={keys} />;
    case "campaigns":
      return <More k={k} go={go} keys={keys} />;
    case "deals":
    case "quotes":
      return <Deals k={k} go={go} keys={keys} />;
    case "candidates":
      return <More k={k} go={go} keys={keys} />;
    default:
      return <Dashboard ownOnly={ownOnly} go={go} />;
  }
}

export default function SalesV3({ embedded = false }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { canView, role } = usePermission();
  const ownOnly = !MANAGEMENT.includes(role);
  const groups = visibleGroups(canView, role);
  const keys = groups.flatMap(([, items]) => items.map(([k]) => k));
  const want = pathname.split("/")[2] || "dashboard";
  const active = keys.includes(want) ? want : keys[0] || "dashboard";
  const [chatsOpen, setChatsOpen] = useState(false);
  const logo = useBrandLogo("logo_sidebar_expanded");
  const go = (k) => {
    if (k === "chats") {
      // Ad Chats = the CRM's WhatsApp ad-chat inbox (same component as the header's).
      setChatsOpen(true);
      return;
    }
    navigate(`/sales-v3/${k}`);
  };

  // Inside the CRM layout (Sales agents): the CRM sidebar + header are already there.
  if (embedded) {
    return (
      <SalesTheme>
        <PopupProvider>
          <div className="sv3 sv3-embedded">
            <main className="main">
              <Suspense fallback={<div className="skel" style={{ height: 260 }} />}>
                <Board k={active} ownOnly={ownOnly} go={go} keys={keys} />
              </Suspense>
            </main>
          </div>
        </PopupProvider>
      </SalesTheme>
    );
  }

  return (
    <SalesTheme>
    <PopupProvider>
    <div className="sv3 sv3-app">
      <div className="shell">
        <nav className="side" aria-label="Sales">
          <a className="brand sv3-brand" href="/" title="Career Lab Consulting — back to the CRM" onClick={(e) => { e.preventDefault(); window.location.assign("/"); }}><img
              src={logo || logoSlot("logo_sidebar_expanded")?.fallback}
              alt="Career Lab Consulting"
              onError={(e) => {
                // Local dev: the uploaded logo lives on the live server, not localhost:8888 —
                // try the live file host, then the bundled logo.
                const img = e.currentTarget;
                const fb = logoSlot("logo_sidebar_expanded")?.fallback;
                if (FILE_BASE_URL && BASE_URL && img.src.startsWith(BASE_URL) && !img.dataset.tried) {
                  img.dataset.tried = "1";
                  img.src = FILE_BASE_URL + img.src.slice(BASE_URL.length);
                } else if (fb && img.src !== new URL(fb, window.location.href).href) img.src = fb;
              }}
            /></a>
          {groups.map(([name, items]) => (
            <React.Fragment key={name}>
              <div className="grp">{name}</div>
              {items.map(([k, label, ic]) => (
                <a
                  key={k}
                  href={`/sales-v3/${k}`}
                  className={k === active ? "on" : ""}
                  aria-current={k === active ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(k);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={D[ic]} /></svg>
                  {(ownOnly && MY[k]) || label}
                </a>
              ))}
            </React.Fragment>
          ))}
          <a className="sv3-back" href="/" onClick={(e) => { e.preventDefault(); window.location.assign("/"); }}>← Back to CRM</a>
        </nav>
        <div className="sv3-col">
          <div className="sv3-head"><HeaderContent /></div>
          <main className="main">
            <Suspense fallback={<div className="skel" style={{ height: 260 }} />}>
              <Board k={active} ownOnly={ownOnly} go={go} keys={keys} />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
      {chatsOpen && (
        <Suspense fallback={null}>
          <AdChatInbox open initialChannel="" initialLead={null} onClose={() => setChatsOpen(false)} />
        </Suspense>
      )}
    </PopupProvider>
    </SalesTheme>
  );
}
