import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ProjectDashboard from './ProjectDashboard';
import ProjectCreate from './ProjectCreate';
import ProjectAllocate from './ProjectAllocate';
import ProjectReview from './ProjectReview';

// Mentor / Admin projects area: 2D dashboard ⇄ 2A create / edit ⇄ 2B allocate
// ⇄ 2E review. The screen is kept in the URL (?view=&id=) so links and the
// browser's back button work.
export default function ProjectsHub() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') || 'dashboard';
  const id = sp.get('id') || null;
  const go = (v, i) => {
    const n = new URLSearchParams(sp);
    if (!v || v === 'dashboard') {
      n.delete('view');
      n.delete('id');
    } else {
      n.set('view', v);
      if (i) n.set('id', i);
      else n.delete('id');
    }
    setSp(n);
    window.scrollTo(0, 0);
  };
  const back = () => go('dashboard');
  if (view === 'create') return <ProjectCreate onDone={go} onCancel={back} />;
  if (view === 'edit' && id) return <ProjectCreate key={id} id={id} onDone={go} onCancel={back} />;
  if (view === 'allocate' && id) return <ProjectAllocate key={id} briefId={id} onDone={go} onCancel={back} />;
  if (view === 'review' && id) return <ProjectReview key={id} id={id} onBack={back} />;
  return <ProjectDashboard go={go} />;
}
