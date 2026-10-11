import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSdk, DEMO_LOGIN } from '../src/services/demoSdk.js';
import { todayKey, addCalendarMonths, planMonths, nextRenewalDate, renewalStatus, renewalStats, reminderUrl } from '../src/services/renewalLogic.js';

const storage=()=>{
  const values=new Map();
  return {
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key),
  };
};
globalThis.localStorage=storage();
globalThis.sessionStorage=storage();
const sdk=createDemoSdk();
let id=0;
async function makePlan(duration='1 month',price=1200) {
  const created=await sdk.table('plans_c').create({
    Name:'Gym Plan '+(++id),price_c:price,active_c:true,duration_c:duration,
  });
  assert.equal(created.success,true,created.message);
  return created.data[0];
}
async function makeMember(plan,renewOn=todayKey()) {
  const created=await sdk.table('gym_members_c').create({
    Name:'Gym Member '+(++id),phone_c:'9876543210',plan_c:plan?.Id??null,
    due_date_c:renewOn,status_c:'Active',
  });
  assert.equal(created.success,true,created.message);
  return created.data[0];
}

test('calendar renewal rules preserve early payment days and month-end dates',()=>{
  assert.equal(addCalendarMonths('2024-01-31',1),'2024-02-29');
  assert.equal(addCalendarMonths('2025-01-31',1),'2025-02-28');
  assert.equal(addCalendarMonths('2026-08-31',1),'2026-09-30');
  assert.equal(planMonths('3 months'),3);
  assert.equal(nextRenewalDate({currentRenewalDate:'2026-11-01',paidOn:'2026-10-11',duration:'1 month'}).next,'2026-12-01');
  assert.equal(nextRenewalDate({currentRenewalDate:'2026-09-01',paidOn:'2026-10-11',duration:'3 months'}).next,'2027-01-11');
  assert.throws(()=>addCalendarMonths('2026-02-30',1));
});

test('renewal badges and manual WhatsApp reminders remain accurate',()=>{
  const now='2026-10-11';
  assert.equal(renewalStatus({due_date_c:'2026-10-10'},now),'expired');
  assert.equal(renewalStatus({due_date_c:'2026-10-11'},now),'today');
  assert.equal(renewalStatus({due_date_c:'2026-10-18'},now),'soon');
  assert.equal(renewalStatus({due_date_c:'2026-10-19'},now),'active');
  assert.equal(renewalStatus({status_c:'Inactive',due_date_c:'2026-10-11'},now),'inactive');
  assert.equal(renewalStats([{due_date_c:now},{due_date_c:'2026-10-14'}],now).soon,2);
  const url=reminderUrl({Name:'Rahul',phone_c:'9876500011',due_date_c:'2026-11-01'},{price_c:1200},now);
  assert.ok(url.startsWith('https://wa.me/919876500011?text='));
  assert.match(decodeURIComponent(url),/renewal fee is ₹1,200/);
  assert.equal(reminderUrl({Name:'No Phone',phone_c:'',due_date_c:now},null,now),null);
});

test('demo login remains isolated and previously seeded local data is discarded',async()=>{
  localStorage.setItem('repcount.demo.data.v2',JSON.stringify({plans_c:[{Name:'Old seeded plan'}]}));
  assert.equal((await sdk.session.login({email:DEMO_LOGIN.email,password:'wrong'})).ok,false);
  assert.equal((await sdk.session.login({email:'other@example.com',password:DEMO_LOGIN.password})).ok,false);
  assert.equal((await sdk.session.login({...DEMO_LOGIN})).ok,true);
  assert.equal((await sdk.session.getUser()).profile,'Admin_c');
  assert.equal(localStorage.getItem('repcount.demo.data.v2'),null);
});

test('fresh showcase has zero plans, members, fees, receipts and renewals',async()=>{
  for(const table of ['plans_c','gym_members_c','membership_dues_c','payments_c']) {
    const result=await sdk.table(table).fetch();
    assert.equal(result.success,true);
    assert.equal(result.total,0,table);
  }
  assert.equal((await sdk.renewals.list()).length,0);
  assert.deepEqual((await sdk.teams.getMembers(0,25)).data.map(u=>u.email),[DEMO_LOGIN.email]);
  assert.deepEqual(await sdk.dashboardSummary(todayKey()),{outstanding:0,dueTodayBalance:0,collectedToday:0});
  const directory=await sdk.directory.list({page:1,pageSize:25});
  assert.equal(directory.total,0);
  assert.equal(directory.stats.active,0);
});

test('owner can create a plan, enroll first member, collect full upfront payment and see renewal',async()=>{
  const plan=await makePlan();
  const member=await makeMember(plan);
  const result=await sdk.renewals.record({
    memberId:member.Id,planId:plan.Id,paidOn:todayKey(),method:'Cash',requestId:'first-activation',
  });
  assert.equal(result.alreadyRecorded,false);
  assert.equal(result.nextRenewalDate,addCalendarMonths(todayKey(),1));
  assert.equal((await sdk.table('gym_members_c').get(member.Id)).data.due_date_c,result.nextRenewalDate);
  assert.equal((await sdk.table('payments_c').fetch()).total,1);
  assert.equal((await sdk.renewals.list()).length,1);
  assert.equal((await sdk.directory.search('Gym Member')).total,1);
});

test('paying before expiry extends the current expiry and repeated requests do not duplicate a receipt',async()=>{
  const member=(await sdk.table('gym_members_c').fetch()).data[0];
  const plan=(await sdk.table('plans_c').fetch()).data[0];
  const expected=addCalendarMonths(member.due_date_c,1);
  const before=(await sdk.table('payments_c').fetch()).total;
  const args={memberId:member.Id,planId:plan.Id,paidOn:todayKey(),method:'UPI',requestId:'second-early-renewal'};
  const first=await sdk.renewals.record(args);
  const second=await sdk.renewals.record(args);
  assert.equal(first.nextRenewalDate,expected);
  assert.equal(second.alreadyRecorded,true);
  assert.equal((await sdk.table('payments_c').fetch()).total,before+1);
  assert.equal((await sdk.table('gym_members_c').get(member.Id)).data.due_date_c,expected);
});

test('exceptional deferred fees still reconcile and prevent overpayment',async()=>{
  const member=(await sdk.table('gym_members_c').fetch()).data[0];
  const due=await sdk.table('membership_dues_c').create({
    Name:'Deferred gym fee',member_c:member.Id,amount_due_c:500,due_date_c:todayKey(),
  });
  assert.equal(due.success,true,due.message);
  const payment=await sdk.table('payments_c').create({
    Name:'Partial exception',member_c:member.Id,due_c:due.data[0].Id,amount_c:200,status_c:'Paid',
  });
  assert.equal(payment.success,true,payment.message);
  assert.equal((await sdk.table('membership_dues_c').get(due.data[0].Id)).data.balance_c,300);
  assert.equal((await sdk.table('payments_c').create({
    Name:'Overpay',member_c:member.Id,due_c:due.data[0].Id,amount_c:400,status_c:'Paid',
  })).success,false);
  assert.equal((await sdk.table('payments_c').remove(payment.data[0].Id)).success,true);
  assert.equal((await sdk.table('membership_dues_c').remove(due.data[0].Id)).success,true);
});

test('team records added during a walkthrough cannot sign in',async()=>{
  const staff=await sdk.teams.createMember({email:'fake@example.com',profileName:'Staff_c'});
  assert.equal((await sdk.session.login({email:'fake@example.com',password:'fake'})).ok,false);
  await sdk.teams.deleteMember(staff.id);
});

test('clear demo workspace removes walkthrough records, retaining only the Admin account',async()=>{
  sdk.demo.reset();
  for(const table of ['plans_c','gym_members_c','membership_dues_c','payments_c']){
    assert.equal((await sdk.table(table).fetch()).total,0,table);
  }
  assert.equal((await sdk.renewals.list()).length,0);
  assert.equal((await sdk.teams.getMembers(0,100)).total,1);
  await sdk.session.logout();
  assert.equal(await sdk.session.getUser(),null);
  assert.equal((await sdk.table('plans_c').fetch()).success,false);
});
