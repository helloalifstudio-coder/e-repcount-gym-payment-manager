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
