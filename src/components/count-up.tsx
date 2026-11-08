'use client';

import { useEffect, useRef, useState } from 'react';

type Props = { value: number; format: (value: number) => string; durationMs?: number; replayKey?: string | number | null; className?: string };

/** Counts from the previous value to the new one. Screen readers get the final figure only. */
export function CountUp({ value, format, durationMs = 1400, replayKey = null, className }: Props) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const start = performance.now();
    const origin = replayKey !== null ? 0 : from.current;
    const tick = (now: number) => {
      const progress = reduced ? 1 : Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(origin + (value - origin) * eased);
      setShown(next);
      if (progress < 1) frame.current = requestAnimationFrame(tick); else { from.current = value; frame.current = null; }
    };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [value, durationMs, replayKey]);
  return <span className={className} aria-label={format(value)}><span aria-hidden="true">{format(shown)}</span></span>;
}
