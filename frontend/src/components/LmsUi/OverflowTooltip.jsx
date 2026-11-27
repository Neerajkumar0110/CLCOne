import { useEffect } from 'react';

// One premium tooltip for the whole LMS (Teacher, Learner, Support).
//  • any text cut with "…" (text-overflow: ellipsis or a line clamp) shows its
//    full text on hover / keyboard focus;
//  • every native `title="…"` inside the LMS screens is shown with the same
//    tooltip instead of the browser's grey box (the title moves to
//    data-lu-tip; icon-only buttons keep it as their aria-label).
// Pure presentation: it only reads the DOM and draws a floating box.

const ROOT_SEL = '.lu, body.lu-on .ant-modal-root, body.lu-on .ant-drawer';
const SKIP_SEL = '.ant-tooltip, .ant-select-selector, input, textarea, [contenteditable="true"], .lu-tip-off, iframe, video, canvas, svg text';

function isTruncated(el) {
  if (!el || el.nodeType !== 1 || !el.textContent || !el.textContent.trim()) return false;
  const cs = getComputedStyle(el);
  if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) return true;
  if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) return true;
  return false;
}

export default function OverflowTooltip() {
  useEffect(() => {
    const tip = document.createElement('div');
    tip.className = 'lu-tip';
    tip.setAttribute('role', 'tooltip');
    tip.id = 'lu-tip';
    document.body.appendChild(tip);
    let showT = 0;
    let current = null;
    let downAt = 0; // a click focuses too — only keyboard focus opens the tip

    const place = (el) => {
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      tip.style.left = '0px';
      tip.style.top = '0px';
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, vw - tw - 8));
      let top = r.top - th - 8;
      let below = false;
      if (top < 8) {
        top = r.bottom + 8;
        below = true;
      }
      if (top + th > vh - 8) top = Math.max(8, vh - th - 8);
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
      tip.dataset.side = below ? 'bottom' : 'top';
    };
    const hide = () => {
      clearTimeout(showT);
      tip.classList.remove('on');
      if (current) current.removeAttribute('aria-describedby');
      current = null;
    };
    const textFor = (el) => {
      if (el.dataset && el.dataset.luTip) return el.dataset.luTip;
      return isTruncated(el) ? el.textContent.trim() : '';
    };
    const findTarget = (start) => {
      let el = start;
      for (let i = 0; el && i < 6; i++, el = el.parentElement) {
        if (el.nodeType !== 1) continue;
        if (el.closest(SKIP_SEL)) return null;
        // native title → ours (once)
        const t = el.getAttribute && el.getAttribute('title');
        if (t) {
          el.dataset.luTip = t;
          el.removeAttribute('title');
          if (!el.getAttribute('aria-label') && !(el.textContent || '').trim()) el.setAttribute('aria-label', t);
        }
        if (textFor(el)) return el;
      }
      return null;
    };
    const onOver = (e) => {
      if (e.type === 'focusin' && Date.now() - downAt < 400) return;
      const t = e.target;
      if (!(t instanceof Element) || !t.closest(ROOT_SEL)) return;
      const el = findTarget(t);
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      const text = textFor(el);
      showT = setTimeout(() => {
        if (current !== el || !document.body.contains(el)) return;
        tip.textContent = text.length > 600 ? `${text.slice(0, 600)}…` : text;
        place(el);
        el.setAttribute('aria-describedby', 'lu-tip');
        tip.classList.add('on');
      }, e.type === 'focusin' ? 0 : 280);
    };
    const onOut = (e) => {
      if (!current) return;
      const to = e.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      hide();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onOver, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('scroll', hide, true);
    const onDown = () => { downAt = Date.now(); hide(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      hide();
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onOver, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      tip.remove();
    };
  }, []);
  return null;
}
