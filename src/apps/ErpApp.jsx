import { useLayoutEffect } from 'react';
import { useEffect } from 'react';
import { selectAppSettings } from '@/redux/settings/selectors';
import { useDispatch, useSelector } from 'react-redux';

import { Layout } from 'antd';

import { useAppContext } from '@/context/appContext';

import Navigation from '@/apps/Navigation/NavigationContainer';

import HeaderContent from '@/apps/Header/HeaderContainer';
import PageLoader from '@/components/PageLoader';

import { settingsAction } from '@/redux/settings/actions';

import { selectSettings } from '@/redux/settings/selectors';

import AppRouter from '@/router/AppRouter';

import useResponsive from '@/hooks/useResponsive';

import storePersist from '@/redux/storePersist';

export default function ErpCrmApp() {
  const { Content } = Layout;

  const { state: stateApp } = useAppContext();
  const { isNavMenuClose } = stateApp;

  const { isMobile } = useResponsive();

  const dispatch = useDispatch();

  useLayoutEffect(() => {
    dispatch(settingsAction.list({ entity: 'setting' }));
  }, []);

  // const appSettings = useSelector(selectAppSettings);

  const { isSuccess: settingIsloaded } = useSelector(selectSettings);

  // useEffect(() => {
  //   const { loadDefaultLang } = storePersist.get('firstVisit');
  //   if (appSettings.idurar_app_language && !loadDefaultLang) {
  //     window.localStorage.setItem('firstVisit', JSON.stringify({ loadDefaultLang: true }));
  //   }
  // }, [appSettings]);

  const sidebarGap = isNavMenuClose ? 80 : 256;

  if (settingIsloaded)
    return (
      <Layout hasSider>
        <Navigation />

        {isMobile ? (
          <Layout
            style={{
              marginLeft: 0,
              height: '100vh',
              overflowY: 'auto',
            }}
          >
            <HeaderContent />
            <Content
              style={{
                margin: '10px',
                overflow: 'initial',
                width: 'calc(100% - 20px)',
                padding: 0,
                maxWidth: 'none',
              }}
            >
              <AppRouter />
            </Content>
          </Layout>
        ) : (
          <Layout
            style={{
              marginLeft: sidebarGap,
              height: '100vh',
              overflowY: 'auto',
              transition: 'margin-left 0.3s ease-in-out',
            }}
          >
            <HeaderContent />
            <Content
              style={{
                margin: '10px',
                overflow: 'initial',
                width: 'calc(100% - 20px)',
                padding: 0,
                maxWidth: 'none',
              }}
            >
              <AppRouter />
            </Content>
          </Layout>
        )}
      </Layout>
    );
  else return <PageLoader />;
}