import { getSnapshot } from './store';
import { seedDemo, DEMO_TODAY } from './seed';
import { detectLateGifts } from './patterns';
import { aiAvailable } from './agents';
import { isDemo } from './http';
export function snapshot() {
  let data=getSnapshot();
  if(isDemo() && !data.giftCount) { seedDemo(); data=getSnapshot(); }
  const today=isDemo()?DEMO_TODAY:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
  return {...data,today,demo:isDemo(),aiAvailable:aiAvailable(),flags:detectLateGifts(data.donors,today)};
}
