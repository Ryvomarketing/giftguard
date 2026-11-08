import { NextRequest, NextResponse } from 'next/server';
import { body, checkPassword, failure, HttpError, makeSession, rateLimit, requireSameOrigin } from '@/lib/http';
export const runtime='nodejs';
export async function POST(req:NextRequest) { try {
 requireSameOrigin(req);
 rateLimit(req,'login',10);
 const data=await body(req); if(typeof data.password!=='string'||!checkPassword(data.password)) throw new HttpError(401,'That password did not match. Please try again.');
 const res=NextResponse.json({ok:true}); res.cookies.set('giftguard-session',makeSession(),{httpOnly:true,sameSite:'strict',secure:req.nextUrl.protocol==='https:',maxAge:28800,path:'/'}); return res;
 }catch(e){return failure(e);} }
