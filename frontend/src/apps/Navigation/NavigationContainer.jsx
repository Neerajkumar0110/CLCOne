import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Drawer, Layout, Menu } from 'antd';

import { useAppContext } from '@/context/appContext';
import { usePermission } from '@/context/permissionContext';
import { useTickets } from '@/context/ticketsContext';
import { useMessages } from '@/context/messagesContext';
import { request } from '@/request';
import { MODULE_NAV_KEY } from '@/config/permissionModules';
import { FEATURE_SECTIONS, OPEN_TABS, isOpenTab } from '@/config/featureSections';
import useWhatsAppAccess from '@/pages/WhatsApp/useWhatsAppAccess';

import useLanguage from '@/locale/useLanguage';
import useBrandLogo from '@/hooks/useBrandLogo';
import { logoSlot } from '@/config/logoSlots';
import { D as SV3_ICON, MY as SV3_MY, visibleGroups as sv3Groups } from '@/pages/SalesV3/nav';
import { BASE_URL, FILE_BASE_URL } from '@/config/serverApiConfig';

import useResponsive from '@/hooks/useResponsive';

import {
  SettingOutlined,
  ContainerOutlined,
  DashboardOutlined,
  CreditCardOutlined,
  MenuOutlined,
  ReconciliationOutlined,
  TrophyOutlined,
  BarChartOutlined,
  VideoCameraOutlined,
  TeamOutlined,
  FundOutlined,
  QuestionCircleOutlined,
  GithubOutlined,
  CloudServerOutlined,
  PhoneOutlined,
  RocketOutlined,
  ThunderboltOutlined,
  UserOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  CodeOutlined,
  MessageOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
// Same list as apps/Header/ChatChannels.jsx (who sees the ad-chat inbox).
const SUPER_ADMIN_ROLES = ['owner', 'Super Admin'];

const { Sider } = Layout;

const NAV_KEY_MODULE = Object.fromEntries(
  Object.entries(MODULE_NAV_KEY).map(([mod, key]) => [key, mod])
);

// Calling's 10 tabs are one page switched by a `?tab=` query param (see
// pages/Calling/index.jsx), not separate routes — so the sidebar's synthetic
// "current path" for /calling folds the query param in, the same way
// "sales/leads" folds a real route segment in for feature sections.
const CALLING_TABS = ['dashboard', 'dial', 'campaigns', 'dialer', 'agent', 'history', 'callbacks', 'recordings', 'reports', 'demos'];
// LMS-module sections shown as submenus inside the one LMS menu (see featureItems).
// order inside the LMS menu (LMS testing report #19): Admin & Ops, Support
// Manager, QA & Releases, Learner Growth
const LMS_FOLDED = ['admin-ops', 'support-mgr', 'qa-env', 'learner-growth'];

function pathKeyFor(loc) {
  if (loc.pathname === '/') return 'dashboard';
  const base = loc.pathname.slice(1);
  if (base === 'calling') {
    const tab = new URLSearchParams(loc.search).get('tab');
    return `calling-${CALLING_TABS.includes(tab) ? tab : 'dashboard'}`;
  }
  return base;
}

// Recursively builds a section's tab items — a tab may itself be a pure
// grouping node (no route of its own, e.g. "Quizzes & Exams") whose
// `children` render as a nested dropdown, same shape/depth as the
// Teacher/Student sidebar in LmsPanelApp.
function buildTabItems(sectionKey, tabs, prefix = '') {
  return tabs.map((tab) => {
    const TabIcon = tab.Icon;
    const key = `${sectionKey}/${prefix}${tab.key}`;
    const icon = TabIcon ? <TabIcon /> : undefined;
    return tab.children
      ? { key, icon, label: tab.label, children: buildTabItems(sectionKey, tab.children, `${prefix}${tab.key}/`) }
      : { key, icon, label: tab.label };
  });
}

export default function Navigation() {
  const { isMobile } = useResponsive();

  return isMobile ? <MobileSidebar /> : <Sidebar collapsible={true} />;
}

function Sidebar({ collapsible, isMobile = false }) {
  let location = useLocation();

  const { state: stateApp, appContextAction } = useAppContext();
  const { isNavMenuClose } = stateApp;
  const { navMenu } = appContextAction;
  const { canView, canEdit, canDelete, role } = usePermission();
  const { tickets } = useTickets();
  const openTicketsCount = tickets.filter((t) => t.status === 'Open').length;
  const { totalUnread } = useMessages();
  // Both sidebar states are separate logo slots — a wide wordmark is
  // unreadable once the sidebar collapses to icons. See config/logoSlots.js.
  const expandedLogo = useBrandLogo('logo_sidebar_expanded');
  const collapsedLogo = useBrandLogo('logo_sidebar_collapsed');
  const [showLogoApp, setLogoApp] = useState(isNavMenuClose);
  const [currentPath, setCurrentPath] = useState(pathKeyFor(location));

  // Badge on LMS ▸ Students — same "how many need attention right now"
  // treatment as the Support ticket count above. Polled rather than pushed
  // (no socket event exists for a roster edit); a 3-min interval matches the
  // LMS panel's own safety-net poll cadence (LmsPanelApp.jsx).
  const [unassignedCount, setUnassignedCount] = useState(0);
  // Messenger › WhatsApp shows only for users an admin has given WhatsApp access.
  const whatsApp = useWhatsAppAccess();
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      request
        .get({ entity: 'lms/students/unassigned-count' })
        .then((res) => {
          if (!cancelled && res && res.success) setUnassignedCount(res.result.count || 0);
        })
        .catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 180000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  const translate = useLanguage();
  const navigate = useNavigate();

  const routeByKey = {
    // Overview
    dashboard: '/',
    // Sales pipeline
    leads: '/leads',
    customer: '/customer',
    calling: '/calling',
    'calling-dashboard': '/calling?tab=dashboard',
    'calling-dial': '/calling?tab=dial',
    'calling-campaigns': '/calling?tab=campaigns',
    'calling-dialer': '/calling?tab=dialer',
    'calling-agent': '/calling?tab=agent',
    'calling-history': '/calling?tab=history',
    'calling-callbacks': '/calling?tab=callbacks',
    'calling-recordings': '/calling?tab=recordings',
    'calling-reports': '/calling?tab=reports',
    'calling-demos': '/calling?tab=demos',
    communication: '/communication',
    // Analytics
    performance: '/performance',
    reports: '/reports',
    // Billing & finance
    invoice: '/invoice',
    'finance-payments': '/finance-payments',
    finance: '/finance',
    // Administration
    'user-management': '/user-management',
    support: '/support',
    'git-management': '/git-management',
    'vercel-management': '/vercel-management',
    'code-editor': '/code-editor',
    generalSettings: '/settings',
    about: '/about',
  };

  // The six new sections (Sales, Marketing, Operations, LMS, HR, Messenger)
  // from config/featureSections.js — each an EXPANDABLE submenu whose children
  // are its sub-modules, routing to /<section>/<tab>. Team Chat lives inside
  // Messenger, so that section carries the unread-message badge.
  // a section / tab drawn for certain roles only (featureSections `roles`)
  // full LMS rights (view + edit + delete) open every LMS section, whatever the role
  const lmsFull = role !== 'Student' && canView('LMS') && canEdit('LMS') && canDelete('LMS');
  const roleOk = (x) => (!x.roles || x.roles.includes(role) || lmsFull) && !(x.hideFor && x.hideFor.includes(role)) && !x.hideInNav;
  const featureItems = FEATURE_SECTIONS.filter(roleOk).map((section) => {
    const SectionIcon = section.Icon;
    const label =
      section.key === 'messenger' && totalUnread > 0 ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {section.label}
          <Badge count={totalUnread} size="small" className="hub-nav-badge" />
        </span>
      ) : (
        section.label
      );
    // A Support user's LMS "Overview" tab is now folded into the main "/"
    // Dashboard (see Dashboard.jsx — it stacks the Support + LMS/interns
    // analytics on one combined page for that role), so the separate tab
    // here would just be a duplicate.
    let tabs =
      role === 'Support' && section.key === 'lms'
        ? section.tabs.filter((t) => t.key !== 'overview' && roleOk(t))
        : section.tabs.filter(roleOk);
    // No permission for the section, but some tabs are open to everyone
    // (Messenger → Team Chat): show just those.
    if (!canView(section.module) && OPEN_TABS[section.key]) tabs = tabs.filter((t) => isOpenTab(section.key, t.key));
    if (section.key === 'messenger' && !whatsApp.hasAccess) tabs = tabs.filter((t) => t.key !== 'whatsapp');
    // Students needing a batch assigned — same badge treatment as Support's
    // open-ticket count and Messenger's unread count above.
    if (section.key === 'lms' && unassignedCount > 0) {
      tabs = tabs.map((t) =>
        t.key === 'students'
          ? {
              ...t,
              label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {t.label}
                  <Badge count={unassignedCount} size="small" className="hub-nav-badge" title={`${unassignedCount} candidate(s) with no batch assigned`} />
                </span>
              ),
            }
          : t
      );
    }
    if (section.key === 'sales') return buildSalesItem(section, label);
    return {
      key: section.key,
      icon: SectionIcon ? <SectionIcon /> : undefined,
      label,
      children: buildTabItems(section.key, tabs),
    };
  })
    // Everything LMS sits under ONE "LMS" menu (user ask 2026-11-24): the other
    // LMS sections become nested submenus there. Their routes, tab keys and
    // permission (module LMS) stay exactly as they were.
    .reduce((acc, item) => {
      const lms = acc.find((i) => i.key === 'lms');
      if (LMS_FOLDED.includes(item.key) && lms) {
        lms.children = [...lms.children, item];
        return acc;
      }
      if (item.key === 'lms') {
        const early = acc.filter((i) => LMS_FOLDED.includes(i.key));
        const rest = acc.filter((i) => !LMS_FOLDED.includes(i.key));
        return [...rest, { ...item, children: [...item.children, ...early] }];
      }
      return [...acc, item];
    }, [])
    .map((item) =>
      item.key === 'lms'
        ? {
            ...item,
            children: [
              ...item.children.filter((c) => !LMS_FOLDED.includes(c.key)),
              ...LMS_FOLDED.map((k) => item.children.find((c) => c.key === k)).filter(Boolean),
            ],
          }
        : item
    );

  // Sales = ONE sidebar tab for everything sales uses (user ask 2026-11-17,
  // from 30 days of real usage): the day's work first, then records & team,
  // the rarely used screens under "More". Calls' tabs live here too, so there
  // is no separate Calls menu. Orders / Products (never used) are left out of
  // the sidebar; their routes still work.
  function buildSalesItem(section, label) {
    const canSales = canView('Sales');
    const canCalls = canView('Calling');
    const isAdmin = ['owner', 'Super Admin', 'Admin'].includes(role);
    // Sales One Place design, agent side: a Sales user who only ever sees their
    // own 360° (not management — same list as Sales360's FULL_ACCESS) gets
    // "My …" names for those tabs. Same routes and screens.
    const ownOnly = !['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Team Manager'].includes(role);
    const MY = { dashboard: 'My Day', 'team-360': 'My Attendance' };
    // Agents: only the new Sales design — its tabs right here under Sales, each
    // screen inside the CRM layout (no old Sales menu, no new tab).
    if (ownOnly && canSales) {
      const Ic = section.Icon;
      const svg = (d) => (
        <span role="img" className="anticon"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg></span>
      );
      const groups = sv3Groups(canView, role).map(([name, items]) => {
        const kids = items.map(([k, l, ic]) => ({ key: `sales-v3/${k}`, icon: svg(SV3_ICON[ic]), label: SV3_MY[k] || l }));
        return name === 'More' ? { key: 'sales-v3-more', label: 'More', icon: <AppstoreOutlined />, children: kids } : { type: 'group', key: `sales-v3-g-${name}`, label: name, children: kids };
      });
      return { key: 'sales', icon: Ic ? <Ic /> : undefined, label, children: groups, salesMenu: true };
    }
    // Management: no old Sales tabs — just "Sales", which opens the new design
    // (full-screen app) in a new browser tab (user ask 2026-11-20).
    if (canSales) {
      const Ic = section.Icon;
      return { key: 'sales-v3', icon: Ic ? <Ic /> : undefined, label, salesMenu: true };
    }
    const tab = (k) => {
      const t = canSales && section.tabs.find((x) => x.key === k);
      return t ? { key: `sales/${k}`, icon: t.Icon ? <t.Icon /> : undefined, label: (ownOnly && MY[k]) || t.label } : null;
    };
    const call = (k, text, icon, adminOnly = false) => (canCalls && (!adminOnly || isAdmin) ? { key: `calling-${k}`, label: text, icon } : null);
    const daily = [
      tab('dashboard'),
      tab('leads'),
      call('dialer', 'Auto Dialer', <ThunderboltOutlined />),
      call('dial', 'Dialer', <PhoneOutlined />),
      call('agent', 'Agent Screen', <UserOutlined />),
      call('callbacks', 'Callbacks', <ClockCircleOutlined />),
      SUPER_ADMIN_ROLES.includes(role) ? { key: 'sales-chats', label: 'Ad Chats', icon: <MessageOutlined /> } : null,
    ].filter(Boolean);
    const records = [
      call('history', 'Call History', <HistoryOutlined />),
      call('recordings', 'Recordings', <PlayCircleOutlined />),
      tab('team-360'),
      tab('payments'),
      call('demos', 'Live Demos', <VideoCameraOutlined />, true),
      call('reports', 'Call Reports', <BarChartOutlined />, true),
    ].filter(Boolean);
    const more = [
      tab('pipeline'),
      tab('deals'),
      tab('quotes'),
      tab('customers'),
      call('dashboard', 'Calls Dashboard', <DashboardOutlined />),
      call('campaigns', 'Campaigns', <RocketOutlined />),
    ].filter(Boolean);
    const children = [
      daily.length && { type: 'group', key: 'sales-g-daily', label: 'Daily work', children: daily },
      records.length && { type: 'group', key: 'sales-g-records', label: 'Records & team', children: records },
      more.length && { key: 'sales-more', label: 'More', icon: <AppstoreOutlined />, children: more },
    ].filter(Boolean);
    const SectionIcon = section.Icon;
    return { key: 'sales', icon: SectionIcon ? <SectionIcon /> : undefined, label, children, salesMenu: true };
  }

  const items = [
    // ---- Overview ----
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: translate('dashboard'),
    },

    // ---- New business sections ---- (Sales now carries Leads / Customers
    // as sub-tabs — see config/featureSections.js. Calling is its own
    // section below, not a Sales sub-tab.)
    ...featureItems,

    // ---- Calls ---- its tabs (in-page ?tab=…, see pages/Calling/index.jsx
    // and routeByKey / CALLING_TABS above) now sit inside Sales — see
    // buildSalesItem. No separate Calls menu.

    // ---- Analytics: Reports ▸ (Overview + Performance) ----
    {
      key: 'reports-group',
      label: 'Reports',
      icon: <BarChartOutlined />,
      children: [
        { key: 'reports', label: 'Overview', icon: <BarChartOutlined /> },
        { key: 'performance', label: 'Performance', icon: <TrophyOutlined /> },
      ],
    },

    // ---- Billing & finance: Finance ▸ (Overview + Invoices + Payments) ----
    {
      key: 'finance-group',
      label: 'Finance',
      icon: <FundOutlined />,
      children: [
        { key: 'finance', label: 'Overview', icon: <FundOutlined /> },
        { key: 'invoice', label: translate('invoices'), icon: <ContainerOutlined /> },
        { key: 'finance-payments', label: translate('payments'), icon: <CreditCardOutlined /> },
      ],
    },

    // ---- Administration ----
    {
      key: 'user-management',
      label: 'User Management',
      icon: <TeamOutlined />,
    },
    {
      key: 'support',
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Support
          {openTicketsCount > 0 && (
            <Badge count={openTicketsCount} size="small" className="hub-nav-badge" />
          )}
        </span>
      ),
      icon: <QuestionCircleOutlined />,
    },
    {
      key: 'git-management',
      label: 'Git Management',
      icon: <GithubOutlined />,
    },
    {
      key: 'vercel-management',
      label: 'Vercel Management',
      icon: <CloudServerOutlined />,
    },
    {
      key: 'code-editor',
      label: 'Code Editor',
      icon: <CodeOutlined />,
    },
    {
      key: 'generalSettings',
      label: translate('settings'),
      icon: <SettingOutlined />,
    },
    {
      key: 'about',
      label: translate('about'),
      icon: <ReconciliationOutlined />,
    },
  ];

  const canSeeKey = (key) => {
    const mod = NAV_KEY_MODULE[key];
    return mod ? canView(mod) : true;
  };
  const visibleItems = items
    .map((item) =>
      item.children ? { ...item, children: item.children.filter((c) => canSeeKey(c.key)) } : item
    )
    // Support's tickets are Support Manager › Tickets (SLA queue | All tickets)
    .filter((item) => !(role === 'Support' && item.key === 'support'))
    .filter((item) => {
      // Sales carries both Sales and Calling screens, each already filtered by its own permission
      if (item.salesMenu) return item.children ? item.children.length > 0 : true;
      // a feature section without its own nav key (Admin & Ops) is gated by its module
      const mod = NAV_KEY_MODULE[item.key] || (FEATURE_SECTIONS.find((s) => s.key === item.key) || {}).module;
      if (mod && OPEN_TABS[item.key]) return true; // has open tabs (Team Chat)
      if (mod) return canView(mod); // parent-gated (feature sections)
      if (item.children) return item.children.length > 0; // pure grouping node
      return true;
    });

  const onMenuClick = ({ key }) => {
    if (key === 'sales-chats') {
      window.dispatchEvent(new CustomEvent('clc:open-ad-chats'));
      return;
    }
    // Sales One Place (v3 design) — its own full-screen app, in a new tab.
    if (key === 'sales-v3') {
      if (['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Team Manager'].includes(role)) window.open('/sales-v3', '_blank', 'noopener');
      else navigate('/sales-v3');
      return;
    }
    const path = routeByKey[key] || '/' + key;
    if (path) navigate(path);
  };

  // Keep the feature section that owns the current route expanded, while
  // still letting the user open/close the others. Not controlled while
  // collapsed — antd shows submenus as flyout popups there.
  const collapsedNow = collapsible ? isNavMenuClose : false;
  const [openKeys, setOpenKeys] = useState([]);
  useEffect(() => {
    const active = FEATURE_SECTIONS.find((s) => currentPath.startsWith(s.key + '/'));
    let want = active ? active.key : null;
    // a folded LMS section opens inside the LMS menu
    const parent = active && LMS_FOLDED.includes(active.key) ? 'lms' : null;
    if (!want && (currentPath === 'reports' || currentPath === 'performance')) want = 'reports-group';
    if (!want && ['finance', 'invoice', 'finance-payments'].includes(currentPath)) want = 'finance-group';
    if (!want && currentPath.startsWith('calling-')) want = 'sales';
    if (!want && currentPath.startsWith('sales-v3/')) want = 'sales';
    // a "More" screen also opens that nested submenu
    const inMore = ['sales/pipeline', 'sales/deals', 'sales/quotes', 'sales/customers', 'calling-dashboard', 'calling-campaigns'].includes(currentPath);
    if (want) {
      setOpenKeys((prev) => {
        const v3More = /^sales-v3\/(pipeline|deals|quotes|candidates|callsdash|campaigns)$/.test(currentPath);
        const add = [...(parent ? [parent] : []), want, ...(inMore ? ['sales-more'] : []), ...(v3More ? ['sales-v3-more'] : [])].filter((k) => !prev.includes(k));
        return add.length ? [...prev, ...add] : prev;
      });
    }
  }, [currentPath]);

  useEffect(() => {
    if (!location) return;
    const next = pathKeyFor(location);
    if (currentPath !== next) setCurrentPath(next);
  }, [location, currentPath]);

  useEffect(() => {
    if (isNavMenuClose) {
      setLogoApp(isNavMenuClose);
    }
    const timer = setTimeout(() => {
      if (!isNavMenuClose) {
        setLogoApp(isNavMenuClose);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [isNavMenuClose]);
  const onCollapse = () => {
    navMenu.collapse();
  };

  return (
    <Sider
      collapsible={collapsible}
      collapsed={collapsible ? isNavMenuClose : false}
      onCollapse={onCollapse}
      trigger={
        collapsible ? (
          <div className="navigation-trigger">{isNavMenuClose ? '»' : '«'}</div>
        ) : null
      }
      className="navigation"
      width={256}
      style={{
        overflow: 'hidden',
        height: '100vh',
        position: isMobile ? 'absolute' : 'fixed',
        top: 0,
        left: 0,
      }}
      theme={'dark'}
    >
      <div
        className="logo"
        onClick={() => navigate('/')}
        style={{
          cursor: 'pointer',
          ...(isNavMenuClose && {
            margin: '15px auto 30px',
            width: 'auto',
            justifyContent: 'center',
          }),
        }}
      >
        <img
          src={isNavMenuClose ? collapsedLogo : expandedLogo}
          alt="Career Lab Consulting"
          onError={(e) => {
            // Local dev: the uploaded logo lives on the live server — try it there, then the bundled one.
            const img = e.currentTarget;
            const fb = logoSlot(isNavMenuClose ? 'logo_sidebar_collapsed' : 'logo_sidebar_expanded')?.fallback;
            if (FILE_BASE_URL && BASE_URL && img.src.startsWith(BASE_URL) && !img.dataset.tried) {
              img.dataset.tried = '1';
              img.src = FILE_BASE_URL + img.src.slice(BASE_URL.length);
            } else if (fb && img.src !== new URL(fb, window.location.href).href) img.src = fb;
          }}
          style={{
            height: isNavMenuClose ? '40px' : '40px',
            width: 'auto',
            objectFit: 'contain',
            marginLeft: isNavMenuClose ? 0 : '-5px',
          }}
        />
      </div>
      <Menu
        items={visibleItems}
        mode="inline"
        theme={'dark'}
        selectedKeys={[currentPath]}
        inlineCollapsed={collapsedNow}
        onClick={onMenuClick}
        {...(collapsedNow ? {} : { openKeys, onOpenChange: setOpenKeys })}
        style={{
          width: '100%',
        }}
      />
    </Sider>
  );
}

function MobileSidebar() {
  const [visible, setVisible] = useState(false);
  const showDrawer = () => {
    setVisible(true);
  };
  const onClose = () => {
    setVisible(false);
  };

  return (
    <>
      <Button
        type="text"
        size="large"
        onClick={showDrawer}
        className="mobile-sidebar-btn"
      >
        <MenuOutlined style={{ fontSize: 18 }} />
      </Button>
      <Drawer
        width={250}
        // style={{ backgroundColor: 'rgba(255, 255, 255, 1)' }}
        placement={'left'}
        closable={false}
        onClose={onClose}
        open={visible}
        className="navigation-drawer"
      >
        <Sidebar collapsible={false} isMobile={true} />
      </Drawer>
    </>
  );
}