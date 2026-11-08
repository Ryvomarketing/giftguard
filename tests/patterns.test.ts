import assert from 'node:assert/strict';
import test from 'node:test';
import { addCalendarMonths, detectLateGifts } from '../src/lib/patterns';
import type { Donor, Gift } from '../src/lib/types';

function donor(dates: string[], changes: Partial<Gift> = {}): Donor {
  return { id: 'd1', name: 'Marisol Vega', email: '', phone: '', address: '', language: 'en', records: [], gifts: dates.map((date, i) => ({ id: `g${i}`, recordId: 'r1', date, amountCents: 2500, recurring: true, source: 'online', sourceFile: 'test.csv', program: 'Family support', kind: 'donation', ...changes })) };
}

test('monthly missing gift starts on day five, not day four', () => {
  const d = donor(['2026-08-02', '2026-09-02', '2026-10-02']);
  assert.equal(detectLateGifts([d], '2026-11-06').length, 0);
  const [flag] = detectLateGifts([d], '2026-11-07');
  assert.equal(flag.expectedDate, '2026-11-02');
  assert.equal(flag.daysLate, 5);
  assert.equal(flag.pattern, 'monthly');
  assert.equal(flag.annualValueCents, 30_000);
});

test('a current monthly gift clears the missing-gift suggestion', () => {
  assert.equal(detectLateGifts([donor(['2026-08-02', '2026-09-02', '2026-10-02', '2026-11-02'])], '2026-11-07').length, 0);
});

test('calendar month addition clamps leap days and year boundaries', () => {
  assert.equal(addCalendarMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addCalendarMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(addCalendarMonths('2025-12-31', 3), '2026-03-31');
  assert.equal(addCalendarMonths('2026-02-28', 1, 31), '2026-03-31');
});

test('month-end monthly schedules do not drift after February', () => {
  const d = donor(['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(detectLateGifts([d], '2026-05-04').length, 0);
  assert.equal(detectLateGifts([d], '2026-05-05')[0].expectedDate, '2026-04-30');
});

test('historic missed December is flagged in November 2026', () => {
  const [flag] = detectLateGifts([donor(['2022-12-12', '2023-12-14', '2024-12-18'])], '2026-11-07');
  assert.equal(flag.pattern, 'annual');
  assert.equal(flag.expectedDate, '2025-12-31');
  assert.match(flag.reason, /2025/);
  assert.equal(flag.firstGiftYear, 2022);
});

test('December donor who gave in 2025 is not late before December 2026 ends', () => {
  const d = donor(['2023-12-12', '2024-12-14', '2025-12-18']);
  assert.equal(detectLateGifts([d], '2026-11-07').length, 0);
  assert.equal(detectLateGifts([d], '2026-12-31').length, 0);
  assert.equal(detectLateGifts([d], '2027-01-01')[0].daysLate, 1);
});

test('quarterly cadence has a two-week grace window', () => {
  const d = donor(['2026-01-10', '2026-04-10', '2026-07-10']);
  assert.equal(detectLateGifts([d], '2026-10-23').length, 0);
  const [flag] = detectLateGifts([d], '2026-10-24');
  assert.equal(flag.pattern, 'quarterly');
  assert.equal(flag.daysLate, 14);
  assert.equal(flag.annualValueCents, 10_000);
});

test('irregular giving and insufficient history never imply lateness', () => {
  assert.equal(detectLateGifts([donor(['2025-01-01', '2025-04-17', '2025-12-02'])], '2026-11-07').length, 0);
  assert.equal(detectLateGifts([donor(['2026-09-02', '2026-10-02'])], '2026-11-07').length, 0);
  assert.equal(detectLateGifts([donor(['2022-12-01', '2024-12-01'])], '2026-11-07').length, 0);
});

test('purchase and refunded/nonpositive transactions cannot establish donation cadence', () => {
  const dates = ['2026-08-02', '2026-09-02', '2026-10-02'];
  assert.equal(detectLateGifts([donor(dates, { kind: 'purchase' })], '2026-11-07').length, 0);
  assert.equal(detectLateGifts([donor(dates, { amountCents: -2500 })], '2026-11-07').length, 0);
});

test('same-day split gifts count once for cadence; amount median uses individual gifts', () => {
  const d = donor(['2026-08-02', '2026-09-02', '2026-10-02', '2026-10-02']);
  d.gifts[1].amountCents = 5000;
  d.gifts[2].amountCents = 1000;
  d.gifts[3].amountCents = 2000;
  const [flag] = detectLateGifts([d], '2026-11-07');
  assert.equal(flag.pattern, 'monthly');
  assert.equal(flag.usualAmountCents, 2000);
  assert.equal(detectLateGifts([donor(['2026-09-02', '2026-10-02', '2026-10-02'])], '2026-11-07').length, 0);
});

test('future or invalid gifts are ignored, invalid as-of date is rejected', () => {
  const d = donor(['2026-08-02', '2026-09-02', '2026-10-02', '2026-12-02', '2026-02-30']);
  assert.equal(detectLateGifts([d], '2026-11-07')[0].lastGiftDate, '2026-10-02');
  assert.throws(() => detectLateGifts([d], '2026-02-30'), /calendar date/);
});


test('three recent monthly gifts establish a pattern after earlier irregular giving', () => {
  const d = donor(['2025-01-17', '2025-09-28', '2026-08-02', '2026-09-02', '2026-10-02']);
  assert.equal(detectLateGifts([d], '2026-11-07')[0].pattern, 'monthly');
});

test('an extra one-time gift cannot hide an established monthly interruption', () => {
  const d = donor(['2026-08-02', '2026-09-02', '2026-10-02']);
  d.gifts.push({ ...d.gifts[0], id: 'earlier-one-time', date: '2020-06-15', recurring: false, amountCents: 12_000 });
  d.gifts.push({ ...d.gifts[0], id: 'recent-one-time', date: '2026-10-15', recurring: false, amountCents: 10_000 });
  const [flag] = detectLateGifts([d], '2026-11-07');
  assert.ok(flag);
  assert.equal(flag.pattern, 'monthly');
  assert.equal(flag.expectedDate, '2026-11-02');
  assert.equal(flag.daysLate, 5);
  assert.equal(flag.usualAmountCents, 2500);
  assert.equal(flag.annualValueCents, 30_000);
  assert.equal(flag.firstGiftYear, 2020);
  assert.equal(flag.lastGiftDate, '2026-10-15');
  assert.equal(flag.lastAmountCents, 10_000);
});

test('a one-time gift on the expected date does not prove the recurring gift was paid', () => {
  const d = donor(['2026-08-02', '2026-09-02', '2026-10-02']);
  d.gifts.push({ ...d.gifts[0], id: 'one-time-on-due-date', date: '2026-11-02', recurring: false });
  assert.equal(detectLateGifts([d], '2026-11-07')[0].expectedDate, '2026-11-02');
});

test('unlabelled gifts still support a regular pattern when recurring evidence is insufficient', () => {
  const d = donor(['2026-08-02', '2026-09-02', '2026-10-02'], { recurring: false });
  d.gifts[0].recurring = true;
  assert.equal(detectLateGifts([d], '2026-11-07')[0].pattern, 'monthly');
});
