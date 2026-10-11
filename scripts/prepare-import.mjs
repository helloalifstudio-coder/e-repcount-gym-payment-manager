#!/usr/bin/env node
// Offline migration tool: turn legacy gym CSV exports into SQL Editor / psql scripts.
// No passwords, API keys, Supabase client, or network access are used here.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import process from 'node:process';

const HELP = 'Usage: npm run import:prepare -- --source ./gym-csv --gym "Gym Name" --admin-email owner@example.com [--out /safe/private/path]';
const fields = {
  plans: ['id','name','duration','price','active','description'],
  members: ['id','name','phone','email','plan_id','joined_on','next_renewal_on','status','notes'],
  dues: ['id','name','member_id','plan_id','due_on','amount','period_start','period_end','notes'],
  payments: ['id','receipt','member_id','due_id','amount','paid_on','method','status','notes'],
  renewals: ['id','member_id','plan_id','payment_id','started_on','next_renewal_on'],
};
const required = {
  plans:['id','name','duration','price'],
  members:['id','name','phone'],
  dues:['id','name','member_id','due_on','amount'],
  payments:['id','receipt','member_id','amount','paid_on','method'],
  renewals:['id','member_id','plan_id','payment_id','started_on','next_renewal_on'],
};
function argumentsMap(argv) {
  const result={};
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--help'||argv[i]==='-h') {result.help=true;continue;}
    if(!['--source','--gym','--admin-email','--out'].includes(argv[i])||!argv[i+1]||argv[i+1].startsWith('--')) {
      throw new Error('Unexpected/missing option. '+HELP);
    }
    result[argv[i].slice(2)]=argv[++i];
  }
  return result;
}
function parseCsv(input) {
  const rows=[];let current=[],cell='',quoted=false;
  const data=input.replace(/^\uFEFF/,'');
  for(let i=0;i<data.length;i++){
    const c=data[i];
    if(quoted) {
      if(c==='"'&&data[i+1]==='"'){cell+='"';i++;}
      else if(c==='"'){quoted=false;}
      else cell+=c;
    } else if(c==='"') {
      if(cell!=='')throw new Error('Malformed CSV: quote inside an unquoted cell.');
      quoted=true;
    } else if(c===',') {current.push(cell);cell='';}
    else if(c==='\n'){current.push(cell.replace(/\r$/,''));rows.push(current);current=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('Malformed CSV: unclosed quoted cell.');
  if(cell!==''||current.length){current.push(cell);rows.push(current);}
  const nonempty=rows.filter(r=>r.some(v=>v.trim()));
  if(!nonempty.length)return [];
  const head=nonempty.shift().map(s=>s.trim());
  if(new Set(head).size!==head.length)throw new Error('Duplicate CSV column header.');
  return nonempty.map((values,index)=>{
    if(values.length!==head.length)throw new Error('CSV line '+(index+2)+' has '+values.length+' cells, expected '+head.length+'.');
    return Object.fromEntries(head.map((k,i)=>[k,values[i].trim()]));
  }).map(r=>({__headers:head,...r}));
}
function date(text, field, optional=false){
  if(!text&&optional)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text||''))throw new Error(field+' must use YYYY-MM-DD.');
  const d=new Date(text+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==text)throw new Error(field+' contains an invalid date.');
  return text;
}
function amount(text,field){
  if(!/^\d+(?:\.\d{1,2})?$/.test(text??''))throw new Error(field+' must be a positive number with up to 2 decimal places.');
  const n=Number(text);
  if(!Number.isFinite(n)||n<=0||n>9999999999.99)throw new Error(field+' is outside supported range.');
  return Math.round(n*100)/100;
}
function label(text,field,max=150){
  if(!text||text.length>max||/[\u0000-\u001F]/.test(text))throw new Error(field+' must be 1-'+max+' printable characters.');
  return text;
}
function uuid(gym,kind,id){
  const hash=createHash('sha256').update('repcount-gym-import-v1|'+gym+'|'+kind+'|'+id).digest('hex').slice(0,32).split('');
  hash[12]='5';hash[16]='8';
  const x=hash.join('');
  return x.slice(0,8)+'-'+x.slice(8,12)+'-'+x.slice(12,16)+'-'+x.slice(16,20)+'-'+x.slice(20);
}
function quote(v) {return v===null||v===undefined?'NULL':"'"+String(v).replaceAll("'","''")+"'";}
function ownerGuard(gym,email) {
  return 'DO $verify_gym$\nBEGIN\n'+
    '  IF (SELECT count(*) FROM public.gyms) <> 1 THEN RAISE EXCEPTION '+quote('Import requires a one-gym project. Stop and check the Supabase project.')+'; END IF;\n'+
    '  IF (SELECT count(*) FROM public.gym_users gu JOIN auth.users u ON u.id=gu.user_id JOIN public.gyms g ON g.id=gu.gym_id'+
    ' WHERE gu.role='+quote('admin')+' AND gu.status='+quote('active')+' AND lower(u.email)='+quote(email)+' AND g.name='+quote(gym)+') <> 1'+
    ' THEN RAISE EXCEPTION '+quote('Wrong project, gym name or active Admin email. Import aborted.')+'; END IF;\nEND\n$verify_gym$;';
}
function sqlBlock(table, specs, records, gym, email) {
  const lines=[];
  const cols=specs.map(([key,col])=>col);
  for(let start=0;start<records.length;start+=250) {
    const batch=records.slice(start,start+250);
    const payload=batch.map(record=>Object.fromEntries(specs.map(([key])=>[key,record[key]??null])));
    const json=quote(JSON.stringify(payload));
    const shape=specs.map(([key,type])=>'"'+key+'" '+type).join(', ');
    // Column types and field names below are hardcoded in this source, never supplied by CSV.
    const columnMap={
      membership_plans:['id','name','duration_c','price_c','active_c','description_c'],
      gym_members:['id','name','phone_c','email_c','plan_c','join_date_c','due_date_c','status_c','notes_c'],
      membership_dues:['id','name','member_c','plan_c','due_date_c','amount_due_c','period_start_c','period_end_c','notes_c'],
      payments:['id','name','member_c','due_c','amount_c','paid_on_c','method_c','status_c','notes_c'],
      membership_renewals:['id','request_id','member_id','plan_id','payment_id','paid_on','started_on','next_renewal_on','amount'],
    };
    const targets=columnMap[table];
    const owner='(SELECT gu.user_id,gu.gym_id FROM public.gym_users gu JOIN auth.users u ON u.id=gu.user_id'+
      ' JOIN public.gyms g ON g.id=gu.gym_id WHERE gu.role='+quote('admin')+
      ' AND gu.status='+quote('active')+' AND lower(u.email)='+quote(email)+' AND g.name='+quote(gym)+')';
    lines.push('INSERT INTO public.'+table+' ('+targets.join(',')+',gym_id,created_by)'+
      '\nSELECT '+targets.map(c=>'src."'+c+'"').join(',')+',o.gym_id,o.user_id'+
      '\nFROM jsonb_to_recordset('+json+'::jsonb) AS src('+shape+')'+
      '\nCROSS JOIN '+owner+' AS o'+
      '\nON CONFLICT (id) DO NOTHING;');
  }
  return lines.join('\n\n');
}
async function main() {
 const args=argumentsMap(process.argv.slice(2));
 if(args.help){console.log(HELP);return;}
 if(!args.source||!args.gym||!args['admin-email'])throw new Error(HELP);
 const gym=label(args.gym.trim(),'Gym name',100);
 const email=args['admin-email'].trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new Error('A valid verified Admin email is required.');
 const source=resolve(args.source);
 const out=resolve(args.out||'.repcount-setup/import');
 const rows={};const ids={};
 for(const [kind,expected] of Object.entries(fields)){
   let raw;
   try{raw=await readFile(join(source,kind+'.csv'),'utf8');}
   catch(e){if(e.code==='ENOENT'&&['dues','payments','renewals'].includes(kind)){rows[kind]=[];ids[kind]=new Set();continue;}throw e;}
   if(raw.length>20000000)throw new Error(kind+'.csv exceeds 20 MB. Split this migration into separate verified batches.');
   const parsed=parseCsv(raw);
   for(const entry of parsed) {
     if(expected.some(k=>!entry.__headers.includes(k)))throw new Error(kind+'.csv is missing required template columns.');
     for(const field of required[kind])if(!entry[field])throw new Error(kind+'.csv has a row missing '+field+'.');
     for(const k of Object.keys(entry))if(k!=='__headers'&&!expected.includes(k))throw new Error('Unexpected '+kind+' column: '+k);
     delete entry.__headers;
   }
   const set=new Set();
   for(const row of parsed) {
     label(row.id,kind+' external ID',100);
     if(set.has(row.id))throw new Error('Duplicate '+kind+' ID '+row.id);
     set.add(row.id);
   }
   rows[kind]=parsed;ids[kind]=set;
 }
 if(rows.members.length===0)throw new Error('members.csv requires at least one member. Nothing was generated.');
 const planNames=new Set(),receiptNames=new Set(),dueNames=new Set();
 const plans=rows.plans.map(p=>{
   label(p.name,'Plan name');if(planNames.has(p.name.toLowerCase()))throw new Error('Duplicate plan name '+p.name);
   planNames.add(p.name.toLowerCase());
   if(!/^([1-9]|[12][0-9]|3[0-6]) months?$/.test(p.duration))throw new Error('Plan duration must be e.g. "1 month" or "3 months".');
   return {id:uuid(gym,'plans',p.id),name:p.name,duration_c:p.duration,price_c:amount(p.price,'Plan price'),
     active_c: p.active===''||p.active==='true'?true:p.active==='false'?false:(()=>{throw new Error('Plan active must be true or false.');})(),
     description_c:p.description||''};
 });
 const members=rows.members.map(m=>{
   label(m.name,'Member name');const digits=m.phone.replace(/\D/g,'');
   if(digits.length<7||digits.length>15)throw new Error('Member '+m.id+' phone number must have 7-15 digits.');
   if(m.plan_id&&!ids.plans.has(m.plan_id))throw new Error('Missing plan '+m.plan_id+' for member '+m.id);
   if(m.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email))throw new Error('Invalid member email.');
   const status=m.status||'Active';
   if(!['Active','Inactive','Due soon','Overdue'].includes(status))throw new Error('Invalid member status '+status);
   const joined=date(m.joined_on,'Member joined_on',true),next=date(m.next_renewal_on,'Member next_renewal_on',true);
   if(joined&&next&&joined>next)throw new Error('Member join date must not exceed next renewal date.');
   return {id:uuid(gym,'members',m.id),name:m.name,phone_c:m.phone,email_c:m.email||null,
     plan_c:m.plan_id?uuid(gym,'plans',m.plan_id):null,join_date_c:joined,due_date_c:next,status_c:status,notes_c:m.notes||''};
 });
 const dueMember=new Map(rows.dues.map(d=>[d.id,d.member_id]));
 const dues=rows.dues.map(d=>{
   label(d.name,'Fee cycle name');if(dueNames.has(d.name.toLowerCase()))throw new Error('Duplicate fee cycle name.');
   dueNames.add(d.name.toLowerCase());
   if(!ids.members.has(d.member_id))throw new Error('Missing member '+d.member_id+' for fee cycle '+d.id);
   if(d.plan_id&&!ids.plans.has(d.plan_id))throw new Error('Missing plan for fee cycle '+d.id);
   const from=date(d.period_start,'Fee cycle period_start',true),to=date(d.period_end,'Fee cycle period_end',true);
   if(from&&to&&from>to)throw new Error('Fee cycle period_start after period_end.');
   return {id:uuid(gym,'dues',d.id),name:d.name,member_c:uuid(gym,'members',d.member_id),
     plan_c:d.plan_id?uuid(gym,'plans',d.plan_id):null,due_date_c:date(d.due_on,'Fee cycle due_on'),
     amount_due_c:amount(d.amount,'Fee cycle amount'),period_start_c:from,period_end_c:to,notes_c:d.notes||''};
 });
 const paymentById=new Map();
 const payments=rows.payments.map(p=>{
   label(p.receipt,'Receipt name');if(receiptNames.has(p.receipt.toLowerCase()))throw new Error('Duplicate receipt '+p.receipt);
   receiptNames.add(p.receipt.toLowerCase());
   if(!ids.members.has(p.member_id))throw new Error('Missing member '+p.member_id+' for receipt '+p.id);
   if(p.due_id&&!ids.dues.has(p.due_id))throw new Error('Missing fee cycle for receipt '+p.id);
   if(p.due_id&&dueMember.get(p.due_id)!==p.member_id)throw new Error('Receipt '+p.id+' references a fee cycle for a different member.');
   if(!['Cash','UPI','Card','Bank transfer'].includes(p.method))throw new Error('Invalid payment method '+p.method);
   const status=p.status||'Paid';
   if(!['Paid','Pending','Refunded'].includes(status))throw new Error('Invalid receipt status '+status);
   const result={id:uuid(gym,'payments',p.id),name:p.receipt,member_c:uuid(gym,'members',p.member_id),
     due_c:p.due_id?uuid(gym,'dues',p.due_id):null,amount_c:amount(p.amount,'Receipt amount'),
     paid_on_c:date(p.paid_on,'Receipt paid_on'),method_c:p.method,status_c:status,notes_c:p.notes||''};
   paymentById.set(p.id,{...result,externalMember:p.member_id});
   return result;
 });
 const memberById=new Map(rows.members.map(m=>[m.id,m]));
 const renewals=rows.renewals.map(r=>{
   if(!ids.members.has(r.member_id)||!ids.plans.has(r.plan_id)||!ids.payments.has(r.payment_id))
     throw new Error('Renewal '+r.id+' references missing member, plan or payment.');
   const payment=paymentById.get(r.payment_id);
   if(payment.externalMember!==r.member_id||payment.status_c!=='Paid'||payment.due_c)
     throw new Error('Renewal '+r.id+' must reference a Paid standalone receipt for the SAME member.');
   const started=date(r.started_on,'Renewal started_on'),next=date(r.next_renewal_on,'Renewal next_renewal_on');
   if(next<=started||started<payment.paid_on_c)throw new Error('Renewal '+r.id+' has inconsistent start/payment/expiry dates.');
   if(memberById.get(r.member_id).next_renewal_on && next>memberById.get(r.member_id).next_renewal_on)
     throw new Error('Renewal '+r.id+' ends AFTER member '+r.member_id+' next_renewal_on. Fix the exported current expiry.');
   return {id:uuid(gym,'renewals',r.id),request_id:uuid(gym,'renewals-request',r.id),
     member_id:uuid(gym,'members',r.member_id),plan_id:uuid(gym,'plans',r.plan_id),
     payment_id:payment.id,paid_on:payment.paid_on_c,started_on:started,next_renewal_on:next,amount:payment.amount_c};
 });
 const uniquePayments=new Set(renewals.map(r=>r.payment_id));
 if(uniquePayments.size!==renewals.length)throw new Error('Each historical payment can back only one renewal.');
 const targets=[
   ['01_plans.sql','membership_plans',plans,
      [['id','uuid'],['name','text'],['duration_c','text'],['price_c','numeric'],['active_c','boolean'],['description_c','text']]],
   ['02_members.sql','gym_members',members,
      [['id','uuid'],['name','text'],['phone_c','text'],['email_c','text'],['plan_c','uuid'],['join_date_c','date'],['due_date_c','date'],['status_c','text'],['notes_c','text']]],
   ['03_dues.sql','membership_dues',dues,
      [['id','uuid'],['name','text'],['member_c','uuid'],['plan_c','uuid'],['due_date_c','date'],['amount_due_c','numeric'],['period_start_c','date'],['period_end_c','date'],['notes_c','text']]],
   ['04_payments.sql','payments',payments,
      [['id','uuid'],['name','text'],['member_c','uuid'],['due_c','uuid'],['amount_c','numeric'],['paid_on_c','date'],['method_c','text'],['status_c','text'],['notes_c','text']]],
   ['05_renewals.sql','membership_renewals',renewals,
      [['id','uuid'],['request_id','uuid'],['member_id','uuid'],['plan_id','uuid'],['payment_id','uuid'],['paid_on','date'],['started_on','date'],['next_renewal_on','date'],['amount','numeric']]],
 ];
 await mkdir(out,{recursive:true});
 const intro=['# Validated gym import','Gym: '+gym,'Admin: '+email,
   'Plans: '+plans.length,'Members: '+members.length,'Fee cycles: '+dues.length,
   'Payment receipts: '+payments.length,'Historical renewal periods: '+renewals.length,
   'No database connection was made; nothing was imported.',
   'Run SQL only on the correctly configured gym AFTER creating its Admin account and schema.',
   'All member and payment data is private. Never commit this folder to GitHub.',
   'For thousands of rows prefer a reviewed psql session rather than pasting a large SQL file into a browser.',
   'Run the numbered files in order. Each file is transactional; reruns skip existing deterministic IDs.',
   'Historical renewal rows must be supported by genuine past receipts/period dates; omitted rows are not invented.',
   'This tool imports records AS PROVIDED and does NOT recalculate expiry or send reminders.',
 ].join('\n')+'\n';
 await writeFile(join(out,'00_READ_ME_FIRST.txt'),intro,{mode:0o600});
 for(const [filename,table,records,specs] of targets)if(records.length){
   const content='-- Validated offline RepCount historical import: '+table+'\n'+
     '-- TARGET GYM: '+gym.replaceAll('\n',' ')+' | OWNER: '+email+'\n'+
     '-- SQL Editor with database-owner privileges ONLY; this file contains private member data.\n'+
     'BEGIN;\n'+ownerGuard(gym,email)+'\n\n'+sqlBlock(table,specs,records,gym,email)+'\nCOMMIT;\n';
   await writeFile(join(out,filename),content,{mode:0o600});
 }
 console.log('PASS: validated private import package at '+out);
 console.log('Records: '+JSON.stringify({plans:plans.length,members:members.length,dues:dues.length,
   payments:payments.length,renewals:renewals.length}));
 console.log('No connection, key, or database mutation occurred. Review files before applying them.');
}
main().catch(e=>{console.error('IMPORT BLOCKED: '+e.message);process.exitCode=1;});
