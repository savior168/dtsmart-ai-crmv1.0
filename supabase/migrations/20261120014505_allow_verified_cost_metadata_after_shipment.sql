-- Shipment freezes physical product history, not audited cost metadata.
create or replace function public.prevent_shipped_stock_line_amendment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.shipped_quantity > 0 then
      raise exception '第%项已有交货代数量，不能删除产品记录',old.line_number;
    end if;
    if old.received_quantity > 0 or old.prepared_quantity > 0 then
      raise exception '第%项已有回货或理货记录，须先核对实物并冲正后才能删除',old.line_number;
    end if;
    return old;
  end if;
  if current_setting('app.pi_amendment_apply',true)='1'
    and to_jsonb(new) - 'estimated_unit_cost_cny'
      = to_jsonb(old) - 'estimated_unit_cost_cny' then
    return new;
  end if;
  if current_setting('app.warehouse_actual_cost_apply',true)='1'
    and to_jsonb(new) - 'warehouse_actual_unit_cost_cny'
      - 'warehouse_actual_cost_updated_at' - 'warehouse_actual_cost_updated_by'
      = to_jsonb(old) - 'warehouse_actual_unit_cost_cny'
      - 'warehouse_actual_cost_updated_at' - 'warehouse_actual_cost_updated_by' then
    return new;
  end if;
  if old.shipped_quantity > 0 and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception '第%项已有交货代数量，不能变更已发货产品记录',old.line_number;
  end if;
  if current_setting('app.pi_amendment_apply',true)='1'
    and old.shipped_quantity=0 and new.quantity>=old.received_quantity
    and new.quantity>=old.prepared_quantity then return new; end if;
  if old.received_quantity > 0 and (
    new.quantity is distinct from old.quantity
    or new.item_name is distinct from old.item_name
    or new.brand is distinct from old.brand
    or new.model is distinct from old.model
    or new.quality is distinct from old.quality
    or new.description is distinct from old.description
    or new.product_type_snapshot is distinct from old.product_type_snapshot
    or new.estimated_unit_cost_cny is distinct from old.estimated_unit_cost_cny
  ) then
    raise exception '第%项已有实物回货，须先由仓库核对并冲正或重新分配，才能生效PI产品变更',old.line_number;
  end if;
  return new;
end;
$$;

-- The update RPC owns the stock row lock, role/permission checks, optimistic
-- price check and audit entry. Mark only that narrow metadata update.
do $$
declare
  definition text;
  changed text;
begin
  definition := pg_get_functiondef('public.update_stock_warehouse_actual_cost(uuid,uuid,numeric,numeric,text)'::regprocedure);
  if position('  update public.stock_order_items set' in definition)=0
    or position('  where id = line.id;' in definition)=0 then
    raise exception 'warehouse actual cost RPC update drifted';
  end if;
  changed := replace(definition,
    '  update public.stock_order_items set',
    '  perform set_config(''app.warehouse_actual_cost_apply'', ''1'', true);
  update public.stock_order_items set');
  changed := replace(changed,
    '  where id = line.id;',
    '  where id = line.id;
  perform set_config(''app.warehouse_actual_cost_apply'', ''0'', true);');
  execute changed;
end $$;
