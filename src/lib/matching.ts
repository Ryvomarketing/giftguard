import { createHash } from 'node:crypto';
import type { MatchCandidate, SourceRecord } from './types';

export function normalizeText(value: unknown): string {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function normalizePhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}
export function normalizeAddress(value: unknown): string {
  return normalizeText(value).replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\broad\b/g, 'rd').replace(/\bboulevard\b/g, 'blvd').replace(/\bapartment\b/g, 'apt');
}
export function pairKey(a: string, b: string): string { return [a, b].sort().join('|'); }
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = old;
    }
  }
  return row[b.length];
}
function compare(a: SourceRecord, b: SourceRecord) {
  const an = normalizeText(a.name).split(' '), bn = normalizeText(b.name).split(' ');
  const sameLast = an.at(-1) === bn.at(-1);
  const sameFirst = an[0] === bn[0];
  const initial = sameLast && an[0]?.[0] === bn[0]?.[0] && (an[0].length === 1 || bn[0].length === 1);
  const fuzzy = sameLast && Math.max(an[0].length, bn[0].length) > 3 && distance(an[0], bn[0]) <= 1;
  const compatible = sameLast && (sameFirst || initial || fuzzy);
  const email = !!a.email && a.email.toLowerCase() === b.email.toLowerCase();
  const phone = !!normalizePhone(a.phone) && normalizePhone(a.phone) === normalizePhone(b.phone);
  const address = !!normalizeAddress(a.address) && normalizeAddress(a.address) === normalizeAddress(b.address);
  const zip = !!a.zip && a.zip === b.zip;
  if (!(email || phone || address || (sameLast && zip) || compatible)) return null;
  const evidence: string[] = [];
  if (email) evidence.push('Same email');
  if (phone) evidence.push('Same phone');
  if (address) evidence.push('Same street address');
  if (compatible) evidence.push(initial ? 'First name may be an initial' : fuzzy ? 'Names are very similar' : 'Same first and last name');
  if (!compatible) evidence.push('Different names — may be members of one household');
  if (!email && a.email && b.email) evidence.push('Different emails');
  const strong = compatible && (email || (phone && address));
  return { compatible, strong, evidence, confidence: strong ? 'High' as const : compatible && (phone || address || zip) ? 'Medium' as const : 'Low' as const };
}

/** Complete-link grouping: every group member must have compatible evidence with every other member. */
export function findCandidates(records: SourceRecord[], rejectedPairs = new Set<string>()): MatchCandidate[] {
  const available = records.slice().sort((a,b) => a.id.localeCompare(b.id));
  const grouped = new Set<string>();
  const results: MatchCandidate[] = [];
  for (let i = 0; i < available.length; i++) {
    const a = available[i];
    if (grouped.has(a.id)) continue;
    const group = [a];
    for (let j = i + 1; j < available.length; j++) {
      const b = available[j];
      if (grouped.has(b.id) || group.some(r => r.donorId === b.donorId || rejectedPairs.has(pairKey(r.id, b.id)))) continue;
      const comparisons = group.map(r => compare(r, b));
      if (comparisons.every(c => c && c.compatible) || (group.length === 1 && comparisons[0] && !comparisons[0].compatible)) {
        // Household conflicts appear as a pair; never extend them into a multi-person group.
        if (group.length > 1 && group.some((r,k) => group.slice(k+1).some(s => !compare(r,s)?.compatible))) continue;
        group.push(b);
        if (!comparisons[0]?.compatible) break;
      }
    }
    if (group.length < 2) continue;
    group.forEach(r => grouped.add(r.id));
    const pairs = group.flatMap((a,i) => group.slice(i+1).map(b => compare(a,b)!));
    const evidence = [...new Set(pairs.flatMap(p => p.evidence))];
    const confidence = pairs.every(p => p.strong) ? 'High' : pairs.some(p => p.confidence === 'Low') ? 'Low' : 'Medium';
    const name = group.map(r => r.name).sort((a,b) => b.length-a.length)[0];
    const ids = group.map(r => r.id).sort();
    results.push({ id: 'match_' + createHash('sha256').update(ids.join('|')).digest('hex').slice(0,20), recordIds: ids, donorIds: [...new Set(group.map(r => r.donorId))], name, confidence, reason: pairs.some(p => !p.compatible) ? 'Shared contact details, but different names. These may be different people in one household.' : `${evidence.slice(0,3).join('; ')}. Please check before combining.`, evidence, status: 'pending', assessedBy: 'rules' });
  }
  return results.sort((a,b) => ({High:0,Medium:1,Low:2}[a.confidence] - {High:0,Medium:1,Low:2}[b.confidence]) || b.recordIds.length-a.recordIds.length);
}
