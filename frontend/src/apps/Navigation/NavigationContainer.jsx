import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Drawer, Layout, Menu } from 'antd';

import { useAppContext } from '@/context/appContext';
import { usePermission } from '@/context/permissionContext';
import { useTickets } from '@/context/ticketsContext';
import { useMessages } from '@/context/messagesContext';
import { MODULE_NAV_KEY } from '@/config/permissionModules';
import { FEATURE_SECTIONS } from '@/config/featureSections';

import useLanguage from '@/locale/useLanguage';
import careerLabIcon from '@/style/images/Horizontal-1-transparent.png';
import careerLabCollapsedIcon from '@/style/images/Vertical-1-transparent.png';

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
} from '@ant-design/icons';

const { Sider } = Layout;

const NAV_KEY_MODULE = Object.fromEntries(
  Object.entries(MODULE_NAV_KEY).map(([mod, key]) => [key, mod])
);

// Calling's 10 tabs are one page switched by a `?tab=` query param (see
// pages/Calling/index.jsx), not separate routes — so the sidebar's synthetic
// "current path" for /calling folds the query param in, the same way
// "sales/leads" folds a real route segment in for feature sections.
const CALLING_TABS = ['dashboard', 'team', 'dial', 'campaigns', 'dialer', 'agent', 'history', 'callbacks', 'recordings', 'reports'];
function pathKeyFor(loc) {
  if (loc.pathname === '/') return 'dashboard';
  const base = loc.pathname.slice(1);
  if (base === 'calling') {
    const tab = new URLSearchParams(loc.search).get('tab');
    return `calling-${CALLING_TABS.includes(tab) ? tab : 'dashboard'}`;
  }
  return base;
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
  const { canView } = usePermission();
  const { tickets } = useTickets();
  const openTicketsCount = tickets.filter((t) => t.status === 'Open').length;
  const { totalUnread } = useMessages();
  const [showLogoApp, setLogoApp] = useState(isNavMenuClose);
  const [currentPath, setCurrentPath] = useState(pathKeyFor(location));

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
    'calling-team': '/calling?tab=team',
    'calling-dial': '/calling?tab=dial',
    'calling-campaigns': '/calling?tab=campaigns',
    'calling-dialer': '/calling?tab=dialer',
    'calling-agent': '/calling?tab=agent',
    'calling-history': '/calling?tab=history',
    'calling-callbacks': '/calling?tab=callbacks',
    'calling-recordings': '/calling?tab=recordings',
    'calling-reports': '/calling?tab=reports',
    communication: '/communication',
    // Analytics
    performance: '/performance',
    reports: '/reports',
    // Billing & finance
    invoice: '/invoice',
    payment: '/payment',
    finance: '/finance',
    // Administration
    'user-management': '/user-management',
    support: '/support',
    'git-management': '/git-management',
    'vercel-management': '/vercel-management',
    generalSettings: '/settings',
    about: '/about',
  };

  // The six new sections (Sales, Marketing, Operations, LMS, HR, Messenger)
  // from config/featureSections.js — each an EXPANDABLE submenu whose children
  // are its sub-modules, routing to /<section>/<tab>. Team Chat lives inside
  // Messenger, so that section carries the unread-message badge.
  const featureItems = FEATURE_SECTIONS.map((section) => {
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
    return {
      key: section.key,
      icon: SectionIcon ? <SectionIcon /> : undefined,
      label,
      children: section.tabs.map((tab) => {
        const TabIcon = tab.Icon;
        return {
          key: `${section.key}/${tab.key}`,
          icon: TabIcon ? <TabIcon /> : undefined,
          label: tab.label,
        };
      }),
    };
  });

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

    // ---- Call center (VICIdial-ready, mock by default) ---- its 10 tabs are
    // in-page (?tab=…, see pages/Calling/index.jsx) rather than real routes,
    // so each child navigates to /calling with that query param — see
    // routeByKey and CALLING_TABS above.
    {
      key: 'calling',
      label: 'Calls',
      icon: <PhoneOutlined />,
      children: [
        { key: 'calling-dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
        { key: 'calling-team', label: 'Team Overview', icon: <TeamOutlined /> },
        { key: 'calling-dial', label: 'Dialer', icon: <PhoneOutlined /> },
        { key: 'calling-campaigns', label: 'Campaigns', icon: <RocketOutlined /> },
        { key: 'calling-dialer', label: 'Auto Dialer', icon: <ThunderboltOutlined /> },
        { key: 'calling-agent', label: 'Agent Screen', icon: <UserOutlined /> },
        { key: 'calling-history', label: 'Call History', icon: <HistoryOutlined /> },
        { key: 'calling-callbacks', label: 'Callbacks', icon: <ClockCircleOutlined /> },
        { key: 'calling-recordings', label: 'Recordings', icon: <PlayCircleOutlined /> },
        { key: 'calling-reports', label: 'Reports', icon: <BarChartOutlined /> },
      ],
    },

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
        { key: 'payment', label: translate('payments'), icon: <CreditCardOutlined /> },
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
    .filter((item) => {
      const mod = NAV_KEY_MODULE[item.key];
      if (mod) return canView(mod); // parent-gated (feature sections)
      if (item.children) return item.children.length > 0; // pure grouping node
      return true;
    });

  const onMenuClick = ({ key }) => {
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
    if (!want && (currentPath === 'reports' || currentPath === 'performance')) want = 'reports-group';
    if (!want && ['finance', 'invoice', 'payment'].includes(currentPath)) want = 'finance-group';
    if (!want && currentPath.startsWith('calling-')) want = 'calling';
    if (want) {
      setOpenKeys((prev) => (prev.includes(want) ? prev : [...prev, want]));
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
          src={isNavMenuClose ? careerLabCollapsedIcon : careerLabIcon}
          alt="Career Lab Consulting"
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
        style={{ ['marginLeft']: 25 }}
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