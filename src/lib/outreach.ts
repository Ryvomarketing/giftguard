import type { LateFlag, Outreach } from './types';
/** Contact closes one missing-gift episode, not every future follow-up. */
export function needsOutreach(flag:LateFlag, outreach:Outreach[], today:string):boolean {
 const contact=outreach.find(item=>item.donorId===flag.donorId);
 if(!contact)return true;
 if(contact.status==='Snoozed')return !contact.snoozedUntil||contact.snoozedUntil<=today;
 return contact.at.slice(0,10)<flag.expectedDate;
}
