import { NextRequest } from 'next/server';
import { z } from 'zod';
import { guard,json,failure,body,HttpError,isDemo } from '@/lib/http';
import { createApproval } from '@/lib/store';
const actionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('merge'),candidateIds:z.array(z.string().max(200)).min(1).max(30),email:z.string().max(254).optional(),address:z.string().max(500).optional()}),
 z.object({type:z.literal('undo'),mergeId:z.string().max(200)}),
 z.object({type:z.literal('reject'),candidateId:z.string().max(200)}),
 z.object({type:z.literal('skip'),candidateId:z.string().max(200)}),
 z.object({type:z.literal('contact'),donorId:z.string().max(200),status:z.enum(['Called','Emailed','Left message','Snoozed']),result:z.string().max(2000)}),
 z.object({type:z.literal('undoContact'),donorId:z.string().max(200)}),
 z.object({type:z.literal('undoEditContact'),donorId:z.string().max(200)}),
 z.object({type:z.literal('undoReview'),candidateId:z.string().max(200)}),
 z.object({type:z.literal('editContact'),donorId:z.string().max(200),email:z.string().max(254),address:z.string().max(500),language:z.enum(['en','es'])}),
 z.object({type:z.literal('reset')})
]);
export async function POST(req:NextRequest) {try{guard(req,true);const action=actionSchema.parse((await body(req)).action);if(action.type==='reset'&&!isDemo())throw new HttpError(403,'Reset is only available with made-up demo data.');return json(createApproval(action));}catch(e){return failure(e);}}
