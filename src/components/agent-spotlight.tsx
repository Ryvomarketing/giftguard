'use client';

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MousePointer2 } from 'lucide-react';
import type { AgentActivity } from '@/lib/agent-activity';

type Rectangle = { left: number; top: number; width: number; height: number };
type Geometry = {
  outline: Rectangle;
  cursor: { left: number; top: number };
  label: Rectangle | null;
};

type Frame = { key: string; geometry: Geometry | null; statusHost: HTMLElement };
const EDGE = 10;
const LABEL_HEIGHT = 62;
const SEARCH_WINDOW_MS = 8000;
const FADE_AFTER_MS = 2700;
const HIDE_AFTER_MS = 3000;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

/** Clips the actual target; small/offscreen fragments never get a pretend pointer. */
export function spotlightGeometry(target: Rectangle, viewport: Rectangle, avoidCoveringTarget = false): Geometry | null {
  if (![target.left, target.top, target.width, target.height, viewport.left, viewport.top, viewport.width, viewport.height].every(Number.isFinite)) return null;
  if (target.width <= 0 || target.height <= 0 || viewport.width < 80 || viewport.height < 90) return null;
  const left = Math.max(target.left, viewport.left + EDGE);
  const top = Math.max(target.top, viewport.top + EDGE);
  const right = Math.min(target.left + target.width, viewport.left + viewport.width - EDGE);
  const bottom = Math.min(target.top + target.height, viewport.top + viewport.height - EDGE);
  if (right - left < 16 || bottom - top < 16) return null;
  const outline = { left, top, width: right - left, height: bottom - top };
  const cursor = {
    left: clamp(left + Math.min(outline.width * .68, 280), viewport.left + EDGE, viewport.left + viewport.width - EDGE - 20),
    top: clamp(top + Math.min(outline.height * .25, 28), viewport.top + EDGE, viewport.top + viewport.height - EDGE - 20),
  };
  const labelWidth = Math.min(230, viewport.width - EDGE * 2);
  const minX = viewport.left + EDGE, maxX = viewport.left + viewport.width - EDGE - labelWidth;
  const minY = viewport.top + EDGE, maxY = viewport.top + viewport.height - EDGE - LABEL_HEIGHT;
  let label: Rectangle | null = null;
  // Prefer space outside the record so activity never hides the facts being reviewed.
  if (right + 8 <= maxX) {
    label = { left: right + 8, top: clamp(top, minY, maxY), width: labelWidth, height: LABEL_HEIGHT };
    cursor.left = clamp(right - 14, viewport.left + EDGE, viewport.left + viewport.width - EDGE - 20);
  } else if (left - labelWidth - 8 >= minX) {
    label = { left: left - labelWidth - 8, top: clamp(top, minY, maxY), width: labelWidth, height: LABEL_HEIGHT };
    cursor.left = left + 4;
  } else if (top - LABEL_HEIGHT - 8 >= minY) {
    label = { left: clamp(left, minX, maxX), top: top - LABEL_HEIGHT - 8, width: labelWidth, height: LABEL_HEIGHT };
    cursor.top = top + 4;
  } else if (bottom + 8 <= maxY) {
    label = { left: clamp(left, minX, maxX), top: bottom + 8, width: labelWidth, height: LABEL_HEIGHT };
    cursor.top = bottom - 20;
  } else if (!avoidCoveringTarget) {
    const desiredLeft = cursor.left + 22 + labelWidth <= viewport.left + viewport.width - EDGE
      ? cursor.left + 22 : cursor.left - labelWidth - 8;
    const desiredTop = cursor.top + 22 + LABEL_HEIGHT <= viewport.top + viewport.height - EDGE
      ? cursor.top + 22 : cursor.top - LABEL_HEIGHT - 8;
    label = { left: clamp(desiredLeft, minX, maxX), top: clamp(desiredTop, minY, maxY), width: labelWidth, height: LABEL_HEIGHT };
  }
  cursor.left = clamp(cursor.left, viewport.left + EDGE, viewport.left + viewport.width - EDGE - 20);
  cursor.top = clamp(cursor.top, viewport.top + EDGE, viewport.top + viewport.height - EDGE - 20);
  return { outline, cursor, label };
}

function motionSnapshot() { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
function subscribeMotion(listener: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function visibleRectangle(element: HTMLElement): Rectangle | null {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]') || !element.getClientRects().length) return null;
  const rect = element.getBoundingClientRect();
  let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return null;
    if (ancestor === element) continue;
    const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
    const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
    if (clipX || clipY) {
      const parent = ancestor.getBoundingClientRect();
      if (clipX) { left = Math.max(left, parent.left); right = Math.min(right, parent.right); }
      if (clipY) { top = Math.max(top, parent.top); bottom = Math.min(bottom, parent.bottom); }
    }
  }
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

function sameFrame(previous: Frame | null, next: Frame) {
  return previous?.key === next.key && previous.statusHost === next.statusHost && JSON.stringify(previous.geometry) === JSON.stringify(next.geometry);
}

/** A passive visual trace of real agent events. It never clicks, focuses, or scrolls. */
export function AgentSpotlight({ activity, enabled }: { activity: AgentActivity | null; enabled: boolean }) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [fadingKey, setFadingKey] = useState<string | null>(null);
  const [expiredKey, setExpiredKey] = useState<string | null>(null);
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, () => true);
  const key = activity ? `${activity.id}:${activity.phase}` : null;
  const phase = activity?.phase;
  const targetNames = JSON.stringify(activity?.targets || []);

  useEffect(() => {
    if (!enabled || !key || !phase) return;
    const names = JSON.parse(targetNames) as string[];
    let stopped = false;
    let animationFrame: number | null = null;
    let missingTimer: ReturnType<typeof setTimeout> | null = null;
    let observedTarget: HTMLElement | null = null;
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const viewport = window.visualViewport;

    const schedule = () => {
      if (!stopped && animationFrame === null) animationFrame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = new ResizeObserver(schedule);
    const mutationObserver = new MutationObserver(schedule);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      if (missingTimer) clearTimeout(missingTimer);
      if (fadeTimer) clearTimeout(fadeTimer);
      if (hideTimer) clearTimeout(hideTimer);
      mutationObserver.disconnect(); resizeObserver.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };

    function measure() {
      animationFrame = null;
      if (stopped) return;
      const bounds = { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0, width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight };
      // Only explicitly marked business modals restrict scope. The voice panel does not.
      const modal = [...document.querySelectorAll<HTMLElement>('[data-agent-scope="modal"]')].reverse().find(element => {
        const rect = visibleRectangle(element);
        return rect && spotlightGeometry(rect, bounds);
      });
      const scope = modal || document.body;
      const candidates = [...scope.querySelectorAll<HTMLElement>('[data-agent-target]')];
      if (scope.hasAttribute('data-agent-target')) candidates.unshift(scope);
      let target: HTMLElement | null = null;
      let geometry: Geometry | null = null;
      for (const name of names) {
        for (const candidate of candidates) {
          if (candidate.dataset.agentTarget !== name) continue;
          const rectangle = visibleRectangle(candidate);
          const placement = rectangle ? spotlightGeometry(rectangle, bounds, phase === 'review') : null;
          if (placement) { target = candidate; geometry = placement; break; }
        }
        if (target) break;
      }
      const next = { key: key!, geometry, statusHost: scope };
      setFrame(previous => sameFrame(previous, next) ? previous : next);
      if (target !== observedTarget) {
        resizeObserver.disconnect();
        observedTarget = target;
        if (target) { resizeObserver.observe(target); if (modal && modal !== target) resizeObserver.observe(modal); }
      }
      if (target) {
        if (missingTimer) clearTimeout(missingTimer);
        missingTimer = null;
        // A finished step fades only after its target has actually appeared, so a panel that renders a moment later still gets pointed at.
        if ((phase === 'complete' || phase === 'failed' || phase === 'saved') && !fadeTimer) {
          fadeTimer = setTimeout(() => setFadingKey(key!), FADE_AFTER_MS);
          hideTimer = setTimeout(() => { setExpiredKey(key!); stop(); }, HIDE_AFTER_MS);
        }
      } else if (!missingTimer) {
        // Missing targets never keep scanning the page indefinitely.
        missingTimer = setTimeout(stop, SEARCH_WINDOW_MS);
      }
    }

    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-agent-target', 'data-agent-scope', 'hidden', 'inert', 'aria-hidden', 'class', 'style', 'open'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    schedule();
    return stop;
  }, [enabled, key, phase, targetNames]);

  if (!enabled || !activity || !frame || expiredKey === key) return null;
  const current = frame.key === key;
  const geometry = frame.geometry;
  const transition = reducedMotion ? 'none' : 'transform 420ms cubic-bezier(.2,.8,.2,1), width 420ms cubic-bezier(.2,.8,.2,1), height 420ms cubic-bezier(.2,.8,.2,1), opacity 240ms ease';
  const fixed: CSSProperties = { position: 'fixed', left: 0, top: 0, pointerEvents: 'none', transition, willChange: reducedMotion ? undefined : 'transform' };
  const opacity = current && fadingKey !== key ? 1 : 0;
  return <>
    {current && createPortal(<span className="sr-only" role="status" aria-live="polite" aria-atomic="true" style={{ pointerEvents: 'none' }}>{activity.label}</span>, frame.statusHost)}
    {geometry && createPortal(
      <div aria-hidden="true" data-agent-overlay="true" style={{ pointerEvents: 'none', position: 'fixed', inset: 0, zIndex: 80, overflow: 'hidden' }}>
        <div style={{ ...fixed, width: geometry.outline.width, height: geometry.outline.height, transform: `translate3d(${geometry.outline.left}px, ${geometry.outline.top}px, 0)`, border: '1px solid rgba(17,17,17,.45)', borderRadius: 8, boxShadow: '0 0 0 3px rgba(255,255,255,.8)', opacity }} />
        {!reducedMotion && geometry.label && <div style={{ ...fixed, transform: `translate3d(${geometry.cursor.left}px, ${geometry.cursor.top}px, 0)`, opacity }}><MousePointer2 size={21} fill="#111" stroke="white" strokeWidth={1.5} /></div>}
        {geometry.label && <div style={{ ...fixed, transform: `translate3d(${geometry.label.left}px, ${geometry.label.top}px, 0)`, width: geometry.label.width, height: geometry.label.height, opacity }}>
          <div className="rounded-lg border border-white/20 bg-neutral-950 px-3 py-2 text-white shadow-sm" style={{ pointerEvents: 'none', height: '100%', overflow: 'hidden' }}>
            <div className="text-[10px] font-medium tracking-wide text-neutral-300">GiftGuard</div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-[15px]">{activity.label}</div>
          </div>
        </div>}
      </div>, document.body,
    )}
  </>;
}
