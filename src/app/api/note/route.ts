import { NextRequest } from 'next/server';
import { guard,json,failure,body,HttpError,rateLimit } from '@/lib/http';
import { draftNote, draftFormats, type DraftFormat } from '@/lib/agents';
import { snapshot } from '@/lib/service';
export async function POST(req:NextRequest) {try{guard(req,true);rateLimit(req,'note');const {donorId,language,giveMiami,format,purpose}=await body(req);const data=snapshot();const donor=data.donors.find(d=>d.id===donorId);if(!donor)throw new HttpError(404,'That donor was not found.');return json(await draftNote(donor,data.flags.find(f=>f.donorId===donorId),language==='es'?'es':language==='en'?'en':donor.language,Boolean(giveMiami),{format:typeof format==='string'&&(draftFormats as string[]).includes(format)?format as DraftFormat:'note',purpose:typeof purpose==='string'?purpose:''}));}catch(e){return failure(e);}}
