import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

/**
 * The cookie-signing secret survives server restarts: an explicit GIFTGUARD_SESSION_SECRET wins,
 * otherwise a generated secret is kept beside the database (owner-only file). A fresh random
 * secret on every start would sign staff out, and break a live voice session, each time the
 * server restarted.
 */
export function loadSessionSecret(databasePath = process.env.GIFTGUARD_DB || 'data/giftguard.sqlite', fromEnvironment = process.env.GIFTGUARD_SESSION_SECRET): Buffer {
  if (fromEnvironment && fromEnvironment.length >= 32) return Buffer.from(fromEnvironment);
  const file = resolve(dirname(resolve(databasePath)), '.session-secret');
  const read = () => { try { const existing = readFileSync(file); return existing.length >= 32 ? existing : null; } catch { return null; } };
  const existing = read();
  if (existing) return existing;
  const fresh = randomBytes(32);
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, fresh, { mode: 0o600, flag: 'wx' }); return fresh; }
  catch { return read() ?? fresh; }
}
const sessionGlobal = globalThis as typeof globalThis & { giftguardSessionSecret?: Buffer };
const secret = sessionGlobal.giftguardSessionSecret ??= loadSessionSecret();
const SESSION_SECONDS = 8 * 60 * 60;
export function isDemo() { return process.env.GIFTGUARD_DEMO !== 'false'; }
function password() { return process.env.GIFTGUARD_PASSWORD || (isDemo() ? 'giftguard-demo' : ''); }
function equal(a: string, b: string) { const x=Buffer.from(a); const y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
function sign(value:string) { return createHmac('sha256', secret).update(value).digest('hex'); }
export function checkPassword(input: string) { return !!password() && equal(input, password()); }
export function makeSession() { const value=String(Math.floor(Date.now()/1000)+SESSION_SECONDS); return `${value}.${sign(value)}`; }
export function authorized(req:NextRequest) { const token=req.cookies.get('giftguard-session')?.value || ''; const [value,sig]=token.split('.'); return !!value && !!sig && Number(value)>Date.now()/1000 && equal(sig,sign(value)); }
function canonicalOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || value !== url.origin) return null;
    // NextRequest normalizes loopback addresses to localhost, while browsers
    // retain the literal address in Origin. Keep scheme and port checks intact.
    if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') url.hostname = 'localhost';
    return url.origin;
  } catch { return null; }
}
export function requireSameOrigin(req: NextRequest): void {
  const origin = canonicalOrigin(req.headers.get('origin'));
  if (!origin || origin !== canonicalOrigin(new URL(req.url).origin)) {
    throw new HttpError(403, 'Please open GiftGuard in this browser and try again.');
  }
}
export function guard(req:NextRequest, mutation=false) {
  if (mutation) requireSameOrigin(req);
  if (!authorized(req)) throw new HttpError(401,'Please sign in to GiftGuard.');
}
export class HttpError extends Error { constructor(public status:number,message:string) { super(message); } }
export function failure(error:unknown) { return NextResponse.json({error:error instanceof HttpError ? error.message : error instanceof Error && !/api.key|sk-|bearer/i.test(error.message) ? error.message.slice(0,350) : 'Something went wrong. Please try again.'},{status:error instanceof HttpError ? error.status : 400}); }
export function json(value:unknown) { return NextResponse.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}); }
export async function body(req:NextRequest) { if(Number(req.headers.get('content-length')||0)>50_000) throw new HttpError(413,'That request is too large.'); return await req.json(); }
const recent=new Map<string,number[]>();
export function rateLimit(req:NextRequest,bucket:string,limit=20) { const id=bucket==='login'?'login':`${bucket}:${req.cookies.get('giftguard-session')?.value || 'anonymous'}`; const now=Date.now(); const times=(recent.get(id)||[]).filter(t=>now-t<60_000); if(times.length>=limit) throw new HttpError(429,'Please wait a minute and try again.'); times.push(now); recent.set(id,times); }
