import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import { localDateInputValue, logMutationError } from '@/utils/repcount';

export const route = { path: '/payments/new', layout: 'owner', access: "profile === 'Admin_c' || profile === 'Manager_c' || profile === 'Staff_c'" };

export default function NewPayment() {
  const navigate = useNavigate();
  const { data: members } = useFetch(
    () => sdk.table('gym_members_c')
      .select(['Id', 'Name', 'phone_c', 'plan_c'])
      .page(1, 100)
      .fetch()
      .then(result => {
        if (!result.success) throw new Error(result.message);
        return result.data;
      }),
    [],
  );
  const { data: dues } = useFetch(
    () => sdk.table('membership_dues_c')
      .select(['Id', 'Name', 'member_c', 'balance_c', 'status_c'])
      .page(1, 100)
      .fetch()
      .then(result => {
        if (!result.success) throw new Error(result.message);
        return result.data;
      }),
    [],
  );
  const [form, setForm] = useState({
    Name: `RC-${Date.now().toString().slice(-6)}`,
    member_c: '',
    due_c: '',
    amount_c: '',
    paid_on_c: localDateInputValue(),
    method_c: 'UPI',
    status_c: 'Paid',
    notes_c: '',
  });
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const memberDues = (dues ?? []).filter(due =>
    String(due.member_c?.Id) === String(form.member_c) && Number(due.balance_c || 0) > 0,
  );
  const change = event => setForm({ ...form, [event.target.name]: event.target.value });

  function chooseMember(event) {
    const memberId = event.target.value;
    const firstDue = (dues ?? []).find(due =>
      String(due.member_c?.Id) === String(memberId) && Number(due.balance_c || 0) > 0,
    );
    setForm(previous => ({
      ...previous,
      member_c: memberId,
      due_c: firstDue?.Id || '',
      amount_c: firstDue ? String(firstDue.balance_c) : previous.amount_c,
    }));
  }

  async function save(event) {
    event.preventDefault();
    if (!form.member_c) return toast.error('Choose the member who made this payment.');

    const amount = Number(form.amount_c);
    if (!Number.isFinite(amount) || amount <= 0) {
      return toast.error('Enter a payment amount greater than zero.');
    }

    setSaving(true);
    try {
      let linkedDue = null;
      if (form.due_c) {
        const dueResult = await sdk.table('membership_dues_c')
          .select(['Id', 'Name', 'amount_due_c', 'amount_paid_c', 'balance_c', 'status_c'])
          .get(form.due_c);
        if (!dueResult.success || !dueResult.data) {
          throw new Error(dueResult.message || 'The selected fee cycle could not be loaded. Refresh and try again.');
        }
        linkedDue = dueResult.data;
        if (amount > Number(linkedDue.balance_c || 0)) {
          toast.error('Payment amount exceeds the remaining balance for this fee cycle.');
          return;
        }
      }

      const result = await sdk.table('payments_c').create({
        Name: form.Name,
        member_c: form.member_c,
        due_c: form.due_c || null,
        amount_c: amount,
        paid_on_c: form.paid_on_c,
        method_c: form.method_c,
        status_c: form.status_c,
        notes_c: form.notes_c,

      });

      if (result.messages?.length) {
        toast.error(result.messages[0], { description: result.messages.slice(1).join('\n') || undefined });
        logMutationError('payment', 'create', result.messages.join('; '));
      }
      if (!result.data?.length) {
        if (!result.messages?.length) {
          toast.error('The payment could not be saved.');
          logMutationError('payment', 'create', 'No record returned by SDK');
        }
        return;
      }

      // The Supabase database trigger reconciles paid payments to fee-cycle balances atomically.
      toast.success('Payment recorded');
      navigate(`/payments/${result.data[0].Id}`);
    } catch (error) {
      toast.error(error.message || 'Could not record payment');
      logMutationError('payment', 'create', error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/payments" className="inline-flex min-h-10 items-center text-sm font-semibold text-muted-foreground">
        <ApperIcon name="ArrowLeft" size={16} className="mr-2" />Back to payments
      </Link>
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Record payment</h1>
        <p className="mt-1 text-sm text-muted-foreground">Record a standalone payment or an exceptional pay-later fee. Paid membership renewals belong in Renewals.</p>
        <p className="mt-2"><Link to="/renewals" className="text-sm font-semibold text-primary underline underline-offset-2">Collect membership fee and extend renewal date →</Link></p>
      </div>
      <form onSubmit={save} className="space-y-5 rounded-lg border border-border bg-card p-4 shadow-sm md:p-6">
        <div className="space-y-2">
          <Label htmlFor="member_c">Member *</Label>
          <select id="member_c" name="member_c" value={form.member_c} onChange={chooseMember} required className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Choose a member</option>
            {(members ?? []).map(member => <option key={member.Id} value={member.Id}>{member.Name} · {member.phone_c}</option>)}
          </select>
        </div>
        {form.member_c && (
          <div className="space-y-2">
            <Label htmlFor="due_c">Payment for (optional)</Label>
            <select id="due_c" name="due_c" value={form.due_c} onChange={event => {
              const due = (dues ?? []).find(item => String(item.Id) === String(event.target.value));
              setForm(previous => ({ ...previous, due_c: event.target.value, amount_c: due ? String(due.balance_c) : previous.amount_c }));
            }} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Other payment</option>
              {memberDues.map(due => <option key={due.Id} value={due.Id}>{due.Name} · Balance ₹{due.balance_c}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">The balance is filled in for you. Change the amount for a partial payment.</p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="amount_c">Amount received (₹) *</Label>
            <Input id="amount_c" name="amount_c" type="number" min="0.01" step="0.01" value={form.amount_c} onChange={change} placeholder="1200.00" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paid_on_c">Payment date *</Label>
            <Input id="paid_on_c" name="paid_on_c" type="date" value={form.paid_on_c} onChange={change} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="method_c">Payment method</Label>
            <select id="method_c" name="method_c" value={form.method_c} onChange={change} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
              {['Cash', 'UPI', 'Card', 'Bank transfer'].map(value => <option key={value}>{value}</option>)}
            </select>
          </div>
        </div>
        <div className="border-t border-border pt-4">
          <Button type="button" variant="ghost" aria-expanded={showDetails} aria-controls="payment-details" onClick={() => setShowDetails(value => !value)} className="min-h-11 w-full justify-between active:scale-[0.98]">
            Receipt, status and notes <ApperIcon name={showDetails ? 'ChevronUp' : 'ChevronDown'} size={16} />
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">A receipt number is generated automatically. Status defaults to Paid.</p>
        </div>
        <div id="payment-details" hidden={!showDetails} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="Name">Receipt number *</Label>
            <Input id="Name" name="Name" value={form.Name} onChange={change} placeholder="RC-000123" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status_c">Payment status</Label>
            <select id="status_c" name="status_c" value={form.status_c} onChange={change} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
              {['Paid', 'Pending', 'Refunded'].map(value => <option key={value}>{value}</option>)}
            </select>
          </div>
        <div className="space-y-2">
          <Label htmlFor="notes_c">Notes (optional)</Label>
          <textarea id="notes_c" name="notes_c" rows={3} value={form.notes_c} onChange={change} placeholder="Membership period or payment note" className="w-full rounded-md border border-input bg-background p-3 text-sm" />
        </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
          <Button asChild type="button" variant="outline"><Link to="/payments">Cancel</Link></Button>
          <Button disabled={saving}>{saving ? 'Saving…' : 'Save payment'}</Button>
        </div>
      </form>
    </div>
  );
}
