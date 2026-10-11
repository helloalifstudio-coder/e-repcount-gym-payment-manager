import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSdk, DEMO_LOGIN } from '../src/services/demoSdk.js';
import { todayKey } from '../src/services/renewalLogic.js';

function makeStorage(){
 const map=new Map();
 return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};
}
globalThis.localStorage=makeStorage();
globalThis.sessionStorage=makeStorage();
const sdk=createDemoSdk();

test('10,000 sample members remain queryable at first, last and filtered pages without full render',async()=>{
  assert.equal((await sdk.session.login(DEMO_LOGIN)).ok,true);
  const db=sdk.demo.reset();
  const future=todayKey(new Date(Date.now()+40*86400_000));
  for(let i=1;i<=10000;i++){
    const id='perf-'+String(i).padStart(5,'0');
    db.gym_members_c.push({Id:id,Name:'Member '+String(i).padStart(5,'0'),
      phone_c:'987'+String(i).padStart(7,'0'),
      email_c:'',due_date_c:future,status_c:'Active',plan_c:null});
  }
  const first=await sdk.directory.list({page:1,pageSize:25});
  const last=await sdk.directory.list({page:400,pageSize:25});
  const beyondLast=await sdk.directory.list({page:401,pageSize:25});
  assert.equal(first.total,10000);
  assert.equal(first.rows.length,25);
  assert.equal(last.rows.length,25);
  assert.equal(last.hasMore,false);
  assert.equal(beyondLast.rows.length,0);
  const searched=await sdk.directory.search('Member 09999');
  assert.equal(searched.total,1);
  assert.equal(searched.rows[0].Name,'Member 09999');
  const expired=await sdk.directory.list({state:'expired',page:1,pageSize:25});
  assert.equal(expired.rows.every(r=>r.renewalState==='expired'),true);
  assert.equal(first.stats.active>=10000,true);
  const paidDate=todayKey();
  for(let i=1;i<=10000;i++){
    db.payments_c.push({
      Id:'perf-payment-'+i,Name:'PERF-'+i,member_c:'perf-'+String(i).padStart(5,'0'),
      due_c:null,amount_c:1200,paid_on_c:paidDate,method_c:'UPI',status_c:'Paid',
    });
  }
  const payments=await sdk.ledger.list({kind:'payments',page:1,pageSize:25,period:'today'});
  assert.equal(payments.total>=10000,true);
  assert.equal(payments.rows.length,25);
  assert.equal(payments.rows.some(row=>row.member_c?.Name?.startsWith('Member')),true);
  await sdk.session.logout();
});
