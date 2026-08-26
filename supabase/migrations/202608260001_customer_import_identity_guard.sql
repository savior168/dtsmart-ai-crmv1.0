-- Permanently remove all historical soft deletes and extra duplicate master
-- rows. The earliest active customer is retained for each normalized
-- company-name + phone/email identity.
create temporary table customer_cleanup_ids (
  id uuid primary key,
  reason text not null
) on commit drop;

insert into customer_cleanup_ids (id, reason)
select id, 'HISTORICAL_SOFT_DELETE'
from public.customers
where deleted_at is not null;

with normalized as (
  select
    id,
    created_at,
    lower(regexp_replace(trim(coalesce(company_name, '')), '\s+', ' ', 'g')) as normalized_name,
    regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') as normalized_phone,
    lower(trim(coalesce(email, ''))) as normalized_email
  from public.customers
  where deleted_at is null
), ranked as (
  select
    *,
    case when normalized_name <> '' and normalized_phone <> '' then
      row_number() over (partition by normalized_name, normalized_phone order by created_at asc nulls last, id)
    else 1 end as phone_rank,
    case when normalized_name <> '' and normalized_email <> '' then
      row_number() over (partition by normalized_name, normalized_email order by created_at asc nulls last, id)
    else 1 end as email_rank
  from normalized
)
insert into customer_cleanup_ids (id, reason)
select id, 'DUPLICATE_CUSTOMER'
from ranked
where phone_rank > 1 or email_rank > 1
on conflict (id) do update set reason = excluded.reason;

do $$
begin
  if to_regclass('public.import_rows') is not null then
    update public.import_rows
       set customer_id = null
     where customer_id in (select id from customer_cleanup_ids);
  end if;
  if to_regclass('public.customer_conflicts') is not null then
    delete from public.customer_conflicts
     where customer_id in (select id from customer_cleanup_ids);
  end if;
end;
$$;

delete from public.customers
where id in (select id from customer_cleanup_ids);

insert into public.audit_logs (user_id, action, target_type, target_id, content)
select
  null,
  'CUSTOMER_PHYSICAL_CLEANUP',
  'customer',
  null,
  jsonb_build_object(
    'permanent_delete', true,
    'soft_deleted_removed', count(*) filter (where reason = 'HISTORICAL_SOFT_DELETE'),
    'duplicate_rows_removed', count(*) filter (where reason = 'DUPLICATE_CUSTOMER')
  )
from customer_cleanup_ids;

-- Prevent duplicate customer rows even when imports run concurrently.
create or replace function public.prevent_duplicate_customer_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_name text;
  normalized_phone text;
  normalized_email text;
  lock_keys text[];
  lock_key text;
begin
  normalized_name := lower(regexp_replace(trim(coalesce(new.company_name, '')), '\s+', ' ', 'g'));
  normalized_phone := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
  normalized_email := lower(trim(coalesce(new.email, '')));

  if normalized_name = '' or (normalized_phone = '' and normalized_email = '') then
    return new;
  end if;

  select array_agg(value order by value)
    into lock_keys
    from unnest(array_remove(array[
      case when normalized_phone <> '' then 'phone:' || normalized_name || '|' || normalized_phone end,
      case when normalized_email <> '' then 'email:' || normalized_name || '|' || normalized_email end
    ], null)) as value;

  foreach lock_key in array lock_keys loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;

  if exists (
    select 1
      from public.customers existing
     where existing.id <> new.id
       and lower(regexp_replace(trim(coalesce(existing.company_name, '')), '\s+', ' ', 'g')) = normalized_name
       and (
         (normalized_phone <> '' and regexp_replace(coalesce(existing.phone, ''), '[^0-9]', '', 'g') = normalized_phone)
         or
         (normalized_email <> '' and lower(trim(coalesce(existing.email, ''))) = normalized_email)
       )
  ) then
    raise exception using
      errcode = '23505',
      message = '客户已存在于系统，保留最先导入的数据';
  end if;

  return new;
end;
$$;

drop trigger if exists customers_prevent_duplicate_identity on public.customers;
create trigger customers_prevent_duplicate_identity
before insert on public.customers
for each row execute function public.prevent_duplicate_customer_identity();
