import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Drawer, Layout, Menu } from 'antd';

import { useAppContext } from '@/context/appContext';
import { usePermission } from '@/context/permissionContext';
import { useTickets } from '@/context/ticketsContext';
import { useMessages } from '@/context/messagesContext';
import { MODULE_NAV_KEY } from '@/config/permissionModules';

import useLanguage from '@/locale/useLanguage';
import careerLabIcon from '@/style/images/Horizontal-1-transparent.png';
import careerLabCollapsedIcon from '@/style/images/Vertical-1-transparent.png';

import useResponsive from '@/hooks/useResponsive';

import {
  SettingOutlined,
  CustomerServiceOutlined,
  ContainerOutlined,
  DashboardOutlined,
  TagOutlined,
  TagsOutlined,
  UserOutlined,
  CreditCardOutlined,
  MenuOutlined,
  FileOutlined,
  FilterOutlined,
  ReconciliationOutlined,
  PhoneOutlined,
  TrophyOutlined,
  SolutionOutlined,
  BarChartOutlined,
  TeamOutlined,
  MessageOutlined,
  FundOutlined,
  QuestionCircleOutlined,
  GithubOutlined,
  CloudServerOutlined,
} from '@ant-design/icons';

const { Sider } = Layout;

const NAV_KEY_MODULE = Object.fromEntries(
  Object.entries(MODULE_NAV_KEY).map(([mod, key]) => [key, mod])
);

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
  const [currentPath, setCurrentPath] = useState(location.pathname.slice(1));

  const translate = useLanguage();
  const navigate = useNavigate();

  const routeByKey = {
    dashboard: '/',
    customer: '/customer',
    calls: '/calls',
    performance: '/performance',
    leads: '/leads',
    invoice: '/invoice',
    payment: '/payment',
    reports: '/reports',
    'user-management': '/user-management',
    communication: '/communication',
    finance: '/finance',
    support: '/support',
    generalSettings: '/settings',
    about: '/about',
    'git-management': '/git-management',
    'vercel-management': '/vercel-management',
  };

  const items = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: translate('dashboard'),
    },
    {
      key: 'customer',
      icon: <CustomerServiceOutlined />,
      label: translate('customers'),
    },
    {
      key: 'calls',
      icon: <PhoneOutlined />,
      label: 'Calls',
    },
    {
      key: 'performance',
      icon: <TrophyOutlined />,
      label: 'Performance',
    },
    {
      key: 'leads',
      icon: <SolutionOutlined />,
      label: 'Leads',
    },
    {
      key: 'invoice',
      icon: <ContainerOutlined />,
      label: translate('invoices'),
    },
    {
      key: 'payment',
      icon: <CreditCardOutlined />,
      label: translate('payments'),
    },
    {
      key: 'reports',
      label: 'Reports',
      icon: <BarChartOutlined />,
    },
    {
      key: 'user-management',
      label: 'User Management',
      icon: <TeamOutlined />,
    },
    {
      key: 'communication',
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Communication
          {totalUnread > 0 && (
            <Badge count={totalUnread} size="small" className="hub-nav-badge" />
          )}
        </span>
      ),
      icon: <MessageOutlined />,
    },
    {
      key: 'finance',
      label: 'Finance',
      icon: <FundOutlined />,
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

  const visibleItems = items.filter((item) => {
    const mod = NAV_KEY_MODULE[item.key];
    return mod ? canView(mod) : true;
  });

  const onMenuClick = ({ key }) => {
    const path = routeByKey[key];
    if (path) navigate(path);
  };

  useEffect(() => {
    if (location)
      if (currentPath !== location.pathname) {
        if (location.pathname === '/') {
          setCurrentPath('dashboard');
        } else setCurrentPath(location.pathname.slice(1));
      }
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
        inlineCollapsed={collapsible ? isNavMenuClose : false}
        onClick={onMenuClick}
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