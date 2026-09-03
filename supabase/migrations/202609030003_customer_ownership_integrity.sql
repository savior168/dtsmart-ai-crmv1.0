begin;

-- Customer ownership is a workflow fact, not an editable CRM field. The
-- authenticated role must use guarded RPCs; server-side service clients retain
-- their existing administrative access.
drop policy if exists customers_owner_or_admin_insert_v5 on public.customers;
drop policy if exists customers_owner_or_admin_update_v5 on public.customers;
drop policy if exists customers_owner_or_admin_delete_v5 on public.customers;
drop policy if exists customers_own_insert_v4 on public.customers;
drop policy if exists customers_own_update_v4 on public.customers;
drop policy if exists customers_own_delete_v4 on public.customers;
drop policy if exists customers_scope_insert_v3 on public.customers;
drop policy if exists customers_scope_update_v3 on public.customers;

drop policy if exists protection_owner_or_admin_write_v5 on public.customer_protection;
drop policy if exists protection_own_write_v4 on public.customer_protection;
drop policy if exists protection_scope_write_v3 on public.customer_protection;

revoke insert, update, delete on table public.customers from authenticated;
revoke insert, update, delete on table public.customer_protection from authenticated;

-- Normalize legacy owner columns before enforcing a single owner value.
update public.customers
set owner_user_id=owner_id,
    updated_at=now()
where owner_id is not null
  and owner_user_id is distinct from owner_id;

update public.customers
set owner_id=owner_user_id,
    updated_at=now()
where owner_id is null
  and owner_user_id is not null;

alter table public.customers
  drop constraint if exists customers_owner_columns_match;
alter table public.customers
  add constraint customers_owner_columns_match
  check (owner_id is not distinct from owner_user_id);

-- Preserve historical protection rows while leaving exactly one effective row
-- per customer. The latest row wins only for malformed legacy duplicates.
with ranked as (
  select id,
         row_number() over (
           partition by customer_id
           order by start_date desc nulls last, id desc
         ) as position
  from public.customer_protection
  where status='ACTIVE'
)
update public.customer_protection protection
set status='SUPERSEDED'
from ranked
where protection.id=ranked.id
  and ranked.position>1;

create unique index if not exists customer_protection_one_active_customer_idx
  on public.customer_protection(customer_id)
  where status='ACTIVE';

commit;
