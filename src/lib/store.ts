import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { findCandidates, pairKey } from './matching';
import type { Action, Approval, Confidence, Donor, Gift, MatchCandidate, MergeLog, Outreach, Snapshot, Source, SourceFreshness, SourceRecord, UploadedFile } from './types';

type Row = Record<string, string | number | null>;
let database: DatabaseSync | undefined;
let databasePath = '';
export function getStore(): DatabaseSync {
  const path = process.env.GIFTGUARD_DB || resolve('data/giftguard.sqlite');
  if (database && databasePath === path) return database;
  database?.close();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  database = new DatabaseSync(path); databasePath = path;
  database.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO meta VALUES('version','0');
    CREATE TABLE IF NOT EXISTS donors(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,language TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_records(id TEXT PRIMARY KEY,source TEXT NOT NULL,source_file TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,zip TEXT NOT NULL,language TEXT NOT NULL,raw_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS donor_links(record_id TEXT PRIMARY KEY REFERENCES source_records(id),donor_id TEXT NOT NULL REFERENCES donors(id));
    CREATE TABLE IF NOT EXISTS gifts(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES source_records(id),date TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),recurring INTEGER NOT NULL,source TEXT NOT NULL,source_file TEXT NOT NULL,program TEXT NOT NULL,kind TEXT NOT NULL,transaction_key TEXT UNIQUE,raw_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS imports(hash TEXT PRIMARY KEY,source TEXT NOT NULL,file TEXT NOT NULL,imported_at TEXT NOT NULL,through_date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,data TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rejected_pairs(pair TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL,expires_at TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outreach(donor_id TEXT PRIMARY KEY,data TEXT NOT NULL);
  `);
  return database;
}
export function dataVersion(): number { return Number((getStore().prepare("SELECT value FROM meta WHERE key='version'").get() as Row).value); }
export function bumpVersion(): void { getStore().prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='version'").run(); }
export function transaction<T>(fn: () => T): T {
  const db = getStore(); db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function today(): string { return process.env.GIFTGUARD_TODAY || (process.env.GIFTGUARD_DEMO !== 'false' ? '2026-11-07' : new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date())); }
function records(): SourceRecord[] {
  return (getStore().prepare('SELECT r.*,l.donor_id FROM source_records r JOIN donor_links l ON l.record_id=r.id').all() as Row[]).map(r => ({ id: String(r.id), donorId: String(r.donor_id), source: r.source as SourceRecord['source'], sourceFile: String(r.source_file), name: String(r.name), email: String(r.email), phone: String(r.phone), address: String(r.address), zip: String(r.zip), language: r.language as 'en'|'es' }));
}
function gifts(): Gift[] {
  return (getStore().prepare('SELECT * FROM gifts ORDER BY date DESC,id').all() as Row[]).map(r => ({id:String(r.id),recordId:String(r.record_id),date:String(r.date),amountCents:Number(r.amount_cents),recurring:!!r.recurring,source:r.source as Gift['source'],sourceFile:String(r.source_file),program:String(r.program),kind:r.kind as Gift['kind']}));
}
export function refreshMatches(): void {
  const db = getStore();
  const rejected = new Set((db.prepare('SELECT pair FROM rejected_pairs').all() as Row[]).map(r => String(r.pair)));
  const found = findCandidates(records(), rejected);
  const currentIds = new Set(found.map(match => match.id));
  for (const old of db.prepare("SELECT id FROM matches WHERE status IN ('pending','skipped')").all() as Row[]) {
    if (!currentIds.has(String(old.id))) db.prepare("UPDATE matches SET status='superseded' WHERE id=?").run(String(old.id));
  }
  for (const match of found) {
    const existing = db.prepare('SELECT data,status FROM matches WHERE id=?').get(match.id) as Row|undefined;
    if (!existing) db.prepare('INSERT INTO matches VALUES(?,?,?)').run(match.id,JSON.stringify(match),'pending');
    else if (existing.status === 'pending' || existing.status === 'skipped' || existing.status === 'superseded') {
      const old = JSON.parse(String(existing.data)) as MatchCandidate;
      const next = old.assessedBy === 'ai' ? {...match,confidence:old.confidence,reason:old.reason,assessedBy:old.assessedBy} : match;
      db.prepare('UPDATE matches SET data=?,status=? WHERE id=?').run(JSON.stringify(next),existing.status === 'skipped' ? 'skipped' : 'pending',match.id);
    }
  }
}
/** Project contact activity onto current donor groups without rewriting its original owner. */
function projectedOutreach(allRecords:SourceRecord[],allEvents:Row[]):{entry:Outreach;ownerId:string}[] {
  const activeIds=new Set(allRecords.map(record=>record.donorId));
  const currentLinks=new Map(allRecords.map(record=>[record.id,record.donorId]));
  const previousRecords=new Map<string,Set<string>>();
  for(const merge of allEvents.filter(e=>e.type==='merge')){
    const data=JSON.parse(String(merge.data));
    for(const link of data.priorLinks as {recordId:string;donorId:string}[]){
      const linked=previousRecords.get(link.donorId)??new Set<string>();linked.add(link.recordId);previousRecords.set(link.donorId,linked);
    }
  }
  const undone=new Set(allEvents.filter(e=>e.type==='undoContact').map(e=>JSON.parse(String(e.data)).eventId));
  const ranks=new Map<string,number>();
  for(const contact of allEvents.filter(e=>e.type==='contact'&&!undone.has(e.id))){
    const ownerId=String(JSON.parse(String(contact.data)).donorId);ranks.set(ownerId,Math.max(ranks.get(ownerId)??0,Number(contact.seq)));
  }
  const projected=new Map<string,{entry:Outreach;ownerId:string}>();
  for(const row of getStore().prepare('SELECT data FROM outreach').all() as Row[]){
    const original=JSON.parse(String(row.data)) as Outreach;const ownerId=original.donorId;
    const targets=activeIds.has(ownerId)?[ownerId]:[...new Set([...(previousRecords.get(ownerId)??[])].map(id=>currentLinks.get(id)).filter((id):id is string=>!!id))];
    // Ambiguous provenance is not silently assigned to a person after a split.
    if(targets.length!==1)continue;
    const donorId=targets[0];const previous=projected.get(donorId);
    if(!previous||original.at>previous.entry.at||(original.at===previous.entry.at&&(ranks.get(ownerId)??0)>(ranks.get(previous.ownerId)??0)))projected.set(donorId,{entry:{...original,donorId},ownerId});
  }
  return [...projected.values()];
}
function currentOutreach(donorId:string):{entry:Outreach;ownerId:string}|undefined {
  return projectedOutreach(records(),getStore().prepare('SELECT * FROM events ORDER BY seq DESC').all() as Row[]).find(item=>item.entry.donorId===donorId);
}
export function getSnapshot(): Snapshot {
  const db = getStore(); const allRecords = records(), allGifts = gifts();
  const donors: Donor[] = (db.prepare('SELECT * FROM donors WHERE id IN (SELECT DISTINCT donor_id FROM donor_links)').all() as Row[]).map(r => {
    const linked = allRecords.filter(record => record.donorId === r.id); const ids = new Set(linked.map(record=>record.id));
    return {id:String(r.id),name:String(r.name),email:String(r.email),phone:String(r.phone),address:String(r.address),language:r.language as 'en'|'es',records:linked,gifts:allGifts.filter(gift=>ids.has(gift.recordId))};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const recordDonors = new Map(allRecords.map(r=>[r.id,r.donorId]));
  const matches = (db.prepare('SELECT * FROM matches WHERE status IN (\'pending\',\'skipped\')').all() as Row[]).map(r=>({...JSON.parse(String(r.data)),status:r.status} as MatchCandidate)).filter(m=>new Set(m.recordIds.map(id=>recordDonors.get(id))).size>1).map(m=>({...m,donorIds:[...new Set(m.recordIds.map(id=>recordDonors.get(id)!))]}));
  const allEvents = db.prepare('SELECT * FROM events ORDER BY seq DESC').all() as Row[];
  const undone = new Set(allEvents.filter(e=>e.type==='undo').map(e=>JSON.parse(String(e.data)).mergeId));
  const merges: MergeLog[] = allEvents.filter(e=>e.type==='merge').map(e=>{const d=JSON.parse(String(e.data));return {id:String(e.id),donorId:d.donorId,name:d.name,recordIds:d.recordIds,at:String(e.at),reason:d.reason,undone:undone.has(e.id)};});
  const sources: SourceFreshness[] = (db.prepare('SELECT * FROM imports ORDER BY imported_at DESC').all() as Row[]).filter((r,i,arr)=>arr.findIndex(x=>x.source===r.source)===i).map(r=>({source:r.source as SourceFreshness['source'],file:String(r.file),importedAt:String(r.imported_at),throughDate:String(r.through_date)}));
  return {donors,matches,flags:[],outreach:projectedOutreach(allRecords,allEvents).map(item=>item.entry),merges,sources,today:today(),demo:process.env.GIFTGUARD_DEMO!=='false',aiAvailable:!!process.env.OPENAI_API_KEY,giftCount:allGifts.length,totalCents:allGifts.reduce((sum,g)=>sum+g.amountCents,0)};
}
export const FILE_PREVIEW_LIMIT = 500;
/** Every upload on record, newest first, with how many gifts each one contributed. */
export function listUploadedFiles(): (SourceFreshness & { rows: number })[] {
  const db = getStore();
  const counts = new Map((db.prepare('SELECT source_file,COUNT(*) AS n FROM gifts GROUP BY source_file').all() as Row[]).map(r => [String(r.source_file), Number(r.n)]));
  return (db.prepare('SELECT * FROM imports ORDER BY imported_at DESC').all() as Row[]).map(r => ({ source: r.source as Source, file: String(r.file), importedAt: String(r.imported_at), throughDate: String(r.through_date), rows: counts.get(String(r.file)) ?? 0 }));
}
/** The rows of one upload as they were in the spreadsheet, newest gift first. Rows that were not imported were never stored. */
export function getUploadedFile(file: string): UploadedFile | null {
  const db = getStore();
  const record = db.prepare('SELECT * FROM imports WHERE file=? ORDER BY imported_at DESC LIMIT 1').get(file) as Row | undefined;
  if (!record) return null;
  const total = Number((db.prepare('SELECT COUNT(*) AS n FROM gifts WHERE source_file=?').get(file) as Row).n);
  const rows = (db.prepare('SELECT raw_json FROM gifts WHERE source_file=? ORDER BY date DESC,id LIMIT ?').all(file, FILE_PREVIEW_LIMIT) as Row[]).map(r => {
    const raw = JSON.parse(String(r.raw_json)) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ? value.slice(0, 10) : String(value ?? '')]));
  });
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const squared = rows.map(row => Object.fromEntries(headers.map(header => [header, row[header] ?? ''])));
  return { file, source: record.source as Source, importedAt: String(record.imported_at), throughDate: String(record.through_date), headers, rows: squared, total };
}
export function getDonor(id: string): Donor | undefined { return getSnapshot().donors.find(d=>d.id===id); }
export function setMatchAssessment(id: string, assessment: {confidence: Confidence; reason: string; verdict?: string}): void {
  const db=getStore(); const row=db.prepare('SELECT * FROM matches WHERE id=?').get(id) as Row|undefined;
  if (!row || row.status!=='pending') return;
  const match=JSON.parse(String(row.data)) as MatchCandidate;
  // Model output is advice only; it cannot approve or reject a match.
  match.confidence = assessment.verdict==='not a match' || assessment.verdict==='not' ? 'Low' : assessment.confidence;
  match.reason=assessment.reason.slice(0,600); match.assessedBy='ai';
  db.prepare('UPDATE matches SET data=? WHERE id=?').run(JSON.stringify(match),id); bumpVersion();
}
function requireDonor(id:string): Donor { const donor=getDonor(id); if(!donor) throw new Error('This donor is no longer available. Refresh and try again.'); return donor; }
function requireMatch(id:string): MatchCandidate { const match=getSnapshot().matches.find(m=>m.id===id); if(!match) throw new Error('This match is no longer waiting for review.'); return match; }
function event(type:string,data:unknown): string { const id=randomUUID();getStore().prepare('INSERT INTO events(id,type,data,at) VALUES(?,?,?,?)').run(id,type,JSON.stringify(data),new Date().toISOString());return id; }
function mergeChoice(match:MatchCandidate,action:Extract<Action,{type:'merge'}>) {
  const donors=match.donorIds.map(requireDonor);
  const latest=donors.slice().sort((a,b)=>(b.gifts[0]?.date||'').localeCompare(a.gifts[0]?.date||''))[0];
  const target=donors.slice().sort((a,b)=>b.name.replace(/\./g,'').length-a.name.replace(/\./g,'').length)[0];
  return {donors,target,email:action.email??latest.email,address:action.address??latest.address};
}
function latestUndoableEvent(types:string[],undoType:string,field:string,id:string):Row {
  const events=getStore().prepare('SELECT * FROM events ORDER BY seq DESC').all() as Row[];
  const undone=new Set(events.filter(e=>e.type===undoType).map(e=>JSON.parse(String(e.data)).eventId));
  const found=events.find(e=>types.includes(String(e.type))&&JSON.parse(String(e.data))[field]===id&&!undone.has(e.id));
  if(!found)throw new Error('There is no change to undo.');
  return found;
}
function restoreRejectionPairs():void {
  const db=getStore();const events=db.prepare("SELECT * FROM events WHERE type IN ('reject','undoReview')").all() as Row[];
  const undone=new Set(events.filter(e=>e.type==='undoReview').map(e=>JSON.parse(String(e.data)).eventId));
  db.prepare('DELETE FROM rejected_pairs').run();
  for(const rejection of events.filter(e=>e.type==='reject'&&!undone.has(e.id))){
    const data=JSON.parse(String(rejection.data));
    const match=db.prepare('SELECT data FROM matches WHERE id=?').get(data.candidateId) as Row|undefined;
    const ids:string[]=data.recordIds??(match?JSON.parse(String(match.data)).recordIds:[]);
    for(let i=0;i<ids.length;i++)for(const other of ids.slice(i+1))db.prepare('INSERT OR IGNORE INTO rejected_pairs VALUES(?)').run(pairKey(ids[i],other));
  }
}
function describeAction(action:Action): Pick<Approval,'title'|'description'|'items'> {
  switch(action.type) {
    case 'merge': {
      if(!action.candidateIds.length || action.candidateIds.length>100 || new Set(action.candidateIds).size!==action.candidateIds.length) throw new Error('Choose between 1 and 100 distinct matches.');
      if(action.candidateIds.length>1&&(action.email!==undefined||action.address!==undefined))throw new Error('Choose contact details one group at a time. Bulk groups keep their own defaults.');
      if((action.email?.length??0)>320||(action.address?.length??0)>500)throw new Error('Please check the contact details.');
      const matches=action.candidateIds.map(requireMatch);
      const donorIds=matches.flatMap(m=>m.donorIds);
      if(new Set(donorIds).size!==donorIds.length) throw new Error('These matches overlap. Review one at a time.');
      return {title:`Combine ${matches.length===1?'these records':`${matches.length} groups`}?`,description:'Every gift and original record will be kept. You can undo this change.',items:matches.map(m=>{const choice=mergeChoice(m,action);return `${m.name}: ${m.recordIds.length} records • ${m.reason} • Keep email: ${choice.email||'No email'} • Keep address: ${choice.address||'No address'}`;})};
    }
    case 'undo': {const merge=getSnapshot().merges.find(m=>m.id===action.mergeId&&!m.undone);if(!merge)throw new Error('This merge has already been undone or does not exist.');return {title:'Undo this merge?',description:'Restore the original donor links. All gifts remain; any later contact edits stay with the donor you edited.',items:[merge.name]};}
    case 'reject': case 'skip': {const match=requireMatch(action.candidateId);return {title:action.type==='reject'?'Keep these people separate?':'Review this match later?',description:action.type==='reject'?'These pairs will not be suggested again.':'This match stays available for later review.',items:[match.name]};}
    case 'undoReview': {const review=latestUndoableEvent(['reject','skip'],'undoReview','candidateId',action.candidateId);const data=JSON.parse(String(review.data));const row=getStore().prepare('SELECT data FROM matches WHERE id=?').get(action.candidateId) as Row|undefined;return {title:'Undo this review decision?',description:'Restore the earlier review status. Other decisions to keep people separate will still be respected.',items:[row?JSON.parse(String(row.data)).name:data.candidateId]};}
    case 'undoEditContact': {const donor=requireDonor(action.donorId);const edit=latestUndoableEvent(['editContact'],'undoEditContact','donorId',donor.id);const data=JSON.parse(String(edit.data));return {title:'Undo the last contact edit?',description:'Restore the previous email, address and preferred language.',items:[donor.name,data.previous.email||'No email',data.previous.address||'No address',data.previous.language==='es'?'Spanish':'English']};}
    case 'contact': {const donor=requireDonor(action.donorId);if(!['Called','Emailed','Left message','Snoozed'].includes(action.status))throw new Error('Choose a contact result.');if(action.result.length>2000)throw new Error('Keep your result under 2,000 characters.');return {title:action.status==='Snoozed'?'Remind you in two weeks?':`Mark ${donor.name} as ${action.status.toLowerCase()}?`,description:'This records your activity. GiftGuard does not send messages or make calls.',items:[donor.name,...(action.result?[action.result]:[])]};}
    case 'undoContact': {const donor=requireDonor(action.donorId);const current=currentOutreach(donor.id);if(!current)throw new Error('There is no contact update to undo.');return {title:'Undo the last contact update?',description:'Restore the previous follow-up status for these linked records.',items:[donor.name,current.entry.status,...(current.entry.result?[current.entry.result]:[])]};}
    case 'editContact': {const donor=requireDonor(action.donorId);if(action.email.length>320||action.address.length>500||!['en','es'].includes(action.language))throw new Error('Please check the contact details.');return {title:'Save these contact details?',description:'Original spreadsheet details stay in the source records.',items:[donor.name,action.email||'No email',action.address||'No address',action.language==='es'?'Spanish':'English']};}
    case 'reset': if(process.env.GIFTGUARD_DEMO==='false')throw new Error('Reset is only available with sample data.');return {title:'Start the sample demo again?',description:'This clears sample changes and uploads. The sample files can be loaded again.',items:['Sample donor database']};
    default: throw new Error('That action is not supported.');
  }
}
export function createApproval(action:Action): Approval {
  const description=describeAction(action); const approval:Approval={id:randomUUID(),...description,action,expiresAt:new Date(Date.now()+10*60*1000).toISOString()};
  getStore().prepare('INSERT INTO approvals(id,data,version,expires_at) VALUES(?,?,?,?)').run(approval.id,JSON.stringify(approval),dataVersion(),approval.expiresAt);
  return approval;
}
function applyMerge(action:Extract<Action,{type:'merge'}>): void {
  const db=getStore();
  for(const candidateId of action.candidateIds) {
    const match=requireMatch(candidateId); const {donors,target,email,address}=mergeChoice(match,action);
    const allRecords=donors.flatMap(d=>d.records); const priorLinks=allRecords.map(r=>({recordId:r.id,donorId:r.donorId}));
    const rejected=new Set((db.prepare('SELECT pair FROM rejected_pairs').all() as Row[]).map(r=>String(r.pair)));
    if(allRecords.some((r,i)=>allRecords.slice(i+1).some(s=>rejected.has(pairKey(r.id,s.id))))) throw new Error('This group includes people previously marked different.');
    for(const record of allRecords)db.prepare('UPDATE donor_links SET donor_id=? WHERE record_id=?').run(target.id,record.id);
    db.prepare('UPDATE donors SET email=?,address=? WHERE id=?').run(email,address,target.id);
    event('merge',{donorId:target.id,name:target.name,recordIds:allRecords.map(r=>r.id),priorLinks,priorDonors:donors.map(d=>({id:d.id,name:d.name,email:d.email,phone:d.phone,address:d.address,language:d.language})),reason:match.reason,candidateId,approvedBy:'staff'});
    db.prepare("UPDATE matches SET status='approved' WHERE id=?").run(candidateId);
  }
}
function applyUndo(mergeId:string):void {
  const db=getStore();const row=db.prepare("SELECT * FROM events WHERE id=? AND type='merge'").get(mergeId) as Row|undefined;
  if(!row)throw new Error('Merge not found.');
  const data=JSON.parse(String(row.data));const snapshot=getSnapshot();
  if(snapshot.merges.find(m=>m.id===mergeId)?.undone)throw new Error('This merge was already undone.');
  const later=db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq').all(Number(row.seq)) as Row[];
  const hasLater=later.some(e=>{
    const d=JSON.parse(String(e.data));
    return e.type==='merge'&&!snapshot.merges.find(m=>m.id===e.id)?.undone&&d.recordIds.some((id:string)=>data.recordIds.includes(id));
  });
  if(hasLater)throw new Error('This donor has a newer merge. Undo newer merges first.');
  for(const link of data.priorLinks)db.prepare('UPDATE donor_links SET donor_id=? WHERE record_id=?').run(link.donorId,link.recordId);
  const undoneEdits=new Set(later.filter(e=>e.type==='undoEditContact').map(e=>JSON.parse(String(e.data)).eventId));
  for(const donor of data.priorDonors){
    const editedLater=later.some(e=>e.type==='editContact'&&!undoneEdits.has(e.id)&&JSON.parse(String(e.data)).donorId===donor.id);
    if(!editedLater)db.prepare('UPDATE donors SET name=?,email=?,phone=?,address=?,language=? WHERE id=?').run(donor.name,donor.email,donor.phone,donor.address,donor.language,donor.id);
  }
  event('undo',{mergeId,approvedBy:'staff'});
  db.prepare("UPDATE matches SET status='pending' WHERE id=?").run(data.candidateId);
}
export function confirmApproval(id:string):{message:string} {
  return transaction(()=>{
    const db=getStore();const row=db.prepare('SELECT * FROM approvals WHERE id=?').get(id) as Row|undefined;
    if(!row||row.consumed)throw new Error('This confirmation is missing or has already been used.');
    if(String(row.expires_at)<new Date().toISOString())throw new Error('This confirmation expired. Please review the action again.');
    if(Number(row.version)!==dataVersion())throw new Error('The donor list changed. Please review a fresh confirmation.');
    const approval=JSON.parse(String(row.data)) as Approval; const action=approval.action;describeAction(action);
    db.prepare('UPDATE approvals SET consumed=1 WHERE id=?').run(id);
    switch(action.type){
      case 'merge':applyMerge(action);break;
      case 'undo':applyUndo(action.mergeId);break;
      case 'reject':case 'skip':{
        const match=requireMatch(action.candidateId);db.prepare('UPDATE matches SET status=? WHERE id=?').run(action.type==='reject'?'rejected':'skipped',match.id);
        if(action.type==='reject')for(let i=0;i<match.recordIds.length;i++)for(const b of match.recordIds.slice(i+1))db.prepare('INSERT OR IGNORE INTO rejected_pairs VALUES(?)').run(pairKey(match.recordIds[i],b));
        event(action.type,{candidateId:match.id,recordIds:match.recordIds,previousStatus:match.status});break;
      }
      case 'undoReview':{
        const review=latestUndoableEvent(['reject','skip'],'undoReview','candidateId',action.candidateId);const data=JSON.parse(String(review.data));
        event('undoReview',{eventId:review.id,candidateId:action.candidateId});restoreRejectionPairs();
        db.prepare('UPDATE matches SET status=? WHERE id=?').run(data.previousStatus==='skipped'?'skipped':'pending',action.candidateId);break;
      }
      case 'undoEditContact':{
        const donor=requireDonor(action.donorId);const edit=latestUndoableEvent(['editContact'],'undoEditContact','donorId',donor.id);const data=JSON.parse(String(edit.data));
        if(data.after&&(donor.email!==data.after.email||donor.address!==data.after.address||donor.language!==data.after.language))throw new Error('These contact details changed again. Review the donor before undoing this edit.');
        db.prepare('UPDATE donors SET email=?,address=?,language=? WHERE id=?').run(data.previous.email,data.previous.address,data.previous.language,donor.id);
        event('undoEditContact',{eventId:edit.id,donorId:donor.id});break;
      }
      case 'contact':{
        const previous=db.prepare('SELECT data FROM outreach WHERE donor_id=?').get(action.donorId) as Row|undefined;
        const snooze=new Date(today()+'T12:00:00Z');snooze.setUTCDate(snooze.getUTCDate()+14);
        const update:Outreach={donorId:action.donorId,status:action.status,result:action.result,at:new Date().toISOString(),snoozedUntil:action.status==='Snoozed'?snooze.toISOString().slice(0,10):null};
        event('contact',{donorId:action.donorId,previous:previous?JSON.parse(String(previous.data)):null});db.prepare('INSERT OR REPLACE INTO outreach VALUES(?,?)').run(action.donorId,JSON.stringify(update));break;
      }
      case 'undoContact':{
        const current=currentOutreach(action.donorId);if(!current)throw new Error('There is no contact update to undo.');
        const contact=latestUndoableEvent(['contact'],'undoContact','donorId',current.ownerId);const data=JSON.parse(String(contact.data));
        if(data.previous)db.prepare('INSERT OR REPLACE INTO outreach VALUES(?,?)').run(current.ownerId,JSON.stringify(data.previous));else db.prepare('DELETE FROM outreach WHERE donor_id=?').run(current.ownerId);
        event('undoContact',{eventId:contact.id,donorId:current.ownerId,reviewedDonorId:action.donorId});break;
      }
      case 'editContact':{const donor=requireDonor(action.donorId);event('editContact',{donorId:donor.id,previous:{email:donor.email,address:donor.address,language:donor.language},after:{email:action.email,address:action.address,language:action.language}});db.prepare('UPDATE donors SET email=?,address=?,language=? WHERE id=?').run(action.email,action.address,action.language,donor.id);break;}
      case 'reset': clearTables(); break;
    }
    bumpVersion();refreshMatches();return {message:action.type==='merge'?'Records combined. Every gift was kept.':action.type==='undo'?'Merge undone. Original donor records restored.':action.type==='reset'?'Sample workspace reset.':'Saved. Your donor history is safe.'};
  });
}
function clearTables():void {
  const db=getStore();for(const table of ['outreach','approvals','events','rejected_pairs','matches','imports','gifts','donor_links','source_records','donors'])db.exec(`DELETE FROM ${table}`);
}
/** Explicit demo/test helper; never available for live records. */
export function resetStore():void {if(process.env.GIFTGUARD_DEMO==='false')throw new Error('Reset is only available with sample data.');transaction(()=>{clearTables();bumpVersion();});}
