import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectColumns, importRows, parseAmount, parseDate } from '../src/lib/importer';
import { getSnapshot, resetStore } from '../src/lib/store';
process.env.GIFTGUARD_DB=join(mkdtempSync(join(tmpdir(),'giftguard-import-')),'test.sqlite');
process.env.GIFTGUARD_DEMO='true';
test('exact file replay adds nothing; identical legitimate rows are preserved',()=>{
  resetStore();const row={name:'Alicia Lopez',amount:'12.34',date:'2026-11-01'};
  const first=importRows([row,row],'checks.csv','check','same-file');assert.equal(first.imported,2);assert.equal(getSnapshot().totalCents,2468);
  const replay=importRows([row,row],'renamed.csv','check','same-file');assert.equal(replay.imported,0);assert.equal(replay.skipped,2);assert.equal(getSnapshot().giftCount,2);
});
test('transaction IDs dedupe across exports while distinct IDs preserve equal gifts',()=>{
  resetStore();const row={name:'Alicia Lopez',amount:'50',date:'2026-11-01','Transaction ID':'A'};
  importRows([row,{...row,'Transaction ID':'B'}],'first.csv','online','first');
  const second=importRows([row,{...row,'Transaction ID':'C'}],'second.csv','online','second');assert.equal(second.imported,1);assert.equal(second.skipped,1);assert.equal(getSnapshot().giftCount,3);
});
test('ambiguous overlapping gifts remain, with a review warning',()=>{
  resetStore();const row={name:'Alicia Lopez',amount:50,date:'2026-11-01'};importRows([row],'first.csv','check','first');
  const second=importRows([row],'second.csv','check','second');assert.equal(second.imported,1);assert.match(second.warnings[0],/Kept both/);
});
test('unknown headers ask for mapping before any rows are stored',()=>{
  resetStore();const result=importRows([{'Who':'Alicia Lopez','Paid':'25','When':'2026-11-01'}],'unknown.csv','check','unknown');assert.ok(result.needsMapping);assert.equal(getSnapshot().giftCount,0);
  const mapped=importRows([{'Who':'Alicia Lopez','Paid':'25','When':'2026-11-01'}],'unknown.csv','check','unknown',{name:'Who',amount:'Paid',date:'When'});assert.equal(mapped.imported,1);
});
test('common headers and invalid values are handled conservatively',()=>{
  resetStore();assert.equal(detectColumns(['Full Name','Amt Rcvd','Received Date']).amount,'Amt Rcvd');
  const result=importRows([{name:'One',amount:'$1,234.56',date:'11/01/2026'},{name:'Two',amount:'12.345',date:'2026-11-01'},{name:'Three',amount:50,date:'2026-02-30'},{name:'Four',amount:-1,date:'2026-01-01'}],'rows.csv','check','rows');assert.equal(result.imported,1);assert.equal(result.skipped,3);assert.equal(getSnapshot().totalCents,123456);
  assert.equal(parseDate('2024-02-29'),'2024-02-29');assert.equal(parseDate('2025-02-29'),null);assert.equal(parseDate(46327),'2026-11-01');assert.equal(parseAmount('0'),null);assert.equal(parseAmount('12garbage'),null);
});
test('event purchases are distinct from explicitly classified donations',()=>{
  resetStore();importRows([{name:'One',amount:50,date:'2026-01-01'},{name:'Two',amount:50,date:'2026-01-01',kind:'donation'}],'events.csv','event','events');
  assert.equal(getSnapshot().donors.find(d=>d.name==='One')?.gifts[0].kind,'purchase');assert.equal(getSnapshot().donors.find(d=>d.name==='Two')?.gifts[0].kind,'donation');
});
test('renaming a file or selecting a different source cannot replay its gifts',()=>{
  resetStore();const row={name:'Alicia Lopez',amount:50,date:'2026-11-01'};importRows([row],'first.csv','online','same-bytes');
  const replay=importRows([row],'new.csv','check','same-bytes');assert.equal(replay.imported,0);assert.equal(getSnapshot().giftCount,1);
});
test('check numbers are scoped to their writer',()=>{
  resetStore();const rows=[{name:'Ana Rivera',amount:50,date:'2026-11-01','Check Number':'1001'},{name:'Ben Lake',amount:75,date:'2026-11-01','Check Number':'1001'}];
  const result=importRows(rows,'checks.csv','check','checks');assert.equal(result.imported,2);assert.equal(getSnapshot().giftCount,2);assert.equal(getSnapshot().totalCents,12500);
});
test('conflicting payment ID never silently discards a different gift',()=>{
  resetStore();const row={name:'Ana Rivera',amount:50,date:'2026-11-01','Transaction ID':'pay_1'};importRows([row],'first.csv','online','first');
  const conflict={...row,name:'Ben Lake',amount:75};const result=importRows([conflict],'second.csv','online','second');assert.equal(result.imported,1);assert.match(result.warnings[0],/conflicting details/);assert.equal(getSnapshot().giftCount,2);
  const replay=importRows([conflict],'third.csv','online','third');assert.equal(replay.imported,0);assert.equal(replay.skipped,1);
});
test('fresh overlapping export preserves latest transaction date when no new gifts arrive',()=>{
  resetStore();const row={name:'Ana Rivera',amount:50,date:'2026-11-01','Transaction ID':'pay_1'};importRows([row],'first.csv','online','first');
  const result=importRows([row],'new-export.csv','online','new-export');assert.equal(result.imported,0);assert.equal(getSnapshot().sources[0].throughDate,'2026-11-01');
});

test('explicit failed payments and refunds are never recorded as received gifts',()=>{
 const result=importRows([
  {Name:'Pending Person',Amount:'25',Date:'2026-11-01',Kind:'donation',Status:'failed'},
  {Name:'Refund Person',Amount:'25',Date:'2026-11-01',Kind:'refund'},
  {Name:'Settled Person',Amount:'25',Date:'2026-11-01',Kind:'donation',Status:'paid'}
 ],'payment-status.csv','online','payment-status');
 assert.equal(result.imported,1);assert.equal(result.skipped,2);assert.equal(result.warnings.length,2);
});
