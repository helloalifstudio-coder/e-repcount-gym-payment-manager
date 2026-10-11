-- RepCount gym installer: ONE SQL paste for a BRAND-NEW EMPTY Supabase project.
-- The same 11 versioned migrations as supabase/migrations/; DO NOT run twice.
-- This file does not grant Admin access; run supabase/bootstrap_admin.sql AFTER creating an Auth user.
-- Does not contain keys, passwords, project references or sample data.

BEGIN;

-- >>> BEGIN MIGRATION: supabase/migrations/202610100001_initial_schema.sql
-- RepCount Supabase schema, policies, and payment consistency triggers.
-- Apply in a new Supabase project before deploying the frontend migration.
-- No passwords or API keys belong in this file.

create table if not exists public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gym_users (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'staff')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null,
  duration_c text not null default '1 month',
  price_c numeric(12,2) not null check (price_c > 0),
  description_c text not null default '',
  active_c boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, name)
);

create table if not exists public.gym_members (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null,
  phone_c text not null,
  email_c text,
  plan_c uuid references public.membership_plans(id) on delete set null,
  join_date_c date,
  due_date_c date,
  status_c text not null default 'Active'
    check (status_c in ('Active', 'Due soon', 'Overdue', 'Inactive')),
  notes_c text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.membership_dues (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null,
  member_c uuid not null references public.gym_members(id) on delete restrict,
  plan_c uuid references public.membership_plans(id) on delete set null,
  period_start_c date,
  period_end_c date,
  due_date_c date not null,
  amount_due_c numeric(12,2) not null check (amount_due_c > 0),
  amount_paid_c numeric(12,2) not null default 0 check (amount_paid_c >= 0),
  balance_c numeric(12,2) not null default 0 check (balance_c >= 0),
  status_c text not null default 'Unpaid'
    check (status_c in ('Unpaid', 'Partially paid', 'Paid', 'Waived')),
  notes_c text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, name)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null,
  member_c uuid references public.gym_members(id) on delete set null,
  due_c uuid references public.membership_dues(id) on delete set null,
  amount_c numeric(12,2) not null check (amount_c > 0),
  paid_on_c date not null default current_date,
  method_c text not null default 'UPI'
    check (method_c in ('Cash', 'UPI', 'Card', 'Bank transfer')),
  status_c text not null default 'Paid'
    check (status_c in ('Paid', 'Pending', 'Refunded')),
  notes_c text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, name)
);

create index if not exists gym_users_gym_id_idx on public.gym_users(gym_id);
create index if not exists gym_members_gym_id_name_idx on public.gym_members(gym_id, name);
create index if not exists membership_dues_gym_due_date_idx on public.membership_dues(gym_id, due_date_c);
create index if not exists membership_dues_member_idx on public.membership_dues(member_c);
create index if not exists payments_gym_paid_on_idx on public.payments(gym_id, paid_on_c);
create index if not exists payments_due_status_idx on public.payments(due_c, status_c);
create index if not exists payments_member_idx on public.payments(member_c);

-- Internal tenant helper functions live outside the API-exposed public schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_gym_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gu.gym_id
  from public.gym_users gu
  where gu.user_id = auth.uid()
    and gu.status = 'active'
  limit 1
$$;

create or replace function private.has_gym_role(target_gym_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gym_users gu
    where gu.user_id = auth.uid()
      and gu.gym_id = target_gym_id
      and gu.status = 'active'
      and gu.role = any (allowed_roles)
  )
$$;

revoke all on function private.current_gym_id() from public;
revoke all on function private.has_gym_role(uuid, text[]) from public;
grant execute on function private.current_gym_id() to authenticated;
grant execute on function private.has_gym_role(uuid, text[]) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['profiles', 'gym_users', 'membership_plans', 'gym_members', 'membership_dues', 'payments']
  loop
    execute format('drop trigger if exists touch_updated_at on public.%I', table_name);
    execute format(
      'create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.normalize_due_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status_c = 'Waived' then
    new.balance_c := 0;
    return new;
  end if;

  if new.amount_paid_c > new.amount_due_c then
    raise exception 'Recorded payments cannot exceed the fee-cycle amount.';
  end if;

  new.balance_c := greatest(new.amount_due_c - new.amount_paid_c, 0);
  new.status_c := case
    when new.balance_c = 0 then 'Paid'
    when new.amount_paid_c > 0 then 'Partially paid'
    else 'Unpaid'
  end;
  return new;
end;
$$;

drop trigger if exists normalize_due_balance on public.membership_dues;
create trigger normalize_due_balance
before insert or update
on public.membership_dues
for each row execute function public.normalize_due_balance();

create or replace function public.validate_workspace_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $workspace$
begin
  if new.plan_c is not null and not exists (
    select 1
    from public.membership_plans p
    where p.id = new.plan_c
      and p.gym_id = new.gym_id
  ) then
    raise exception 'The selected membership plan does not belong to this gym.';
  end if;

  -- Keep the dues-only field reference in its own branch so member inserts do not
  -- attempt to resolve NEW.member_c on the gym_members trigger path.
  if tg_table_name = 'membership_dues' then
    if not exists (
      select 1
      from public.gym_members m
      where m.id = new.member_c
        and m.gym_id = new.gym_id
    ) then
      raise exception 'The selected member does not belong to this gym.';
    end if;
  end if;

  return new;
end;
$workspace$;

drop trigger if exists validate_workspace_links on public.gym_members;
create trigger validate_workspace_links
before insert or update on public.gym_members
for each row execute function public.validate_workspace_links();

drop trigger if exists validate_workspace_links on public.membership_dues;
create trigger validate_workspace_links
before insert or update on public.membership_dues
for each row execute function public.validate_workspace_links();

create or replace function public.validate_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_gym_id uuid;
  due_member_id uuid;
  due_amount numeric(12,2);
  due_status text;
  paid_other_payments numeric(12,2);
begin
  if new.member_c is not null and not exists (
    select 1 from public.gym_members m
    where m.id = new.member_c and m.gym_id = new.gym_id
  ) then
    raise exception 'The selected member does not belong to this gym.';
  end if;

  if new.due_c is not null then
    select d.gym_id, d.member_c, d.amount_due_c, d.status_c
      into due_gym_id, due_member_id, due_amount, due_status
    from public.membership_dues d
    where d.id = new.due_c
    for update;

    if not found or due_gym_id <> new.gym_id then
      raise exception 'The selected fee cycle does not belong to this gym.';
    end if;

    if new.member_c is not null and due_member_id <> new.member_c then
      raise exception 'The payment member must match the fee-cycle member.';
    end if;

    if new.status_c = 'Paid' and due_status = 'Waived' then
      raise exception 'A waived fee cycle cannot accept a payment.';
    end if;

    if new.status_c = 'Paid' then
      select coalesce(sum(p.amount_c), 0)
        into paid_other_payments
      from public.payments p
      where p.due_c = new.due_c
        and p.gym_id = new.gym_id
        and p.status_c = 'Paid'
        and p.id is distinct from new.id;

      if paid_other_payments + new.amount_c > due_amount then
        raise exception 'This payment exceeds the remaining fee-cycle balance.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payment on public.payments;
create trigger validate_payment
before insert or update of gym_id, member_c, due_c, amount_c, status_c
on public.payments
for each row execute function public.validate_payment();

create or replace function public.recalculate_due_from_payments(target_due_id uuid, target_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_amount numeric(12,2);
  due_status text;
  paid_total numeric(12,2);
begin
  if target_due_id is null then
    return;
  end if;

  select d.amount_due_c, d.status_c
    into due_amount, due_status
  from public.membership_dues d
  where d.id = target_due_id and d.gym_id = target_gym_id
  for update;

  if not found or due_status = 'Waived' then
    return;
  end if;

  select coalesce(sum(p.amount_c), 0)
    into paid_total
  from public.payments p
  where p.due_c = target_due_id
    and p.gym_id = target_gym_id
    and p.status_c = 'Paid';

  update public.membership_dues
  set amount_paid_c = paid_total,
      balance_c = greatest(due_amount - paid_total, 0),
      status_c = case
        when greatest(due_amount - paid_total, 0) = 0 then 'Paid'
        when paid_total > 0 then 'Partially paid'
        else 'Unpaid'
      end
  where id = target_due_id and gym_id = target_gym_id;
end;
$$;

create or replace function public.sync_due_after_payment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_due_from_payments(old.due_c, old.gym_id);
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (old.due_c is distinct from new.due_c or old.gym_id is distinct from new.gym_id) then
    perform public.recalculate_due_from_payments(old.due_c, old.gym_id);
  end if;

  perform public.recalculate_due_from_payments(new.due_c, new.gym_id);
  return new;
end;
$$;

drop trigger if exists sync_due_after_payment_change on public.payments;
create trigger sync_due_after_payment_change
after insert or update or delete on public.payments
for each row execute function public.sync_due_after_payment_change();

create or replace function public.dashboard_summary(p_today date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'outstanding',
    coalesce((
      select sum(d.balance_c)
      from public.membership_dues d
      where d.gym_id = private.current_gym_id()
        and d.balance_c > 0
        and d.status_c <> 'Waived'
    ), 0),
    'due_today_balance',
    coalesce((
      select sum(d.balance_c)
      from public.membership_dues d
      where d.gym_id = private.current_gym_id()
        and d.due_date_c = p_today
        and d.balance_c > 0
        and d.status_c <> 'Waived'
    ), 0),
    'collected_today',
    coalesce((
      select sum(p.amount_c)
      from public.payments p
      where p.gym_id = private.current_gym_id()
        and p.paid_on_c = p_today
        and p.status_c = 'Paid'
    ), 0)
  )
$$;

revoke all on function public.validate_workspace_links() from public;
revoke all on function public.validate_payment() from public;
revoke all on function public.recalculate_due_from_payments(uuid, uuid) from public;
revoke all on function public.sync_due_after_payment_change() from public;
revoke all on function public.touch_updated_at() from public;
revoke all on function public.normalize_due_balance() from public;

revoke all on function public.dashboard_summary(date) from public;
grant execute on function public.dashboard_summary(date) to authenticated;

-- Explicitly remove Supabase's per-role default function grants.
-- Trigger functions are not API endpoints and must never be exposed through RPC.
revoke execute on function private.current_gym_id() from anon;
revoke execute on function private.has_gym_role(uuid, text[]) from anon;
revoke execute on function public.dashboard_summary(date) from anon;
revoke execute on function public.touch_updated_at() from anon, authenticated;
revoke execute on function public.normalize_due_balance() from anon, authenticated;
revoke execute on function public.validate_workspace_links() from anon, authenticated;
revoke execute on function public.validate_payment() from anon, authenticated;
revoke execute on function public.recalculate_due_from_payments(uuid, uuid) from anon, authenticated;
revoke execute on function public.sync_due_after_payment_change() from anon, authenticated;

-- Enable RLS everywhere that contains application or workspace data.
alter table public.gyms enable row level security;
alter table public.profiles enable row level security;
alter table public.gym_users enable row level security;
alter table public.membership_plans enable row level security;
alter table public.gym_members enable row level security;
alter table public.membership_dues enable row level security;
alter table public.payments enable row level security;

drop policy if exists gyms_read_current_gym on public.gyms;
create policy gyms_read_current_gym on public.gyms
for select to authenticated
using (id = private.current_gym_id());

drop policy if exists profiles_read_workspace on public.profiles;
create policy profiles_read_workspace on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.gym_users other_user
    where other_user.user_id = profiles.id
      and other_user.gym_id = private.current_gym_id()
      and other_user.status = 'active'
      and private.has_gym_role(other_user.gym_id, array['admin']::text[])
  )
);

drop policy if exists gym_users_read_workspace on public.gym_users;
create policy gym_users_read_workspace on public.gym_users
for select to authenticated
using (
  gym_id = private.current_gym_id()
  and (
    user_id = auth.uid()
    or private.has_gym_role(gym_id, array['admin']::text[])
  )
);

drop policy if exists plans_read_workspace on public.membership_plans;
create policy plans_read_workspace on public.membership_plans
for select to authenticated
using (gym_id = private.current_gym_id());

drop policy if exists plans_insert_admin_manager on public.membership_plans;
create policy plans_insert_admin_manager on public.membership_plans
for insert to authenticated
with check (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
  and created_by = auth.uid()
);

drop policy if exists plans_update_admin_manager on public.membership_plans;
create policy plans_update_admin_manager on public.membership_plans
for update to authenticated
using (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
)
with check (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
);

drop policy if exists plans_delete_admin_manager on public.membership_plans;
create policy plans_delete_admin_manager on public.membership_plans
for delete to authenticated
using (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
);

drop policy if exists members_read_workspace on public.gym_members;
create policy members_read_workspace on public.gym_members
for select to authenticated
using (gym_id = private.current_gym_id());

drop policy if exists members_insert_admin_manager on public.gym_members;
create policy members_insert_admin_manager on public.gym_members
for insert to authenticated
with check (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
  and created_by = auth.uid()
);

drop policy if exists members_update_admin_manager on public.gym_members;
create policy members_update_admin_manager on public.gym_members
for update to authenticated
using (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
)
with check (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
);

drop policy if exists members_delete_admin_manager on public.gym_members;
create policy members_delete_admin_manager on public.gym_members
for delete to authenticated
using (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
);

drop policy if exists dues_read_workspace on public.membership_dues;
create policy dues_read_workspace on public.membership_dues
for select to authenticated
using (gym_id = private.current_gym_id());

drop policy if exists dues_insert_admin_manager on public.membership_dues;
create policy dues_insert_admin_manager on public.membership_dues
for insert to authenticated
with check (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
  and created_by = auth.uid()
);

drop policy if exists dues_update_admin_manager on public.membership_dues;
create policy dues_update_admin_manager on public.membership_dues
for update to authenticated
using (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
)
with check (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
);

drop policy if exists dues_delete_admin_manager on public.membership_dues;
create policy dues_delete_admin_manager on public.membership_dues
for delete to authenticated
using (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
);

drop policy if exists payments_read_workspace on public.payments;
create policy payments_read_workspace on public.payments
for select to authenticated
using (gym_id = private.current_gym_id());

drop policy if exists payments_insert_members on public.payments;
create policy payments_insert_members on public.payments
for insert to authenticated
with check (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager', 'staff']::text[])
  and created_by = auth.uid()
);

drop policy if exists payments_update_admin_manager on public.payments;
create policy payments_update_admin_manager on public.payments
for update to authenticated
using (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
)
with check (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
);

drop policy if exists payments_delete_admin_manager on public.payments;
create policy payments_delete_admin_manager on public.payments
for delete to authenticated
using (
  gym_id = private.current_gym_id()
  and private.has_gym_role(gym_id, array['admin', 'manager']::text[])
);

-- Keep the default PostgREST grants explicit. User/profile/role writes are server-only.
grant select on public.gyms, public.profiles, public.gym_users to authenticated;
grant select, insert, update, delete on public.membership_plans, public.gym_members,
  public.membership_dues, public.payments to authenticated;

-- Private workspace file bucket used only if the UI later enables file uploads.
insert into storage.buckets (id, name, public)
values ('repcount-files', 'repcount-files', false)
on conflict (id) do nothing;

drop policy if exists repcount_files_read_workspace on storage.objects;
create policy repcount_files_read_workspace on storage.objects
for select to authenticated
using (
  bucket_id = 'repcount-files'
  and (storage.foldername(name))[1] = private.current_gym_id()::text
);

drop policy if exists repcount_files_insert_workspace on storage.objects;
create policy repcount_files_insert_workspace on storage.objects
for insert to authenticated
with check (
  bucket_id = 'repcount-files'
  and (storage.foldername(name))[1] = private.current_gym_id()::text
);

drop policy if exists repcount_files_update_workspace on storage.objects;
create policy repcount_files_update_workspace on storage.objects
for update to authenticated
using (
  bucket_id = 'repcount-files'
  and (storage.foldername(name))[1] = private.current_gym_id()::text
)
with check (
  bucket_id = 'repcount-files'
  and (storage.foldername(name))[1] = private.current_gym_id()::text
);

drop policy if exists repcount_files_delete_workspace on storage.objects;
create policy repcount_files_delete_workspace on storage.objects
for delete to authenticated
using (
  bucket_id = 'repcount-files'
  and (storage.foldername(name))[1] = private.current_gym_id()::text
);
-- <<< END MIGRATION: supabase/migrations/202610100001_initial_schema.sql

-- >>> BEGIN MIGRATION: supabase/migrations/202610100002_harden_function_privileges.sql
-- Tighten RPC grants. Supabase projects may have explicit per-role default grants
-- to anon/authenticated, so revoking PUBLIC alone is not sufficient.
REVOKE EXECUTE ON FUNCTION private.current_gym_id() FROM anon;
REVOKE EXECUTE ON FUNCTION private.has_gym_role(uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_summary(date) FROM anon;

-- These are trigger/internal routines and must not be directly callable via RPC.
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.normalize_due_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_workspace_links() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalculate_due_from_payments(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_due_after_payment_change() FROM PUBLIC, anon, authenticated;

-- Keep the required authenticated helper/summary calls available.
GRANT EXECUTE ON FUNCTION private.current_gym_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_gym_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(date) TO authenticated;
-- <<< END MIGRATION: supabase/migrations/202610100002_harden_function_privileges.sql

-- >>> BEGIN MIGRATION: supabase/migrations/202610100003_move_tenant_helpers_private.sql
-- Move tenant helper RPCs out of the API-exposed public schema.
-- The conditional makes this safe both for existing projects and fresh installs
-- whose initial schema already creates these functions in private.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.current_gym_id()') IS NOT NULL THEN
    ALTER FUNCTION public.current_gym_id() SET SCHEMA private;
  END IF;
  IF to_regprocedure('public.has_gym_role(uuid, text[])') IS NOT NULL THEN
    ALTER FUNCTION public.has_gym_role(uuid, text[]) SET SCHEMA private;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.current_gym_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_gym_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_gym_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_gym_role(uuid, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_summary(p_today date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'outstanding',
    coalesce((
      SELECT sum(d.balance_c)
      FROM public.membership_dues d
      WHERE d.gym_id = private.current_gym_id()
        AND d.balance_c > 0
        AND d.status_c <> 'Waived'
    ), 0),
    'due_today_balance',
    coalesce((
      SELECT sum(d.balance_c)
      FROM public.membership_dues d
      WHERE d.gym_id = private.current_gym_id()
        AND d.due_date_c = p_today
        AND d.balance_c > 0
        AND d.status_c <> 'Waived'
    ), 0),
    'collected_today',
    coalesce((
      SELECT sum(p.amount_c)
      FROM public.payments p
      WHERE p.gym_id = private.current_gym_id()
        AND p.paid_on_c = p_today
        AND p.status_c = 'Paid'
    ), 0)
  )
$$;

REVOKE ALL ON FUNCTION public.dashboard_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(date) TO authenticated;
-- <<< END MIGRATION: supabase/migrations/202610100003_move_tenant_helpers_private.sql

-- >>> BEGIN MIGRATION: supabase/migrations/202610100004_fix_workspace_link_trigger.sql
-- Fix the member/dues validation trigger without accessing dues-only record fields
-- while an INSERT/UPDATE is running on gym_members.
CREATE OR REPLACE FUNCTION public.validate_workspace_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $workspace$
BEGIN
  IF NEW.plan_c IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.membership_plans p
    WHERE p.id = NEW.plan_c
      AND p.gym_id = NEW.gym_id
  ) THEN
    RAISE EXCEPTION 'The selected membership plan does not belong to this gym.';
  END IF;

  IF TG_TABLE_NAME = 'membership_dues' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.gym_members m
      WHERE m.id = NEW.member_c
        AND m.gym_id = NEW.gym_id
    ) THEN
      RAISE EXCEPTION 'The selected member does not belong to this gym.';
    END IF;
  END IF;

  RETURN NEW;
END;
$workspace$;

REVOKE EXECUTE ON FUNCTION public.validate_workspace_links() FROM PUBLIC, anon, authenticated;
-- <<< END MIGRATION: supabase/migrations/202610100004_fix_workspace_link_trigger.sql

-- >>> BEGIN MIGRATION: supabase/migrations/20261010150000_secure_login_and_scale.sql
-- Three-attempt sign-in lockout and performance indexes for larger gym workspaces.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO service_role;
CREATE TABLE IF NOT EXISTS private.login_attempt_buckets (
  bucket_hash text PRIMARY KEY CHECK (bucket_hash ~ '^[a-f0-9]{64}$'),
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 3),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.login_attempt_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.login_attempt_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.login_attempt_buckets TO service_role;
CREATE INDEX IF NOT EXISTS login_attempt_buckets_updated_at_idx ON private.login_attempt_buckets (updated_at);

CREATE OR REPLACE FUNCTION public.login_lock_status(p_bucket_hash text)
RETURNS TABLE (is_locked boolean, attempts smallint, locked_until timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT coalesce(b.locked_until > now(), false), b.failed_attempts, b.locked_until
 FROM private.login_attempt_buckets AS b WHERE b.bucket_hash = p_bucket_hash AND p_bucket_hash ~ '^[a-f0-9]{64}$' $$;

CREATE OR REPLACE FUNCTION public.login_record_failure(p_bucket_hash text)
RETURNS TABLE (attempts smallint, locked_until timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE changed private.login_attempt_buckets%ROWTYPE;
BEGIN
 IF p_bucket_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid login throttle bucket.'; END IF;
 INSERT INTO private.login_attempt_buckets (bucket_hash, failed_attempts, locked_until, updated_at)
 VALUES (p_bucket_hash, 1, NULL, now())
 ON CONFLICT (bucket_hash) DO UPDATE
 SET failed_attempts = CASE
       WHEN private.login_attempt_buckets.locked_until > now() THEN 3
       WHEN private.login_attempt_buckets.locked_until IS NOT NULL THEN 1
       ELSE least(private.login_attempt_buckets.failed_attempts + 1, 3) END,
     locked_until = CASE
       WHEN private.login_attempt_buckets.locked_until > now() THEN private.login_attempt_buckets.locked_until
       WHEN private.login_attempt_buckets.locked_until IS NOT NULL THEN NULL
       WHEN private.login_attempt_buckets.failed_attempts + 1 >= 3 THEN now() + interval '24 hours'
       ELSE NULL END,
     updated_at = now()
 RETURNING * INTO changed;
 RETURN QUERY SELECT changed.failed_attempts, changed.locked_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.login_clear_failures(p_bucket_hash text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ DELETE FROM private.login_attempt_buckets WHERE bucket_hash = p_bucket_hash AND p_bucket_hash ~ '^[a-f0-9]{64}$' $$;
REVOKE ALL ON FUNCTION public.login_lock_status(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.login_record_failure(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.login_clear_failures(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_lock_status(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.login_record_failure(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.login_clear_failures(text) TO service_role;

CREATE INDEX IF NOT EXISTS gym_users_created_by_idx ON public.gym_users (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS gym_users_gym_status_role_idx ON public.gym_users (gym_id, status, role);
CREATE INDEX IF NOT EXISTS membership_plans_created_by_idx ON public.membership_plans (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS gym_members_plan_idx ON public.gym_members (plan_c) WHERE plan_c IS NOT NULL;
CREATE INDEX IF NOT EXISTS gym_members_created_by_idx ON public.gym_members (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS membership_dues_plan_idx ON public.membership_dues (plan_c) WHERE plan_c IS NOT NULL;
CREATE INDEX IF NOT EXISTS membership_dues_created_by_idx ON public.membership_dues (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_created_by_idx ON public.payments (created_by) WHERE created_by IS NOT NULL;

ALTER POLICY gyms_read_current_gym ON public.gyms USING (id = (SELECT private.current_gym_id()));
ALTER POLICY profiles_read_workspace ON public.profiles USING (
 id = (SELECT auth.uid()) OR (
  (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin']::text[]))
  AND EXISTS (SELECT 1 FROM public.gym_users AS other_user WHERE other_user.user_id = profiles.id
    AND other_user.gym_id = (SELECT private.current_gym_id()) AND other_user.status = 'active')
 ));
ALTER POLICY gym_users_read_workspace ON public.gym_users USING (
 gym_id = (SELECT private.current_gym_id()) AND (
  user_id = (SELECT auth.uid()) OR (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin']::text[]))
 ));
ALTER POLICY plans_read_workspace ON public.membership_plans USING (gym_id = (SELECT private.current_gym_id()));
ALTER POLICY plans_insert_admin_manager ON public.membership_plans WITH CHECK (
 gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[]))
 AND created_by = (SELECT auth.uid()));
ALTER POLICY plans_update_admin_manager ON public.membership_plans
 USING (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])))
 WITH CHECK (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])));
ALTER POLICY plans_delete_admin_manager ON public.membership_plans
 USING (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])));
ALTER POLICY members_read_workspace ON public.gym_members USING (gym_id = (SELECT private.current_gym_id()));
ALTER POLICY members_insert_admin_manager ON public.gym_members WITH CHECK (
 gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[]))
 AND created_by = (SELECT auth.uid()));
ALTER POLICY members_update_admin_manager ON public.gym_members
 USING (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])))
 WITH CHECK (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])));
ALTER POLICY members_delete_admin_manager ON public.gym_members
 USING (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])));
ALTER POLICY dues_read_workspace ON public.membership_dues USING (gym_id = (SELECT private.current_gym_id()));
ALTER POLICY dues_insert_admin_manager ON public.membership_dues WITH CHECK (
 gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[]))
 AND created_by = (SELECT auth.uid()));
ALTER POLICY dues_update_admin_manager ON public.membership_dues
 USING (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])))
 WITH CHECK (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])));
ALTER POLICY dues_delete_admin_manager ON public.membership_dues
 USING (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])));
ALTER POLICY payments_read_workspace ON public.payments USING (gym_id = (SELECT private.current_gym_id()));
ALTER POLICY payments_insert_members ON public.payments WITH CHECK (
 gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager','staff']::text[]))
 AND created_by = (SELECT auth.uid()));
ALTER POLICY payments_update_admin_manager ON public.payments
 USING (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])))
 WITH CHECK (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])));
ALTER POLICY payments_delete_admin_manager ON public.payments
 USING (gym_id = (SELECT private.current_gym_id()) AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[])));
-- <<< END MIGRATION: supabase/migrations/20261010150000_secure_login_and_scale.sql

-- >>> BEGIN MIGRATION: supabase/migrations/20261010151000_restrict_login_bucket_client_access.sql
-- Explicitly deny browser roles access to the private login attempt store.
-- Only the server-side secure-login function uses the service_role credential.
DROP POLICY IF EXISTS login_attempt_buckets_deny_client ON private.login_attempt_buckets;
CREATE POLICY login_attempt_buckets_deny_client
  ON private.login_attempt_buckets
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
REVOKE ALL ON TABLE private.login_attempt_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.login_attempt_buckets TO service_role;
-- <<< END MIGRATION: supabase/migrations/20261010151000_restrict_login_bucket_client_access.sql

-- >>> BEGIN MIGRATION: supabase/migrations/20261010182500_reconcile_existing_table_security.sql
-- Reconcile an installation whose business tables existed before the full RepCount
-- migrations. Fresh installations already have these unique constraints.
-- This migration is safe to rerun: it only adds missing constraints and revokes
-- public access to an optional privileged helper function.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.membership_plans'::regclass
      AND conname = 'membership_plans_gym_id_name_key'
  ) THEN
    ALTER TABLE public.membership_plans
      ADD CONSTRAINT membership_plans_gym_id_name_key UNIQUE (gym_id, name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.membership_dues'::regclass
      AND conname = 'membership_dues_gym_id_name_key'
  ) THEN
    ALTER TABLE public.membership_dues
      ADD CONSTRAINT membership_dues_gym_id_name_key UNIQUE (gym_id, name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass
      AND conname = 'payments_gym_id_name_key'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_gym_id_name_key UNIQUE (gym_id, name);
  END IF;

  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;
-- <<< END MIGRATION: supabase/migrations/20261010182500_reconcile_existing_table_security.sql

-- >>> BEGIN MIGRATION: supabase/migrations/20261011093000_restrict_public_table_grants.sql
-- RepCount least-privilege API role grants.
-- Previous schema initialization inherited broad Supabase default table grants:
-- both anon and authenticated had TRUNCATE, TRIGGER and REFERENCES rights.
-- PostgreSQL RLS does not protect TRUNCATE, so remove unsupported operations.
-- No rows are modified or removed by this migration.
--
-- This does not touch service_role, postgres, migrations or storage permissions.
REVOKE ALL PRIVILEGES ON TABLE
  public.gyms,
  public.gym_users,
  public.profiles,
  public.gym_members,
  public.membership_plans,
  public.membership_dues,
  public.payments
FROM anon, authenticated;

-- Users can read their own workspace metadata and permitted profiles.
-- RLS remains responsible for restricting rows.
GRANT SELECT ON TABLE public.gyms, public.gym_users, public.profiles
TO authenticated;

-- Business records are mutable according to existing admin/manager/staff RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.gym_members, public.membership_plans, public.membership_dues, public.payments
TO authenticated;

-- Abort if privileged operations or anonymous read access are still inherited.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'gyms', 'gym_users', 'profiles', 'gym_members',
    'membership_plans', 'membership_dues', 'payments'
  ]
  LOOP
    IF has_table_privilege('anon', format('public.%I', tbl), 'TRUNCATE')
      OR has_table_privilege('authenticated', format('public.%I', tbl), 'TRUNCATE')
      OR has_table_privilege('anon', format('public.%I', tbl), 'SELECT')
    THEN
      RAISE EXCEPTION 'Unsafe table privileges remain on %', tbl;
    END IF;
  END LOOP;
END $$;
-- <<< END MIGRATION: supabase/migrations/20261011093000_restrict_public_table_grants.sql

-- >>> BEGIN MIGRATION: supabase/migrations/20261011110000_membership_renewals.sql
-- Renewal-first membership accounting. No existing dues or payment records are deleted.
-- This is a separate ledger for paid-in-advance membership periods.
CREATE TABLE IF NOT EXISTS public.membership_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  gym_id uuid NOT NULL REFERENCES public.gyms(id),
  member_id uuid NOT NULL REFERENCES public.gym_members(id),
  plan_id uuid NOT NULL REFERENCES public.membership_plans(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT,
  paid_on date NOT NULL,
  started_on date NOT NULL,
  next_renewal_on date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT renewal_dates_in_order CHECK (next_renewal_on > started_on)
);
CREATE INDEX IF NOT EXISTS membership_renewals_gym_member_idx ON public.membership_renewals(gym_id,member_id,created_at DESC);
CREATE INDEX IF NOT EXISTS membership_renewals_gym_created_idx ON public.membership_renewals(gym_id,created_at DESC);
ALTER TABLE public.membership_renewals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS membership_renewals_read ON public.membership_renewals;
CREATE POLICY membership_renewals_read ON public.membership_renewals FOR SELECT TO authenticated
USING (gym_id = (SELECT private.current_gym_id()));
DROP POLICY IF EXISTS membership_renewals_insert ON public.membership_renewals;
CREATE POLICY membership_renewals_insert ON public.membership_renewals FOR INSERT TO authenticated
WITH CHECK (
  gym_id = (SELECT private.current_gym_id())
  AND created_by = (SELECT auth.uid())
  AND (SELECT private.has_gym_role((SELECT private.current_gym_id()), ARRAY['admin','manager']::text[]))
);
REVOKE ALL ON public.membership_renewals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.membership_renewals TO authenticated;

-- SECURITY INVOKER preserves the ordinary tenant RLS policies for all writes.
-- This function records a full upfront payment and extends renewal eligibility
-- in the SAME database transaction. A repeated request_id cannot double-charge.
CREATE OR REPLACE FUNCTION public.record_membership_renewal(
  p_member_id uuid,
  p_plan_id uuid,
  p_paid_on date,
  p_method text,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_member public.gym_members%ROWTYPE;
  v_plan public.membership_plans%ROWTYPE;
  v_gym uuid;
  v_user uuid;
  v_months integer;
  v_start date;
  v_target_month date;
  v_next date;
  v_payment_id uuid;
  v_event_id uuid;
  v_old public.membership_renewals%ROWTYPE;
  v_name text;
BEGIN
  v_user := auth.uid();
  v_gym := private.current_gym_id();
  IF v_user IS NULL OR v_gym IS NULL OR NOT private.has_gym_role(v_gym,ARRAY['admin','manager']::text[]) THEN
    RAISE EXCEPTION 'An active Admin or Manager must record a membership renewal';
  END IF;
  IF p_member_id IS NULL OR p_plan_id IS NULL OR p_request_id IS NULL OR p_paid_on IS NULL
     OR p_method NOT IN ('Cash','UPI','Card','Bank transfer')
     OR p_paid_on > current_date OR p_paid_on < current_date - 365 THEN
    RAISE EXCEPTION 'Invalid renewal date, plan, payment method or request';
  END IF;
  SELECT * INTO v_old FROM public.membership_renewals
    WHERE request_id = p_request_id AND gym_id = v_gym;
  IF FOUND THEN
    RETURN jsonb_build_object('id',v_old.id,'paymentId',v_old.payment_id,
      'startDate',v_old.started_on,'nextRenewalDate',v_old.next_renewal_on,'alreadyRecorded',true);
  END IF;
  SELECT * INTO v_member FROM public.gym_members
    WHERE id = p_member_id AND gym_id = v_gym FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This member does not belong to your gym'; END IF;
  SELECT * INTO v_plan FROM public.membership_plans
    WHERE id = p_plan_id AND gym_id = v_gym AND active_c = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active plan from your gym'; END IF;
  IF v_plan.duration_c !~ '^([0-9]{1,2}) months?$' THEN
    RAISE EXCEPTION 'Unsupported plan duration; use 1–36 months';
  END IF;
  v_months := split_part(v_plan.duration_c,' ',1)::integer;
  IF v_months < 1 OR v_months > 36 THEN RAISE EXCEPTION 'Unsupported plan duration'; END IF;

  v_start := greatest(p_paid_on,coalesce(v_member.due_date_c,p_paid_on));
  v_target_month := (date_trunc('month',v_start::timestamp) + make_interval(months => v_months))::date;
  v_next := v_target_month
    + (least(extract(day from v_start)::integer,
       extract(day from (v_target_month + interval '1 month - 1 day')::date)::integer) - 1);
  v_name := 'REN-' || replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.payments (gym_id,name,member_c,due_c,amount_c,paid_on_c,method_c,status_c,notes_c,created_by)
  VALUES(v_gym,v_name,p_member_id,NULL,v_plan.price_c,p_paid_on,p_method,'Paid',
      'Membership renewal: ' || v_plan.name,v_user)
  RETURNING id INTO v_payment_id;

  UPDATE public.gym_members
  SET plan_c = p_plan_id, due_date_c = v_next, status_c = 'Active'
  WHERE id = p_member_id AND gym_id = v_gym;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member renewal update was not permitted'; END IF;

  INSERT INTO public.membership_renewals
    (request_id,gym_id,member_id,plan_id,payment_id,paid_on,started_on,next_renewal_on,amount,created_by)
  VALUES(p_request_id,v_gym,p_member_id,p_plan_id,v_payment_id,p_paid_on,v_start,v_next,v_plan.price_c,v_user)
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('id',v_event_id,'paymentId',v_payment_id,
    'startDate',v_start,'nextRenewalDate',v_next,'alreadyRecorded',false);
END;
$$;
REVOKE ALL ON FUNCTION public.record_membership_renewal(uuid,uuid,date,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_membership_renewal(uuid,uuid,date,text,uuid) TO authenticated;
-- <<< END MIGRATION: supabase/migrations/20261011110000_membership_renewals.sql

-- >>> BEGIN MIGRATION: supabase/migrations/20261011120000_indexed_bounded_directory_api.sql
-- Indexes and bounded tenant-scoped API for directories, renewals and ledgers.
-- The functions are SECURITY INVOKER: RLS and ordinary grants apply.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS gym_members_gym_renewal_idx
  ON public.gym_members (gym_id, due_date_c, id) INCLUDE (status_c, plan_c);
CREATE INDEX IF NOT EXISTS gym_members_gym_phone_idx
  ON public.gym_members (gym_id, phone_c);
CREATE INDEX IF NOT EXISTS gym_members_name_trgm_idx
  ON public.gym_members USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gym_members_phone_trgm_idx
  ON public.gym_members USING gin (phone_c extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS payments_gym_date_id_idx
  ON public.payments (gym_id, paid_on_c DESC, id DESC);
CREATE INDEX IF NOT EXISTS membership_dues_gym_due_id_idx
  ON public.membership_dues (gym_id, due_date_c, id);
CREATE INDEX IF NOT EXISTS membership_renewals_created_by_idx
  ON public.membership_renewals (created_by);
CREATE INDEX IF NOT EXISTS membership_renewals_member_fk_idx
  ON public.membership_renewals (member_id);
CREATE INDEX IF NOT EXISTS membership_renewals_plan_fk_idx
  ON public.membership_renewals (plan_id);

CREATE OR REPLACE FUNCTION public.repcount_members_page(
 p_search text DEFAULT '',
 p_state text DEFAULT 'all',
 p_page integer DEFAULT 1,
 p_page_size integer DEFAULT 25,
 p_today date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
 g uuid := private.current_gym_id();
 term text := left(trim(coalesce(p_search,'')),80);
 safe_pattern text;
 n integer := least(100,greatest(1,coalesce(p_page_size,25)));
 off_rows integer := (least(100000,greatest(1,coalesce(p_page,1)))-1)*n;
 data jsonb;
BEGIN
 IF g IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Gym login required'; END IF;
 IF coalesce(p_state,'all') NOT IN ('all','active','soon','today','expired','inactive','not-set') THEN
   RAISE EXCEPTION 'Invalid renewal status filter';
 END IF;
 IF length(trim(coalesce(p_search,'')))>80 THEN RAISE EXCEPTION 'Search term too long'; END IF;
 safe_pattern := '%' || replace(replace(replace(term,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_') || '%';
 WITH pool AS MATERIALIZED (
   SELECT m.id,m.name,m.phone_c,m.email_c,m.plan_c,m.due_date_c,m.status_c,
          p.name plan_name,p.price_c plan_price,p.duration_c plan_duration,p.active_c plan_active,
          CASE WHEN m.status_c='Inactive' THEN 'inactive'
            WHEN m.due_date_c IS NULL THEN 'not-set'
            WHEN m.due_date_c<p_today THEN 'expired'
            WHEN m.due_date_c=p_today THEN 'today'
            WHEN m.due_date_c<=p_today+7 THEN 'soon'
            ELSE 'active' END state
   FROM public.gym_members m
   LEFT JOIN public.membership_plans p ON p.id=m.plan_c AND p.gym_id=g
   WHERE m.gym_id=g
 ), matched AS MATERIALIZED (
   SELECT * FROM pool x
   WHERE ((p_state='all' OR x.state=p_state OR (p_state='soon' AND x.state='today'))
     AND (term='' OR x.name ILIKE safe_pattern OR coalesce(x.phone_c,'') ILIKE safe_pattern
           OR coalesce(x.email_c,'') ILIKE safe_pattern))
 ), page_rows AS (
   SELECT * FROM matched ORDER BY due_date_c ASC NULLS LAST,name,id LIMIT n OFFSET off_rows
 )
 SELECT jsonb_build_object(
  'total',(SELECT count(*) FROM matched),
  'stats',(SELECT jsonb_build_object(
    'active',count(*) FILTER(WHERE state IN ('active','soon','today')),
    'soon',count(*) FILTER(WHERE state IN ('soon','today')),
    'today',count(*) FILTER(WHERE state='today'),
    'expired',count(*) FILTER(WHERE state='expired'),
    'noDate',count(*) FILTER(WHERE state='not-set'),
    'inactive',count(*) FILTER(WHERE state='inactive')
   ) FROM pool),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'Id',id,'Name',name,'phone_c',phone_c,'email_c',email_c,'due_date_c',due_date_c,
   'status_c',status_c,'renewalState',state,
   'plan_c',CASE WHEN plan_c IS NULL THEN NULL ELSE jsonb_build_object(
      'Id',plan_c,'Name',plan_name,'price_c',plan_price,'duration_c',plan_duration,'active_c',plan_active) END
  ) ORDER BY due_date_c ASC NULLS LAST,name,id) FROM page_rows),'[]'::jsonb)
 ) INTO data;
 RETURN data;
END;
$$;
REVOKE ALL ON FUNCTION public.repcount_members_page(text,text,integer,integer,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repcount_members_page(text,text,integer,integer,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.repcount_ledger_page(
 p_kind text, p_search text DEFAULT '', p_status text DEFAULT 'All',
 p_period text DEFAULT 'all', p_page integer DEFAULT 1, p_page_size integer DEFAULT 25,
 p_today date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
 g uuid := private.current_gym_id();
 term text := trim(coalesce(p_search,''));
 pattern text;
 n integer := least(100,greatest(1,coalesce(p_page_size,25)));
 off_rows integer := (least(100000,greatest(1,coalesce(p_page,1)))-1)*n;
 result jsonb;
BEGIN
 IF g IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Gym login required'; END IF;
 IF length(term)>80 THEN RAISE EXCEPTION 'Search term too long'; END IF;
 pattern := '%' || replace(replace(replace(term,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_') || '%';
 IF p_kind='payments' THEN
  IF p_status NOT IN ('All','Paid','Pending','Refunded') OR p_period NOT IN ('all','today') THEN
   RAISE EXCEPTION 'Invalid payment filter';
  END IF;
  WITH matched AS MATERIALIZED (
   SELECT p.*, m.name AS member_name,m.phone_c AS member_phone
   FROM public.payments p
   LEFT JOIN public.gym_members m ON m.id=p.member_c AND m.gym_id=g
   WHERE p.gym_id=g AND (p_status='All' OR p.status_c=p_status)
    AND (p_period='all' OR p.paid_on_c=p_today)
    AND (term='' OR p.name ILIKE pattern OR p.method_c ILIKE pattern
              OR coalesce(m.name,'') ILIKE pattern OR coalesce(m.phone_c,'') ILIKE pattern)
  ), page_rows AS (
   SELECT * FROM matched ORDER BY paid_on_c DESC,id DESC LIMIT n OFFSET off_rows
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),
   'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'Id',id,'Name',name,'member_c',CASE WHEN member_c IS NULL THEN NULL ELSE
      jsonb_build_object('Id',member_c,'Name',member_name,'phone_c',member_phone) END,
    'amount_c',amount_c,'paid_on_c',paid_on_c,'method_c',method_c,'status_c',status_c
   ) ORDER BY paid_on_c DESC,id DESC) FROM page_rows),'[]'::jsonb)) INTO result;
 ELSIF p_kind='dues' THEN
  IF p_period NOT IN ('all','today','week','overdue') THEN RAISE EXCEPTION 'Invalid due filter'; END IF;
  WITH matched AS MATERIALIZED (
   SELECT d.*,m.name member_name,m.phone_c member_phone,pl.name plan_name
   FROM public.membership_dues d
   JOIN public.gym_members m ON m.id=d.member_c AND m.gym_id=g
   LEFT JOIN public.membership_plans pl ON pl.id=d.plan_c AND pl.gym_id=g
   WHERE d.gym_id=g AND d.balance_c>0 AND d.status_c<>'Waived'
    AND (p_period='all' OR
      (p_period='today' AND d.due_date_c=p_today) OR
      (p_period='overdue' AND d.due_date_c<p_today) OR
      (p_period='week' AND d.due_date_c>p_today
       AND d.due_date_c<=p_today + ((7-extract(isodow from p_today)::integer)%7)))
    AND (term='' OR d.name ILIKE pattern OR m.name ILIKE pattern OR coalesce(m.phone_c,'') ILIKE pattern)
  ), page_rows AS (
   SELECT * FROM matched ORDER BY due_date_c ASC,id ASC LIMIT n OFFSET off_rows
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),
   'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'Id',id,'Name',name,'member_c',jsonb_build_object('Id',member_c,'Name',member_name,'phone_c',member_phone),
    'plan_c',CASE WHEN plan_c IS NULL THEN NULL ELSE jsonb_build_object('Id',plan_c,'Name',plan_name) END,
    'due_date_c',due_date_c,'balance_c',balance_c,'status_c',status_c
   ) ORDER BY due_date_c ASC,id ASC) FROM page_rows),'[]'::jsonb)) INTO result;
 ELSE
   RAISE EXCEPTION 'Invalid ledger type';
 END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.repcount_ledger_page(text,text,text,text,integer,integer,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repcount_ledger_page(text,text,text,text,integer,integer,date) TO authenticated;
-- <<< END MIGRATION: supabase/migrations/20261011120000_indexed_bounded_directory_api.sql

-- >>> BEGIN MIGRATION: supabase/migrations/20261011121500_fix_search_escaping.sql
-- Follow-up for projects that already applied the first paginated API migration.
CREATE OR REPLACE FUNCTION public.repcount_members_page(
 p_search text DEFAULT '',
 p_state text DEFAULT 'all',
 p_page integer DEFAULT 1,
 p_page_size integer DEFAULT 25,
 p_today date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
 g uuid := private.current_gym_id();
 term text := left(trim(coalesce(p_search,'')),80);
 safe_pattern text;
 n integer := least(100,greatest(1,coalesce(p_page_size,25)));
 off_rows integer := (least(100000,greatest(1,coalesce(p_page,1)))-1)*n;
 data jsonb;
BEGIN
 IF g IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Gym login required'; END IF;
 IF coalesce(p_state,'all') NOT IN ('all','active','soon','today','expired','inactive','not-set') THEN
   RAISE EXCEPTION 'Invalid renewal status filter';
 END IF;
 IF length(trim(coalesce(p_search,'')))>80 THEN RAISE EXCEPTION 'Search term too long'; END IF;
 safe_pattern := '%' || replace(replace(replace(term,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_') || '%';
 WITH pool AS MATERIALIZED (
   SELECT m.id,m.name,m.phone_c,m.email_c,m.plan_c,m.due_date_c,m.status_c,
          p.name plan_name,p.price_c plan_price,p.duration_c plan_duration,p.active_c plan_active,
          CASE WHEN m.status_c='Inactive' THEN 'inactive'
            WHEN m.due_date_c IS NULL THEN 'not-set'
            WHEN m.due_date_c<p_today THEN 'expired'
            WHEN m.due_date_c=p_today THEN 'today'
            WHEN m.due_date_c<=p_today+7 THEN 'soon'
            ELSE 'active' END state
   FROM public.gym_members m
   LEFT JOIN public.membership_plans p ON p.id=m.plan_c AND p.gym_id=g
   WHERE m.gym_id=g
 ), matched AS MATERIALIZED (
   SELECT * FROM pool x
   WHERE ((p_state='all' OR x.state=p_state OR (p_state='soon' AND x.state='today'))
     AND (term='' OR x.name ILIKE safe_pattern OR coalesce(x.phone_c,'') ILIKE safe_pattern
           OR coalesce(x.email_c,'') ILIKE safe_pattern))
 ), page_rows AS (
   SELECT * FROM matched ORDER BY due_date_c ASC NULLS LAST,name,id LIMIT n OFFSET off_rows
 )
 SELECT jsonb_build_object(
  'total',(SELECT count(*) FROM matched),
  'stats',(SELECT jsonb_build_object(
    'active',count(*) FILTER(WHERE state IN ('active','soon','today')),
    'soon',count(*) FILTER(WHERE state IN ('soon','today')),
    'today',count(*) FILTER(WHERE state='today'),
    'expired',count(*) FILTER(WHERE state='expired'),
    'noDate',count(*) FILTER(WHERE state='not-set'),
    'inactive',count(*) FILTER(WHERE state='inactive')
   ) FROM pool),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'Id',id,'Name',name,'phone_c',phone_c,'email_c',email_c,'due_date_c',due_date_c,
   'status_c',status_c,'renewalState',state,
   'plan_c',CASE WHEN plan_c IS NULL THEN NULL ELSE jsonb_build_object(
      'Id',plan_c,'Name',plan_name,'price_c',plan_price,'duration_c',plan_duration,'active_c',plan_active) END
  ) ORDER BY due_date_c ASC NULLS LAST,name,id) FROM page_rows),'[]'::jsonb)
 ) INTO data;
 RETURN data;
END;
$$;

CREATE OR REPLACE FUNCTION public.repcount_ledger_page(
 p_kind text, p_search text DEFAULT '', p_status text DEFAULT 'All',
 p_period text DEFAULT 'all', p_page integer DEFAULT 1, p_page_size integer DEFAULT 25,
 p_today date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
 g uuid := private.current_gym_id();
 term text := trim(coalesce(p_search,''));
 pattern text;
 n integer := least(100,greatest(1,coalesce(p_page_size,25)));
 off_rows integer := (least(100000,greatest(1,coalesce(p_page,1)))-1)*n;
 result jsonb;
BEGIN
 IF g IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Gym login required'; END IF;
 IF length(term)>80 THEN RAISE EXCEPTION 'Search term too long'; END IF;
 pattern := '%' || replace(replace(replace(term,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_') || '%';
 IF p_kind='payments' THEN
  IF p_status NOT IN ('All','Paid','Pending','Refunded') OR p_period NOT IN ('all','today') THEN
   RAISE EXCEPTION 'Invalid payment filter';
  END IF;
  WITH matched AS MATERIALIZED (
   SELECT p.*, m.name AS member_name,m.phone_c AS member_phone
   FROM public.payments p
   LEFT JOIN public.gym_members m ON m.id=p.member_c AND m.gym_id=g
   WHERE p.gym_id=g AND (p_status='All' OR p.status_c=p_status)
    AND (p_period='all' OR p.paid_on_c=p_today)
    AND (term='' OR p.name ILIKE pattern OR p.method_c ILIKE pattern
              OR coalesce(m.name,'') ILIKE pattern OR coalesce(m.phone_c,'') ILIKE pattern)
  ), page_rows AS (
   SELECT * FROM matched ORDER BY paid_on_c DESC,id DESC LIMIT n OFFSET off_rows
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),
   'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'Id',id,'Name',name,'member_c',CASE WHEN member_c IS NULL THEN NULL ELSE
      jsonb_build_object('Id',member_c,'Name',member_name,'phone_c',member_phone) END,
    'amount_c',amount_c,'paid_on_c',paid_on_c,'method_c',method_c,'status_c',status_c
   ) ORDER BY paid_on_c DESC,id DESC) FROM page_rows),'[]'::jsonb)) INTO result;
 ELSIF p_kind='dues' THEN
  IF p_period NOT IN ('all','today','week','overdue') THEN RAISE EXCEPTION 'Invalid due filter'; END IF;
  WITH matched AS MATERIALIZED (
   SELECT d.*,m.name member_name,m.phone_c member_phone,pl.name plan_name
   FROM public.membership_dues d
   JOIN public.gym_members m ON m.id=d.member_c AND m.gym_id=g
   LEFT JOIN public.membership_plans pl ON pl.id=d.plan_c AND pl.gym_id=g
   WHERE d.gym_id=g AND d.balance_c>0 AND d.status_c<>'Waived'
    AND (p_period='all' OR
      (p_period='today' AND d.due_date_c=p_today) OR
      (p_period='overdue' AND d.due_date_c<p_today) OR
      (p_period='week' AND d.due_date_c>p_today
       AND d.due_date_c<=p_today + ((7-extract(isodow from p_today)::integer)%7)))
    AND (term='' OR d.name ILIKE pattern OR m.name ILIKE pattern OR coalesce(m.phone_c,'') ILIKE pattern)
  ), page_rows AS (
   SELECT * FROM matched ORDER BY due_date_c ASC,id ASC LIMIT n OFFSET off_rows
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),
   'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'Id',id,'Name',name,'member_c',jsonb_build_object('Id',member_c,'Name',member_name,'phone_c',member_phone),
    'plan_c',CASE WHEN plan_c IS NULL THEN NULL ELSE jsonb_build_object('Id',plan_c,'Name',plan_name) END,
    'due_date_c',due_date_c,'balance_c',balance_c,'status_c',status_c
   ) ORDER BY due_date_c ASC,id ASC) FROM page_rows),'[]'::jsonb)) INTO result;
 ELSE
   RAISE EXCEPTION 'Invalid ledger type';
 END IF;
 RETURN result;
END;
$$;
-- <<< END MIGRATION: supabase/migrations/20261011121500_fix_search_escaping.sql

COMMIT;
