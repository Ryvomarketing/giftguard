import { NextRequest } from 'next/server';
import { guard, json, failure, HttpError } from '@/lib/http';
import { getUploadedFile, listUploadedFiles } from '@/lib/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Read-only: shows an upload back as a table. Nothing here changes data. */
export async function GET(req: NextRequest) {
  try {
    guard(req);
    const name = req.nextUrl.searchParams.get('name');
    if (name === null) return json({ files: listUploadedFiles() });
    const file = getUploadedFile(name.slice(0, 260));
    if (!file) throw new HttpError(404, 'That file is not in GiftGuard. It may have been removed by a reset.');
    return json(file);
  } catch (e) { return failure(e); }
}
