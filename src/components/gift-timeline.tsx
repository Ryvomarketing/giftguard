'use client';

import { timelineMonths } from '@/lib/showcase';
import type { Gift, LateFlag } from '@/lib/types';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
const longMonth = (key: string) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

type Props = { gifts: Pick<Gift, 'date' | 'amountCents' | 'kind'>[]; today: string; flag?: Pick<LateFlag, 'expectedDate'> | null; months?: number; compact?: boolean };

/** Two years of giving as one row of dots, so a missing gift is visible at a glance. Purely descriptive. */
export function GiftTimeline({ gifts, today, flag = null, months = 24, compact = false }: Props) {
  const items = timelineMonths(gifts, today, flag, months);
  const max = Math.max(1, ...items.map(item => item.cents));
  const given = items.filter(item => item.count > 0).length;
  const missing = items.find(item => item.expectedMissing);
  return (
    <figure className={`gift-timeline ${compact ? 'compact' : ''}`} aria-label={`Giving over the last ${months} months`}>
      <ol className="timeline-row">
        {items.map(item => {
          const size = item.count ? 6 + Math.round(10 * Math.sqrt(item.cents / max)) : 0;
          const title = item.count ? `${longMonth(item.month)}: ${money(item.cents)}${item.count > 1 ? ` in ${item.count} gifts` : ''}${item.purchaseOnly ? ' (purchases)' : ''}` : item.expectedMissing ? `${longMonth(item.month)}: expected gift has not arrived` : `${longMonth(item.month)}: no gift`;
          return <li key={item.month} className={`${item.count ? 'given' : 'empty'} ${item.purchaseOnly ? 'purchase' : ''} ${item.expectedMissing ? 'missing' : ''} ${item.isToday ? 'today' : ''}`} title={title}>
            <span className="dot" style={item.count ? { width: size, height: size } : undefined} />
            {(item.month.endsWith('-01') || item.isToday) && <small>{item.month.endsWith('-01') ? item.month.slice(0, 4) : 'now'}</small>}
            <span className="sr-only">{title}</span>
          </li>;
        })}
      </ol>
      {!compact && <figcaption className="timeline-note"><span className="timeline-note-label">Note</span><span>{given} of the last {months} months had a gift.{missing ? ` The dashed ring is ${longMonth(missing.month)}, when the next gift was expected.` : ''} Dot size follows the amount; hollow dots are event or auction purchases. The timeline reflects the files you have uploaded.</span></figcaption>}
    </figure>
  );
}
