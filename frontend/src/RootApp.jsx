import './style/app.css';

import { Suspense, lazy } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import store from '@/redux/store';
import PageLoader from '@/components/PageLoader';
import { ThemeProvider } from '@/context/themeContext';

const IdurarOs = lazy(() => import('./apps/IdurarOs'));

export default function RoutApp() {
  return (
    <BrowserRouter>
      <Provider store={store}>
        <ThemeProvider>
          <Suspense fallback={<PageLoader />}>
            <IdurarOs />
          </Suspense>
        </ThemeProvider>
      </Provider>
    </BrowserRouter>
  );
}
