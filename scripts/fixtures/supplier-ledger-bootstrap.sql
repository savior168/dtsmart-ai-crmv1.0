-- Isolated PostgreSQL fixture for parsing and exercising the draft supplier ledger.
-- Never run against DTS or another non-empty database.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor_id', true), '')::uuid
$$;
create table public.users (id uuid primary key, role text not null, status text not null);
create table public.sales_orders (id uuid primary key, order_number text not null, warehouse_reference_number text);
create table public.quotes (
  id uuid primary key, subtotal_cny numeric(14,2), subtotal numeric(14,2),
  paypal_fee_cny numeric(14,2), paypal_fee_amount numeric(14,2),
  total_cny numeric(14,2), total_amount numeric(14,2), amount numeric(14,2),
  version integer not null default 1, updated_at timestamptz default now()
);
create table public.quote_items (
  id uuid primary key default gen_random_uuid(), quote_id uuid references public.quotes(id),
  line_number integer, item_name text, brand text, model text, quality text,
  description text, description_zh text, preparation_requirement text, internal_note text,
  quantity integer, unit_price numeric(14,2), unit_price_cny numeric(14,2),
  amount numeric(14,2), unit_cost_cny numeric(14,2), procurement_cost numeric(14,2),
  unique(quote_id,line_number)
);
create table public.sales_order_items (
  id uuid primary key, sales_order_id uuid not null references public.sales_orders(id),
  line_number integer not null, item_name text, brand text, model text, quality text,
  description text, description_zh text, preparation_requirement text, internal_note text,
  quantity integer, unit_price_cny numeric(14,2), estimated_unit_cost_cny numeric(14,2)
);
create table public.attachments (id uuid primary key, created_at timestamptz not null default now());
create table public.stock_orders (
  id uuid primary key, sales_order_id uuid references public.sales_orders(id),
  status text not null default 'WAITING', updated_at timestamptz not null default now()
);
create table public.stock_order_items (
  id uuid primary key default gen_random_uuid(), stock_order_id uuid not null references public.stock_orders(id),
  line_number integer not null, item_name text not null, product_type_snapshot text,
  brand text, model text, quality text, description text, description_zh text,
  quantity integer not null, received_quantity integer not null default 0,
  prepared_quantity integer not null default 0, shipped_quantity integer not null default 0,
  preparation_status text not null default 'WAITING',
  warehouse_supplier_code text,
  procurement_cost numeric(14,2), procurement_cost_confirmed boolean not null default false
);
create table public.audit_logs (
  id bigint generated always as identity primary key, user_id uuid, action text,
  target_type text, target_id uuid, content jsonb
);
create table public.system_notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid, type text, category text, title text, content text,
  href text, entity_type text, entity_id uuid, dedupe_key text,
  action_status text
);
create unique index system_notifications_dedupe_unique
  on public.system_notifications(recipient_id,dedupe_key) where dedupe_key is not null;
create table public.role_permission_settings (
  role_code text not null, permission_code text not null, enabled boolean not null,
  primary key (role_code, permission_code)
);
create function public.current_user_has_business_permission(text)
returns boolean language sql stable as $$ select true $$;
create function public.record_stock_progress(
  p_stock_order_id uuid, p_action text, p_changes jsonb,
  p_expected_updated_at timestamptz, p_note text
) returns public.stock_orders language plpgsql as $$
declare result public.stock_orders;
begin
  if p_action <> 'RECEIVE' then raise exception 'fixture only supports RECEIVE'; end if;
  update public.stock_order_items i
  set received_quantity = x.quantity
  from jsonb_to_recordset(p_changes) as x(item_id uuid, quantity integer, supplier_code text)
  where i.id = x.item_id and i.stock_order_id = p_stock_order_id;
  update public.stock_orders set updated_at = clock_timestamp()
  where id = p_stock_order_id and updated_at = p_expected_updated_at
  returning * into result;
  if result.id is null then raise exception 'stale stock version'; end if;
  return result;
end;
$$;
create function public.correct_stock_item_progress(
  p_stock_order_id uuid, p_changes jsonb,
  p_expected_updated_at timestamptz, p_reason text
) returns public.stock_orders language plpgsql as $$
declare result public.stock_orders;
begin
  if nullif(btrim(p_reason),'') is null then raise exception 'reason required'; end if;
  update public.stock_order_items i
  set received_quantity = x.received_quantity
  from jsonb_to_recordset(p_changes) as x(item_id uuid, received_quantity integer,
    prepared_quantity integer, supplier_code text)
  where i.id = x.item_id and i.stock_order_id = p_stock_order_id
    and x.received_quantity >= i.prepared_quantity
    and x.received_quantity >= i.shipped_quantity;
  if not found then raise exception 'invalid stock correction'; end if;
  update public.stock_orders set updated_at = clock_timestamp()
  where id = p_stock_order_id and updated_at = p_expected_updated_at
  returning * into result;
  if result.id is null then raise exception 'stale stock version'; end if;
  return result;
end;
$$;
-- A pre-ledger physical receipt has no paper-note provenance. Migration must
-- preserve it as an explicit baseline and never invent an allocation.
insert into public.sales_orders(id,order_number)
values ('66666666-6666-4666-8666-666666666661','PI-LEGACY');
insert into public.stock_orders(id,sales_order_id)
values ('66666666-6666-4666-8666-666666666662','66666666-6666-4666-8666-666666666661');
insert into public.stock_order_items(id,stock_order_id,line_number,item_name,quantity,received_quantity)
values ('66666666-6666-4666-8666-666666666663','66666666-6666-4666-8666-666666666662',1,'Legacy received product',5,2);
