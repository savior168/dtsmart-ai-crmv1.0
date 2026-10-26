begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Keep the existing list view's stable column order intact. This dedicated
-- view is recreated after archive columns exist and is used by the stock list.
create or replace view public.stock_orders_with_archive
  with (security_invoker = true) as
select stock.*, pi.prepared_by as pi_prepared_by, pi.updated_at as pi_updated_at
from public.stock_orders stock
left join public.sales_orders pi on pi.id = stock.sales_order_id;
revoke all on public.stock_orders_with_archive from public, anon;
grant select on public.stock_orders_with_archive to authenticated;

-- Parent RLS is enforced in these predicates as well, so archived child rows
-- cannot be queried directly by non-admin users.
drop policy if exists sales_order_items_archive_visibility on public.sales_order_items;
create policy sales_order_items_archive_visibility on public.sales_order_items
  as restrictive for select to authenticated
  using (exists (
    select 1 from public.sales_orders so
    where so.id = sales_order_id and (so.archived_at is null or public.current_user_is_admin())
  ));
drop policy if exists stock_order_items_archive_visibility on public.stock_order_items;
create policy stock_order_items_archive_visibility on public.stock_order_items
  as restrictive for select to authenticated
  using (exists (
    select 1 from public.stock_orders so
    where so.id = stock_order_id and (so.archived_at is null or public.current_user_is_admin())
  ));

-- Trigger checks must see archived parents even when RLS hides them from the
-- mutating user; otherwise direct child-row updates could bypass the archive.
create or replace function public.prevent_archived_order_item_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
revoke all on function public.prevent_archived_order_item_mutation() from public, anon, authenticated;

create or replace function public.prevent_archived_order_delete()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if old.archived_at is not null then
    raise exception '已归档单据不可删除，请先由系统管理员恢复' using errcode = '55000';
  end if;
  return old;
end $$;
drop trigger if exists sales_orders_archived_delete_guard on public.sales_orders;
create trigger sales_orders_archived_delete_guard before delete on public.sales_orders
  for each row execute function public.prevent_archived_order_delete();
drop trigger if exists stock_orders_archived_delete_guard on public.stock_orders;
create trigger stock_orders_archived_delete_guard before delete on public.stock_orders
  for each row execute function public.prevent_archived_order_delete();

commit;
