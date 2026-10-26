alter table public.sales_orders
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.users(id) on delete set null,
  add column if not exists archive_reason text,
  add column if not exists archive_batch_id uuid;

alter table public.stock_orders
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.users(id) on delete set null,
  add column if not exists archive_reason text,
  add column if not exists archive_batch_id uuid;

create index if not exists sales_orders_archived_updated_idx
  on public.sales_orders(archived_at, updated_at desc);
create index if not exists stock_orders_archived_updated_idx
  on public.stock_orders(archived_at, updated_at desc);

create table if not exists public.order_archive_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  entity_type text not null check (entity_type in ('sales_order', 'stock_order')),
  entity_id uuid not null,
  action text not null check (action in ('ARCHIVE', 'RESTORE')),
  actor_id uuid references public.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists order_archive_events_entity_created_idx
  on public.order_archive_events(entity_type, entity_id, created_at desc);
alter table public.order_archive_events enable row level security;
revoke all on table public.order_archive_events from anon, authenticated;
drop policy if exists order_archive_events_admin_read on public.order_archive_events;
create policy order_archive_events_admin_read on public.order_archive_events
  for select to authenticated using (public.current_user_is_admin());
grant select on public.order_archive_events to authenticated;

-- A restrictive policy composes with every existing permissive ownership/role policy.
-- Even warehouse users and order clerks cannot read archived documents or their children.
drop policy if exists sales_orders_archive_visibility on public.sales_orders;
create policy sales_orders_archive_visibility on public.sales_orders
  as restrictive for select to authenticated
  using (archived_at is null or public.current_user_is_admin());
drop policy if exists stock_orders_archive_visibility on public.stock_orders;
create policy stock_orders_archive_visibility on public.stock_orders
  as restrictive for select to authenticated
  using (archived_at is null or public.current_user_is_admin());

create or replace function public.prevent_archived_order_mutation()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if (new.archived_at, new.archived_by, new.archive_reason, new.archive_batch_id)
       is distinct from
     (old.archived_at, old.archived_by, old.archive_reason, old.archive_batch_id)
     and not public.current_user_is_admin() then
    raise exception '仅系统管理员可管理单据归档' using errcode = '42501';
  end if;
  if old.archived_at is not null and new.archived_at is not null
     and (to_jsonb(new) - array['updated_at','archived_at','archived_by','archive_reason','archive_batch_id'])
         is distinct from
         (to_jsonb(old) - array['updated_at','archived_at','archived_by','archive_reason','archive_batch_id']) then
    raise exception '已归档单据只读，请先由系统管理员恢复后再操作' using errcode = '55000';
  end if;
  return new;
end $$;

drop trigger if exists sales_orders_archived_read_only on public.sales_orders;
create trigger sales_orders_archived_read_only before update on public.sales_orders
  for each row execute function public.prevent_archived_order_mutation();
drop trigger if exists stock_orders_archived_read_only on public.stock_orders;
create trigger stock_orders_archived_read_only before update on public.stock_orders
  for each row execute function public.prevent_archived_order_mutation();

create or replace function public.prevent_archived_order_item_mutation()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare parent_id uuid; parent_archived_at timestamptz;
begin
  if tg_op = 'DELETE' then
    parent_id := case when tg_table_name = 'sales_order_items' then old.sales_order_id else old.stock_order_id end;
  else
    parent_id := case when tg_table_name = 'sales_order_items' then new.sales_order_id else new.stock_order_id end;
  end if;
  if tg_table_name = 'sales_order_items' then
    select archived_at into parent_archived_at from public.sales_orders where id = parent_id;
  else
    select archived_at into parent_archived_at from public.stock_orders where id = parent_id;
  end if;
  if parent_archived_at is not null then
    raise exception '已归档单据明细只读，请先由系统管理员恢复后再操作' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'sales_order_items' then
      select archived_at into parent_archived_at from public.sales_orders where id = old.sales_order_id;
    else
      select archived_at into parent_archived_at from public.stock_orders where id = old.stock_order_id;
    end if;
    if parent_archived_at is not null then
      raise exception '已归档单据明细只读，请先由系统管理员恢复后再操作' using errcode = '55000';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists sales_order_items_archived_read_only on public.sales_order_items;
create trigger sales_order_items_archived_read_only before insert or update or delete on public.sales_order_items
  for each row execute function public.prevent_archived_order_item_mutation();
drop trigger if exists stock_order_items_archived_read_only on public.stock_order_items;
create trigger stock_order_items_archived_read_only before insert or update or delete on public.stock_order_items
  for each row execute function public.prevent_archived_order_item_mutation();

create or replace function public.manage_order_archives(
  p_entity_type text,
  p_ids uuid[],
  p_action text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_id uuid := auth.uid();
  target_id uuid;
  related_id uuid;
  operation_id uuid;
  changed_sales integer := 0;
  changed_stock integer := 0;
  changed_rows integer;
  old_batch uuid;
  clean_ids uuid[];
begin
  if actor_id is null or not exists (
    select 1 from public.users u where u.id = actor_id and u.role = 'ADMIN' and u.status = 'ACTIVE'
  ) then raise exception '仅有效系统管理员可管理单据归档' using errcode = '42501'; end if;
  if coalesce(p_entity_type, '') not in ('sales_order', 'stock_order') or coalesce(p_action, '') not in ('ARCHIVE', 'RESTORE') then
    raise exception '归档操作参数不正确' using errcode = '22023';
  end if;
  select array_agg(distinct id) into clean_ids from unnest(coalesce(p_ids, '{}'::uuid[])) as ids(id) where id is not null;
  if coalesce(cardinality(clean_ids), 0) = 0 or cardinality(clean_ids) > 100 then
    raise exception '请选择 1 至 100 张单据' using errcode = '22023';
  end if;
  if p_action = 'ARCHIVE' and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception '归档时必须填写原因' using errcode = '22023';
  end if;
  if p_action = 'ARCHIVE' and length(trim(p_reason)) > 500 then
    raise exception '归档原因不能超过 500 个字符' using errcode = '22023';
  end if;

  foreach target_id in array clean_ids loop
    if p_entity_type = 'sales_order' then
      if p_action = 'ARCHIVE' then
        operation_id := gen_random_uuid();
        update public.sales_orders set archived_at = now(), archived_by = actor_id,
          archive_reason = trim(p_reason), archive_batch_id = operation_id, updated_at = now()
          where id = target_id and archived_at is null;
        get diagnostics changed_rows = row_count;
        if changed_rows > 0 then
          changed_sales := changed_sales + 1;
          insert into public.order_archive_events(batch_id,entity_type,entity_id,action,actor_id,reason)
          values(operation_id,'sales_order',target_id,'ARCHIVE',actor_id,trim(p_reason));
          for related_id in select id from public.stock_orders where sales_order_id = target_id and archived_at is null loop
            update public.stock_orders set archived_at = now(), archived_by = actor_id,
              archive_reason = trim(p_reason), archive_batch_id = operation_id, updated_at = now()
              where id = related_id and archived_at is null;
            get diagnostics changed_rows = row_count;
            if changed_rows > 0 then
              changed_stock := changed_stock + 1;
              insert into public.order_archive_events(batch_id,entity_type,entity_id,action,actor_id,reason)
              values(operation_id,'stock_order',related_id,'ARCHIVE',actor_id,trim(p_reason));
            end if;
          end loop;
        end if;
      else
        select archive_batch_id into old_batch from public.sales_orders where id = target_id and archived_at is not null;
        if old_batch is not null then
          update public.sales_orders set archived_at = null, archived_by = null, archive_reason = null,
            archive_batch_id = null, updated_at = now() where id = target_id and archive_batch_id = old_batch;
          get diagnostics changed_rows = row_count;
          if changed_rows > 0 then
            changed_sales := changed_sales + 1;
            insert into public.order_archive_events(batch_id,entity_type,entity_id,action,actor_id)
            values(old_batch,'sales_order',target_id,'RESTORE',actor_id);
          end if;
          for related_id in select id from public.stock_orders where sales_order_id = target_id and archive_batch_id = old_batch and archived_at is not null loop
            update public.stock_orders set archived_at = null, archived_by = null, archive_reason = null,
              archive_batch_id = null, updated_at = now() where id = related_id and archive_batch_id = old_batch;
            get diagnostics changed_rows = row_count;
            if changed_rows > 0 then
              changed_stock := changed_stock + 1;
              insert into public.order_archive_events(batch_id,entity_type,entity_id,action,actor_id)
              values(old_batch,'stock_order',related_id,'RESTORE',actor_id);
            end if;
          end loop;
        end if;
      end if;
    else
      if p_action = 'ARCHIVE' then
        operation_id := gen_random_uuid();
        update public.stock_orders set archived_at = now(), archived_by = actor_id,
          archive_reason = trim(p_reason), archive_batch_id = operation_id, updated_at = now()
          where id = target_id and archived_at is null;
        get diagnostics changed_rows = row_count;
        if changed_rows > 0 then
          changed_stock := changed_stock + 1;
          insert into public.order_archive_events(batch_id,entity_type,entity_id,action,actor_id,reason)
          values(operation_id,'stock_order',target_id,'ARCHIVE',actor_id,trim(p_reason));
        end if;
      else
        if exists (
          select 1 from public.stock_orders s
          join public.sales_orders so on so.id = s.sales_order_id
          where s.id = target_id and so.archived_at is not null
        ) then
          raise exception '该备货单所属 PI 仍处于归档状态，请先恢复 PI 订单' using errcode = '55000';
        end if;
        select archive_batch_id into old_batch from public.stock_orders where id = target_id and archived_at is not null;
        if old_batch is not null then
          update public.stock_orders set archived_at = null, archived_by = null, archive_reason = null,
            archive_batch_id = null, updated_at = now() where id = target_id and archive_batch_id = old_batch;
          get diagnostics changed_rows = row_count;
          if changed_rows > 0 then
            changed_stock := changed_stock + 1;
            insert into public.order_archive_events(batch_id,entity_type,entity_id,action,actor_id)
            values(old_batch,'stock_order',target_id,'RESTORE',actor_id);
          end if;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('sales_orders',changed_sales,'stock_orders',changed_stock,'action',p_action);
end $$;

revoke all on function public.manage_order_archives(text,uuid[],text,text) from public, anon;
grant execute on function public.manage_order_archives(text,uuid[],text,text) to authenticated;

create or replace function public.stock_order_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare actor public.users; scope_id uuid; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号无效'; end if;
  scope_id:=case when actor.role in ('ADMIN','WAREHOUSE','ORDER_CLERK') then null else actor.id end;
  with scoped as (
    select s.* from public.stock_orders s
    where s.archived_at is null and (scope_id is null or s.sales_user_id=scope_id)
      and (actor.role<>'WAREHOUSE' or s.status<>'DRAFT'
        or exists(select 1 from public.sales_orders so
          where so.id=s.sales_order_id and so.confirmation_method is distinct from 'DIRECT_PI'))
  ), recent_rows as (
    select s.id,s.quote_id,s.sales_order_id,s.quote_number,s.order_number,s.warehouse_reference_number,s.stock_number,s.sales_user_id,
      s.customer_short_name,s.destination_country,s.status,s.stocking_requirements,s.status_note,
      s.expected_ready_at,s.ready_at,s.created_at,s.updated_at,
      jsonb_build_object('name',u.name,'email',u.email) sales
    from scoped s left join public.users u on u.id=s.sales_user_id order by s.updated_at desc limit 10
  )
  select jsonb_build_object('counts',jsonb_build_object(
    'DRAFT',(select count(*) from scoped where status='DRAFT'),
    'WAITING',(select count(*) from scoped where status='WAITING'),
    'PREPARING',(select count(*) from scoped where status='PREPARING'),
    'RECEIVED',(select count(*) from scoped where status='RECEIVED'),
    'SORTING',(select count(*) from scoped where status='SORTING'),
    'READY_TO_SHIP',(select count(*) from scoped where status='READY_TO_SHIP'),
    'SHIPPED',(select count(*) from scoped where status='SHIPPED'),
    'SHORTAGE',(select count(*) from scoped where status='SHORTAGE'),
    'READY',(select count(*) from scoped where status='READY'),
    'CANCELLED',(select count(*) from scoped where status='CANCELLED')),
    'recent',coalesce((select jsonb_agg(to_jsonb(recent_rows) order by updated_at desc)
      from recent_rows),'[]'::jsonb)) into result;
  return result;
end $$;
revoke execute on function public.stock_order_dashboard() from public, anon;
grant execute on function public.stock_order_dashboard() to authenticated;
