import { NextRequest } from 'next/server';
import { z } from 'zod';
import { guard,json,failure,body,HttpError,rateLimit } from '@/lib/http';
import { commandContextSchema, handleCommand } from '@/lib/agents';
import { snapshot } from '@/lib/service';
const requestSchema = commandContextSchema.extend({ message: z.string().max(1500).trim().min(1) }).strict();
export async function POST(req:NextRequest) {try{
 guard(req,true);rateLimit(req,'command');
 const parsed=requestSchema.safeParse(await body(req));
 if(!parsed.success)throw new HttpError(400,'Use a request up to 1,500 characters and at most eight recent messages, each up to 1,500 characters and 8,000 total. Choose one donor for a follow-up.');
 const {message,...context}=parsed.data;
 return json(await handleCommand(message,snapshot(),context));
}catch(e){return failure(e);}}
