-- Price-only corrections use correct_direct_pi_line_prices. A warehouse
-- amendment must contain at least one product/quantity/instruction change.
do $guard$
declare
  definition text;
  changed text;
  marker text := 'if not changed then raise exception ''订单内容没有变化''; end if;';
begin
  definition := pg_get_functiondef('public.request_direct_pi_amendment(uuid,integer,jsonb,text)'::regprocedure);
  if length(definition) - length(replace(definition, marker, '')) <> length(marker) then
    raise exception 'request_direct_pi_amendment price-only guard target drifted';
  end if;
  changed := replace(definition, marker, marker || $insert$
  if jsonb_array_length(p_items) =
      (select count(*) from public.sales_order_items i
        where i.sales_order_id = target.id and i.pi_amendment_cancelled_at is null)
    and not exists (
      select 1 from jsonb_to_recordset(p_items) as x(
        id uuid,item_name text,brand text,model text,quality text,description text,
        description_zh text,preparation_requirement text,internal_note text,
        quantity numeric,unit_price_cny numeric,estimated_unit_cost_cny numeric)
      left join public.sales_order_items i on i.id = x.id
        and i.sales_order_id = target.id and i.pi_amendment_cancelled_at is null
      where i.id is null or row(x.item_name,x.brand,x.model,x.quality,
        x.description,x.description_zh,x.preparation_requirement,x.internal_note,x.quantity)
        is distinct from row(i.item_name,i.brand,i.model,i.quality,
        i.description,i.description_zh,i.preparation_requirement,i.internal_note,i.quantity)
    ) then
    raise exception '仅修改售价或销售成本请使用产品行更正价格，无需仓库确认';
  end if;
$insert$);
  execute changed;
end;
$guard$;
