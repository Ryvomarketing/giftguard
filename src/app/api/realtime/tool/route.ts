import { NextRequest } from 'next/server';
import { failure, guard, HttpError, json, rateLimit } from '@/lib/http';
import { readLimitedText, runRealtimeTool } from '@/lib/realtime';
import { snapshot } from '@/lib/service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    guard(req, true);
    rateLimit(req, 'realtime-tool', 60);
    const text = await readLimitedText(req, 16_384);
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new HttpError(400, 'The voice action was not understood. Please try again.'); }
    return json(await runRealtimeTool(input, snapshot()));
  } catch (error) {
    return failure(error instanceof HttpError ? error : new HttpError(400, 'That action is no longer available. Please review the current donor records and try again.'));
  }
}
