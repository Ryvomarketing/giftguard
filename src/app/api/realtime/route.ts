import { NextRequest } from 'next/server';
import { failure, guard, HttpError, rateLimit } from '@/lib/http';
import { readLimitedText, realtimeSession } from '@/lib/realtime';
import { snapshot } from '@/lib/service';

export const runtime = 'nodejs';

/** Exchange SDP only. The persistent media connection is browser ↔ OpenAI. */
export async function POST(req: NextRequest) {
  try {
    guard(req, true);
    rateLimit(req, 'realtime', 12);
    if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/sdp') throw new HttpError(415, 'Start a live voice connection from GiftGuard.');
    const sdp = await readLimitedText(req, 65_536);
    if (!sdp.startsWith('v=0') || !/(?:^|\r?\n)m=audio\s/.test(sdp)) throw new HttpError(400, 'The voice connection request was invalid. Please reconnect.');
    if (!process.env.OPENAI_API_KEY) throw new HttpError(503, 'Live voice needs the server API key. You can still use the typed assistant.');
    const body = new FormData();
    body.set('sdp', sdp);
    body.set('session', JSON.stringify(realtimeSession(snapshot().today)));
    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body,
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(25_000)]),
    });
    if (!upstream.ok) throw new HttpError(502, 'Live voice could not connect. Please try again or use the typed assistant.');
    const answer = await readLimitedText(upstream, 65_536, 502);
    if (!answer.startsWith('v=0') || !/(?:^|\r?\n)m=audio\s/.test(answer)) throw new HttpError(502, 'The voice service returned an invalid connection response.');
    return new Response(answer, { headers: { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    return failure(error instanceof HttpError ? error : new HttpError(503, 'Live voice could not connect. Please try again or use the typed assistant.'));
  }
}
