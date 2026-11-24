import React, { useEffect, useRef, useState } from 'react';
import { useContentProgress } from './tracker';
import { C, I, Btn } from './ui';

// In-LMS viewer for study material (learner) so reading time and scroll depth
// can be tracked (Figma 3B). Text files render inline (real scroll depth);
// PDFs / documents open in an embedded viewer (time on page); video plays in
// a <video> (watch %, pauses, rewatches); images count as seen on open.
export default function MaterialViewer({ m, kind, onClose }) {
  const scrollRef = useRef(null);
  const videoRef = useRef(null);
  const [text, setText] = useState(null);
  useEffect(() => {
    if (kind !== 'text' || !m) return;
    fetch(m.fileUrl)
      .then((r) => r.text())
      .then((t) => setText(t.slice(0, 400000)))
      .catch(() => setText('Could not load this file.'));
  }, [m, kind]);
  useContentProgress({
    kind: kind === 'video' ? 'video' : 'material',
    ref: m && String(m.id),
    title: m && m.title,
    course: m && m.courseTitle,
    module: m && (m.subject || m.batch),
    scrollRef: kind === 'text' ? scrollRef : undefined,
    videoRef: kind === 'video' ? videoRef : undefined,
    // embedded PDF / document: we can't see its scrolling — 5 active minutes = fully read
    readSecTarget: ['text', 'video', 'image'].includes(kind) ? undefined : 300,
    enabled: !!m,
  });
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!m) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={m.title} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15,23,42,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.w, borderRadius: 14, width: 'min(1100px, 100%)', height: 'min(88vh, 900px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${C.ln}` }}>
          <I n={kind === 'video' ? 'video' : 'reading'} c={C.pri} />
          <b style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</b>
          <Btn k="s" sm i="download" href={m.fileUrl} target="_blank">
            Open in new tab
          </Btn>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: 'none', cursor: 'pointer', color: C.mut }}>
            <I n="x" />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: kind === 'video' ? '#000' : C.bg }}>
          {kind === 'text' && (
            <div ref={scrollRef} style={{ height: '100%', overflow: 'auto', padding: 24 }}>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1.6, margin: 0, color: C.ink }}>{text == null ? 'Loading…' : text}</pre>
            </div>
          )}
          {kind === 'video' && <video ref={videoRef} src={m.fileUrl} controls autoPlay style={{ width: '100%', height: '100%' }} />}
          {kind === 'image' && (
            <div style={{ height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={m.fileUrl} alt={m.title} style={{ maxWidth: '100%', maxHeight: '100%' }} />
            </div>
          )}
          {!['text', 'video', 'image'].includes(kind) && <iframe title={m.title} src={m.fileUrl} style={{ width: '100%', height: '100%', border: 0 }} />}
        </div>
      </div>
    </div>
  );
}
