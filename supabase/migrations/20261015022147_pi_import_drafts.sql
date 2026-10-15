-- Customer-facing Excel PI imports are kept separate until the salesperson
-- supplies internal RMB cost, business exchange rate, customer and account.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('SALES','orders.import',true),('SUPERVISOR','orders.import',true),
       ('WAREHOUSE','orders.import',false),('ADMIN','orders.import',true)
on conflict(role_code,permission_code) do nothing;

alter table public.sales_orders add column pi_source text not null default 'MANUAL';
alter table public.sales_orders add constraint sales_orders_pi_source_check
  check (pi_source in ('MANUAL','EXCEL_IMPORT'));

create table public.pi_import_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete restrict,
  source_file_name text not null,
  source_sheet_name text not null,
  source_order_number text,
  payload jsonb not null,
  revision integer not null default 1 check (revision > 0),
  status text not null default 'PENDING' check (status in ('PENDING','CONVERTED')),
  converted_order_id uuid unique references public.sales_orders(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object'),
  check (length(source_file_name) between 1 and 255),
  check (length(source_sheet_name) between 1 and 100),
  check (source_order_number is null or length(source_order_number) <= 80),
  check (octet_length(payload::text) <= 262144)
);
create index pi_import_drafts_owner_created_idx on public.pi_import_drafts(owner_id,created_at desc);
alter table public.pi_import_drafts enable row level security;
create policy pi_import_drafts_owner_read on public.pi_import_drafts for select to authenticated
  using (owner_id=(select auth.uid()));
grant select on public.pi_import_drafts to authenticated;

create function public.create_pi_import_draft(p_file_name text,p_sheet_name text,p_payload jsonb)
returns public.pi_import_drafts language plpgsql security definer set search_path='' as $$
declare actor public.users; result public.pi_import_drafts; order_no text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('SALES','SUPERVISOR','ADMIN')
    or not public.current_user_has_business_permission('orders.import') then raise exception '没有PI导入权限'; end if;
  if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'items')<>'array'
    or jsonb_array_length(p_payload->'items')<1 or jsonb_array_length(p_payload->'items')>500
    or octet_length(p_payload::text)>262144 then raise exception 'PI导入内容不正确或过大'; end if;
  order_no:=nullif(trim(coalesce(p_payload->>'warehouse_reference_number','')),'');
  if length(coalesce(order_no,''))>80 then raise exception '订单编号不能超过80字'; end if;
  insert into public.pi_import_drafts(owner_id,source_file_name,source_sheet_name,source_order_number,payload)
  values(actor.id,left(trim(p_file_name),255),left(trim(p_sheet_name),100),order_no,p_payload) returning * into result;
  return result;
end $$;

create function public.delete_pi_import_draft(p_draft_id uuid,p_expected_revision integer)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.users; target public.pi_import_drafts;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('orders.import') then raise exception '没有PI导入权限'; end if;
  select * into target from public.pi_import_drafts where id=p_draft_id for update;
  if target.id is null or target.owner_id<>actor.id or target.status<>'PENDING' then raise exception '导入草稿不可删除'; end if;
  if target.revision is distinct from p_expected_revision then raise exception '导入草稿已更新，请刷新后重试'; end if;
  delete from public.pi_import_drafts where id=p_draft_id;
end $$;

create function public.convert_pi_import_draft(
  p_draft_id uuid,p_expected_revision integer,
  p_customer_id uuid,p_warehouse_reference_number text,p_currency text,p_fx_rate numeric,p_shipping_cny numeric,
  p_payment_method text,p_payment_account_id uuid,p_valid_until date,p_delivery_date date,
  p_delivery_recipient text,p_delivery_phone text,p_delivery_email text,p_delivery_address text,
  p_stocking_requirements text,p_items jsonb
) returns public.sales_orders language plpgsql security definer set search_path='' as $$
declare actor public.users; target public.pi_import_drafts; result public.sales_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('orders.import') then raise exception '没有PI导入权限'; end if;
  select * into target from public.pi_import_drafts where id=p_draft_id for update;
  if target.id is null or target.owner_id<>actor.id or target.status<>'PENDING' then raise exception '导入草稿不可转换'; end if;
  if target.revision is distinct from p_expected_revision then raise exception '导入草稿已更新，请刷新后重试'; end if;
  result:=public.create_direct_pi_order(p_customer_id,p_warehouse_reference_number,p_currency,p_fx_rate,p_shipping_cny,
    p_payment_method,p_payment_account_id,p_valid_until,p_delivery_date,p_delivery_recipient,p_delivery_phone,
    p_delivery_email,p_delivery_address,p_stocking_requirements,p_items);
  update public.sales_orders set pi_source='EXCEL_IMPORT' where id=result.id returning * into result;
  update public.pi_import_drafts set status='CONVERTED',converted_order_id=result.id,revision=revision+1,updated_at=now()
    where id=target.id;
  return result;
end $$;

revoke all on function public.create_pi_import_draft(text,text,jsonb) from public,anon;
revoke all on function public.delete_pi_import_draft(uuid,integer) from public,anon;
revoke all on function public.convert_pi_import_draft(uuid,integer,uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_pi_import_draft(text,text,jsonb) to authenticated;
grant execute on function public.delete_pi_import_draft(uuid,integer) to authenticated;
grant execute on function public.convert_pi_import_draft(uuid,integer,uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb) to authenticated;
commit;
