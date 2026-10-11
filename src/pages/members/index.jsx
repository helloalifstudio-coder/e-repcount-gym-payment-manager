import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { renewalStatus } from '@/services/renewalLogic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import ApperIcon from '@/components/ApperIcon';
import { ListSkeleton } from '@/components/PageSkeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
export const route={path:'/members',layout:'owner',access:"profile === 'Admin_c' || profile === 'Manager_c' || profile === 'Staff_c'"};
export const nav={label:'Members',icon:'Users',order:1,profiles:['Admin_c','Manager_c','Staff_c']};
const { contains, eq, and, or } = window.RepCountSDK.CoreSDK;
const statuses = ['Active', 'Due soon', 'Overdue', 'Inactive'];
const statusStyles = {
  Active: 'bg-success/10 border-success/20 text-success',
  'Due soon': 'bg-warning/10 border-warning/20 text-warning',
  Overdue: 'bg-destructive/10 border-destructive/20 text-destructive',
  Inactive: 'bg-muted border-border text-muted-foreground',
};
export default function Members() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [page, setPage] = useState(1);
  const { profile } = useProfile();
  const { canCreate } = getTableAccess(profile, 'gym_members_c');
  useEffect(() => { setPage(1); }, [search, status]);
  const { data, loading, error, run } = useFetch(async () => {
    const filters = [];
    if (search.trim()) filters.push(or(contains('Name', search.trim()), contains('phone_c', search.trim()), contains('email_c', search.trim())));
    // Date-based renewal state is computed locally, not trusted from stale status_c.
    let query = sdk.table('gym_members_c').select(['Id', 'Name', 'phone_c', 'plan_c', 'due_date_c', 'status_c']);
    if (filters.length) query = query.where(and(...filters));
    const result = await query.orderBy('Name').page(page, 25).fetch();
    if (!result.success) throw new Error(result.message);
    return { rows: result.data, total: result.total, hasMore: result.hasMore };
  }, [search, status, page]);
  const rows = (data?.rows ?? []).filter(m=>status==='All'||({active:'Active',soon:'Due soon',today:'Due soon',expired:'Overdue',inactive:'Inactive','not-set':'Inactive'}[renewalStatus(m)]===status));
  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-2xl font-heading font-semibold tracking-tight">Members</h1><p className="mt-1 text-sm text-muted-foreground">Find a member to review their details, membership and renewal status.</p></div>
      {canCreate && <Button asChild className="min-h-11"><Link to="/members/new"><ApperIcon name="UserPlus" size={17} className="mr-2" />Add member</Link></Button>}
    </div>
    <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
      <Input aria-label="Search members" className="min-h-11" placeholder="Search name or phone…" value={search} onChange={event => setSearch(event.target.value)} />
      <select aria-label="Member status" className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring" value={status} onChange={event => setStatus(event.target.value)}><option value="All">All members</option>{statuses.map(value => <option key={value}>{value}</option>)}</select>
    </div>
    {loading ? <ListSkeleton rows={6} /> : error ? <div role="alert" className="rounded-lg border border-border p-4"><p className="text-sm">Could not load members. Please try again.</p><Button variant="outline" className="mt-3" onClick={run}>Try again</Button></div> : <section aria-label="Members" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="divide-y divide-border">{rows.map(member => <Link key={member.Id} to={`/members/${member.Id}`} className="flex min-w-0 items-center gap-3 p-4 transition-colors duration-(--transition-fast) hover:bg-accent active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <Avatar className="h-10 w-10 shrink-0"><AvatarFallback>{(member.Name || 'Member').split(' ').map(part => part[0]).slice(0, 2).join('')}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1"><p className="text-sm font-medium break-words">{member.Name}</p><p className="mt-1 text-sm text-muted-foreground break-words">{member.phone_c || 'No phone'} · {member.plan_c?.Name || 'No plan'}</p><p className="mt-1 text-xs text-muted-foreground">Renewal: {member.due_date_c ? formatLocalDate(member.due_date_c, DATE_FORMATS.SHORT) : 'Not set'}</p><Badge variant="outline" className={`mt-2 ${statusStyles[({active:'Active',soon:'Due soon',today:'Due soon',expired:'Overdue',inactive:'Inactive','not-set':'Inactive'})[renewalStatus(member)]] || statusStyles.Inactive}`}>{({active:'Active',soon:'Due soon',today:'Due soon',expired:'Expired',inactive:'Inactive','not-set':'No renewal date'})[renewalStatus(member)]}</Badge></div>
        <ApperIcon name="ChevronRight" size={18} className="shrink-0 text-muted-foreground" />
      </Link>)}</div>
      {!rows.length && <div className="p-8 text-center"><p className="text-sm font-medium">No members found</p><p className="mt-1 text-sm text-muted-foreground">{canCreate ? 'Try a different search or add your first member.' : 'Try a different search or ask an administrator to add members.'}</p>{canCreate && <Button asChild className="mt-4" variant="outline"><Link to="/members/new">Add member</Link></Button>}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4"><span className="text-sm text-muted-foreground">{data?.total ?? 0} members · Page {page}</span><div className="flex gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><Button variant="outline" disabled={!data?.hasMore} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>
    </section>}
  </div>;
}
