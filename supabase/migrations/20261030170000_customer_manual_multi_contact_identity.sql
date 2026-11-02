begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Some environments already have these structured columns; keep their values.
alter table public.customers add column if not exists phone_numbers jsonb not null default '[]'::jsonb;
alter table public.customers add column if not exists email_addresses jsonb not null default '[]'::jsonb;
alter table public.customers add column if not exists whatsapp_numbers jsonb not null default '[]'::jsonb;
alter table public.customers add column if not exists wechat_numbers jsonb not null default '[]'::jsonb;

-- Manual phone, WhatsApp and email fields retain their legacy text columns.
-- Semicolon-separated values must all participate in the global identity guard.
create or replace function public.customer_manual_identity_keys(p_phone text, p_whatsapp text, p_email text, p_phone_numbers jsonb, p_whatsapp_numbers jsonb, p_email_addresses jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct key order by key), array[]::text[])
  from (
    select 'phone:' || regexp_replace(regexp_replace(trim(value), '[^0-9]', '', 'g'), '^00', '') as key
    from regexp_split_to_table(coalesce(p_phone, '') || ';' || coalesce(p_whatsapp, '') || ';' ||
      coalesce((select string_agg(value, ';') from jsonb_array_elements_text(coalesce(p_phone_numbers, '[]'::jsonb)) as value), '') || ';' ||
      coalesce((select string_agg(value, ';') from jsonb_array_elements_text(coalesce(p_whatsapp_numbers, '[]'::jsonb)) as value), ''), E'[,，;；|\\r\\n]+') as value
    union all
    select 'email:' || lower(trim(value)) as key
    from regexp_split_to_table(coalesce(p_email, '') || ';' ||
      coalesce((select string_agg(value, ';') from jsonb_array_elements_text(coalesce(p_email_addresses, '[]'::jsonb)) as value), ''), E'[,，;；|\\r\\n]+') as value
  ) entries
  where key not in ('phone:', 'email:');
$$;

create or replace function public.prevent_duplicate_customer_identity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lock_keys text[];
  lock_key text;
begin
  if new.deleted_at is not null then return new; end if;
  -- Historical duplicate identities are not rewritten by this migration.
  -- Changing unrelated profile fields must not newly block those rows.
  if tg_op = 'UPDATE'
    and new.phone is not distinct from old.phone
    and new.whatsapp is not distinct from old.whatsapp
    and new.email is not distinct from old.email
    and new.phone_numbers is not distinct from old.phone_numbers
    and new.whatsapp_numbers is not distinct from old.whatsapp_numbers
    and new.email_addresses is not distinct from old.email_addresses
    and new.deleted_at is not distinct from old.deleted_at then
    return new;
  end if;
  lock_keys := public.customer_manual_identity_keys(new.phone, new.whatsapp, new.email, new.phone_numbers, new.whatsapp_numbers, new.email_addresses);
  if cardinality(lock_keys) = 0 then return new; end if;
  foreach lock_key in array lock_keys loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;
  if exists (
    select 1 from public.customers existing
    where existing.id <> new.id and existing.deleted_at is null
      and lock_keys && public.customer_manual_identity_keys(existing.phone, existing.whatsapp, existing.email, existing.phone_numbers, existing.whatsapp_numbers, existing.email_addresses)
  ) then
    raise exception using errcode = '23505', message = '电话、whatsapp或邮箱已存在于系统，不能创建重复客户';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_prevent_duplicate_identity on public.customers;
create trigger customers_prevent_duplicate_identity
before insert or update of phone, whatsapp, email, phone_numbers, whatsapp_numbers, email_addresses on public.customers
for each row execute function public.prevent_duplicate_customer_identity();

commit;

