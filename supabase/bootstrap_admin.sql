-- ONE-TIME FIRST-ADMIN BOOTSTRAP
-- Before running this script, create the first user in Supabase Authentication > Users.
-- Enable "Auto Confirm User" for that account, then replace both placeholders below.
-- Run this only once for a brand-new RepCount workspace. Never paste passwords or API keys here.

do $$
declare
  admin_email text := lower('REPLACE_WITH_FIRST_ADMIN_EMAIL');
  gym_name text := 'REPLACE_WITH_GYM_NAME';
  new_user_id uuid;
  new_gym_id uuid;
  confirmed_at timestamptz;
begin
  if admin_email like '%REPLACE_WITH%' or gym_name like '%REPLACE_WITH%' then
    raise exception 'Replace the gym name and Admin email placeholders before running bootstrap.';
  end if;
  if length(trim(gym_name)) < 1 or length(gym_name) > 100 then
    raise exception 'Enter a valid gym name (1–100 characters).';
  end if;
  if exists (select 1 from public.gyms) then
    raise exception 'This Supabase project already contains a gym. Use a NEW project for each gym.';
  end if;

  select u.id, u.email_confirmed_at
    into new_user_id, confirmed_at
  from auth.users u
  where lower(u.email) = admin_email
  limit 1;

  if new_user_id is null then
    raise exception 'Create and auto-confirm the first Admin in Supabase Auth before running this script.';
  end if;

  if confirmed_at is null then
    raise exception 'The first Admin must have a confirmed email. Confirm the account in Supabase Auth first.';
  end if;

  if exists (select 1 from public.gym_users gu where gu.user_id = new_user_id) then
    raise exception 'This user already has a RepCount workspace role; bootstrap was not repeated.';
  end if;

  insert into public.gyms (name)
  values (gym_name)
  returning id into new_gym_id;

  insert into public.profiles (id, email, first_name, last_name)
  select
    u.id,
    coalesce(u.email, admin_email),
    coalesce(u.raw_user_meta_data ->> 'first_name', ''),
    coalesce(u.raw_user_meta_data ->> 'last_name', '')
  from auth.users u
  where u.id = new_user_id
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  insert into public.gym_users (gym_id, user_id, role, status, created_by)
  values (new_gym_id, new_user_id, 'admin', 'active', new_user_id);
end;
$$;
