import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST as login } from '../src/app/api/login/route';
import { guard, makeSession } from '../src/lib/http';

process.env.GIFTGUARD_DEMO='true';
delete process.env.GIFTGUARD_PASSWORD;
function request(host:string,origin:string|null,path='login') {
 return new NextRequest(`http://${host}/api/${path}`,{method:'POST',headers:{host,...(origin?{origin}:{}),'content-type':'application/json',cookie:`giftguard-session=${makeSession()}`},body:JSON.stringify({password:'giftguard-demo'})});
}
test('sample login accepts the documented IPv4 localhost address',async()=>{
 const req=request('127.0.0.1:3000','http://127.0.0.1:3000');
 assert.equal(new URL(req.url).hostname,'localhost');
 const result=await login(req);
 assert.equal(result.status,200);
 assert.match(result.headers.get('set-cookie')||'',/giftguard-session=/);
});
test('sample login also accepts localhost and the IPv6 loopback address',async()=>{
 for(const host of ['localhost:3000','[::1]:3000']){
  const result=await login(request(host,`http://${host}`));
  assert.equal(result.status,200);
 }
});
test('authenticated changes use the same loopback origin check as login',()=>{
 assert.doesNotThrow(()=>guard(request('127.0.0.1:3000','http://127.0.0.1:3000','propose'),true));
});
test('origin checks still reject unrelated sites, changed ports, schemes and absent origins',()=>{
 for(const origin of ['http://example.test:3000','http://localhost.attacker.test:3000','http://localhost:3001','https://localhost:3000','null',null]){
  assert.throws(()=>guard(request('127.0.0.1:3000',origin,'propose'),true));
 }
});
