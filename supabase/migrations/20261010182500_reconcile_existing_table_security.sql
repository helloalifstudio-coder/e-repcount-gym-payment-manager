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
