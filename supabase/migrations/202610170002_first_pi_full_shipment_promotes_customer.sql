begin;
set local lock_timeout = '5s';

-- A won customer is a customer whose first active, submitted PI has actually
-- completed the whole stock-order shipment. Drafts and cancelled PIs do not
-- establish a sale. Apply the transition in the shipment transaction when
-- customer contact data satisfies the existing customer-stage constraint.
create function public.promote_customer_after_first_pi_shipment(p_customer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  customer_row public.customers;
  first_pi public.sales_orders;
  first_stock public.stock_orders;
  actor_id uuid := auth.uid();
begin
  select * into customer_row from public.customers
    where id = p_customer_id and deleted_at is null for update;
  if customer_row.id is null or customer_row.owner_id is null
    or customer_row.status not in ('CLAIMED', 'FOLLOWING') then
    return;
  end if;

  -- A potential customer may have been entered with just one contact method.
  -- Never fail a real warehouse handoff for that CRM data gap. The contact
  -- update trigger below retries the promotion when both fields are present.
  if nullif(btrim(coalesce(customer_row.phone, '')), '') is null
    or nullif(btrim(coalesce(customer_row.email, '')), '') is null then
    return;
  end if;

  select * into first_pi from public.sales_orders
    where customer_id = customer_row.id and confirmed_at is not null
      and status not in ('DRAFT', 'CANCELLED')
    order by confirmed_at, created_at, id limit 1;
  if first_pi.id is null then return; end if;

  select * into first_stock from public.stock_orders
    where sales_order_id = first_pi.id limit 1;
  if first_stock.id is null or first_stock.status <> 'SHIPPED' then return; end if;
  if not exists (select 1 from public.stock_order_items i
      where i.stock_order_id = first_stock.id) or exists (
      select 1 from public.stock_order_items i
      where i.stock_order_id = first_stock.id
        and (i.quantity <= 0 or i.shipped_quantity is distinct from i.quantity)
    ) then return;
  end if;

  update public.customer_protection set status = 'SUPERSEDED'
    where customer_id = customer_row.id and owner_id = customer_row.owner_id
      and status = 'ACTIVE';
  insert into public.customer_protection
    (customer_id, owner_id, type, start_date, expire_date, status, extension_count)
    values (customer_row.id, customer_row.owner_id, 'DEAL', now(), null, 'ACTIVE', 0);
  update public.customers set status = 'DEAL', pool_status = 'CLAIMED', updated_at = now()
    where id = customer_row.id;
  insert into public.customer_status_history
    (customer_id, from_status, to_status, changed_by, reason)
    values (customer_row.id, customer_row.status, 'DEAL', actor_id,
      format('首张有效PI %s 的备货单 %s 已全部产品发货，系统自动更新客户阶段',
        first_pi.order_number, first_stock.stock_number));
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
    values (actor_id, 'CUSTOMER_STAGE_AUTO_FIRST_PI_SHIPPED', 'customer',
      customer_row.id, jsonb_build_object(
        'from_status', customer_row.status, 'to_status', 'DEAL',
        'pi_id', first_pi.id, 'pi_number', first_pi.order_number,
        'stock_order_id', first_stock.id, 'stock_number', first_stock.stock_number));
end $$;

revoke all on function public.promote_customer_after_first_pi_shipment(uuid)
  from public, anon, authenticated;

create function public.promote_customer_after_stock_shipped()
returns trigger language plpgsql security definer set search_path = '' as $$
declare customer_id_value uuid;
begin
  if new.status = 'SHIPPED' and old.status is distinct from new.status then
    select customer_id into customer_id_value from public.sales_orders
      where id = new.sales_order_id;
    if customer_id_value is not null then
      perform public.promote_customer_after_first_pi_shipment(customer_id_value);
    end if;
  end if;
  return new;
end $$;

create trigger stock_orders_first_pi_customer_stage
after update of status on public.stock_orders for each row
execute function public.promote_customer_after_stock_shipped();
revoke all on function public.promote_customer_after_stock_shipped()
  from public, anon, authenticated;

create function public.retry_first_pi_customer_stage_after_contact_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('CLAIMED', 'FOLLOWING')
    and (old.phone is distinct from new.phone or old.email is distinct from new.email) then
    perform public.promote_customer_after_first_pi_shipment(new.id);
  end if;
  return new;
end $$;

create trigger customers_retry_first_pi_customer_stage
after update of phone, email on public.customers for each row
execute function public.retry_first_pi_customer_stage_after_contact_update();
revoke all on function public.retry_first_pi_customer_stage_after_contact_update()
  from public, anon, authenticated;

commit;
