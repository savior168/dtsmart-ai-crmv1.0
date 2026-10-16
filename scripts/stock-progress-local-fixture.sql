-- Minimal isolated schema for exercising the quantity migration in local PostgreSQL.
do $$begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end$$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.test_uid',true),'')::uuid
$$;
create table public.users(id uuid primary key,status text,role text,name text,email text);
create function public.current_user_has_business_permission(text) returns boolean
language sql stable as $$select true$$;
create table public.sales_orders(id uuid primary key,status text,updated_at timestamptz,
  warehouse_reference_number text,confirmation_method text);
create table public.stock_orders(
  id uuid primary key,sales_order_id uuid,sales_user_id uuid,status text,updated_at timestamptz,
  status_note text,ready_at timestamptz,updated_by uuid,warehouse_reference_number text,order_number text
);
create table public.stock_order_items(
  id uuid primary key,stock_order_id uuid,line_number integer,item_name text,model text,quantity numeric not null,
  received_quantity integer not null default 0,preparation_status text not null default 'WAITING',
  warehouse_supplier_code text
);
create table public.stock_order_events(
  stock_order_id uuid,from_status text,to_status text,note text,created_by uuid
);
create table public.system_notifications(
  recipient_id uuid,type text,category text,title text,content text,href text,
  entity_type text,entity_id uuid,dedupe_key text,action_status text
);
create table public.audit_logs(user_id uuid,action text,target_type text,target_id uuid,content jsonb);
create table public.stock_order_expenses(
  stock_order_id uuid primary key references public.stock_orders(id),
  packaging_cost_cny numeric(14,2) not null,
  procurement_expenses_cny numeric(14,2) not null,
  shipping_expenses_cny numeric(14,2) not null,
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now()
);
create function public.update_stock_item_stages(p_stock_order_id uuid,p_changes jsonb,
  p_expected_updated_at timestamptz,p_note text default null,
  p_packaging_cost_cny numeric default null,p_procurement_expenses_cny numeric default null,
  p_shipping_expenses_cny numeric default null)
returns public.stock_orders language sql as $$select null::public.stock_orders$$;
create function public.save_stock_receiving_details(p_stock_order_id uuid,p_items jsonb,p_expected_updated_at timestamptz)
returns public.stock_orders language sql as $$select null::public.stock_orders$$;
insert into public.users values
  ('00000000-0000-0000-0000-000000000001','ACTIVE','WAREHOUSE','Warehouse','warehouse@example.test'),
  ('00000000-0000-0000-0000-000000000002','ACTIVE','SALES','Sales','sales@example.test');
insert into public.sales_orders(id,status,updated_at) values
  ('00000000-0000-0000-0000-000000000101','WAITING_STOCK',now());
insert into public.stock_orders(id,sales_order_id,sales_user_id,status,updated_at,warehouse_reference_number,order_number)
values ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000002','WAITING',now(),'D-TEST-1','PI-TEST-1');
insert into public.stock_order_items(id,stock_order_id,line_number,item_name,model,quantity) values
  ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201',1,'LCD','IPH 17 Pro',20),
  ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000201',2,'LCD','IPH 16',10);
