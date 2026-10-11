import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { todayKey } from '@/services/renewalLogic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';

export const route={path:'/members/new',layout:'owner',access:"profile === 'Admin_c' || profile === 'Manager_c'"};
const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n||0));

export default function NewMember(){
  const navigate=useNavigate();
  const {data:plans,error:planError}=useFetch(async()=>{
    const r=await sdk.table('plans_c').select(['Id','Name','price_c','duration_c','active_c']).page(1,100).fetch();
    if(!r.success) throw new Error(r.message);
    return r.data;
  },[]);
  const [form,setForm]=useState({
    Name:'',phone_c:'',email_c:'',plan_c:'',join_date_c:todayKey(),notes_c:'',
  });
  const [paidUpfront,setPaidUpfront]=useState(true);
  const [method,setMethod]=useState('UPI');
  const [saving,setSaving]=useState(false);
  const activePlans=(plans??[]).filter(p=>p.active_c);
  const selectedPlan=activePlans.find(p=>String(p.Id)===String(form.plan_c));
  const change=e=>setForm(x=>({...x,[e.target.name]:e.target.value}));
  async function save(e){
    e.preventDefault();
    if(saving)return;
    if(!form.Name.trim()||!form.phone_c.trim())return toast.error('Enter member name and phone number.');
    if(paidUpfront&&!selectedPlan)return toast.error('Choose a membership plan to record upfront payment.');
    setSaving(true);
    try{
      const paidOn=todayKey();
      // The initial date is the payment date; renewal RPC advances it by the plan duration.
      const created=await sdk.table('gym_members_c').create({
        ...form,Name:form.Name.trim(),phone_c:form.phone_c.trim(),
        plan_c:form.plan_c||null,
        due_date_c:paidUpfront?paidOn:null,
        status_c:paidUpfront?'Active':'Inactive',
      });
      if(!created.success||!created.data?.[0]?.Id)throw new Error(created.message||'Could not save member.');
      const memberId=created.data[0].Id;
      if(paidUpfront){
        try{
          const receipt=await sdk.renewals.record({
            memberId,planId:selectedPlan.Id,paidOn,method,requestId:crypto.randomUUID(),
          });
          toast.success('Member activated', {description:'Paid '+money(selectedPlan.price_c)+' · Next renewal '+receipt.nextRenewalDate});
        }catch(error){
          // Creating a member and recording payment are separate API calls. Keep
          // the new member rather than silently deleting it after an error.
          toast.error('Member saved, but payment was not recorded. Open Renewals to finish activation.',{duration:9000});
          navigate('/members/'+memberId);
          return;
        }
      }else toast.success('Member saved. Activate the membership after receiving payment.');
      navigate('/members/'+memberId);
    }catch(error){toast.error(error.message||'Could not add member.');}
    finally{setSaving(false);}
  }
  return <div className="mx-auto max-w-3xl space-y-6">
    <Link to="/members" className="inline-flex items-center text-sm text-muted-foreground"><ApperIcon name="ArrowLeft" size={16} className="mr-2"/>Back to members</Link>
    <header><p className="text-xs font-bold uppercase tracking-widest text-primary">Member enrollment</p>
      <h1 className="mt-2 font-heading text-3xl font-bold">Add a gym member</h1>
      <p className="mt-2 text-sm text-muted-foreground">Collect the membership fee upfront; we'll track the next renewal date automatically.</p></header>
    <form onSubmit={save} className="space-y-6 rounded-xl border border-border bg-card p-5 md:p-7">
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Member details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="member-name">Full name *</Label><Input className="mt-1" id="member-name" name="Name" value={form.Name} onChange={change} placeholder="e.g. Rahul Sharma" required disabled={saving}/></div>
          <div><Label htmlFor="member-phone">Phone number *</Label><Input className="mt-1" id="member-phone" name="phone_c" type="tel" value={form.phone_c} onChange={change} placeholder="+91 98765 43210" required disabled={saving}/></div>
          <div><Label htmlFor="member-email">Email (optional)</Label><Input className="mt-1" id="member-email" name="email_c" type="email" value={form.email_c} onChange={change} disabled={saving}/></div>
          <div><Label htmlFor="member-join">Join date</Label><Input className="mt-1" id="member-join" name="join_date_c" type="date" max={todayKey()} value={form.join_date_c} onChange={change} disabled={saving}/></div>
        </div>
      </section>
      <section className="space-y-4 border-t border-border pt-5">
        <h2 className="font-heading text-lg font-bold">Membership & first payment</h2>
        {planError&&<p role="alert" className="text-sm text-destructive">Could not load membership plans: {planError.message}</p>}
        {!planError&&plans&&activePlans.length===0&&<div className="rounded-lg border border-primary/25 bg-primary/5 p-4">
          <p className="font-semibold">First, create a membership plan</p>
          <p className="mt-1 text-sm text-muted-foreground">Add a monthly or quarterly package with its fee. Then return here to enroll a member and collect the upfront payment.</p>
          <Button asChild variant="outline" size="sm" className="mt-3"><Link to="/plans/new">Create first plan</Link></Button>
        </div>}
        <div><Label htmlFor="member-plan">Membership plan</Label>
          <select id="member-plan" name="plan_c" className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.plan_c} onChange={change} disabled={saving}>
            <option value="">Choose a plan</option>
            {activePlans.map(p=><option key={p.Id} value={p.Id}>{p.Name} — {money(p.price_c)} / {p.duration_c}</option>)}
          </select></div>
        <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <input type="checkbox" checked={paidUpfront} disabled={saving} onChange={e=>setPaidUpfront(e.target.checked)} className="mt-1 size-4 accent-primary"/>
          <span><strong className="block text-sm">Membership fee received today</strong><span className="mt-1 block text-xs text-muted-foreground">Automatically activate the chosen plan and calculate the next renewal date.</span></span>
        </label>
        {paidUpfront&&<div className="rounded-lg bg-primary/5 p-4">
          <p className="text-sm">Total paid upfront: <strong>{selectedPlan?money(selectedPlan.price_c):'Select a plan'}</strong></p>
          <div className="mt-3"><Label htmlFor="payment-method">Received via</Label>
            <select id="payment-method" value={method} onChange={e=>setMethod(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={saving}>
              {['UPI','Cash','Card','Bank transfer'].map(m=><option key={m}>{m}</option>)}
            </select></div>
        </div>}
        <p className="text-xs text-muted-foreground">If payment isn't received yet, leave the member inactive and record their payment later from Renewals. No overdue debt is created automatically.</p>
      </section>
      <section className="border-t border-border pt-5"><Label htmlFor="notes">Notes (optional)</Label><textarea id="notes" name="notes_c" rows={3} value={form.notes_c} onChange={change} disabled={saving} className="mt-1 w-full rounded-md border border-input bg-background p-3 text-sm"/></section>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5"><Button asChild type="button" variant="outline"><Link to="/members">Cancel</Link></Button>
        <Button type="submit" disabled={saving||(paidUpfront&&!selectedPlan)}>{saving?'Saving…':paidUpfront?'Save member and payment':'Save member'}</Button></div>
    </form>
  </div>;
}
