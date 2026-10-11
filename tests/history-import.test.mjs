import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const script=join(root,'scripts/prepare-import.mjs');
const columns={
 plans:'id,name,duration,price,active,description',
 members:'id,name,phone,email,plan_id,joined_on,next_renewal_on,status,notes',
 dues:'id,name,member_id,plan_id,due_on,amount,period_start,period_end,notes',
 payments:'id,receipt,member_id,due_id,amount,paid_on,method,status,notes',
 renewals:'id,member_id,plan_id,payment_id,started_on,next_renewal_on'
};
function fixture(){
 const folder=mkdtempSync(join(tmpdir(),'repcount-history-test-'));
 const input=join(folder,'csv'),out=join(folder,'sql');
 mkdirSync(input,{recursive:true});
 const lines={
  plans:'p1,"O\'Brien Monthly",1 month,1200,true,Monthly prepaid plan',
  members:'m1,"Rahul, Sharma",9876543210,rahul@example.com,p1,2026-01-01,2026-12-01,Active,Legacy transfer',
  dues:'d1,OLD-001,m1,p1,2026-01-31,600,2026-01-01,2026-01-31,Pay later exception',
  payments:'pay1,RCPT-001,m1,,1200,2026-11-01,UPI,Paid,Renewal payment',
  renewals:'r1,m1,p1,pay1,2026-11-01,2026-12-01',
 };
 for(const [table,head] of Object.entries(columns))writeFileSync(join(input,table+'.csv'),head+'\n'+lines[table]+'\n');
 return {folder,input,out};
}
function run(input,out){
 return spawnSync(process.execPath,[script,'--source',input,'--gym',"O'Brien Fitness",
  '--admin-email','Owner@Example.com','--out',out],{encoding:'utf8',cwd:root,timeout:20000});
}

test('validate and prepare ordered transactional SQL with linked historical data',()=>{
 const f=fixture();
 try {
  const r=run(f.input,f.out);
  assert.equal(r.status,0,r.stderr);
  const guide=readFileSync(join(f.out,'00_READ_ME_FIRST.txt'),'utf8');
  assert.match(guide,/Members: 1/);
  for(const name of ['01_plans.sql','02_members.sql','03_dues.sql','04_payments.sql','05_renewals.sql']){
    const sql=readFileSync(join(f.out,name),'utf8');
    assert.match(sql,/BEGIN;/);
    assert.match(sql,/COMMIT;/);
    assert.match(sql,/ON CONFLICT \(id\) DO NOTHING/);
    assert.match(sql,/Wrong project, gym name or active Admin email/);
    assert.ok(sql.includes("O''Brien Fitness"),'SQL gym name must be escaped');
    assert.ok(sql.includes('jsonb_to_recordset'));
    assert.ok(!sql.includes('sb_secret_'));
  }
  assert.match(readFileSync(join(f.out,'02_members.sql'),'utf8'),/Rahul, Sharma/);
  assert.match(readFileSync(join(f.out,'05_renewals.sql'),'utf8'),/membership_renewals/);
 } finally {rmSync(f.folder,{recursive:true,force:true});}
});

test('reject orphaned payment and never write SQL output',()=>{
 const f=fixture();
 try {
  writeFileSync(join(f.input,'payments.csv'),columns.payments+'\npay1,RCPT-001,missing,,1200,2026-11-01,UPI,Paid,x\n');
  const r=run(f.input,f.out);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Missing member/);
  assert.equal(existsSync(join(f.out,'04_payments.sql')),false);
 } finally {rmSync(f.folder,{recursive:true,force:true});}
});

test('reject duplicate IDs, malformed CSV, impossible dates and unsafe payment status',()=>{
 const f=fixture();
 try {
  writeFileSync(join(f.input,'members.csv'),columns.members+'\nm1,Rahul,9876543210,,p1,2026-01-01,2026-12-01,Active,x\nm1,Rahul,9876543210,,p1,2026-01-01,2026-12-01,Active,x\n');
  assert.match(run(f.input,f.out).stderr,/Duplicate members ID/);
  writeFileSync(join(f.input,'members.csv'),columns.members+'\nm1,Rahul,9876543210,,p1,2026-01-01,2026-02-31,Active,x\n');
  assert.match(run(f.input,f.out).stderr,/invalid date/);
  writeFileSync(join(f.input,'members.csv'),columns.members+'\nm1,Rahul,9876543210,,p1,2026-01-01,2026-12-01,Active,x\n');
  writeFileSync(join(f.input,'payments.csv'),columns.payments+'\npay1,RCPT-001,m1,,1200,2026-11-01,UPI,Forged,x\n');
  assert.match(run(f.input,f.out).stderr,/Invalid receipt status/);
 } finally {rmSync(f.folder,{recursive:true,force:true});}
});

test('10,000 member CSV entries produce a bounded SQL preparation package offline',()=>{
 const f=fixture();
 try{
  const rows=[columns.members];
  for(let i=1;i<=10000;i++){
    rows.push('m'+i+',Member '+i+',98'+String(i).padStart(8,'0')+
      ',,p1,2026-01-01,2027-01-01,Active,');
  }
  writeFileSync(join(f.input,'members.csv'),rows.join('\n')+'\n');
  // No linked payment, fee or renewal CSV in this larger benchmark.
  for(const [kind,header] of Object.entries(columns))if(!['plans','members'].includes(kind))
    writeFileSync(join(f.input,kind+'.csv'),header+'\n');
  const r=run(f.input,f.out);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/"members":10000/);
  const sql=readFileSync(join(f.out,'02_members.sql'),'utf8');
  assert.equal((sql.match(/INSERT INTO public\.gym_members/g)||[]).length,40);
  assert.match(sql,/Member 10000/);
 }finally{rmSync(f.folder,{recursive:true,force:true});}
});

test('rerun cannot silently leave or reuse SQL from an older gym import',()=>{
 const f=fixture();
 try{
  assert.equal(run(f.input,f.out).status,0);
  const second=run(f.input,f.out);
  assert.notEqual(second.status,0);
  assert.match(second.stderr,/already contains files/);
 }finally{rmSync(f.folder,{recursive:true,force:true});}
});
