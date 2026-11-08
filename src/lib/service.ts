import { getSnapshot } from './store';
import { seedDemo, seedDemoEvents, DEMO_TODAY } from './seed';
import { listEvents } from './events';
import { detectLateGifts } from './patterns';
import { aiAvailable } from './agents';
import { isDemo } from './http';
export function snapshot() {
  let data=getSnapshot();
  if(isDemo() && !data.giftCount) { seedDemo(); data=getSnapshot(); }
  let events=listEvents();
  if(isDemo() && !events.length) { seedDemoEvents(data.donors); events=listEvents(); }
  const today=isDemo()?DEMO_TODAY:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
  return {...data,events,today,demo:isDemo(),aiAvailable:aiAvailable(),flags:detectLateGifts(data.donors,today)};
}
