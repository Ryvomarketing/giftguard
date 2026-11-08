import { NextRequest } from 'next/server';
import { guard,json,failure } from '@/lib/http';
import { snapshot } from '@/lib/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {try{guard(req);return json(snapshot());}catch(e){return failure(e);}}
