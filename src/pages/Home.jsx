import { Link } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { renewalStatus, renewalStats, reminderUrl, todayKey } from '@/services/renewalLogic';
import { Button } from '@/components/ui/button';
import ApperIcon from '@/components/ApperIcon';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';

export const route={path:'/',layout:'owner',access:"profile === 'Admin_c' || profile === 'Manager_c' || profile === 'Staff_c'"};
export const nav={label:'Overview',icon:'LayoutDashboard',order:0};
const today=todayKey();
const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n||0));
async function allMembers(){
  const members=[];
  for(let page=1;page<=100;page++){
    const r=await sdk.table('gym_members_c')
      .select(['Id','Name','phone_c','plan_c','due_date_c','status_c'])
      .page(page,100).fetch();
    if(!r.success)throw new Error(r.message||'Could not load members');
    members.push(...r.data);
    if(!r.hasMore)return members;
  }
  throw new Error('Membership directory exceeded the supported page limit.');
}
const Metric=({label,value,detail,icon,to})=><Link to={to} className="block rounded-lg border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm">
  <ApperIcon name={icon} size={20} className="text-primary"/>
  <p className="mt-3 font-heading text-3xl font-bold">{value}</p>
  <p className="mt-1 text-sm font-medium">{label}</p>
  <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
</Link>;

export default function Home(){
  const {profile}=useProfile();
  const {canCreate}=getTableAccess(profile,'gym_members_c');
  const {data:members,loading,error,run}=useFetch(allMembers,[]);
  const {data:summary}=useFetch(()=>sdk.dashboardSummary(today),[today]);
  const records=members??[];
  const stats=renewalStats(records,today);
  const attention=records.filter(m=>['expired','today','soon'].includes(renewalStatus(m,today)))
    .sort((a,b)=>String(a.due_date_c).localeCompare(String(b.due_date_c))).slice(0,8);
  return <div className="space-y-6 pb-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Membership retention</p>
        <h1 className="mt-2 font-heading text-3xl font-bold">Renewals overview</h1>
        <p className="mt-2 text-sm text-muted-foreground">See who's renewing next and remind them before their gym membership expires.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canCreate&&<Button asChild variant="outline"><Link to="/members/new"><ApperIcon name="UserPlus" size={16} className="mr-2"/>Add member</Link></Button>}
        <Button asChild><Link to="/renewals"><ApperIcon name="CalendarClock" size={16} className="mr-2"/>Manage renewals</Link></Button>
      </div>
    </header>
    {error&&<div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">Could not load renewal dates: {error.message}<Button variant="outline" className="ml-3" onClick={run}>Retry</Button></div>}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Membership renewal totals">
      <Metric label="Active memberships" value={loading?'—':stats.active} detail="Paid and currently valid" icon="Users" to="/members"/>
      <Metric label="Renewals next 7 days" value={loading?'—':stats.soon} detail="Including today's renewals" icon="CalendarClock" to="/renewals?view=soon"/>
      <Metric label="Renewing today" value={loading?'—':stats.today} detail="Contact these members first" icon="Bell" to="/renewals?view=today"/>
      <Metric label="Expired memberships" value={loading?'—':stats.expired} detail="Invite them to renew" icon="AlertTriangle" to="/renewals?view=expired"/>
    </section>
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div><h2 className="font-heading text-lg font-bold">Members needing a reminder</h2>
          <p className="text-sm text-muted-foreground">Memberships expiring within a week or already expired</p></div>
        <Button asChild variant="outline" size="sm"><Link to="/renewals">View all renewals <ApperIcon name="ArrowRight" size={15} className="ml-2"/></Link></Button>
      </div>
      {loading?<p className="p-6 text-sm text-muted-foreground">Checking upcoming renewals…</p>
        :!attention.length?<div className="p-8 text-center"><ApperIcon name="CheckCircle2" size={25} className="mx-auto text-success"/><p className="mt-3 font-medium">No imminent renewals</p><p className="mt-1 text-sm text-muted-foreground">Everyone is currently up to date. Check back closer to the next billing date.</p></div>
        :<div className="divide-y divide-border">{attention.map(m=>{
          const link=reminderUrl(m,m.plan_c,today);
          return <div key={m.Id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div><Link to={'/members/'+m.Id} className="font-semibold hover:underline">{m.Name}</Link>
              <p className="mt-1 text-xs text-muted-foreground">Next renewal: {m.due_date_c} · {m.plan_c?.Name||'No plan'}</p></div>
            <div className="flex gap-2">
              {link&&<Button asChild variant="outline" size="sm"><a href={link} target="_blank" rel="noopener noreferrer"><ApperIcon name="MessageCircle" size={16} className="mr-1"/>Remind</a></Button>}
              <Button asChild size="sm"><Link to={'/renewals?view='+ (renewalStatus(m,today)==='expired'?'expired':'soon')}>Renew</Link></Button>
            </div>
          </div>;
        })}</div>}
    </section>
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="font-semibold">Payments are recorded upfront</p>
        <p className="mt-1 text-sm text-muted-foreground">After collecting a renewal payment, use Record renewal to advance the next billing date. Old credit balances remain under Dues.</p></div>
      <div className="text-right"><p className="text-xs text-muted-foreground">Payments collected today</p><p className="font-heading text-xl font-bold">{summary?money(summary.collectedToday):'—'}</p></div>
    </section>
  </div>;
}
