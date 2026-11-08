import { NextRequest } from 'next/server';
import { guard,json,failure,body,HttpError } from '@/lib/http';
import { confirmApproval } from '@/lib/store';
export async function POST(req:NextRequest) {try{guard(req,true);const {id}=await body(req);if(typeof id!=='string'||id.length>200)throw new HttpError(400,'Choose an action to confirm.');return json(confirmApproval(id));}catch(e){return failure(e);}}
