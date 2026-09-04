begin;

-- A contact value belongs to one customer master record globally. Company
-- names are presentation data and vary by spelling, legal suffix and locale;
-- they must never weaken phone/email/whatsapp duplicate protection.
create or replace function public.prevent_duplicate_customer_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone text;
  normalized_whatsapp text;
  normalized_email text;
  lock_keys text[];
  lock_key text;
begin
  normalized_phone := regexp_replace(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '^00', '');
  normalized_whatsapp := regexp_replace(regexp_replace(coalesce(new.whatsapp, ''), '[^0-9]', '', 'g'), '^00', '');
  normalized_email := lower(trim(coalesce(new.email, '')));

  select array_agg(value order by value)
    into lock_keys
    from unnest(array_remove(array[
      case when normalized_phone <> '' then 'phone:' || normalized_phone end,
      case when normalized_whatsapp <> '' then 'phone:' || normalized_whatsapp end,
      case when normalized_email <> '' then 'email:' || normalized_email end
    ], null)) as value;

  if lock_keys is null then return new; end if;
  foreach lock_key in array lock_keys loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;

  if exists (
    select 1
    from public.customers existing
    where existing.id <> new.id
      and existing.deleted_at is null
      and (
        (normalized_phone <> '' and normalized_phone in (
          regexp_replace(regexp_replace(coalesce(existing.phone, ''), '[^0-9]', '', 'g'), '^00', ''),
          regexp_replace(regexp_replace(coalesce(existing.whatsapp, ''), '[^0-9]', '', 'g'), '^00', '')
        ))
        or (normalized_whatsapp <> '' and normalized_whatsapp in (
          regexp_replace(regexp_replace(coalesce(existing.phone, ''), '[^0-9]', '', 'g'), '^00', ''),
          regexp_replace(regexp_replace(coalesce(existing.whatsapp, ''), '[^0-9]', '', 'g'), '^00', '')
        ))
        or (normalized_email <> '' and lower(trim(coalesce(existing.email, ''))) = normalized_email)
      )
  ) then
    raise exception using errcode = '23505', message = '电话、whatsapp或邮箱已存在于系统，不能创建重复客户';
  end if;

  return new;
end;
$$;

drop trigger if exists customers_prevent_duplicate_identity on public.customers;
create trigger customers_prevent_duplicate_identity
before insert or update of phone, whatsapp, email on public.customers
for each row execute function public.prevent_duplicate_customer_identity();

commit;
