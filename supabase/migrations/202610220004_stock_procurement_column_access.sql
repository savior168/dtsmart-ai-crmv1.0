begin;

-- Sensitive purchase data is fetched only through authorized server routes.
-- Stock item mutations already go through permission-checked database functions.
revoke all privileges on table public.stock_order_items from public, anon, authenticated;
revoke all privileges (
  id, stock_order_id, line_number, item_name, brand, model, quality, description,
  description_zh, procurement_cost, quantity, preparation_requirement,
  product_type_snapshot, product_specifications_snapshot, product_color_snapshot,
  procurement_cost_confirmed, internal_note, estimated_unit_cost_cny,
  received_quantity, warehouse_supplier_code, preparation_status,
  prepared_quantity, shipped_quantity, warehouse_note
) on table public.stock_order_items from public, anon, authenticated;
grant select on table public.stock_order_items to service_role;
grant select (
  id,
  stock_order_id,
  line_number,
  item_name,
  brand,
  model,
  quality,
  description,
  description_zh,
  quantity,
  preparation_requirement,
  product_type_snapshot,
  product_specifications_snapshot,
  product_color_snapshot,
  estimated_unit_cost_cny,
  received_quantity,
  prepared_quantity,
  shipped_quantity,
  preparation_status,
  warehouse_supplier_code,
  internal_note
) on public.stock_order_items to authenticated;

commit;
