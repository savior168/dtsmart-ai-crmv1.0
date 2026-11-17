-- Price corrections are commercial/accounting changes, not warehouse product
-- changes. Apply them atomically and preserve before/after values in the audit.
create function public.correct_direct_pi_line_prices(
  p_order_id uuid, p_item_id uuid, p_expected_revision integer,
  p_expected_sale_cny numeric, p_expected_cost_cny numeric,
  p_revised_sale_cny numeric, p_revised_cost_cny numeric, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.sales_orders;
  stock public.stock_orders;
  line public.sales_order_items;
  stock_line public.stock_order_items;
  payment_price numeric;
  v_subtotal_cny numeric;
  v_subtotal_payment numeric;
  base_cny numeric;
  base_payment numeric;
  fee_cny numeric;
  fee_payment numeric;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into stock from public.stock_orders where sales_order_id=p_order_id for update;
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null or stock.id is null
    or actor.role not in ('SALES','SUPERVISOR','ORDER_CLERK','ADMIN')
    or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id
    or not public.current_user_has_business_permission('orders.edit')
    or target.confirmation_method<>'DIRECT_PI' then
    raise exception '只有此PI创建人可更正产品价格';
  end if;
  if target.pi_revision is distinct from p_expected_revision
    or target.status in ('DRAFT','CANCELLED','SHIPPED')
    or stock.status in ('DRAFT','CANCELLED','SHIPPED') then
    raise exception 'PI版本或状态已变化，请刷新后核对';
  end if;
  if exists(select 1 from public.pi_amendment_requests
      where sales_order_id=p_order_id and status='PENDING') then
    raise exception '已有待确认的产品变更，请先处理后再更正价格';
  end if;
  if p_revised_sale_cny is null or p_revised_cost_cny is null
    or p_revised_sale_cny<0 or p_revised_cost_cny<0
    or p_revised_sale_cny>999999999999.99 or p_revised_cost_cny>999999999999.99
    or p_revised_sale_cny<>round(p_revised_sale_cny,2)
    or p_revised_cost_cny<>round(p_revised_cost_cny,2)
    or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500
    or target.fx_rate_cny_to_payment is null or target.fx_rate_cny_to_payment<=0 then
    raise exception '请填写有效的人民币单价、成本、付款汇率和更正原因';
  end if;
  select * into line from public.sales_order_items
    where id=p_item_id and sales_order_id=p_order_id
      and pi_amendment_cancelled_at is null for update;
  select * into stock_line from public.stock_order_items
    where stock_order_id=stock.id and line_number=line.line_number
      and pi_amendment_cancelled_at is null for update;
  if line.id is null or stock_line.id is null or stock_line.shipped_quantity>0
    or line.unit_price_cny is distinct from p_expected_sale_cny
    or line.estimated_unit_cost_cny is distinct from p_expected_cost_cny then
    raise exception '产品已交货代或价格已变化，请刷新后核对';
  end if;
  if line.unit_price_cny=p_revised_sale_cny
    and line.estimated_unit_cost_cny=p_revised_cost_cny then
    raise exception '新价格与当前价格相同';
  end if;
  payment_price:=round(p_revised_sale_cny*target.fx_rate_cny_to_payment,2);
  perform set_config('app.pi_amendment_apply','1',true);
  update public.stock_order_items set estimated_unit_cost_cny=p_revised_cost_cny
    where id=stock_line.id;
  perform set_config('app.pi_amendment_apply','0',true);
  update public.sales_order_items set unit_price_cny=p_revised_sale_cny,
    unit_price=payment_price,amount=payment_price*line.quantity,
    estimated_unit_cost_cny=p_revised_cost_cny where id=line.id;
  update public.quote_items set unit_price_cny=p_revised_sale_cny,
    unit_price=payment_price,amount=payment_price*line.quantity,
    unit_cost_cny=p_revised_cost_cny
    where quote_id=target.quote_id and line_number=line.line_number
      and pi_amendment_cancelled_at is null;
  if not found then raise exception '报价快照产品行不存在'; end if;
  select coalesce(sum(quantity*unit_price_cny),0),coalesce(sum(amount),0)
    into v_subtotal_cny,v_subtotal_payment from public.sales_order_items
    where sales_order_id=p_order_id and pi_amendment_cancelled_at is null;
  base_cny:=v_subtotal_cny+coalesce(target.shipping_cny,0)
    +coalesce(target.last_balance_cny,0)+coalesce(target.other_charge_cny,0)
    -coalesce(target.discount_cny,0);
  base_payment:=v_subtotal_payment+coalesce(target.shipping_cost,0)
    +coalesce(target.last_balance_amount,0)+coalesce(target.other_charge_amount,0)
    -coalesce(target.discount_amount,0);
  if base_cny<0 or base_payment<0 then raise exception '更正后折扣超过应付金额'; end if;
  fee_cny:=round(base_cny*coalesce(target.paypal_fee_percent,0)/100,2);
  fee_payment:=round(base_payment*coalesce(target.paypal_fee_percent,0)/100,2);
  update public.sales_orders set subtotal_cny=v_subtotal_cny,subtotal=v_subtotal_payment,
    paypal_fee_cny=fee_cny,paypal_fee_amount=fee_payment,
    total_cny=base_cny+fee_cny,total_amount=base_payment+fee_payment,
    pi_revision=pi_revision+1,updated_at=now() where id=p_order_id;
  update public.quotes set subtotal_cny=v_subtotal_cny,subtotal=v_subtotal_payment,
    paypal_fee_cny=fee_cny,paypal_fee_amount=fee_payment,
    total_cny=base_cny+fee_cny,total_amount=base_payment+fee_payment,
    amount=base_payment+fee_payment,version=version+1,updated_at=now()
    where id=target.quote_id;
  if not found then raise exception 'PI报价快照不存在'; end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'PI_LINE_PRICE_CORRECTED','sales_order',p_order_id,
      jsonb_build_object('item_id',line.id,'line_number',line.line_number,
        'previous_sale_cny',line.unit_price_cny,'revised_sale_cny',p_revised_sale_cny,
        'previous_cost_cny',line.estimated_unit_cost_cny,'revised_cost_cny',p_revised_cost_cny,
        'reason',btrim(p_reason),'revision',target.pi_revision+1));
  return jsonb_build_object('item_id',line.id,'revision',target.pi_revision+1);
end;
$$;
revoke all on function public.correct_direct_pi_line_prices(uuid,uuid,integer,numeric,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.correct_direct_pi_line_prices(uuid,uuid,integer,numeric,numeric,numeric,numeric,text) to authenticated;
