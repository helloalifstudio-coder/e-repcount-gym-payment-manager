import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSdk, DEMO_LOGIN } from '../src/services/demoSdk.js';

function store() {
  const data = new Map();
  return { getItem:k=>data.has(k)?data.get(k):null, setItem:(k,v)=>data.set(k,String(v)), removeItem:k=>data.delete(k), clear:()=>data.clear() };
}
globalThis.localStorage = store();
globalThis.sessionStorage = store();
const sdk = createDemoSdk();

test('demo credentials cannot authenticate a different email or password', async()=>{
  assert.equal((await sdk.session.login({email:'other@example.com',password:DEMO_LOGIN.password})).ok,false);
  assert.equal((await sdk.session.login({email:DEMO_LOGIN.email,password:'wrong'})).ok,false);
  assert.equal(await sdk.session.getUser(),null);
  assert.equal((await sdk.session.login({...DEMO_LOGIN})).ok,true);
  assert.equal((await sdk.session.getUser()).profile,'Admin_c');
});

test('sample plans, members, linked dues and dashboard summary load without Supabase',async()=>{
  const plans=await sdk.table('plans_c').page(1,10).fetch();
  assert.equal(plans.success,true);
  assert.equal(plans.total,3);
  const dues=await sdk.table('membership_dues_c').fetch();
  assert.equal(dues.total,4);
  assert.equal(dues.data[0].member_c.Name,'Arjun Sharma');
  assert.equal(dues.data[0].plan_c.Name,'Quarterly Strength');
  const now = new Date();
  const today = [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  const summary=await sdk.dashboardSummary(today);
  assert.equal(summary.outstanding,6797);
  assert.equal(summary.collectedToday,1799);
});

test('all demo CRUD operations and payment reconciliation remain browser-local',async()=>{
  const plan=await sdk.table('plans_c').create({Name:'Test plan',price_c:500,duration_c:'1 month'});
  assert.equal(plan.success,true);
  const member=await sdk.table('gym_members_c').create({Name:'Test Member',phone_c:'9999999999',status_c:'Active',plan_c:plan.data[0].Id});
  assert.equal(member.success,true);
  const due=await sdk.table('membership_dues_c').create({Name:'TEST-FEE',member_c:member.data[0].Id,plan_c:plan.data[0].Id,due_date_c:'2026-10-12',amount_due_c:500});
  assert.equal(due.success,true);
  const pay=await sdk.table('payments_c').create({Name:'TEST-PAY',member_c:member.data[0].Id,due_c:due.data[0].Id,amount_c:200,status_c:'Paid',method_c:'UPI'});
  assert.equal(pay.success,true);
  let updated=await sdk.table('membership_dues_c').get(due.data[0].Id);
  assert.equal(updated.data.amount_paid_c,200);
  assert.equal(updated.data.balance_c,300);
  assert.equal(updated.data.status_c,'Partially paid');
  assert.equal((await sdk.table('payments_c').create({Name:'OVERPAY',member_c:member.data[0].Id,due_c:due.data[0].Id,amount_c:1000,status_c:'Paid'})).success,false);
  assert.equal((await sdk.table('payments_c').remove(pay.data[0].Id)).success,true);
  updated=await sdk.table('membership_dues_c').get(due.data[0].Id);
  assert.equal(updated.data.balance_c,500);
  assert.equal(updated.data.status_c,'Unpaid');
  assert.equal((await sdk.table('membership_dues_c').remove(due.data[0].Id)).success,true);
  assert.equal((await sdk.table('gym_members_c').remove(member.data[0].Id)).success,true);
  assert.equal((await sdk.table('plans_c').remove(plan.data[0].Id)).success,true);
});

test('demo team entries do not become authentication credentials',async()=>{
  const staff=await sdk.teams.createMember({email:'mock.staff@example.com',firstName:'Mock',lastName:'Staff',profileName:'Staff_c',password:'not-saved'});
  assert.equal(staff.profile.name,'Staff_c');
  const all=await sdk.teams.getMembers(0,100);
  assert.ok(all.data.some(u=>u.email==='mock.staff@example.com'));
  assert.equal((await sdk.session.login({email:'mock.staff@example.com',password:'not-saved'})).ok,false);
  await sdk.teams.deleteMember(staff.id);
});

test('logout and demo reset do not access real auth or data',async()=>{
  await sdk.session.logout();
  assert.equal(await sdk.session.getUser(),null);
  assert.equal((await sdk.table('plans_c').fetch()).success,false);
  await sdk.session.login({...DEMO_LOGIN});
  sdk.demo.reset();
  const plans=await sdk.table('plans_c').fetch();
  assert.equal(plans.total,3);
});
