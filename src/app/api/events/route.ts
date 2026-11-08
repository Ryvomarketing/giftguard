import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { body, failure, guard, HttpError, rateLimit } from '@/lib/http';
import { createEvent, deleteEvent, listEvents } from '@/lib/events';
import { snapshot } from '@/lib/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Staff only. GET lists events or renders a QR code for one; POST creates an empty list; DELETE removes an empty list. */
export async function GET(req: NextRequest) {
  try {
    guard(req);
    const code = req.nextUrl.searchParams.get('qr');
    if (code) {
      const event = listEvents().find(item => item.code === code);
      if (!event) throw new HttpError(404, 'That sign-up list was not found.');
      const link = `${req.nextUrl.origin}/signup/${event.code}`;
      const png = await QRCode.toBuffer(link, { type: 'png', margin: 1, width: 480, color: { dark: '#111111', light: '#ffffff' } });
      return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    }
    return Response.json({ events: listEvents() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  try {
    guard(req, true);
    rateLimit(req, 'events', 20);
    const input = await body(req) as { name?: unknown; host?: unknown; date?: unknown };
    const event = createEvent(input, snapshot().today, 'staff');
    return Response.json({ event }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function DELETE(req: NextRequest) {
  try {
    guard(req, true);
    const id = req.nextUrl.searchParams.get('id') ?? '';
    if (!deleteEvent(id)) throw new HttpError(404, 'That sign-up list was not found.');
    return Response.json({ removed: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
