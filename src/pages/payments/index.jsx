import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import ApperIcon from '@/components/ApperIcon';
import { ListSkeleton } from '@/components/PageSkeleton';

export const route = {
  path: '/payments',
  layout: 'owner',
  access: "profile === 'Admin_c' || profile === 'Manager_c' || profile === 'Staff_c'",
};
export const nav = {
  label: 'Payments',
  icon: 'Wallet',
  order: 3,
  profiles: ['Admin_c', 'Manager_c', 'Staff_c'],
};

const money = value => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const dateKey = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};


const STATUSES = ['All', 'Paid', 'Pending', 'Refunded'];

export default function Payments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [debouncedSearch,setDebouncedSearch]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>setDebouncedSearch(search.trim()),250);return ()=>clearTimeout(timer);},[search]);
  const [status, setStatus] = useState('All');
  const [period, setPeriod] = useState(() => searchParams.get('period') === 'today' ? 'today' : 'all');
  const [page, setPage] = useState(1);
  const today = dateKey(new Date());

  useEffect(() => {
    setPage(1);
  }, [search, status, period]);

  const { data, loading, error, run } = useFetch(()=>
    sdk.ledger.list({kind:'payments',search:debouncedSearch,status,period,page,pageSize:25}),
    [debouncedSearch,status,period,page]);

  const rows = data?.rows ?? [];
  const paidPageTotal = rows
    .filter(payment => payment.status_c === 'Paid')
    .reduce((sum, payment) => sum + Number(payment.amount_c || 0), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Collections register</p>
          <h1 className="mt-2 font-heading text-2xl font-bold">Payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">Receipts and fee collections recorded by your gym.</p>
        </div>
        <Button asChild className="min-h-11">
          <Link to="/payments/new"><ApperIcon name="Plus" size={16} className="mr-2" />Record payment</Link>
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Matching payment records</p>
          <p className="mt-2 font-heading text-3xl font-bold">{loading ? '—' : data?.total ?? 0}</p>
          <p className="mt-1 text-xs text-muted-foreground">Across all pages matching the filters</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Paid amount on this page</p>
          <p className="mt-2 font-heading text-3xl font-bold">{loading ? '—' : money(paidPageTotal)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Up to 25 receipts at a time</p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_160px]">
        <Input
          aria-label="Search payments"
          className="min-h-11"
          placeholder="Search receipt, member or method…"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
        <select
          aria-label="Filter payment status"
          className="h-11 rounded-md border border-input bg-background px-3 text-sm"
          value={status}
          onChange={event => setStatus(event.target.value)}
        >
          {STATUSES.map(value => <option key={value}>{value}</option>)}
        </select>
        <select
          aria-label="Filter payment date"
          className="h-11 rounded-md border border-input bg-background px-3 text-sm"
          value={period}
          onChange={event => {
            const value = event.target.value;
            setPeriod(value);
            setSearchParams(value === 'today' ? { period: 'today' } : {}, { replace: true });
          }}
        >
          <option value="all">All dates</option>
          <option value="today">Today</option>
        </select>
      </section>

      {loading && !data ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <div role="alert" className="rounded-lg border border-border bg-card p-6">
          <p className="font-semibold">Could not load payments.</p>
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
          <Button className="mt-3" variant="outline" onClick={run}>Try again</Button>
        </div>
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          {rows.map(payment => (
            <Link
              to={`/payments/${payment.Id}`}
              key={payment.Id}
              className="flex min-h-[76px] items-center gap-3 border-l-4 border-l-primary border-b border-border p-4 transition hover:bg-muted/40 last:border-b-0"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-success-muted text-success">
                <ApperIcon name="ArrowDownLeft" size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold">{payment.member_c?.Name || 'Member payment'}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {payment.Name} · {payment.paid_on_c || 'Date not set'} · {payment.method_c || 'Method not set'}
                </p>
                <div className="mt-2">
                  <Badge variant={payment.status_c === 'Paid' ? 'secondary' : 'outline'}>
                    {payment.status_c || 'Pending'}
                  </Badge>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-heading text-base font-bold">{money(payment.amount_c)}</p>
                <ApperIcon name="ChevronRight" size={16} className="ml-auto mt-1 text-muted-foreground" />
              </div>
            </Link>
          ))}
          {rows.length === 0 && (
            <div className="p-10 text-center">
              <ApperIcon name="Wallet" size={30} className="mx-auto text-muted-foreground" />
              <p className="mt-3 font-semibold">No payments found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {search || status !== 'All' || period === 'today'
                  ? 'Change your filters or clear your search.'
                  : 'Record the first payment when a member pays.'}
              </p>
              <Button asChild className="mt-4">
                <Link to="/payments/new">Record payment</Link>
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
            <span className="text-sm text-muted-foreground">Page {page} · {data?.total ?? 0} matching records</span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button>
              <Button variant="outline" disabled={!data?.hasMore || loading} onClick={() => setPage(value => value + 1)}>Next</Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
