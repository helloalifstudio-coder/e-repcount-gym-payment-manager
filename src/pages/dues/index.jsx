import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ApperIcon from '@/components/ApperIcon';
import { ListSkeleton } from '@/components/PageSkeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
export const route={path:'/dues',layout:'owner',access:"profile === 'Admin_c' || profile === 'Manager_c' || profile === 'Staff_c'"};
export const nav={label:'Unpaid exceptions',icon:'ReceiptText',order:10,profiles:['Admin_c','Manager_c','Staff_c']};
const money=value=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(value||0));
const key=date=>{const y=date.getFullYear();const m=String(date.getMonth()+1).padStart(2,'0');const d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;};
function monday(date){const copy=new Date(date.getFullYear(),date.getMonth(),date.getDate());copy.setDate(copy.getDate()-((copy.getDay()+6)%7));return copy;}
const { and, or, contains, gt, eq, ne, lte, lt, isIn } = window.RepCountSDK.CoreSDK;
const periods = [['today', 'Today'], ['week', 'Rest of week'], ['overdue', 'Overdue'], ['all', 'All unpaid']];
export default function Dues(){
 const { profile } = useProfile();
 const { canCreate } = getTableAccess(profile, 'membership_dues_c');
 const [search,setSearch]=useState('');
 const [searchParams,setSearchParams]=useSearchParams();
 const [view,setView]=useState(()=>periods.some(([value])=>value===searchParams.get('view'))?searchParams.get('view'):'today');
 const [page, setPage] = useState(1);
 const today = key(new Date());
 const weekEndDate = monday(new Date());
 weekEndDate.setDate(weekEndDate.getDate() + 6);
 const weekEnd = key(weekEndDate);
 useEffect(() => { setPage(1); }, [search, view]);
 const { data, loading, error, run } = useFetch(async () => {
   const filters = [gt('balance_c', 0), ne('status_c', 'Waived')];
   if (view === 'today') filters.push(eq('due_date_c', today));
   if (view === 'week') filters.push(gt('due_date_c', today), lte('due_date_c', weekEnd));
   if (view === 'overdue') filters.push(lt('due_date_c', today));
   if (search.trim()) {
     const term = search.trim();
     const matchingMembers = await sdk.table('gym_members_c')
       .select(['Id'])
       .where(or(contains('Name', term), contains('phone_c', term)))
       .limit(1000, 0)
       .fetch();
     if (!matchingMembers.success) throw new Error(matchingMembers.message || 'Could not search members.');
     const searchClauses = [contains('Name', term)];
     const memberIds = matchingMembers.data.map(member => member.Id);
     if (memberIds.length) searchClauses.push(isIn('member_c', memberIds));
     filters.push(or(...searchClauses));
   }
   const result = await sdk.table('membership_dues_c')
     .select(['Id', 'Name', 'member_c', { field: 'member_c', ref: 'phone_c' }, 'plan_c', 'due_date_c', 'balance_c'])
     .where(and(...filters)).orderBy('due_date_c').page(page, 25).fetch();
   if (!result.success) throw new Error(result.message);
   return { rows: result.data, total: result.total, hasMore: result.hasMore };
 }, [search, view, page, today, weekEnd]);
 const rows = data?.rows ?? [];
 return <div className="space-y-6">
   <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
     <div className="min-w-0"><h1 className="text-2xl font-heading font-semibold tracking-tight">Unpaid fee exceptions</h1><p className="mt-1 text-sm text-muted-foreground">Only for members allowed to pay later. Standard upfront-paid memberships and expiry reminders are managed under Renewals.</p></div>
     <Button asChild className="min-h-11 shrink-0 active:scale-[0.98]"><Link to="/payments/new"><ApperIcon name="Plus" size={16} className="mr-2"/>Record payment</Link></Button>
   </header>
   <div className="space-y-3">
     <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Due period">{periods.map(([value, label]) => <Button key={value} type="button" aria-pressed={view === value} variant={view === value ? 'default' : 'outline'} className="min-h-11 active:scale-[0.98]" onClick={() => { setView(value); setSearchParams({ view: value }, { replace: true }); }}>{label}</Button>)}</div>
     <Input aria-label="Search dues" className="min-h-11" placeholder="Search member or fee reference…" value={search} onChange={event => setSearch(event.target.value)}/>
     <p className="text-sm text-muted-foreground">{view === 'week' ? `After today through ${formatLocalDate(weekEnd, DATE_FORMATS.SHORT)}. Earlier unpaid dues are under Overdue.` : view === 'all' ? 'All unpaid dues, including upcoming dates.' : view === 'overdue' ? 'Unpaid dues with a date before today.' : 'Unpaid dues dated today.'}</p>
   </div>
   {loading ? <ListSkeleton rows={5}/> : error ? <div role="alert" className="rounded-lg border border-border bg-card p-4"><p className="text-sm">Could not load dues. {error.message}</p><Button variant="outline" className="mt-3" onClick={run}>Try again</Button></div> : <section className="overflow-hidden rounded-lg border border-border bg-card">
     <div className="border-b border-border p-4"><h2 className="text-base font-heading font-semibold">{periods.find(([value]) => value === view)?.[1]}</h2><p className="mt-1 text-sm text-muted-foreground">{data?.total ?? 0} unpaid dues</p></div>
     <div className="divide-y divide-border">{rows.map(row => {
       const name = row.member_c?.Name || 'Member';
       const phone = String(row.member_c?.phone_c || '').replace(/\D/g, '');
       const date = row.due_date_c ? formatLocalDate(row.due_date_c, DATE_FORMATS.SHORT) : 'Date not set';
       const message = `Hi ${name}, your gym membership balance is ${money(row.balance_c)}, due ${date}. Please contact us if you have already paid. Thank you!`;
       return <article key={row.Id} className="space-y-3 p-4">
         <div className="flex items-start gap-3"><Avatar className="h-10 w-10 shrink-0"><AvatarFallback>{name.split(' ').filter(Boolean).slice(0,2).map(part => part[0]).join('')}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{name}</p><p className="mt-1 break-words text-sm text-muted-foreground">{row.plan_c?.Name || 'Membership'} · Due {date}</p><p className="mt-1 text-sm font-medium tabular-nums">{money(row.balance_c)} to collect</p></div></div>
         <div className="grid gap-2 sm:grid-cols-2"><Button asChild variant="outline" className="min-h-11 active:scale-[0.98]"><Link to={`/dues/${row.Id}`}>Review due</Link></Button>{phone ? <Button asChild variant="outline" className="min-h-11 active:scale-[0.98]"><a href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><ApperIcon name="MessageCircle" size={16} className="mr-2"/>Send reminder</a></Button> : <Button disabled className="min-h-11" variant="outline">No phone number</Button>}</div>
       </article>;
     })}</div>
     {rows.length === 0 && <div className="space-y-3 p-4 text-center"><p className="text-sm font-medium">{search ? 'No matching dues' : 'No unpaid dues in this view'}</p><p className="text-sm text-muted-foreground">{search ? 'Try another name or clear your search.' : 'Choose another period to see more dues.'}</p>{search && <Button variant="outline" onClick={() => setSearch('')}>Clear search</Button>}</div>}
     <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4"><span className="text-sm text-muted-foreground">Page {page}</span><div className="flex gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><Button variant="outline" disabled={!data?.hasMore} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>
   </section>}
   <footer className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Reminders open in WhatsApp for you to review and send.</p>{canCreate && <Button asChild variant="outline" className="min-h-11"><Link to="/dues/new">Add a due</Link></Button>}</footer>
 </div>;
}
