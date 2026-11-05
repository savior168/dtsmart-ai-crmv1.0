\set ON_ERROR_STOP on
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$;
create table public.users (id uuid primary key, status text not null);
create table public.sales_orders (
  id uuid primary key, prepared_by uuid references public.users(id)
);
create table public.stock_orders (
  id uuid primary key, sales_order_id uuid references public.sales_orders(id),
  sales_user_id uuid references public.users(id)
);
create table public.system_notifications (
  id uuid primary key default gen_random_uuid(), recipient_id uuid not null,
  type text not null, category text, title text, content text, href text,
  metadata jsonb not null default '{}'::jsonb, entity_type text, entity_id uuid,
  dedupe_key text, deliver_at timestamptz not null default now(),
  action_status text not null default 'INFO'
);
create unique index system_notifications_dedupe_unique
  on public.system_notifications(recipient_id, dedupe_key)
  where dedupe_key is not null;
\ir ../supabase/migrations/20261103000001_notify_pi_preparer_stock_status.sql

insert into public.users values
 ('00000000-0000-4000-8000-000000000001','ACTIVE'),
 ('00000000-0000-4000-8000-000000000002','ACTIVE'),
 ('00000000-0000-4000-8000-000000000003','DISABLED');
insert into public.sales_orders values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000003');
insert into public.stock_orders values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001');

insert into public.system_notifications
 (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key)
values
 ('00000000-0000-4000-8000-000000000001','STOCK_STATUS_CHANGED','STOCK','备货状态已更新','缺货异常','/stock-orders/21','stock_order','00000000-0000-4000-8000-000000000021','update-1'),
 ('00000000-0000-4000-8000-000000000001','STOCK_STATUS_CHANGED','STOCK','备货状态已更新','已备齐','/stock-orders/22','stock_order','00000000-0000-4000-8000-000000000022','update-2'),
 ('00000000-0000-4000-8000-000000000001','STOCK_STATUS_CHANGED','STOCK','备货状态已更新','已备齐','/stock-orders/23','stock_order','00000000-0000-4000-8000-000000000023','update-3');

do $$
begin
  if (select count(*) from public.system_notifications) <> 4 then
    raise exception 'Expected one mirrored notification only';
  end if;
  if not exists (
    select 1 from public.system_notifications
    where recipient_id='00000000-0000-4000-8000-000000000002'
      and entity_id='00000000-0000-4000-8000-000000000021'
      and content='缺货异常' and dedupe_key='update-1'
  ) then raise exception 'Preparer notification missing or changed'; end if;
end $$;
