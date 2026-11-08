import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importRows } from '../src/lib/importer';
import { createApproval, confirmApproval, getSnapshot, getStore, resetStore } from '../src/lib/store';
process.env.GIFTGUARD_DB=join(mkdtempSync(join(tmpdir(),'giftguard-store-')),'test.sqlite');
process.env.GIFTGUARD_DEMO='true';
function rosa(){
  for(const [i,name] of ['Rosa Delgado','Rosa M. Delgado','R. Delgado'].entries()) importRows([{name,email:i===2?'rosa.second@example.org':'rosa@example.org',phone:'305-555-0101',address:'12 Oak Street',amount:'50.00',date:`2026-0${i+1}-02`}],`source${i}.csv`,(['online','check','event'] as const)[i],`rosa${i}`);
}
test('Rosa approved linking and undo preserve all immutable gifts and originals',()=>{
  resetStore();rosa();const before=getSnapshot();assert.equal(before.donors.length,3);assert.equal(before.matches.length,1);assert.equal(before.matches[0].recordIds.length,3);
  const giftIds=before.donors.flatMap(d=>d.gifts.map(g=>g.id)).sort();
  assert.throws(()=>confirmApproval('forged'),/missing/);
  const approval=createApproval({type:'merge',candidateIds:[before.matches[0].id]});assert.equal(getSnapshot().donors.length,3);
  confirmApproval(approval.id);const merged=getSnapshot();assert.equal(merged.donors.length,1);assert.equal(merged.giftCount,3);assert.equal(merged.totalCents,before.totalCents);assert.deepEqual(merged.donors.flatMap(d=>d.gifts.map(g=>g.id)).sort(),giftIds);
  assert.throws(()=>confirmApproval(approval.id),/already/);
  confirmApproval(createApproval({type:'undo',mergeId:merged.merges[0].id}).id);const undone=getSnapshot();assert.equal(undone.donors.length,3);assert.equal(undone.giftCount,3);assert.equal(undone.totalCents,before.totalCents);assert.equal(undone.merges[0].undone,true);assert.equal(undone.matches.length,1);
});
test('expired and stale approvals cannot mutate records',()=>{
  resetStore();rosa();const id=getSnapshot().matches[0].id;
  const expired=createApproval({type:'merge',candidateIds:[id]});getStore().prepare("UPDATE approvals SET expires_at='2000-01-01' WHERE id=?").run(expired.id);assert.throws(()=>confirmApproval(expired.id),/expired/);
  const stale=createApproval({type:'merge',candidateIds:[id]});importRows([{name:'Other Person',amount:10,date:'2026-01-01'}],'other.csv','check','other');assert.throws(()=>confirmApproval(stale.id),/changed/);assert.equal(getSnapshot().donors.length,4);
});
test('rejected groups remain separate after further imports',()=>{
  resetStore();rosa();confirmApproval(createApproval({type:'reject',candidateId:getSnapshot().matches[0].id}).id);
  importRows([{name:'Rosa Delgado',email:'rosa@example.org',phone:'3055550101',address:'12 Oak Street',amount:25,date:'2026-05-02'}],'later.csv','online','later');assert.equal(getSnapshot().matches.length,0);
});
test('household names produce cautious pair and never merge automatically',()=>{
  resetStore();for(const [i,name] of ['Maria Torres','Miguel Torres'].entries())importRows([{name,email:'family@example.org',phone:'3055550123',address:'4 Elm St',amount:20,date:'2026-01-02'}],`house${i}.csv`,'check',`house${i}`);
  const state=getSnapshot();assert.equal(state.donors.length,2);assert.equal(state.matches[0].confidence,'Low');assert.match(state.matches[0].reason,/household/);
});
test('contact and snooze updates can be undone',()=>{
  resetStore();rosa();const donorId=getSnapshot().donors[0].id;
  confirmApproval(createApproval({type:'contact',donorId,status:'Called',result:'Will call back.'}).id);assert.equal(getSnapshot().outreach[0].status,'Called');
  confirmApproval(createApproval({type:'contact',donorId,status:'Snoozed',result:''}).id);assert.equal(getSnapshot().outreach[0].snoozedUntil,'2026-11-21');
  confirmApproval(createApproval({type:'undoContact',donorId}).id);assert.equal(getSnapshot().outreach[0].status,'Called');
  confirmApproval(createApproval({type:'undoContact',donorId}).id);assert.equal(getSnapshot().outreach.length,0);
});
test('undoing an older merge cannot overwrite a later overlapping merge',()=>{
  resetStore();rosa();const first=getSnapshot().matches[0];confirmApproval(createApproval({type:'merge',candidateIds:[first.id]}).id);const oldMerge=getSnapshot().merges[0];
  importRows([{name:'Rosa Delgado',email:'rosa@example.org',phone:'3055550101',address:'12 Oak Street',amount:75,date:'2026-07-02'}],'auction.csv','auction','new-alias');
  const second=getSnapshot().matches[0];assert.ok(second);confirmApproval(createApproval({type:'merge',candidateIds:[second.id]}).id);
  assert.throws(()=>confirmApproval(createApproval({type:'undo',mergeId:oldMerge.id}).id),/newer/);assert.equal(getSnapshot().donors.length,1);assert.equal(getSnapshot().giftCount,4);
  const newest=getSnapshot().merges.find(m=>m.id!==oldMerge.id)!;confirmApproval(createApproval({type:'undo',mergeId:newest.id}).id);confirmApproval(createApproval({type:'undo',mergeId:oldMerge.id}).id);assert.equal(getSnapshot().donors.length,4);
});
test('returned approval object cannot change the server-bound action',()=>{
  resetStore();rosa();const approval=createApproval({type:'skip',candidateId:getSnapshot().matches[0].id});approval.action={type:'reset'};
  confirmApproval(approval.id);assert.equal(getSnapshot().giftCount,3);assert.equal(getSnapshot().matches[0].status,'skipped');
});
test('undo merge remains possible after contact edits and preserves edited details',()=>{
  resetStore();rosa();confirmApproval(createApproval({type:'merge',candidateIds:[getSnapshot().matches[0].id]}).id);const merged=getSnapshot().donors[0];const merge=getSnapshot().merges[0];
  confirmApproval(createApproval({type:'editContact',donorId:merged.id,email:'updated@example.org',address:'New address',language:'es'}).id);
  confirmApproval(createApproval({type:'undo',mergeId:merge.id}).id);const restored=getSnapshot();assert.equal(restored.donors.length,3);assert.equal(restored.donors.find(d=>d.id===merged.id)?.email,'updated@example.org');assert.equal(restored.giftCount,3);
});
test('merge approval names the exact chosen default or override contacts',()=>{
  resetStore();rosa();const match=getSnapshot().matches[0];
  const defaults=createApproval({type:'merge',candidateIds:[match.id]});assert.match(defaults.items[0],/Keep email: rosa.second@example.org/);assert.match(defaults.items[0],/Keep address: 12 Oak Street/);
  const override=createApproval({type:'merge',candidateIds:[match.id],email:'preferred@example.org',address:'90 New St'});assert.match(override.items[0],/Keep email: preferred@example.org/);assert.match(override.items[0],/Keep address: 90 New St/);
  confirmApproval(override.id);assert.equal(getSnapshot().donors[0].email,'preferred@example.org');assert.equal(getSnapshot().donors[0].address,'90 New St');
});
test('bulk merge cannot apply one contact override to multiple people',()=>{
  resetStore();rosa();for(const [i,name] of ['Ana Rivera','Ana M. Rivera'].entries())importRows([{name,email:'ana@example.org',phone:'3055550999',address:'9 First St',amount:50,date:`2026-0${i+1}-02`}],`ana${i}.csv`,i?'check':'online',`ana${i}`);
  const candidateIds=getSnapshot().matches.map(m=>m.id);assert.equal(candidateIds.length,2);
  assert.throws(()=>createApproval({type:'merge',candidateIds,email:'wrong@example.org'}),/one group at a time/);
  const approval=createApproval({type:'merge',candidateIds});assert.equal(approval.items.length,2);assert.ok(approval.items.some(i=>i.includes('ana@example.org')));assert.ok(approval.items.some(i=>i.includes('rosa.second@example.org')));
});
test('skip and reject decisions can be undone without losing history',()=>{
  resetStore();rosa();const candidateId=getSnapshot().matches[0].id;
  confirmApproval(createApproval({type:'skip',candidateId}).id);assert.equal(getSnapshot().matches[0].status,'skipped');
  confirmApproval(createApproval({type:'undoReview',candidateId}).id);assert.equal(getSnapshot().matches[0].status,'pending');
  confirmApproval(createApproval({type:'reject',candidateId}).id);assert.equal(getSnapshot().matches.length,0);
  confirmApproval(createApproval({type:'undoReview',candidateId}).id);assert.equal(getSnapshot().matches[0].status,'pending');assert.equal(getSnapshot().giftCount,3);
  assert.throws(()=>createApproval({type:'undoReview',candidateId}),/no change/);
});
test('undoing a rejection preserves pairs protected by another active rejection',()=>{
  resetStore();rosa();const candidateId=getSnapshot().matches[0].id;confirmApproval(createApproval({type:'reject',candidateId}).id);
  const db=getStore();const rejection=db.prepare("SELECT data FROM events WHERE type='reject'").get()!;
  db.prepare('INSERT INTO events(id,type,data,at) VALUES(?,?,?,?)').run('second-rejection','reject',String(rejection.data),new Date().toISOString());
  confirmApproval(createApproval({type:'undoReview',candidateId}).id);assert.equal(getSnapshot().matches.length,0);assert.equal((db.prepare('SELECT COUNT(*) AS total FROM rejected_pairs').get()!).total,3);
  confirmApproval(createApproval({type:'undoReview',candidateId}).id);assert.equal(getSnapshot().matches.length,1);
});
test('contact edits have an approval-gated undo and restore the preceding values',()=>{
  resetStore();rosa();const donor=getSnapshot().donors[0];
  confirmApproval(createApproval({type:'editContact',donorId:donor.id,email:'new@example.org',address:'New address',language:'es'}).id);
  const undo=createApproval({type:'undoEditContact',donorId:donor.id});assert.ok(undo.items.includes(donor.email));assert.equal(getSnapshot().donors.find(d=>d.id===donor.id)?.email,'new@example.org');
  confirmApproval(undo.id);const restored=getSnapshot().donors.find(d=>d.id===donor.id)!;assert.equal(restored.email,donor.email);assert.equal(restored.address,donor.address);assert.equal(restored.language,donor.language);
  assert.throws(()=>createApproval({type:'undoEditContact',donorId:donor.id}),/no change/);
});
test('absorbed donor contact status follows the merged person and restores on undo',()=>{
  resetStore();rosa();const before=getSnapshot();const absorbed=before.donors.find(d=>d.name==='R. Delgado')!;
  confirmApproval(createApproval({type:'contact',donorId:absorbed.id,status:'Called',result:'Already reached Rosa.'}).id);
  confirmApproval(createApproval({type:'merge',candidateIds:[getSnapshot().matches[0].id]}).id);const merged=getSnapshot();const target=merged.donors[0];assert.notEqual(target.id,absorbed.id);
  assert.equal(merged.outreach.length,1);assert.equal(merged.outreach[0].donorId,target.id);assert.equal(merged.outreach[0].status,'Called');assert.equal(merged.outreach[0].result,'Already reached Rosa.');
  confirmApproval(createApproval({type:'undo',mergeId:merged.merges[0].id}).id);const restored=getSnapshot();assert.equal(restored.outreach.length,1);assert.equal(restored.outreach[0].donorId,absorbed.id);assert.equal(restored.outreach[0].status,'Called');
});
test('merge undo preserves subsequent contact activity and original absorbed donor activity',()=>{
  resetStore();rosa();const absorbed=getSnapshot().donors.find(d=>d.name==='R. Delgado')!;
  confirmApproval(createApproval({type:'contact',donorId:absorbed.id,status:'Called',result:'First call.'}).id);
  confirmApproval(createApproval({type:'merge',candidateIds:[getSnapshot().matches[0].id]}).id);const merged=getSnapshot();const target=merged.donors[0];
  confirmApproval(createApproval({type:'contact',donorId:target.id,status:'Emailed',result:'Sent the follow-up myself.'}).id);assert.equal(getSnapshot().outreach[0].status,'Emailed');
  confirmApproval(createApproval({type:'undo',mergeId:merged.merges[0].id}).id);const restored=getSnapshot();assert.equal(restored.outreach.length,2);assert.equal(restored.outreach.find(o=>o.donorId===target.id)?.status,'Emailed');assert.equal(restored.outreach.find(o=>o.donorId===absorbed.id)?.status,'Called');
});
test('undo contact from a merged donor undoes the projected original contact update',()=>{
  resetStore();rosa();const absorbed=getSnapshot().donors.find(d=>d.name==='R. Delgado')!;
  confirmApproval(createApproval({type:'contact',donorId:absorbed.id,status:'Called',result:''}).id);confirmApproval(createApproval({type:'merge',candidateIds:[getSnapshot().matches[0].id]}).id);
  const target=getSnapshot().donors[0];confirmApproval(createApproval({type:'undoContact',donorId:target.id}).id);assert.equal(getSnapshot().outreach.length,0);
  confirmApproval(createApproval({type:'undo',mergeId:getSnapshot().merges[0].id}).id);assert.equal(getSnapshot().outreach.length,0);
});
