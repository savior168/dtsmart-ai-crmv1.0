-- Compare each PI line's quantity-weighted supplier purchase price (product
-- price only; no packing, shipping, or other fees) with the seller estimate.
-- No business rows change.

create or replace function public.review_shipped_pi_seller_cost(
  p_order_id uuid, p_item_id uuid, p_expected_unit_cost_cny numeric,
  p_revised_unit_cost_cny numeric, p_reason text
) returns public.sales_order_items
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.sales_orders;
  stock public.stock_orders;
  stock_line public.stock_order_items;
  line public.sales_order_items;
  revised public.sales_order_items;
  actual_quantity numeric;
  actual_amount numeric;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into stock from public.stock_orders where sales_order_id=p_order_id for update;
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null or stock.id is null
    or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id
    or actor.role not in ('SALES','SUPERVISOR','ORDER_CLERK','ADMIN')
    or not public.current_user_has_business_permission('orders.cost_review') then
    raise exception '无此PI销售成本复核权限';
  end if;
  if target.confirmation_method<>'DIRECT_PI' or target.status<>'SHIPPED'
    or stock.status<>'SHIPPED'
    or not exists(select 1 from public.stock_order_items i where i.stock_order_id=stock.id
      and i.pi_amendment_cancelled_at is null)
    or exists(select 1 from public.stock_order_items i where i.stock_order_id=stock.id
      and i.pi_amendment_cancelled_at is null
      and i.shipped_quantity is distinct from i.quantity) then
    raise exception '整单全部交货代后才可复核销售预估成本';
  end if;
  if p_revised_unit_cost_cny is null or p_revised_unit_cost_cny<0
    or p_revised_unit_cost_cny>999999999999.99
    or p_revised_unit_cost_cny<>round(p_revised_unit_cost_cny,2)
    or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception '请填写有效的人民币成本单价和500字以内的复核原因';
  end if;
  select * into line from public.sales_order_items
    where id=p_item_id and sales_order_id=target.id
      and pi_amendment_cancelled_at is null for update;
  if line.id is null or line.estimated_unit_cost_cny is null
    or line.estimated_unit_cost_cny is distinct from p_expected_unit_cost_cny then
    raise exception '该产品成本已变化，请刷新后核对';
  end if;
  select * into stock_line from public.stock_order_items
    where stock_order_id=stock.id and line_number=line.line_number
      and pi_amendment_cancelled_at is null for update;
  if stock_line.id is null then raise exception '备货产品行不存在，请刷新核对'; end if;
  select coalesce(sum(a.quantity),0),
         coalesce(sum(a.quantity*a.purchase_unit_price_cny),0)
    into actual_quantity,actual_amount
    from public.supplier_receipt_allocations a
    where a.stock_order_item_id=stock_line.id;
  if actual_quantity<>stock_line.quantity or actual_quantity<=0
    or round(actual_amount/actual_quantity,2)<=line.estimated_unit_cost_cny then
    raise exception '仅当产品完整回货后的数量加权采购单价高于销售成本时，才可复核该产品';
  end if;
  if line.estimated_unit_cost_cny=p_revised_unit_cost_cny then
    raise exception '复核后的成本与当前成本相同';
  end if;
  update public.sales_order_items set estimated_unit_cost_cny=p_revised_unit_cost_cny
    where id=line.id returning * into revised;
  insert into public.pi_seller_cost_reviews(sales_order_id,sales_order_item_id,
    previous_unit_cost_cny,revised_unit_cost_cny,reason,reviewed_by)
  values(target.id,line.id,line.estimated_unit_cost_cny,p_revised_unit_cost_cny,
    btrim(p_reason),actor.id);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_SELLER_COST_REVIEW','sales_order',target.id,
    jsonb_build_object('item_id',line.id,'line_number',line.line_number,
      'previous_unit_cost_cny',line.estimated_unit_cost_cny,
      'revised_unit_cost_cny',p_revised_unit_cost_cny,'reason',btrim(p_reason)));
  return revised;
end;
$$;

create or replace function public.notify_pi_seller_cost_review_after_handoff()
returns trigger language plpgsql set search_path = '' as $$
declare
  target public.sales_orders;
  review_lines text;
  pi_reference text;
  recipient uuid;
begin
  if new.status='SHIPPED' and old.status is distinct from new.status then
    select * into target from public.sales_orders where id=new.sales_order_id;
    if target.confirmation_method='DIRECT_PI' then
      select string_agg(s.line_number::text, ', ' order by s.line_number)
        into review_lines
        from public.stock_order_items s
        join public.sales_order_items p on p.sales_order_id=target.id
          and p.line_number=s.line_number and p.pi_amendment_cancelled_at is null
        cross join lateral (
          select coalesce(sum(a.quantity),0) as received_quantity,
                 coalesce(sum(a.quantity*a.purchase_unit_price_cny),0) as purchase_amount
            from public.supplier_receipt_allocations a where a.stock_order_item_id=s.id
        ) actual
        where s.stock_order_id=new.id and s.pi_amendment_cancelled_at is null
          and p.estimated_unit_cost_cny is not null
          and actual.received_quantity=s.quantity and actual.received_quantity>0
          and round(actual.purchase_amount/actual.received_quantity,2)>p.estimated_unit_cost_cny;
      if nullif(review_lines,'') is not null then
        pi_reference := coalesce(nullif(btrim(target.warehouse_reference_number),''),'（未填写用户订单编号）');
        for recipient in
          select distinct user_id from unnest(array[target.prepared_by,target.sales_user_id]) as users(user_id)
          where user_id is not null
        loop
          insert into public.system_notifications
            (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
          values(recipient,'STOCK_STATUS_CHANGED','STOCK','PI订单销售成本待复核',
            format('PI订单 %s 已整单交货代；第 %s 项产品的采购均价高于提交的销售成本，请复核对应产品。',pi_reference,review_lines),
            '/orders/'||target.id,'sales_order',target.id,
            'pi-seller-cost-review:'||target.id||':'||recipient,'PENDING')
          on conflict(recipient_id,dedupe_key) where dedupe_key is not null do nothing;
        end loop;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_pi_seller_cost_review_after_handoff()
  from public,anon,authenticated;
