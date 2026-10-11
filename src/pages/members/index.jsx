import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { renewalStatus } from '@/services/renewalLogic';
import { getTableAccess } from '@/services/userPermissions';
import { useProfile } from '@/hooks/useProfile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ApperIcon from '@/components/ApperIcon';

export const route={path:'/members',layout:'owner',access:"profile === 'Admin_c' || profile === 'Manager_c' || profile === 'Staff_c'"};
export const nav={label:'Members',icon:'Users',order:1,profiles:['Admin_c','Manager_c','Staff_c']};
const statuses={all:'All',active:'Active',soon:'Renewal soon',today:'Renewing today',expired:'Expired',inactive:'Inactive','not-set':'Date missing'};
const PAGE_SIZE=25;

export default function Members(){
  const [search,setSearch]=useState('');
  const [debouncedSearch,setDebouncedSearch]=useState('');
  const [status,setStatus]=useState('all');
  const [page,setPage]=useState(1);
  const {profile}=useProfile();
  const {canCreate}=getTableAccess(profile,'gym_members_c');
  useEffect(()=>{
    const t=setTimeout(()=>setDebouncedSearch(search.trim()),250);
    return ()=>clearTimeout(t);
  },[search]);
  const {data,loading,error,run}=useFetch(()=>
    sdk.directory.list({search:debouncedSearch,state:status,page,pageSize:PAGE_SIZE}),
    [debouncedSearch,status,page]);
  const total=Number(data?.total??0);
  const numberOfPages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  function changeStatus(next){setStatus(next);setPage(1);}
  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h1 className="font-heading text-3xl font-bold">Gym members</h1>
        <p className="mt-1 text-sm text-muted-foreground">Instantly find members and their next membership renewal date.</p></div>
      {canCreate&&<Button asChild><Link to="/members/new"><ApperIcon name="UserPlus" size={16} className="mr-2"/>Add member</Link></Button>}
    </header>
    <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
      <Input aria-label="Search members" placeholder="Search names, phone or email…" value={search}
        onChange={e=>{setSearch(e.target.value);setPage(1);}} />
      <select aria-label="Renewal status" className="h-11 rounded-md border border-input bg-background px-3 text-sm"
        value={status} onChange={e=>changeStatus(e.target.value)}>
        {Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    {loading?<p className="rounded-lg border p-6 text-sm text-muted-foreground">Loading members…</p>
    :error?<div role="alert" className="rounded-lg border p-5">Could not load members: {error.message}<Button variant="outline" className="ml-3" onClick={run}>Retry</Button></div>
    :<section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="divide-y divide-border">
        {(data?.rows??[]).map(m=><Link key={m.Id} to={'/members/'+m.Id}
          className="flex items-center justify-between gap-4 p-4 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="min-w-0">
            <p className="break-words font-semibold">{m.Name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{m.phone_c||'No phone'} · {m.plan_c?.Name||'No plan'}</p>
            <p className="mt-1 text-xs">Next renewal: <strong>{m.due_date_c||'Not scheduled'}</strong> · {statuses[m.renewalState||renewalStatus(m)]}</p>
          </div>
          <ApperIcon name="ChevronRight" size={18} className="shrink-0 text-muted-foreground"/>
        </Link>)}
        {!data?.rows?.length&&<div className="p-8 text-center text-sm text-muted-foreground">No members match these filters.</div>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t p-4 text-sm text-muted-foreground">
        <span>{total.toLocaleString('en-IN')} matching members · Page {page} of {numberOfPages}</span>
        <div className="flex gap-2"><Button variant="outline" disabled={page<=1||loading} onClick={()=>setPage(n=>Math.max(1,n-1))}>Previous</Button>
        <Button variant="outline" disabled={page>=numberOfPages||loading} onClick={()=>setPage(n=>n+1)}>Next</Button></div>
      </div>
    </section>}
  </div>;
}
