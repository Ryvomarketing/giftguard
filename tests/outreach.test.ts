import test from 'node:test';
import assert from 'node:assert/strict';
import { needsOutreach } from '../src/lib/outreach';
import type { LateFlag, Outreach } from '../src/lib/types';
const flag={donorId:'donor',expectedDate:'2026-11-02'} as LateFlag;
const contact:Outreach={donorId:'donor',status:'Called',result:'',at:'2026-11-07T12:00:00Z',snoozedUntil:null};
test('contact hides only the current missed-gift episode',()=>{
 assert.equal(needsOutreach(flag,[],'2026-11-07'),true);
 assert.equal(needsOutreach(flag,[contact],'2026-11-07'),false);
 assert.equal(needsOutreach({...flag,expectedDate:'2026-12-02'},[contact],'2026-12-07'),true);
});
test('snooze expires on its reminder date',()=>{
 const snoozed={...contact,status:'Snoozed' as const,snoozedUntil:'2026-11-21'};
 assert.equal(needsOutreach(flag,[snoozed],'2026-11-20'),false);
 assert.equal(needsOutreach(flag,[snoozed],'2026-11-21'),true);
});
