import { NextRequest } from 'next/server';
import { body, failure, guard, HttpError, rateLimit } from '@/lib/http';

export const runtime = 'nodejs';

/** Narration for the guided tour. Text in, audio out; nothing is stored and no donor data is required. */
export async function POST(req: NextRequest) {
  try {
    guard(req, true);
    rateLimit(req, 'speech', 40);
    const input = await body(req) as { text?: unknown; language?: unknown };
    const spanish = input.language === 'es';
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > 600) throw new HttpError(400, 'Narration must be between 1 and 600 characters.');
    if (!process.env.OPENAI_API_KEY) throw new HttpError(503, 'Spoken narration needs the server API key. The tour continues with captions.');
    const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
        voice: process.env.OPENAI_REALTIME_VOICE || 'marin',
        input: text,
        response_format: 'mp3',
        // A touch quicker than the model's default keeps the tour near a minute without sounding rushed.
        speed: Math.min(1.5, Math.max(0.8, Number(process.env.OPENAI_TTS_SPEED) || 1.2)),
        instructions: spanish
          ? 'Eres una guía cálida y cercana que le muestra a una colega su espacio de trabajo de donantes. Habla en español colombiano, con acento natural de Colombia, en tono casual y amable, como una compañera de trabajo, con ritmo ágil pero sin afán. Nunca suenes a vendedora.'
          : 'You are a warm, confident guide showing a nonprofit staff member around their donor workspace. Keep a brisk, lively pace without ever sounding rushed. Friendly and clear, never salesy.',
      }),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]),
    });
    if (!upstream.ok || !upstream.body) throw new HttpError(502, 'Narration could not be generated. The tour continues with captions.');
    return new Response(upstream.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    return failure(error instanceof HttpError ? error : new HttpError(502, 'Narration could not be generated. The tour continues with captions.'));
  }
}
