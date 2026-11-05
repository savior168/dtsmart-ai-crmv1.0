-- Disposable local PostgreSQL only. Stub business RPCs isolate permission
-- migration syntax and ownership checks from unrelated order validations.
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor_id',true),'')::uuid
$$;
create table public.users(id uuid primary key,role text not null,status text not null);
create table public.role_permission_settings(role_code text,permission_code text,enabled boolean,
  primary key(role_code,permission_code));
create function public.current_user_has_business_permission(p_permission text)
returns boolean language sql stable security definer as $$
  select coalesce((select r.enabled from public.role_permission_settings r
    join public.users u on u.role=r.role_code
    where u.id=auth.uid() and u.status='ACTIVE' and r.permission_code=p_permission),false)
$$;
create function public.current_user_role() returns text language sql stable as $$
  select role from public.users where id=auth.uid()
$$;
create function public.is_legacy_stock_sales_order(uuid) returns boolean
language sql stable as $$ select false $$;
create table public.stock_orders(id uuid primary key,sales_user_id uuid,sales_order_id uuid,status text);
create table public.stock_order_items(id uuid primary key,stock_order_id uuid);
create table public.stock_order_events(id uuid primary key,stock_order_id uuid);
create table public.stock_order_expenses(id uuid primary key,stock_order_id uuid);
create table public.stock_order_shipments(id uuid primary key,stock_order_id uuid);
alter table public.stock_orders enable row level security;
alter table public.stock_order_items enable row level security;
alter table public.stock_order_events enable row level security;
alter table public.stock_order_expenses enable row level security;
alter table public.stock_order_shipments enable row level security;

do $$
declare signature text; name text; args text;
begin
  foreach signature in array array[
    'warehouse_prepare_stock_draft(p_stock_order_id uuid,p_stocking_requirements text,p_expected_ready_at timestamptz,p_items jsonb)',
    'warehouse_submit_stock_draft(p_stock_order_id uuid)',
    'record_stock_progress(p_stock_order_id uuid,p_action text,p_changes jsonb,p_expected_updated_at timestamptz,p_note text)',
    'correct_stock_item_progress(p_stock_order_id uuid,p_changes jsonb,p_expected_updated_at timestamptz,p_reason text)',
    'complete_stock_items_batch(p_stock_order_id uuid,p_stage text,p_item_ids uuid[],p_expected_updated_at timestamptz)',
    'record_stock_shipment(p_stock_order_id uuid,p_item_ids uuid[],p_expected_updated_at timestamptz,p_note text,p_packaging_cost_cny numeric,p_procurement_expenses_cny numeric,p_shipping_expenses_cny numeric)',
    'update_stock_order_status(p_stock_order_id uuid,p_status text,p_note text,p_packaging_cost_cny numeric,p_procurement_expenses_cny numeric,p_shipping_expenses_cny numeric)',
    'record_supplier_receipt(p_stock_order_id uuid,p_stock_order_item_id uuid,p_supplier_id uuid,p_note_number text,p_document_date date,p_quantity integer,p_purchase_unit_price_cny numeric,p_expected_updated_at timestamptz,p_note text,p_cash_paid_reported_cny numeric)',
    'reverse_supplier_receipt(p_stock_order_id uuid,p_allocation_id uuid,p_quantity integer,p_expected_updated_at timestamptz,p_reason text)'
  ] loop
    name:=split_part(signature,'(',1);
    args:=substring(signature from position('(' in signature));
    execute format('create function public.%I%s returns void language plpgsql security definer set search_path=public as $body$
      declare actor public.users;
      begin
        select * into actor from public.users where id=auth.uid() and status=''ACTIVE'';
        if actor.id is null or actor.role not in (''WAREHOUSE'',''ADMIN'')
          or not public.current_user_has_business_permission(''stock.update'') then
          raise exception ''DENIED'';
        end if;
      end $body$',name,args);
  end loop;
end $$;
-- The legacy stage RPC is deliberately disabled in production and must not
-- be reopened by the permission migration.
create function public.update_stock_item_stages(p_stock_order_id uuid,p_changes jsonb,p_expected_updated_at timestamptz,p_note text,p_packaging_cost_cny numeric,p_procurement_expenses_cny numeric,p_shipping_expenses_cny numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  raise exception '备货页面已更新，请刷新页面后继续操作';
end $$;
create function public.save_stock_order_procurement_costs(p_stock_order_id uuid,p_items jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare actor public.users;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role <> 'WAREHOUSE'
    or not public.current_user_has_business_permission('stock.procurement.edit') then
    raise exception 'DENIED';
  end if;
end $$;
create function public.decide_direct_pi_amendment(p_request_id uuid,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare actor public.users; stock public.stock_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into stock from public.stock_orders where id=p_request_id;
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception 'DENIED';
  end if;
end $$;
create function public.stock_order_dashboard() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor public.users; scope_id uuid;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号无效'; end if;
  scope_id:=case when actor.role in ('ADMIN','WAREHOUSE','ORDER_CLERK') then null else actor.id end;
  return jsonb_build_object('scope_id',scope_id);
end $$;

\ir ../../supabase/migrations/20261105094015_stock_permission_alignment.sql

insert into public.users values
  ('11111111-1111-4111-8111-111111111111','SALES','ACTIVE'),
  ('22222222-2222-4222-8222-222222222222','WAREHOUSE','ACTIVE');
insert into public.stock_orders values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',null,'WAITING'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',null,'WAITING');
insert into public.role_permission_settings values
  ('SALES','stock.view',true),('SALES','stock.update',true),('SALES','stock.data_all',false),
  ('WAREHOUSE','stock.view',true),('WAREHOUSE','stock.update',true),('WAREHOUSE','stock.data_all',true);

select set_config('test.actor_id','11111111-1111-4111-8111-111111111111',false);
do $$ begin
  if public.stock_order_dashboard()->>'scope_id'<>'11111111-1111-4111-8111-111111111111' then
    raise exception 'Sales dashboard scope should remain owned only';
  end if;
end $$;
do $$ begin
  perform public.warehouse_submit_stock_draft('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  begin
    perform public.warehouse_submit_stock_draft('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    raise exception 'CROSS_OWNER_WRITE_ACCEPTED';
  exception when others then
    if sqlerrm='CROSS_OWNER_WRITE_ACCEPTED' then raise; end if;
  end;
end $$;
select set_config('test.actor_id','22222222-2222-4222-8222-222222222222',false);
do $$ begin
  if public.stock_order_dashboard()->>'scope_id' is not null then
    raise exception 'Warehouse dashboard should retain all-stock scope';
  end if;
  begin
    perform public.update_stock_item_stages('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]'::jsonb,null,null,null,null,null);
    raise exception 'LEGACY_STAGE_RPC_REOPENED';
  exception when others then
    if sqlerrm='LEGACY_STAGE_RPC_REOPENED' then raise; end if;
    if sqlerrm<>'备货页面已更新，请刷新页面后继续操作' then raise; end if;
  end;
end $$;
select public.warehouse_submit_stock_draft('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  if (select count(*) from pg_policies where schemaname='public'
      and policyname like 'stock_%_configurable_gate' and permissive='RESTRICTIVE')<>5 then
    raise exception 'RLS_PERMISSION_GATES_MISSING';
  end if;
end $$;
grant usage on schema auth,public to authenticated;
grant select on public.stock_orders to authenticated;
set role authenticated;
select set_config('test.actor_id','11111111-1111-4111-8111-111111111111',false);
do $$ begin
  if (select count(*) from public.stock_orders)<>1 then raise exception 'SALES_RLS_SCOPE_FAILED'; end if;
end $$;
select set_config('test.actor_id','22222222-2222-4222-8222-222222222222',false);
do $$ begin
  if (select count(*) from public.stock_orders)<>2 then raise exception 'WAREHOUSE_RLS_SCOPE_FAILED'; end if;
end $$;
reset role;
select 'STOCK_PERMISSION_ALIGNMENT_PASS';
