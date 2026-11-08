import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { guard,json,failure,HttpError,rateLimit } from '@/lib/http';
import { detectColumns, importRows } from '@/lib/importer';
import { assessMatches, mapColumns } from '@/lib/agents';
import { snapshot } from '@/lib/service';
import type { ColumnMap, ImportResult, Source } from '@/lib/types';
export const runtime='nodejs';
function sourceFor(name:string):Source|undefined {return /auction|gala/i.test(name)?'auction':/event|ticket/i.test(name)?'event':/check|cheque|mail/i.test(name)?'check':/online|web|donation/i.test(name)?'online':undefined;}
export async function POST(req:NextRequest) {try{
 guard(req,true);rateLimit(req,'import',8);
 if(Number(req.headers.get('content-length')||0)>12_000_000)throw new HttpError(413,'Please upload less than 12 MB at a time.');
 const form=await req.formData();const files=form.getAll('files');
 if(!files.length||files.length>8)throw new HttpError(400,'Choose between one and eight spreadsheets.');
 const mappingRaw=form.get('mapping');let mappings:Record<string,ColumnMap>={};
 if(typeof mappingRaw==='string') {try{mappings=JSON.parse(mappingRaw);}catch{throw new HttpError(400,'Please choose the columns again.');}}
 let sourceChoices:Record<string,Source>={};
 const sourcesRaw=form.get('sources');if(typeof sourcesRaw==='string'){try{sourceChoices=JSON.parse(sourcesRaw);}catch{throw new HttpError(400,'Please choose the file source again.');}}
 const result:ImportResult={imported:0,skipped:0,files:0,warnings:[],needsMapping:[],needsSource:[]};
 for(const file of files){
  if(!(file instanceof File)||file.size>5_000_000||!file.size||!/\.(csv|xlsx|xls)$/i.test(file.name)){result.warnings.push('Choose a CSV or Excel file under 5 MB.');continue;}
  const name=file.name.replace(/[\x00-\x1f]/g,'').slice(0,200);const bytes=Buffer.from(await file.arrayBuffer());
  let book:XLSX.WorkBook;
  try{book=XLSX.read(bytes,{type:'buffer',cellDates:true,sheetRows:20002,bookVBA:false});}catch{result.warnings.push(`${name} could not be read. Please export it again as CSV.`);continue;}
  if(book.SheetNames.length>8){result.warnings.push(`${name}: this workbook has more than eight sheets. Split it into smaller workbooks; nothing from this file was imported.`);continue;}
  for(const sheetName of book.SheetNames){
   const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[sheetName],{defval:''});
   if(rows.length>20000){result.warnings.push(`${name}: please split this file into fewer than 20,000 rows.`);continue;}
   const label=book.SheetNames.length>1?`${name} (${sheetName})`:name;
   const headers=Object.keys(rows[0]||{});let mapping=mappings[label]||mappings[name];
   const known={...detectColumns(headers),...mapping};
   const missing=['name','date','amount'].filter(k=>k==='name'?!(known.name||(known.firstName&&known.lastName)):!known[k as keyof ColumnMap]);
   if(missing.length){
    const suggested=await mapColumns(headers,rows.slice(0,5));
    result.needsMapping!.push({file:label,headers,missing,...(suggested?{suggested}:{})});
    result.warnings.push(`${label}: help identify ${missing.join(', ')}.`);continue;
   }
   mapping={...known,...mapping};
   const selectedSource=sourceChoices[name]||sourceFor(name);
   if(selectedSource&&!['online','event','auction','check'].includes(selectedSource))throw new HttpError(400,'Choose a supported source.');
   if(!selectedSource&&!mapping.source){result.needsSource!.push({file:name});continue;}
   const fileHash=createHash('sha256').update(bytes).update(sheetName).digest('hex');
   const one=importRows(rows,label,selectedSource||'online',fileHash,mapping);
   result.imported+=one.imported;result.skipped+=one.skipped;result.files+=one.files;result.warnings.push(...one.warnings);
   if(one.needsMapping)result.needsMapping!.push(...one.needsMapping);
  }
 }
 if(result.imported>0)await assessMatches(snapshot());
 result.warnings=result.warnings.slice(0,30);return json(result);
 }catch(e){return failure(e);}}
