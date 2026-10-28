-- Role-scoped sales performance detail. Confirmed sales orders are the only
-- source of performance; cancelled orders and drafts are excluded.
create or replace function public.sales_performance_detail(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor public.users; result jsonb; scope_ids uuid[];
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role='WAREHOUSE' then raise exception '无权查看销售业绩'; end if;
  if actor.role='ADMIN' then
    select coalesce(array_agg(id), '{}'::uuid[]) into scope_ids from public.users where status='ACTIVE' and role in ('SALES','SUPERVISOR');
  elsif actor.role='SUPERVISOR' then
    select array_agg(id) into scope_ids from public.users where status='ACTIVE' and (id=actor.id or manager_id=actor.id);
  else scope_ids:=array[actor.id]; end if;
  with scoped_orders as (
    select o.*, coalesce(c.company_name,o.customer_short_name,'未命名客户') customer_name
    from public.sales_orders o left join public.customers c on c.id=o.customer_id
    where o.sales_user_id=any(scope_ids) and o.confirmed_at>=p_from and o.confirmed_at<p_to and o.status<>'CANCELLED'
  ), order_cost as (
    select so.id, coalesce(sum(si.procurement_cost*si.quantity),0) cost
    from scoped_orders so left join public.stock_orders st on st.sales_order_id=so.id left join public.stock_order_items si on si.stock_order_id=st.id
    group by so.id
  ), customer_rows as (
    select customer_id, max(customer_name) label, count(*) order_count, coalesce(sum(total_amount),0) amount,
      coalesce(sum(oc.cost),0) cost, coalesce(sum(total_amount)-sum(oc.cost),0) profit
    from scoped_orders so join order_cost oc on oc.id=so.id group by customer_id order by amount desc
  ), product_rows as (
    select coalesce(nullif(trim(i.item_name),''),'未命名产品') label, coalesce(nullif(trim(i.brand),''),'') brand,
      coalesce(nullif(trim(i.model),''),'') model, sum(i.quantity) quantity, sum(i.amount) amount,
      coalesce(sum(si.procurement_cost*i.quantity),0) cost
    from scoped_orders so join public.sales_order_items i on i.sales_order_id=so.id
    left join public.stock_orders st on st.sales_order_id=so.id left join public.stock_order_items si on si.stock_order_id=st.id and si.line_number=i.line_number
    group by 1,2,3 order by amount desc
  ), order_rows as (
    select so.id,so.order_number,so.customer_id,so.customer_name,so.sales_user_id,so.currency,so.total_amount,
      so.confirmed_at,coalesce(oc.cost,0) cost,so.total_amount-coalesce(oc.cost,0) profit,
      coalesce((select jsonb_agg(jsonb_build_object('item_name',i.item_name,'brand',i.brand,'model',i.model,'quantity',i.quantity,'amount',i.amount) order by i.line_number) from public.sales_order_items i where i.sales_order_id=so.id),'[]'::jsonb) items
    from scoped_orders so join order_cost oc on oc.id=so.id order by so.confirmed_at desc
  )
  select jsonb_build_object(
    'scope_user_ids',to_jsonb(scope_ids),
    'orders',coalesce((select jsonb_agg(order_rows) from order_rows),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(customer_rows) from customer_rows),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(product_rows) from product_rows),'[]'::jsonb),
    'totals',jsonb_build_object('orders',(select count(*) from scoped_orders),'amount',(select coalesce(sum(total_amount),0) from scoped_orders),'cost',(select coalesce(sum(cost),0) from order_cost),'profit',(select coalesce(sum(total_amount)-sum(cost),0) from scoped_orders so join order_cost oc on oc.id=so.id),'currencies',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select currency,sum(total_amount) amount from scoped_orders group by currency order by currency) x)
  ) into result;
  return result;
end $$;
revoke execute on function public.sales_performance_detail(timestamptz,timestamptz) from public,anon;
grant execute on function public.sales_performance_detail(timestamptz,timestamptz) to authenticated;
