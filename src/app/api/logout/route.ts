import { NextRequest } from 'next/server';
import { guard,json,failure } from '@/lib/http';
export async function POST(req:NextRequest) {try{guard(req,true);const res=json({ok:true});res.cookies.delete('giftguard-session');return res;}catch(e){return failure(e);}}
