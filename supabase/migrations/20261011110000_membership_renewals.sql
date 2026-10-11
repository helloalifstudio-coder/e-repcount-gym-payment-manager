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
