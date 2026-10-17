-- Additional customer-facing PI amounts are snapshotted in both currencies.
-- Keep the original RPCs for existing imports; new wrappers update totals in
-- the same database transaction as draft creation or revision.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.sales_orders
  add column show_dual_currency_prices boolean not null default false,
  add column last_balance_cny numeric(14,2) not null default 0,
  add column last_balance_amount numeric(14,2) not null default 0,
  add column last_balance_source text not null default 'CNY' check (last_balance_source in ('CNY','PAYMENT')),
  add column discount_cny numeric(14,2) not null default 0,
  add column discount_amount numeric(14,2) not null default 0,
  add column discount_source text not null default 'CNY' check (discount_source in ('CNY','PAYMENT')),
  add column other_charge_cny numeric(14,2) not null default 0,
  add column other_charge_amount numeric(14,2) not null default 0,
  add column other_charge_source text not null default 'CNY' check (other_charge_source in ('CNY','PAYMENT')),
  add column paypal_fee_percent numeric(7,4) not null default 0,
  add column paypal_fee_cny numeric(14,2) not null default 0,
  add column paypal_fee_amount numeric(14,2) not null default 0;
alter table public.quotes
  add column last_balance_cny numeric(14,2) not null default 0,
  add column last_balance_amount numeric(14,2) not null default 0,
  add column last_balance_source text not null default 'CNY' check (last_balance_source in ('CNY','PAYMENT')),
  add column discount_cny numeric(14,2) not null default 0,
  add column discount_amount numeric(14,2) not null default 0,
  add column discount_source text not null default 'CNY' check (discount_source in ('CNY','PAYMENT')),
  add column other_charge_cny numeric(14,2) not null default 0,
  add column other_charge_amount numeric(14,2) not null default 0,
  add column other_charge_source text not null default 'CNY' check (other_charge_source in ('CNY','PAYMENT')),
  add column paypal_fee_percent numeric(7,4) not null default 0,
  add column paypal_fee_cny numeric(14,2) not null default 0,
  add column paypal_fee_amount numeric(14,2) not null default 0;

alter table public.sales_orders add constraint sales_orders_pi_fees_nonnegative_check check (
  last_balance_cny >= 0 and last_balance_amount >= 0 and discount_cny >= 0 and discount_amount >= 0
  and other_charge_cny >= 0 and other_charge_amount >= 0 and paypal_fee_percent between 0 and 100
  and paypal_fee_cny >= 0 and paypal_fee_amount >= 0);
alter table public.quotes add constraint quotes_pi_fees_nonnegative_check check (
  last_balance_cny >= 0 and last_balance_amount >= 0 and discount_cny >= 0 and discount_amount >= 0
  and other_charge_cny >= 0 and other_charge_amount >= 0 and paypal_fee_percent between 0 and 100
  and paypal_fee_cny >= 0 and paypal_fee_amount >= 0);

alter table public.quote_items add column unit_price_source text not null default 'CNY'
  check (unit_price_source in ('CNY','PAYMENT'));
alter table public.sales_order_items add column unit_price_source text not null default 'CNY'
  check (unit_price_source in ('CNY','PAYMENT'));
-- Existing bank accounts retain their current behavior until an administrator
-- explicitly assigns them to another payment channel.
alter table public.pi_payment_accounts add column payment_channel text not null default 'T/T Bank Transfer'
  check (payment_channel in ('T/T Bank Transfer','Alipay','PayPal','Wise Transfer','Payoneer Transfer','OTHER'));

create function public.assert_pi_payment_account(p_account_id uuid, p_method text)
returns void language plpgsql security definer set search_path = '' as $$
declare account public.pi_payment_accounts; channel text;
begin
  channel := case when p_method in ('T/T Bank Transfer','Alipay','PayPal','Wise Transfer','Payoneer Transfer')
    then p_method else 'OTHER' end;
  select * into account from public.pi_payment_accounts where id = p_account_id and active = true for share;
  if account.id is null or nullif(trim(coalesce(p_method,'')),'') is null
    or account.payment_channel is distinct from channel then
    raise exception '付款渠道与收款账户不匹配，请重新选择';
  end if;
end $$;
revoke all on function public.assert_pi_payment_account(uuid,text) from public, anon, authenticated;

do $$
declare definition text; updated text;
begin
  definition := pg_get_functiondef('public.submit_direct_pi_order(uuid,integer)'::regprocedure);
  updated := replace(definition,
    'and a.active=true) then',
    'and a.active=true and a.payment_channel=(case when target.payment_method in (''T/T Bank Transfer'',''Alipay'',''PayPal'',''Wise Transfer'',''Payoneer Transfer'') then target.payment_method else ''OTHER'' end)) then');
  if updated = definition then raise exception 'PI submit payment-account guard changed; review migration'; end if;
  execute updated;
end $$;

-- The legacy direct-PI functions derive foreign price from CNY. Correct each
-- line in this transaction when the salesperson entered the foreign price.
create function public.apply_direct_pi_unit_prices(p_order_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.sales_orders; v_subtotal_cny numeric; v_subtotal_payment numeric;
begin
  select * into target from public.sales_orders where id = p_order_id for update;
  if target.id is null or target.confirmation_method <> 'DIRECT_PI' or target.status <> 'DRAFT'
    or target.fx_rate_cny_to_payment is null or target.fx_rate_cny_to_payment <= 0
    or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'PI草稿单价不可更新';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(unit_price_cny numeric,unit_price_payment numeric,unit_price_source text)
    where x.unit_price_source not in ('CNY','PAYMENT') or x.unit_price_source is null
      or x.unit_price_payment is null or x.unit_price_payment < 0
      or x.unit_price_payment <> round(x.unit_price_payment,2)
      or case when x.unit_price_source = 'PAYMENT'
        then x.unit_price_cny <> round(x.unit_price_payment/target.fx_rate_cny_to_payment,2)
        else x.unit_price_payment <> round(x.unit_price_cny*target.fx_rate_cny_to_payment,2) end
  ) then raise exception 'PI产品行的人民币与外币单价或汇率不一致'; end if;
  update public.quote_items qi set
    unit_price = input.unit_price_payment,
    unit_price_source = input.unit_price_source
  from (
    select x.ordinality as line_number, y.unit_price_payment, y.unit_price_source
    from jsonb_array_elements(p_items) with ordinality as x(value,ordinality)
    cross join lateral jsonb_to_record(x.value) as y(unit_price_payment numeric,unit_price_source text)
  ) input where qi.quote_id = target.quote_id and qi.line_number = input.line_number;
  update public.sales_order_items soi set
    unit_price = qi.unit_price, unit_price_source = qi.unit_price_source
  from public.quote_items qi where soi.sales_order_id = target.id and qi.quote_id = target.quote_id
    and soi.line_number = qi.line_number;
  select coalesce(sum(qi.quantity * qi.unit_price_cny),0), coalesce(sum(qi.amount),0)
    into v_subtotal_cny,v_subtotal_payment from public.quote_items qi where qi.quote_id = target.quote_id;
  update public.sales_orders set subtotal_cny = v_subtotal_cny, subtotal = v_subtotal_payment,
    total_cny = v_subtotal_cny + shipping_cny, total_amount = v_subtotal_payment + shipping_cost
  where id = target.id;
  update public.quotes set subtotal_cny = v_subtotal_cny, subtotal = v_subtotal_payment,
    total_cny = v_subtotal_cny + shipping_cny, total_amount = v_subtotal_payment + shipping_cost,
    amount = v_subtotal_payment + shipping_cost
  where id = target.quote_id;
end $$;
revoke all on function public.apply_direct_pi_unit_prices(uuid,jsonb) from public, anon, authenticated;

create function public.pi_fee_pair(p_value jsonb, p_fx_rate numeric)
returns numeric[] language plpgsql immutable set search_path = '' as $$
declare
  source text := coalesce(p_value->>'source', 'CNY');
  amount numeric;
begin
  if p_fx_rate is null or p_fx_rate <= 0 or p_value is null or jsonb_typeof(p_value) <> 'object'
    or coalesce(p_value->>'amount', '') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$'
    or source not in ('CNY', 'PAYMENT') then
    raise exception 'PI附加费用格式不正确';
  end if;
  amount := (p_value->>'amount')::numeric;
  if source = 'CNY' then return array[amount, round(amount * p_fx_rate, 2)]; end if;
  return array[round(amount / p_fx_rate, 2), amount];
end $$;
revoke all on function public.pi_fee_pair(jsonb,numeric) from public, anon;

create function public.apply_direct_pi_fees(p_order_id uuid, p_fees jsonb)
returns public.sales_orders language plpgsql security definer set search_path = '' as $$
declare
  target public.sales_orders;
  result public.sales_orders;
  balance numeric[]; discount numeric[]; other_fee numeric[];
  rate_percent numeric; fee_cny numeric(14,2); fee_payment numeric(14,2);
  base_cny numeric(14,2); base_payment numeric(14,2);
begin
  select * into target from public.sales_orders where id = p_order_id for update;
  if target.id is null or target.confirmation_method <> 'DIRECT_PI' or target.status <> 'DRAFT'
    or target.fx_rate_cny_to_payment is null or target.fx_rate_cny_to_payment <= 0 then
    raise exception 'PI草稿不可更新费用';
  end if;
  if p_fees is null or jsonb_typeof(p_fees) <> 'object' then raise exception 'PI附加费用格式不正确'; end if;
  if p_fees ? 'show_dual_currency_prices' and jsonb_typeof(p_fees->'show_dual_currency_prices') <> 'boolean' then
    raise exception 'PI双币种展示选项不正确';
  end if;
  balance := public.pi_fee_pair(p_fees->'last_balance', target.fx_rate_cny_to_payment);
  discount := public.pi_fee_pair(p_fees->'discount', target.fx_rate_cny_to_payment);
  other_fee := public.pi_fee_pair(p_fees->'other', target.fx_rate_cny_to_payment);
  if coalesce(p_fees->>'paypal_rate_percent', '') !~ '^(0|[1-9][0-9]?|100)(\.[0-9]{1,4})?$' then
    raise exception 'PayPal手续费百分比格式不正确';
  end if;
  rate_percent := (p_fees->>'paypal_rate_percent')::numeric;
  if rate_percent > 100 then raise exception 'PayPal手续费百分比不能超过100%%'; end if;
  if target.payment_method is distinct from 'PayPal' then rate_percent := 0; end if;
  base_cny := target.subtotal_cny + target.shipping_cny + balance[1] + other_fee[1] - discount[1];
  base_payment := target.subtotal + target.shipping_cost + balance[2] + other_fee[2] - discount[2];
  if base_cny < 0 or base_payment < 0 then raise exception '折扣不得超过本单应付金额'; end if;
  fee_cny := round(base_cny * rate_percent / 100, 2);
  fee_payment := round(base_payment * rate_percent / 100, 2);
  update public.sales_orders set
    show_dual_currency_prices = coalesce((p_fees->>'show_dual_currency_prices')::boolean, false),
    last_balance_cny = balance[1], last_balance_amount = balance[2], last_balance_source = p_fees->'last_balance'->>'source',
    discount_cny = discount[1], discount_amount = discount[2], discount_source = p_fees->'discount'->>'source',
    other_charge_cny = other_fee[1], other_charge_amount = other_fee[2], other_charge_source = p_fees->'other'->>'source',
    paypal_fee_percent = rate_percent, paypal_fee_cny = fee_cny, paypal_fee_amount = fee_payment,
    total_cny = base_cny + fee_cny, total_amount = base_payment + fee_payment
  where id = target.id returning * into result;
  update public.quotes set
    last_balance_cny = balance[1], last_balance_amount = balance[2], last_balance_source = p_fees->'last_balance'->>'source',
    discount_cny = discount[1], discount_amount = discount[2], discount_source = p_fees->'discount'->>'source',
    other_charge_cny = other_fee[1], other_charge_amount = other_fee[2], other_charge_source = p_fees->'other'->>'source',
    paypal_fee_percent = rate_percent, paypal_fee_cny = fee_cny, paypal_fee_amount = fee_payment,
    total_cny = result.total_cny, total_amount = result.total_amount, amount = result.total_amount
  where id = target.quote_id;
  return result;
end $$;
revoke all on function public.apply_direct_pi_fees(uuid,jsonb) from public, anon, authenticated;

create function public.create_direct_pi_order_with_fees(
  p_customer_id uuid, p_warehouse_reference_number text, p_currency text, p_fx_rate numeric, p_shipping_cny numeric,
  p_payment_method text, p_payment_account_id uuid, p_valid_until date, p_delivery_date date,
  p_delivery_recipient text, p_delivery_phone text, p_delivery_email text, p_delivery_address text,
  p_stocking_requirements text, p_items jsonb, p_fees jsonb, p_sales_user_id uuid
) returns public.sales_orders language plpgsql security definer set search_path = '' as $$
declare created public.sales_orders; actor public.users; customer public.customers;
begin
  perform public.assert_pi_payment_account(p_payment_account_id,p_payment_method);
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  select * into customer from public.customers where id = p_customer_id and deleted_at is null for update;
  if actor.id is null or customer.id is null or p_sales_user_id is null
    or customer.owner_id is distinct from p_sales_user_id
    or (actor.role = 'ORDER_CLERK' and not exists (
      select 1 from public.users u where u.id = p_sales_user_id and u.role = 'SALES' and u.status = 'ACTIVE'))
    or (actor.role <> 'ORDER_CLERK' and actor.id is distinct from p_sales_user_id) then
    raise exception '所选销售员与客户归属不匹配';
  end if;
  created := public.create_direct_pi_order(p_customer_id,p_warehouse_reference_number,p_currency,p_fx_rate,p_shipping_cny,
    p_payment_method,p_payment_account_id,p_valid_until,p_delivery_date,p_delivery_recipient,p_delivery_phone,
    p_delivery_email,p_delivery_address,p_stocking_requirements,p_items);
  perform public.apply_direct_pi_unit_prices(created.id, p_items);
  return public.apply_direct_pi_fees(created.id, p_fees);
end $$;
revoke all on function public.create_direct_pi_order_with_fees(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb,uuid) from public, anon;
grant execute on function public.create_direct_pi_order_with_fees(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb,uuid) to authenticated;

create function public.update_direct_pi_draft_with_fees(
  p_order_id uuid, p_expected_revision integer, p_warehouse_reference_number text, p_currency text,
  p_fx_rate numeric, p_shipping_cny numeric, p_payment_method text, p_payment_account_id uuid,
  p_valid_until date, p_delivery_date date, p_delivery_recipient text, p_delivery_phone text,
  p_delivery_email text, p_delivery_address text, p_stocking_requirements text, p_items jsonb, p_fees jsonb
) returns public.sales_orders language plpgsql security definer set search_path = '' as $$
declare updated public.sales_orders;
begin
  perform public.assert_pi_payment_account(p_payment_account_id,p_payment_method);
  updated := public.update_direct_pi_draft(p_order_id,p_expected_revision,p_warehouse_reference_number,p_currency,
    p_fx_rate,p_shipping_cny,p_payment_method,p_payment_account_id,p_valid_until,p_delivery_date,p_delivery_recipient,
    p_delivery_phone,p_delivery_email,p_delivery_address,p_stocking_requirements,p_items);
  perform public.apply_direct_pi_unit_prices(updated.id, p_items);
  return public.apply_direct_pi_fees(updated.id, p_fees);
end $$;
revoke all on function public.update_direct_pi_draft_with_fees(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.update_direct_pi_draft_with_fees(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb) to authenticated;
-- Direct calls to the legacy updater would reset totals without resetting the
-- snapshotted fee columns. The wrapper remains its only supported entry point.
revoke execute on function public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb) from authenticated;
revoke execute on function public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb) from authenticated;

create function public.convert_pi_import_draft_with_fees(
  p_draft_id uuid,p_expected_revision integer,
  p_customer_id uuid,p_warehouse_reference_number text,p_currency text,p_fx_rate numeric,p_shipping_cny numeric,
  p_payment_method text,p_payment_account_id uuid,p_valid_until date,p_delivery_date date,
  p_delivery_recipient text,p_delivery_phone text,p_delivery_email text,p_delivery_address text,
  p_stocking_requirements text,p_items jsonb,p_fees jsonb
) returns public.sales_orders language plpgsql security definer set search_path = '' as $$
declare converted public.sales_orders;
begin
  perform public.assert_pi_payment_account(p_payment_account_id,p_payment_method);
  converted := public.convert_pi_import_draft(p_draft_id,p_expected_revision,p_customer_id,p_warehouse_reference_number,
    p_currency,p_fx_rate,p_shipping_cny,p_payment_method,p_payment_account_id,p_valid_until,p_delivery_date,
    p_delivery_recipient,p_delivery_phone,p_delivery_email,p_delivery_address,p_stocking_requirements,p_items);
  perform public.apply_direct_pi_unit_prices(converted.id, p_items);
  return public.apply_direct_pi_fees(converted.id, p_fees);
end $$;
revoke all on function public.convert_pi_import_draft_with_fees(uuid,integer,uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.convert_pi_import_draft_with_fees(uuid,integer,uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb) to authenticated;
revoke execute on function public.convert_pi_import_draft(uuid,integer,uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb) from authenticated;
commit;
