import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { reminderUrl, renewalStatus } from '@/services/renewalLogic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import { logMutationError } from '@/utils/repcount';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
export const route = { path: '/members/:id', layout: 'owner', access: "profile === 'Admin_c' || profile === 'Manager_c' || profile === 'Staff_c'" };
const memberFields = ['Id','Name','phone_c','email_c','plan_c','join_date_c','due_date_c','status_c','notes_c'];
const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(value||0));
const { eq } = window.RepCountSDK.CoreSDK;

async function fetchAllMemberRows(tableName, fields, memberId) {
  const records = [];
  let page = 1;
  while (true) {
    const result = await sdk.table(tableName)
      .select(fields)
      .where(eq('member_c', memberId))
      .orderByDesc('CreatedOn')
      .page(page, 100)
      .fetch();
    if (!result.success) throw new Error(result.message || 'Could not load member history.');
    records.push(...result.data);
    if (!result.hasMore) return records;
    page += 1;
  }
}
export default function MemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: member, loading, error, run } = useFetch(() => sdk.table('gym_members_c').select(memberFields).get(id).then(result => result.data), [id]);
  const { data: dues } = useFetch(() => fetchAllMemberRows('membership_dues_c', ['Id','Name','member_c','plan_c','due_date_c','amount_due_c','amount_paid_c','balance_c','status_c'], id), [id]);
  const { data: payments } = useFetch(() => fetchAllMemberRows('payments_c', ['Id','Name','member_c','amount_c','paid_on_c','method_c','status_c'], id), [id]);
  const { data: plans } = useFetch(() => sdk.table('plans_c').select(['Id','Name','price_c','duration_c']).page(1, 100).fetch().then(result => { if(!result.success) throw new Error(result.message); return result.data; }), []);
  const [editing,setEditing] = useState(false);
  const { profile } = useProfile();
  const { canUpdate, canDelete } = getTableAccess(profile, 'gym_members_c');
  const [saving,setSaving] = useState(false);
  const [form,setForm] = useState(null);
  if(loading && member===undefined) return <div className="space-y-4"><div className="h-8 w-40 animate-pulse rounded bg-muted"/><div className="h-64 animate-pulse rounded-lg bg-muted"/></div>;
  if(error || !member) return <div className="space-y-4"><Link to="/members" className="text-sm text-primary">← Back to members</Link><p className="font-semibold">{error ? 'Could not load member.' : 'Member not found.'}</p></div>;
  const current = form || { Name:member.Name||'',phone_c:member.phone_c||'',email_c:member.email_c||'',plan_c:member.plan_c?.Id||'',join_date_c:member.join_date_c||'',due_date_c:member.due_date_c||'',status_c:member.status_c||'Active',notes_c:member.notes_c||'' };
  const memberDues = dues ?? [];
  const memberPayments = payments ?? [];
  const balance=memberDues.reduce((sum,row)=>sum+Number(row.balance_c||0),0);
  const whatsapp = reminderUrl(member,member.plan_c);
  async function save(event) { event.preventDefault(); setSaving(true); try { const result=await sdk.table('gym_members_c').update({Id:member.Id,...current,plan_c:current.plan_c||null}); if(result.messages?.length) { toast.error(result.messages[0]); logMutationError('member','update',result.messages.join('; ')); } if(!result.data?.length) { if(!result.messages?.length) { toast.error('The member could not be updated.'); logMutationError('member','update','No record returned by SDK'); } return; } toast.success('Member details updated'); setEditing(false); setForm(null); run(); } catch(error) { toast.error(error.message||'Could not update member'); logMutationError('member','update',error); } finally { setSaving(false); } }
  async function remove() {
    try {
      const result = await sdk.table('gym_members_c').remove(member.Id);
      if (result.messages?.length) {
        toast.error(result.messages[0]);
        logMutationError('member', 'delete', result.messages.join('; '));
      }
      if (!result.data?.length) {
        if (!result.messages?.length) {
          toast.error('The member could not be deleted.');
          logMutationError('member', 'delete', 'No record returned by SDK');
        }
        return;
      }
      toast.success('Member deleted');
      navigate('/members');
    } catch (error) {
      toast.error(error.message || 'Could not delete member');
      logMutationError('member', 'delete', error);
    }
  }
  return (
    <div className="space-y-5 pb-4">
      <Link to="/members" className="inline-flex min-h-10 items-center text-sm font-semibold text-muted-foreground hover:text-foreground"><ApperIcon name="ArrowLeft" size={16} className="mr-2"/>Back to members</Link>
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center md:p-6">
        <div className="flex min-w-0 items-center gap-3"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-secondary font-heading text-lg font-bold">{member.Name?.split(' ').map(part=>part[0]).slice(0,2).join('')}</div><div className="min-w-0"><h1 className="break-words font-heading text-2xl font-bold">{member.Name}</h1><p className="mt-1 break-words text-sm text-muted-foreground">{member.phone_c} · Joined {member.join_date_c||'date not recorded'}</p><div className="mt-2"><Badge variant={member.status_c==='Overdue'?'destructive':'secondary'}>{({active:'Active',soon:'Due soon',today:'Renewing today',expired:'Expired',inactive:'Inactive','not-set':'Date missing'})[renewalStatus(member)]}</Badge></div></div></div>
        <div className="grid grid-cols-2 gap-2 sm:flex">{whatsapp && <Button variant="outline" asChild className="min-h-11"><a href={whatsapp} target="_blank" rel="noopener noreferrer"><ApperIcon name="MessageCircle" size={16} className="mr-2"/>Remind</a></Button>}{canUpdate&&<Button asChild className="min-h-11" variant="outline"><Link to="/renewals"><ApperIcon name="RefreshCw" size={16} className="mr-2"/>Record renewal</Link></Button>}{canUpdate && <Button className="min-h-11" onClick={()=>{setForm(current);setEditing(!editing);}}><ApperIcon name="Pencil" size={16} className="mr-2"/>{editing?'Close edit':'Edit member'}</Button>}{canDelete && <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="icon" className="min-h-11 min-w-11" aria-label="Delete member"><ApperIcon name="Trash2" size={16}/></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {member.Name}?</AlertDialogTitle><AlertDialogDescription>This permanently removes this member record. Review linked fee cycles and payments before proceeding.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={remove}>Delete member</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div>
      </section>
      {editing && canUpdate && <form onSubmit={save} className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 md:p-6"><h2 className="font-heading text-lg font-bold sm:col-span-2">Edit member details</h2><div className="space-y-2"><Label htmlFor="Name">Full name *</Label><Input id="Name" placeholder="e.g. Arjun Reddy" value={current.Name} onChange={event=>setForm({...current,Name:event.target.value})} required/></div><div className="space-y-2"><Label htmlFor="phone_c">Phone number *</Label><Input id="phone_c" placeholder="+91 98765 43210" value={current.phone_c} onChange={event=>setForm({...current,phone_c:event.target.value})} required/></div><div className="space-y-2"><Label htmlFor="email_c">Email</Label><Input id="email_c" type="email" placeholder="member@example.com" value={current.email_c} onChange={event=>setForm({...current,email_c:event.target.value})}/></div><div className="space-y-2"><Label htmlFor="plan_c">Membership plan</Label><select id="plan_c" value={current.plan_c} onChange={event=>setForm({...current,plan_c:event.target.value})} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">No plan</option>{(plans??[]).map(plan=><option key={plan.Id} value={plan.Id}>{plan.Name}</option>)}</select></div><div className="space-y-2"><Label htmlFor="join_date_c">Join date</Label><Input id="join_date_c" type="date" value={current.join_date_c} onChange={event=>setForm({...current,join_date_c:event.target.value})}/></div><div className="space-y-2"><Label>Next renewal date</Label><p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">{member.due_date_c||'Not active'} — use Record renewal to advance it with a payment.</p></div><div className="space-y-2"><Label htmlFor="status_c">Member status</Label><select id="status_c" value={current.status_c} onChange={event=>setForm({...current,status_c:event.target.value})} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">{['Active','Due soon','Overdue','Inactive'].map(value=><option key={value}>{value}</option>)}</select></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="notes_c">Notes</Label><textarea id="notes_c" value={current.notes_c} onChange={event=>setForm({...current,notes_c:event.target.value})} rows={3} className="w-full rounded-md border border-input bg-background p-3 text-sm" placeholder="Training preferences or follow-up notes"/></div><div className="flex justify-end gap-2 sm:col-span-2"><Button variant="outline" type="button" onClick={()=>{setEditing(false);setForm(null);}}>Cancel</Button><Button disabled={saving}>{saving?'Saving…':'Save changes'}</Button></div></form>}
      <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Unpaid exceptions</p><p className="mt-2 font-heading text-2xl font-bold">{money(balance)}</p><p className="mt-1 text-xs text-muted-foreground">Across linked fee cycles</p></div><div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Fee cycles</p><p className="mt-2 font-heading text-2xl font-bold">{memberDues.length}</p><p className="mt-1 text-xs text-muted-foreground">Old pay-later fee cycles only</p></div><div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Recorded payments</p><p className="mt-2 font-heading text-2xl font-bold">{memberPayments.length}</p><Button asChild variant="link" className="mt-1 h-auto px-0"><Link to="/payments/new">Record payment</Link></Button></div></section>
      <section className="rounded-lg border border-border bg-card p-4 md:p-6"><h2 className="font-heading text-lg font-bold">Contact and membership</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">Phone</dt><dd className="mt-1 break-words font-medium">{member.phone_c||'—'}</dd></div><div><dt className="text-sm text-muted-foreground">Email</dt><dd className="mt-1 break-words font-medium">{member.email_c||'—'}</dd></div><div><dt className="text-sm text-muted-foreground">Plan</dt><dd className="mt-1 font-medium">{member.plan_c?.Name||'No plan assigned'}</dd></div><div><dt className="text-sm text-muted-foreground">Next renewal</dt><dd className="mt-1 font-medium">{member.due_date_c||'Not scheduled'}</dd></div><div className="sm:col-span-2"><dt className="text-sm text-muted-foreground">Notes</dt><dd className="mt-1 whitespace-pre-wrap font-medium">{member.notes_c||'No notes yet'}</dd></div></dl></section>
      <section className="rounded-lg border border-border bg-card p-4 md:p-6"><div className="flex items-center justify-between gap-3"><div><h2 className="font-heading text-lg font-bold">Membership dues</h2><p className="mt-1 text-sm text-muted-foreground">Billing cycles and remaining balances.</p></div><Button asChild variant="outline"><Link to="/dues">View register</Link></Button></div><div className="mt-4 space-y-3">{memberDues.map(row=><div key={row.Id} className="rounded-md border-l-4 border-l-primary bg-muted/40 p-3"><Link to={`/dues/${row.Id}`} className="break-words font-semibold hover:text-primary">{row.Name}</Link><p className="mt-1 text-xs text-muted-foreground">Due {row.due_date_c} · {row.status_c}</p><p className="mt-1 text-xs text-muted-foreground">Paid {money(row.amount_paid_c)} of {money(row.amount_due_c)}</p><p className="mt-1 font-heading font-bold">Balance: {money(row.balance_c)}</p></div>)}{memberDues.length===0&&<p className="rounded-md bg-muted/40 p-5 text-sm text-muted-foreground">No membership fee cycles are linked to this member yet.</p>}</div></section>
      <section className="rounded-lg border border-border bg-card p-4 md:p-6"><h2 className="font-heading text-lg font-bold">Payment history</h2><div className="mt-4 divide-y divide-border">{memberPayments.map(payment=><div key={payment.Id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><Link to={`/payments/${payment.Id}`} className="break-words font-semibold hover:text-primary">{payment.Name}</Link><p className="mt-1 text-xs text-muted-foreground">{payment.paid_on_c} · {payment.method_c}</p></div><p className="shrink-0 font-heading font-bold">{money(payment.amount_c)}</p></div>)}{memberPayments.length===0&&<p className="py-5 text-sm text-muted-foreground">No payments recorded yet.</p>}</div></section>
    </div>
  );
}
