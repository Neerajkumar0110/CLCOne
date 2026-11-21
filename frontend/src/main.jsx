import { createRoot } from 'react-dom/client';

import RootApp from './RootApp';

// After a new build is deployed, a tab opened before it still asks for the old
// screen files (their names change every build) — the lazy import fails and the
// screen goes blank until a manual refresh. Reload once to pick up the new
// build; the session flag stops a reload loop if the file is really missing.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('clc:chunkReload')) return;
    sessionStorage.setItem('clc:chunkReload', '1');
  } catch {
    /* storage blocked: still reload once */
  }
  event.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      sessionStorage.removeItem('clc:chunkReload');
    } catch {
      /* ignore */
    }
  }, 10000);
});

const root = createRoot(document.getElementById('root'));
root.render(<RootApp />);
