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
