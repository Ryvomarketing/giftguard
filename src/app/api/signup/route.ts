import { NextRequest } from 'next/server';
import { body, failure, HttpError, requireSameOrigin } from '@/lib/http';
import { addSignup, eventByCode, validateSignupInput } from '@/lib/events';
import { snapshot } from '@/lib/service';

export const runtime = 'nodejs';

const recent = new Map<string, number[]>();
/** Guests are not signed in, so the limit is per network address: 30 sign-ups a minute is generous for a check-in table. */
function publicRateLimit(req: NextRequest, limit = 30) {
  const address = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
  const now = Date.now();
  const times = (recent.get(address) ?? []).filter(time => now - time < 60_000);
  if (times.length >= limit) throw new HttpError(429, 'Please wait a minute and try again.');
  times.push(now); recent.set(address, times);
}

/** Public: a guest adds themselves to one event's list. The response confirms only their own name; the donor match stays with staff. */
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    publicRateLimit(req);
    const input = await body(req) as Record<string, unknown>;
    const code = String(input.code ?? '').slice(0, 40);
    const event = eventByCode(code);
    if (!event) throw new HttpError(404, 'This sign-up page is no longer available.');
    let valid;
    try { valid = validateSignupInput(input); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Please check the form.'); }
    try {
      const signup = addSignup(event.id, valid, snapshot().donors);
      return Response.json({ ok: true, name: signup.name, event: event.name }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { throw new HttpError(409, error instanceof Error ? error.message : 'Please see a staff member.'); }
  } catch (error) { return failure(error); }
}
