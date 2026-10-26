begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- PL/pgSQL trigger records only expose columns belonging to the triggering
-- table. Avoid CASE expressions referencing fields from both item tables.
create or replace function public.prevent_archived_order_item_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  parent_id uuid;
  parent_archived_at timestamptz;
  old_parent_archived_at timestamptz;
begin
  if tg_table_name = 'sales_order_items' then
    if tg_op = 'DELETE' then
      parent_id := old.sales_order_id;
    else
      parent_id := new.sales_order_id;
    end if;
    select so.archived_at into parent_archived_at
      from public.sales_orders so where so.id = parent_id;
    if tg_op = 'UPDATE' then
      select so.archived_at into old_parent_archived_at
        from public.sales_orders so where so.id = old.sales_order_id;
    end if;
  else
    if tg_op = 'DELETE' then
      parent_id := old.stock_order_id;
    else
      parent_id := new.stock_order_id;
    end if;
    select so.archived_at into parent_archived_at
      from public.stock_orders so where so.id = parent_id;
    if tg_op = 'UPDATE' then
      select so.archived_at into old_parent_archived_at
        from public.stock_orders so where so.id = old.stock_order_id;
    end if;
  end if;

  if parent_archived_at is not null or old_parent_archived_at is not null then
    raise exception '已归档单据明细只读，请先由系统管理员恢复后再操作' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.prevent_archived_order_item_mutation() from public, anon, authenticated;

commit;
