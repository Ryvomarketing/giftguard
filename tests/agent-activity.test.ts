import test from 'node:test';
import assert from 'node:assert/strict';
import { savedActivity, toolActivity } from '../src/lib/agent-activity';
import type { CommandResult } from '../src/lib/types';

test('working labels describe pending work without claiming a completed lookup',()=>{
 const working=toolActivity('one','get_donor_context',{view:'donor',query:'Miguel Santos'},'working');
 assert.equal(working?.label,'Finding donor records');assert.deepEqual(working?.targets,['nav-donors']);
 const result=toolActivity('one','get_donor_context',{view:'donor'},'complete',{message:'Here is Miguel.',donorId:'miguel',mode:'ai'});
 assert.deepEqual(result?.targets,['donor:miguel']);assert.equal(result?.phase,'complete');
});
test('approval feedback identifies the review card and never a confirm control',()=>{
 const result={message:'Review this action.',mode:'ai',approval:{id:'secret-approval',title:'Combine?',items:['Rosa']}} as CommandResult;
 const activity=toolActivity('two','propose_change',{action:'merge'},'complete',result);
 assert.equal(activity?.phase,'review');assert.deepEqual(activity?.targets,['approval-card']);assert.equal(activity?.label,'Ready for your review');
 assert.doesNotMatch(JSON.stringify(activity),/secret-approval|confirm-button/);
});
test('failed and unsupported tools never show successful work',()=>{
 assert.equal(toolActivity('three','draft_note',{donorId:'miguel'},'failed')?.phase,'failed');
 assert.equal(toolActivity('four','confirmApproval',{},'working'),null);
});
test('draft completion targets the returned note and generic receipts never point at an unrelated donor',()=>{
 assert.deepEqual(toolActivity('five','draft_note',{donorId:'miguel'},'complete')?.targets,['draft:miguel','voice-draft']);
 assert.deepEqual(savedActivity('six','Records combined. Every gift was kept.').targets,['workspace-notice']);
});
