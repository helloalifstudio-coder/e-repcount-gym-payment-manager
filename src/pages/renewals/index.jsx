import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { renewalStatus, reminderUrl, todayKey } from '@/services/renewalLogic';
import { getTableAccess } from '@/services/userPermissions';
import { useProfile } from '@/hooks/useProfile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';

export const route = { path:'/renewals', layout:'owner',
  access:"profile === 'Admin_c' || profile === 'Manager_c' || profile === 'Staff_c'" };
export const nav = { label:'Renewals', icon:'CalendarClock', order:2, profiles:['Admin_c','Manager_c','Staff_c'] };
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n||0));
const today = todayKey();

const tabLabels = {
  all:'All members',soon:'Next 7 days',today:'Today',expired:'Expired','not-set':'Date missing'
};
const style = {
  active:'bg-success/10 text-success',soon:'bg-warning/10 text-warning',
  today:'bg-warning/10 text-warning',expired:'bg-destructive/10 text-destructive',
  inactive:'bg-muted text-muted-foreground','not-set':'bg-muted text-muted-foreground'
};

export default function Renewals() {
  const {profile}=useProfile();
  const {canUpdate}=getTableAccess(profile,'gym_members_c');
  const [params,setParams]=useSearchParams();
  const filter=tabLabels[params.get('view')]?params.get('view'):'all';
  const [search,setSearch]=useState('');
  const [debouncedSearch,setDebouncedSearch]=useState('');
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState(null);
  const [planId,setPlanId]=useState('');
  const [method,setMethod]=useState('UPI');
  const [paidOn,setPaidOn]=useState(todayKey());
  const [saving,setSaving]=useState(false);
  const requestId=useRef(null);
  useEffect(()=>{
    const timer=setTimeout(()=>setDebouncedSearch(search.trim()),250);
    return ()=>clearTimeout(timer);
  },[search]);
  const {data,loading,error,run}=useFetch(()=>
    sdk.directory.list({search:debouncedSearch,state:filter,page,pageSize:25}),
    [debouncedSearch,filter,page]);
  const {data:plansResult,loading:plansLoading}=useFetch(async()=>{
    const r=await sdk.table('plans_c').select(['Id','Name','price_c','duration_c','active_c']).page(1,100).fetch();
    if(!r.success)throw new Error(r.message||'Could not load plans');
    return r.data;
  },[]);
  const plans=plansResult??[];
  const stats={active:0,soon:0,today:0,expired:0,...data?.stats};
  const rows=data?.rows??[];
  const total=Number(data?.total??0);
  const pages=Math.max(1,Math.ceil(total/25));
  const chosenPlan=plans.find(p=>String(p.Id)===String(planId));
  function begin(member){
    requestId.current=crypto.randomUUID();
    setSelected(member);
    setPlanId(member.plan_c?.Id || '');
    setPaidOn(todayKey());
    setMethod('UPI');
  }
  async function record(event){
    event.preventDefault();
    if(saving||!selected||!chosenPlan)return;
    setSaving(true);
    if(!requestId.current)requestId.current=crypto.randomUUID();
    try{
      const result=await sdk.renewals.record({
        memberId:selected.Id,planId:chosenPlan.Id,paidOn,method,requestId:requestId.current,
      });
      toast.success('Membership renewed', {description:'Next renewal: '+result.nextRenewalDate});
      setSelected(null);requestId.current=null;
      await run();
    }catch(e){toast.error(e.message||'Could not record renewal. Try again.');}
    finally{setSaving(false);}
  }
  return <div className="space-y-6 pb-8">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Retention and memberships</p>
        <h1 className="mt-2 font-heading text-3xl font-bold">Membership renewals</h1>
        <p className="mt-2 text-sm text-muted-foreground">Track the next billing date, send manual WhatsApp reminders and record advance payments.</p>
      </div>
      <Button asChild variant="outline"><Link to="/members/new"><ApperIcon name="UserPlus" size={16} className="mr-2"/>Add member</Link></Button>
    </header>
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Renewal summary">
      {[
        ['Active members',stats.active,'Users'],
        ['Next 7 days',stats.soon,'CalendarClock'],
        ['Renewing today',stats.today,'Bell'],
        ['Expired',stats.expired,'AlertTriangle'],
      ].map(([label,value,icon])=><div key={label} className="rounded-lg border border-border bg-card p-4">
        <ApperIcon name={icon} size={20} className="text-primary"/>
        <p className="mt-3 font-heading text-3xl font-bold tabular-nums">{loading?'—':value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>)}
    </section>
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex flex-wrap gap-2">
          {Object.entries(tabLabels).map(([key,label])=><Button key={key} size="sm" variant={filter===key?'default':'outline'}
            onClick={()=>{setPage(1);setParams(key==='all'?{}:{view:key});}}>{label}</Button>)}
        </div>
        <Input className="max-w-lg" aria-label="Search renewals" placeholder="Search by member name or phone" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
      </div>
      {loading?<p className="p-6 text-sm text-muted-foreground">Loading membership renewal dates…</p>
      :error?<div className="p-6" role="alert">Unable to load renewals: {error.message}<Button onClick={run} variant="outline" className="ml-3">Retry</Button></div>
      :!rows.length?<div className="p-8 text-center text-sm text-muted-foreground">No members in this category. Memberships appear here when they have a renewal date.</div>
      :<div className="divide-y divide-border">
        {rows.map(member=>{
          const state=renewalStatus(member,today);
          const link=reminderUrl(member,member.plan_c,today);
          return <article key={member.Id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link to={'/members/'+member.Id} className="font-semibold hover:underline">{member.Name}</Link>
              <p className="mt-1 text-xs text-muted-foreground">{member.phone_c||'No phone'} · {member.plan_c?.Name||'No plan selected'}</p>
              <p className="mt-1 text-sm">Next renewal: <strong>{member.due_date_c||'Not set'}</strong>
                <span className={'ml-2 rounded-full px-2 py-0.5 text-xs font-medium '+style[state]}>{state==='soon'?'Due soon':state==='not-set'?'No date':state.charAt(0).toUpperCase()+state.slice(1)}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {link?<Button asChild variant="outline" size="sm"><a href={link} target="_blank" rel="noopener noreferrer">
                <ApperIcon name="MessageCircle" size={15} className="mr-1"/>WhatsApp reminder</a></Button>:
              <Button variant="outline" size="sm" disabled>Phone or date missing</Button>}
              {canUpdate&&<Button size="sm" onClick={()=>begin(member)}><ApperIcon name="RefreshCw" size={15} className="mr-1"/>Record renewal</Button>}
            </div>
          </article>
        })}
      </div>}
      {!loading&&!error&&<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4 text-sm text-muted-foreground">
        <span>{total.toLocaleString('en-IN')} matches · Page {page} of {pages}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page<=1} onClick={()=>setPage(n=>Math.max(1,n-1))}>Previous</Button>
          <Button variant="outline" disabled={page>=pages} onClick={()=>setPage(n=>n+1)}>Next</Button>
        </div>
      </div>}
    </section>
    <p className="text-xs text-muted-foreground">WhatsApp reminders open a prefilled message for staff to review and send. They are not sent automatically. Old unpaid fee cycles remain under Dues for exceptional cases.</p>
    {selected&&<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!saving)setSelected(null);}}>
      <section role="dialog" aria-modal="true" aria-labelledby="renewal-title" className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div><h2 id="renewal-title" className="font-heading text-xl font-bold">Renew {selected.Name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Record a full upfront payment and advance the next renewal date.</p></div>
          <Button type="button" variant="ghost" size="sm" disabled={saving} aria-label="Close" onClick={()=>setSelected(null)}><ApperIcon name="X" size={18}/></Button>
        </div>
        <form onSubmit={record} className="space-y-4">
          <div><Label htmlFor="renew-plan">Membership plan</Label>
            <select id="renew-plan" className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm" value={planId} required onChange={e=>{setPlanId(e.target.value);requestId.current=crypto.randomUUID();}}>
              <option value="">Choose a plan</option>
              {plans.filter(p=>p.active_c).map(p=><option key={p.Id} value={p.Id}>{p.Name} — {money(p.price_c)}</option>)}
            </select>
          </div>
          <div><Label htmlFor="renew-date">Payment date</Label><Input className="mt-1" id="renew-date" type="date" max={todayKey()} value={paidOn} required onChange={e=>{setPaidOn(e.target.value);requestId.current=crypto.randomUUID();}}/></div>
          <div><Label htmlFor="renew-method">Payment method</Label>
            <select id="renew-method" value={method} className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm" onChange={e=>{setMethod(e.target.value);requestId.current=crypto.randomUUID();}}>
              {['UPI','Cash','Card','Bank transfer'].map(m=><option key={m}>{m}</option>)}
            </select></div>
          <p className="rounded-md bg-muted p-3 text-sm">Payment received: <strong>{chosenPlan?money(chosenPlan.price_c):'Select a plan'}</strong>. Paying early preserves remaining membership days.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={()=>setSelected(null)}>Cancel</Button>
            <Button type="submit" disabled={saving||!chosenPlan||plansLoading}>{saving?'Recording…':'Confirm payment & renew'}</Button></div>
        </form>
      </section>
    </div>}
  </div>;
}
