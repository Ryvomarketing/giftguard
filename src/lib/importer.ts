import { createHash } from 'node:crypto';
import { bumpVersion, getStore, refreshMatches, transaction } from './store';
import { normalizePhone, normalizeText } from './matching';
import type { ColumnMap, ImportResult, Source } from './types';

const aliases:Record<keyof ColumnMap,string[]>={
  name:['name','donor','donor name','full name','supporter','supporter name','bidder','bidder name','attendee','payor','payer','check name'],
  firstName:['first name','firstname','first','given name'],lastName:['last name','lastname','last','surname'],
  email:['email','email address','e mail','donor email','contact email'],phone:['phone','telephone','mobile','phone number','contact phone'],
  address:['address','street','street address','mailing address','address line 1'],zip:['zip','zip code','zipcode','postal code','postal'],
  amount:['amount','gift amount','donation amount','total','total paid','amount paid','amt','amt rcvd','payment','paid','bid amount','check amount'],
  date:['date','gift date','donation date','payment date','received','received date','date received','paid at','transaction date','check date'],
  recurring:['recurring','is recurring','monthly','recurring gift','subscription'],source:['source','channel'],
  transactionId:['transaction id','gift id','payment id','donation id','receipt id','check number','check no','id'],program:['program','fund','designation','campaign'],
  kind:['kind','type','transaction type','gift type','payment status','transaction status','status'],language:['language','preferred language','lang']
};
export function detectColumns(headers:string[]):ColumnMap {
  const result:ColumnMap={};
  for(const [key, alternatives] of Object.entries(aliases)){
    const header=headers.find(h=>alternatives.includes(normalizeText(h)));if(header)result[key as keyof ColumnMap]=header;
  }
  return result;
}
export function parseAmount(value:unknown):number|null {
  if(typeof value==='number')return Number.isFinite(value)&&value>0&&value<=100000000&&Math.abs(value*100-Math.round(value*100))<0.00001?Math.round(value*100):null;
  const text=String(value??'').trim();if(!/^\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(text))return null;
  const amount=Number(text.replace(/[$,\s]/g,''));return amount>0&&amount<=100000000?Math.round(amount*100):null;
}
export function parseDate(value:unknown):string|null {
  if(value instanceof Date){return Number.isFinite(value.getTime())?value.toISOString().slice(0,10):null;}
  if(typeof value==='number'){
    if(!Number.isFinite(value)||value<1||value>100000)return null;
    // Excel's 1900 date system (including its historical leap-year offset).
    return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
  }
  const text=String(value??'').trim();let y:number,m:number,d:number;
  let match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  if(match){y=Number(match[1]);m=Number(match[2]);d=Number(match[3]);}
  else {match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!match)return null;y=Number(match[3]);m=Number(match[1]);d=Number(match[2]);}
  const date=new Date(Date.UTC(y,m-1,d));if(y<1900||y>2100||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return null;
  return date.toISOString().slice(0,10);
}
function hash(value:string):string {return createHash('sha256').update(value).digest('hex');}
function cell(row:Record<string,unknown>,map:ColumnMap,key:keyof ColumnMap):string{return String(map[key]?row[map[key]!]??'':'').trim();}
function getSource(value:string,fallback:Source):Source {const source=normalizeText(value);return source.includes('auction')||source.includes('gala')?'auction':source.includes('event')||source.includes('ticket')?'event':source.includes('check')||source.includes('cheque')||source.includes('mail')?'check':source.includes('online')||source.includes('web')?'online':fallback;}

export function importRows(rows:Record<string,unknown>[],sourceFile:string,source:Source,fileHash:string,mapping?:ColumnMap):ImportResult {
  if(!['online','event','auction','check'].includes(source))throw new Error('Choose a supported source.');
  if(rows.length>20000)throw new Error('Please upload no more than 20,000 rows at once.');
  const db=getStore();const result:ImportResult={imported:0,skipped:0,files:1,warnings:[]};
  if(!rows.length){result.warnings.push(`${sourceFile}: no gift rows found.`);return result;}
  const importKey=hash(fileHash);
  if(db.prepare('SELECT hash FROM imports WHERE hash=?').get(importKey)){result.skipped=rows.length;return result;}
  const headers=[...new Set(rows.flatMap(r=>Object.keys(r)))];const map={...detectColumns(headers),...mapping};
  const missing=['name','amount','date'].filter(k=>k==='name'?!(map.name||(map.firstName&&map.lastName)):!map[k as keyof ColumnMap]);
  if(missing.length){result.needsMapping=[{file:sourceFile,headers,missing}];result.warnings.push(`${sourceFile}: please identify ${missing.join(', ')} before importing.`);return result;}
  for(const header of Object.values(map))if(header&&!headers.includes(header))throw new Error(`Column "${header}" was not found in ${sourceFile}.`);
  return transaction(()=>{
    let throughDate='';
    let validRows=0;
    for(let index=0;index<rows.length;index++){
      const row=rows[index];const rowNumber=index+2;
      const kindText=normalizeText(cell(row,map,'kind'));
      const statusCells=Object.entries(row).filter(([header])=>/^(payment |transaction )?status$/.test(normalizeText(header))).map(([,value])=>normalizeText(value));
      if([kindText,...statusCells].some(value=>/\b(refund(?:ed)?|failed|declined|pending|void(?:ed)?|chargeback|cancelled|canceled)\b/.test(value))){result.skipped++;result.warnings.push(`${sourceFile}, row ${rowNumber}: a refund or unsettled payment is not a received gift. This row was not imported.`);continue;}
      const name=(cell(row,map,'name')||`${cell(row,map,'firstName')} ${cell(row,map,'lastName')}`).trim();
      const amount=parseAmount(row[map.amount!]);const date=parseDate(row[map.date!]);
      if(!name||name.length>200||!amount||!date){result.skipped++;result.warnings.push(`${sourceFile}, row ${rowNumber}: check the ${!name||name.length>200?'name':!amount?'positive gift amount':'date (YYYY-MM-DD or MM/DD/YYYY)'}. This row was not imported.`);continue;}
      const email=cell(row,map,'email').toLowerCase().slice(0,320),phone=normalizePhone(cell(row,map,'phone')),address=cell(row,map,'address').slice(0,500),zip=cell(row,map,'zip').slice(0,20);
      const rowSource=getSource(cell(row,map,'source'),source);const language=cell(row,map,'language').toLowerCase().startsWith('es')?'es':'en';
      const recordId='record_'+hash([rowSource,normalizeText(name),email,phone,normalizeText(address),zip].join('|')).slice(0,24);
      const donorId='donor_'+recordId.slice(7);
      validRows++;if(date>throughDate)throughDate=date;
      const transactionId=cell(row,map,'transactionId');
      // Check numbers belong to the writer, not to a globally unique payment namespace.
      const baseTransactionKey=transactionId?[rowSource,...(rowSource==='check'?[recordId]:[]),transactionId].join('|'):null;
      let transactionKey=baseTransactionKey;
      if(baseTransactionKey){
        const existing=db.prepare('SELECT record_id,date,amount_cents FROM gifts WHERE transaction_key=?').get(baseTransactionKey);
        if(existing){
          if(existing.record_id===recordId&&existing.date===date&&existing.amount_cents===amount){result.skipped++;continue;}
          result.warnings.push(`${name}: transaction ID ${transactionId} has conflicting details. Both entries were kept for review.`);
          transactionKey=baseTransactionKey+'|conflict:'+hash([recordId,date,amount].join('|')).slice(0,20);
          if(db.prepare('SELECT id FROM gifts WHERE transaction_key=?').get(transactionKey)){result.skipped++;continue;}
        }
      }
      const recurring=/^(true|yes|1|monthly|recurring|y)$/i.test(cell(row,map,'recurring'));
      const kind=kindText==='donation'||kindText==='gift'?'donation':kindText==='purchase'||kindText.includes('ticket')||kindText.includes('auction')?'purchase':rowSource==='event'||rowSource==='auction'?'purchase':'donation';
      if(!transactionKey&&db.prepare('SELECT id FROM gifts WHERE record_id=? AND date=? AND amount_cents=? AND source_file<>?').get(recordId,date,amount,sourceFile))result.warnings.push(`${name}: a similar gift already exists. Kept both because no transaction ID proves they are the same.`);
      db.prepare('INSERT OR IGNORE INTO donors VALUES(?,?,?,?,?,?)').run(donorId,name,email,phone,address,language);
      db.prepare('INSERT OR IGNORE INTO source_records VALUES(?,?,?,?,?,?,?,?,?,?)').run(recordId,rowSource,sourceFile,name,email,phone,address,zip,language,JSON.stringify(row));
      db.prepare('INSERT OR IGNORE INTO donor_links VALUES(?,?)').run(recordId,donorId);
      const giftId='gift_'+hash(importKey+'|'+index).slice(0,28);
      db.prepare('INSERT INTO gifts VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(giftId,recordId,date,amount,Number(recurring),rowSource,sourceFile,cell(row,map,'program').slice(0,200),kind,transactionKey,JSON.stringify(row));
      result.imported++;if(date>throughDate)throughDate=date;
    }
    // Invalid files remain retryable after correction; a completely valid replay is skipped.
    if(validRows>0)db.prepare('INSERT INTO imports VALUES(?,?,?,?,?)').run(importKey,source,sourceFile,new Date().toISOString(),throughDate);
    bumpVersion();refreshMatches();return result;
  });
}
