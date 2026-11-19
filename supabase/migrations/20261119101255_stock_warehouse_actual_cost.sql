-- Warehouse-verified quote cost is distinct from both the seller's PI estimate
-- and the supplier's actual purchase price recorded in receipt allocations.
alter table public.stock_order_items
  add column if not exists warehouse_actual_unit_cost_cny numeric(14,2)
    check (warehouse_actual_unit_cost_cny is null or warehouse_actual_unit_cost_cny >= 0),
  add column if not exists warehouse_actual_cost_updated_at timestamptz,
  add column if not exists warehouse_actual_cost_updated_by uuid references public.users(id);

-- Existing stock lines use explicit column SELECT grants. Expose only the
-- warehouse-verified quote price, never purchase price or supplier details.
grant select (warehouse_actual_unit_cost_cny, warehouse_actual_cost_updated_at)
  on public.stock_order_items to authenticated;

insert into public.role_permission_settings(role_code, permission_code, enabled)
values ('WAREHOUSE', 'stock.actual_cost.edit', true)
on conflict (role_code, permission_code) do nothing;

create or replace function public.update_stock_warehouse_actual_cost(
  p_stock_order_id uuid,
  p_item_id uuid,
  p_expected_cost_cny numeric,
  p_new_cost_cny numeric,
  p_reason text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor public.users;
  stock public.stock_orders;
  line public.stock_order_items;
  prior_cost numeric;
  seller_cost numeric;
  target public.sales_orders;
  recipient uuid;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE', 'ADMIN')
    or not public.current_user_has_business_permission('stock.actual_cost.edit')
  then raise exception '无仓库实际成本核价权限'; end if;
  select * into stock from public.stock_orders where id = p_stock_order_id for update;
  if stock.id is null or stock.status in ('DRAFT', 'CANCELLED')
  then raise exception '备货单不存在或当前状态不可核价'; end if;
  select * into line from public.stock_order_items
    where id = p_item_id and stock_order_id = stock.id
      and pi_amendment_cancelled_at is null for update;
  if line.id is null then raise exception '产品项不存在'; end if;
  prior_cost := coalesce(line.warehouse_actual_unit_cost_cny, line.estimated_unit_cost_cny);
  if p_expected_cost_cny is distinct from prior_cost
  then raise exception '实际成本价已被他人更新，请刷新后重试'; end if;
  if p_new_cost_cny is null or p_new_cost_cny < 0 or p_new_cost_cny > 999999999999.99
    or p_new_cost_cny <> round(p_new_cost_cny, 2)
  then raise exception '实际成本价须为有效的非负金额，最多两位小数'; end if;
  if p_new_cost_cny = prior_cost then raise exception '实际成本价没有变化'; end if;
  if length(trim(coalesce(p_reason, ''))) < 2 or length(p_reason) > 500
  then raise exception '请填写2至500字的核价原因'; end if;
  update public.stock_order_items set
    warehouse_actual_unit_cost_cny = p_new_cost_cny,
    warehouse_actual_cost_updated_at = now(),
    warehouse_actual_cost_updated_by = actor.id
  where id = line.id;
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
  values (actor.id, 'STOCK_WAREHOUSE_ACTUAL_COST_UPDATE', 'stock_order', stock.id,
    jsonb_build_object('item_id', line.id, 'line_number', line.line_number,
      'before_cny', prior_cost, 'after_cny', p_new_cost_cny, 'reason', trim(p_reason)));
  select * into target from public.sales_orders where id = stock.sales_order_id;
  select estimated_unit_cost_cny into seller_cost from public.sales_order_items
    where sales_order_id = target.id and line_number = line.line_number
      and pi_amendment_cancelled_at is null;
  if p_new_cost_cny > seller_cost then
    for recipient in
      select distinct u.id from public.users u
      where u.id in (target.prepared_by, target.sales_user_id) and u.status = 'ACTIVE'
    loop
      insert into public.system_notifications
        (recipient_id, type, category, title, content, href, entity_type, entity_id,
         dedupe_key, action_status)
      values (recipient, 'STOCK_STATUS_CHANGED', 'STOCK', 'PI产品实际成本上涨待核对',
        format('PI %s 第 %s 项仓库实际成本由 ¥%s 调整为 ¥%s，高于销售成本 ¥%s；请核对报价。',
          coalesce(nullif(trim(target.warehouse_reference_number), ''), target.order_number),
          line.line_number, prior_cost, p_new_cost_cny, seller_cost),
        '/orders/' || target.id, 'sales_order', target.id,
        'pi-actual-cost-rise:' || line.id || ':' || recipient, 'PENDING')
      on conflict (recipient_id, dedupe_key) where dedupe_key is not null
      do update set content = excluded.content, action_status = 'PENDING',
        read_at = null, archived_at = null, deliver_at = now();
    end loop;
  else
    update public.system_notifications set action_status = 'RESOLVED',
      read_at = coalesce(read_at, now())
    where dedupe_key like 'pi-actual-cost-rise:' || line.id || ':%'
      and action_status = 'PENDING';
  end if;
end $$;

revoke execute on function public.update_stock_warehouse_actual_cost(uuid,uuid,numeric,numeric,text) from public, anon;
grant execute on function public.update_stock_warehouse_actual_cost(uuid,uuid,numeric,numeric,text) to authenticated;
