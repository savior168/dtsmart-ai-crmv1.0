begin;
set local lock_timeout = '5s';

-- A genuinely shipped first PI is independent evidence of a completed deal.
-- Keep manual stage changes subject to the existing contact requirement.
create function public.customer_first_pi_fully_shipped(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with first_pi as (
    select id from public.sales_orders
    where customer_id = p_customer_id and confirmed_at is not null
      and status not in ('DRAFT', 'CANCELLED')
    order by confirmed_at, created_at, id limit 1
  ), stock as (
    select s.id from public.stock_orders s join first_pi p on p.id = s.sales_order_id
    where s.status = 'SHIPPED' limit 1
  )
  select exists (
    select 1 from stock s
    where exists (select 1 from public.stock_order_items i where i.stock_order_id = s.id)
      and not exists (select 1 from public.stock_order_items i
        where i.stock_order_id = s.id
          and (i.quantity <= 0 or i.shipped_quantity is distinct from i.quantity))
  );
$$;
revoke all on function public.customer_first_pi_fully_shipped(uuid) from public, anon, authenticated;

create or replace function public.require_customer_stage_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('FOLLOWING', 'DEAL')
    and nullif(btrim(coalesce(new.phone, '')), '') is null
    and nullif(btrim(coalesce(new.email, '')), '') is null
    and nullif(btrim(coalesce(new.wechat, '')), '') is null
    and nullif(btrim(coalesce(new.whatsapp, '')), '') is null
    and jsonb_array_length(coalesce(new.phone_numbers, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(new.email_addresses, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(new.wechat_numbers, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(new.whatsapp_numbers, '[]'::jsonb)) = 0
    and not exists (select 1 from public.customer_contacts contact
      where contact.customer_id = new.id
        and contact.type in ('PHONE', 'EMAIL', 'WECHAT', 'WHATSAPP')
        and nullif(btrim(coalesce(contact.value_raw, '')), '') is not null)
    and not (new.status = 'DEAL'
      and public.customer_first_pi_fully_shipped(new.id)) then
    raise exception '意向客户和成交客户至少填写电话、邮箱、微信或 WhatsApp 其中一项'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Preserve the existing shipment trigger, protection and audit behavior.
-- The prior implementation incorrectly required BOTH phone and email.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.promote_customer_after_first_pi_shipment(uuid)'::regprocedure);
  if position('if nullif(btrim(coalesce(customer_row.phone' in definition) = 0
    or position('select * into first_pi' in definition) = 0 then
    raise exception 'Unexpected first-PI promotion implementation; manual review required';
  end if;
  definition := regexp_replace(definition,
    '  if nullif\(btrim\(coalesce\(customer_row\.phone, ''''\)\), ''''\) is null\s+or nullif\(btrim\(coalesce\(customer_row\.email, ''''\)\), ''''\) is null then\s+return;\s+end if;',
    '', '');
  if position('if nullif(btrim(coalesce(customer_row.phone' in definition) > 0 then
    raise exception 'Failed to remove obsolete two-contact gate';
  end if;
  execute definition;
end $$;

-- Idempotent repair: the existing function locks and rechecks every customer.
do $$
declare candidate record;
begin
  for candidate in
    select c.id from public.customers c
    where c.deleted_at is null and c.owner_id is not null
      and c.status in ('CLAIMED', 'FOLLOWING')
      and public.customer_first_pi_fully_shipped(c.id)
  loop
    perform public.promote_customer_after_first_pi_shipment(candidate.id);
  end loop;
end $$;
commit;
