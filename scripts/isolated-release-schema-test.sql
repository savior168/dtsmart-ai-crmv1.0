-- Runs only against the disposable Supabase database started by CI.
\set ON_ERROR_STOP on
begin;

do $$
declare
  missing text[];
begin
  select array_agg(required.column_name order by required.table_name, required.column_name)
    into missing
  from (values
    ('customers','shipping_address'),
    ('customers','manual_grade'),
    ('sales_orders','show_dual_currency_prices'),
    ('sales_orders','prepared_by'),
    ('sales_orders','last_balance_cny'),
    ('sales_orders','discount_cny'),
    ('sales_orders','other_charge_cny'),
    ('sales_orders','paypal_fee_percent'),
    ('sales_order_items','unit_price_source'),
    ('quote_items','unit_price_source'),
    ('pi_payment_accounts','payment_channel')
  ) as required(table_name,column_name)
  left join information_schema.columns actual
    on actual.table_schema='public' and actual.table_name=required.table_name
      and actual.column_name=required.column_name
  where actual.column_name is null;
  if missing is not null then
    raise exception 'Required release columns missing: %', missing;
  end if;

  if not exists (select 1 from pg_constraint
    where conname='users_role_v5_check' and pg_get_constraintdef(oid) like '%ORDER_CLERK%') then
    raise exception 'ORDER_CLERK role constraint missing';
  end if;

  if not exists (select 1 from public.role_permission_settings
    where role_code='ORDER_CLERK' and permission_code='orders.create' and enabled) then
    raise exception 'ORDER_CLERK PI create permission missing';
  end if;

  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='sales_orders'
      and policyname='sales_orders_scope_select_v8') then
    raise exception 'ORDER_CLERK scoped PI read policy missing';
  end if;

  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sales_orders' and c.relrowsecurity) then
    raise exception 'PI row-level security disabled';
  end if;

  if not has_function_privilege('authenticated',
    'public.create_direct_pi_order_with_fees(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb,uuid)',
    'EXECUTE') then
    raise exception 'Fee-aware PI creator is not callable by authenticated users';
  end if;

  if has_function_privilege('authenticated',
    'public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)',
    'EXECUTE') then
    raise exception 'Legacy direct PI creator remains callable';
  end if;
end $$;

rollback;
