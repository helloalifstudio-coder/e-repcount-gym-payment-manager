import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSdk, DEMO_LOGIN } from '../src/services/demoSdk.js';
import { todayKey, addCalendarMonths, planMonths, nextRenewalDate, renewalStatus, renewalStats, reminderUrl } from '../src/services/renewalLogic.js';

const storage = () => {
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
};
globalThis.localStorage=storage();
globalThis.sessionStorage=storage();
const sdk=createDemoSdk();

test('calendar-month renewals handle month ends and leap years',()=>{
  assert.equal(addCalendarMonths('2024-01-31',1),'2024-02-29');
  assert.equal(addCalendarMonths('2025-01-31',1),'2025-02-28');
  assert.equal(addCalendarMonths('2026-08-31',1),'2026-09-30');
  assert.equal(planMonths('3 months'),3);
  assert.equal(nextRenewalDate({currentRenewalDate:'2026-11-01',paidOn:'2026-10-11',duration:'1 month'}).next,'2026-12-01');
  assert.equal(nextRenewalDate({currentRenewalDate:'2026-09-01',paidOn:'2026-10-11',duration:'3 months'}).next,'2027-01-11');
  assert.throws(()=>addCalendarMonths('2026-02-30',1));
});
test('renewal status is based on actual calendar dates, never outstanding fees',()=>{
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

test('demo sign-in is isolated from Supabase and only accepts public sample credentials',async()=>{
  assert.equal((await sdk.session.login({email:DEMO_LOGIN.email,password:'wrong'})).ok,false);
  assert.equal((await sdk.session.login({email:'other@example.com',password:DEMO_LOGIN.password})).ok,false);
  assert.equal((await sdk.session.login({...DEMO_LOGIN})).ok,true);
  assert.equal((await sdk.session.getUser()).profile,'Admin_c');
});

test('demo starts with upfront payments and no artificial debts',async()=>{
  const plans=await sdk.table('plans_c').fetch();
  const dues=await sdk.table('membership_dues_c').fetch();
  const payments=await sdk.table('payments_c').fetch();
  const members=await sdk.table('gym_members_c').fetch();
  assert.equal(plans.total,3);
  assert.equal(dues.total,0);
  assert.equal(payments.total,4);
  assert.equal(members.total,5);
  assert.equal((await sdk.dashboardSummary(todayKey())).outstanding,0);
  assert.equal((await sdk.renewals.list()).length,4);
  assert.equal(renewalStats(members.data).expired,1);
});

test('early renewal records full payment, advances expiry, and deduplicates retries',async()=>{
  const before=(await sdk.table('payments_c').fetch()).total;
  const member=(await sdk.table('gym_members_c').get('member-2')).data;
  const expected=nextRenewalDate({currentRenewalDate:member.due_date_c,paidOn:todayKey(),duration:'1 month'}).next;
  const args={memberId:'member-2',planId:'plan-basic',paidOn:todayKey(),method:'UPI',requestId:'test-renewal-early'};
  const first=await sdk.renewals.record(args);
  const second=await sdk.renewals.record(args);
  assert.equal(first.nextRenewalDate,expected);
  assert.equal(second.alreadyRecorded,true);
  assert.equal((await sdk.table('payments_c').fetch()).total,before+1);
  assert.equal((await sdk.table('gym_members_c').get('member-2')).data.due_date_c,expected);
});

test('creating a new member and recording upfront renewal activates membership',async()=>{
  const plan=await sdk.table('plans_c').create({Name:'Test plan',price_c:500,active_c:true,duration_c:'1 month'});
  assert.equal(plan.success,true);
  const member=await sdk.table('gym_members_c').create({Name:'Trial',phone_c:'9999999999',plan_c:plan.data[0].Id,due_date_c:todayKey(),status_c:'Active'});
  assert.equal(member.success,true);
  const paid=await sdk.renewals.record({memberId:member.data[0].Id,planId:plan.data[0].Id,paidOn:todayKey(),method:'Cash',requestId:'test-new-member'});
  assert.equal(paid.nextRenewalDate,addCalendarMonths(todayKey(),1));
  assert.equal((await sdk.table('gym_members_c').get(member.data[0].Id)).data.due_date_c,paid.nextRenewalDate);
  assert.equal((await sdk.renewals.list()).some(r=>r.member_id===member.data[0].Id),true);
});
test('legacy exceptional unpaid fee-cycle accounting still works',async()=>{
  const member=await sdk.table('gym_members_c').get('member-1');
  const due=await sdk.table('membership_dues_c').create({Name:'Exceptional deferred fee',member_c:member.data.Id,amount_due_c:500,due_date_c:todayKey()});
  assert.equal(due.success,true);
  const payment=await sdk.table('payments_c').create({Name:'Partial late payment',member_c:member.data.Id,due_c:due.data[0].Id,amount_c:200,status_c:'Paid'});
  assert.equal(payment.success,true);
  const updated=await sdk.table('membership_dues_c').get(due.data[0].Id);
  assert.equal(updated.data.balance_c,300);
  assert.equal((await sdk.table('payments_c').create({Name:'Overpay',member_c:member.data.Id,due_c:due.data[0].Id,amount_c:400,status_c:'Paid'})).success,false);
  assert.equal((await sdk.table('payments_c').remove(payment.data[0].Id)).success,true);
  assert.equal((await sdk.table('membership_dues_c').remove(due.data[0].Id)).success,true);
});
test('fictional demo team entries cannot sign in',async()=>{
  const staff=await sdk.teams.createMember({email:'fake@example.com',profileName:'Staff_c'});
  assert.equal((await sdk.session.login({email:'fake@example.com',password:'fake'})).ok,false);
  await sdk.teams.deleteMember(staff.id);
});
test('reset restores clean showcase and logout removes demo access',async()=>{
  sdk.demo.reset();
  assert.equal((await sdk.table('membership_dues_c').fetch()).total,0);
  assert.equal((await sdk.table('payments_c').fetch()).total,4);
  await sdk.session.logout();
  assert.equal(await sdk.session.getUser(),null);
  assert.equal((await sdk.table('plans_c').fetch()).success,false);
});
