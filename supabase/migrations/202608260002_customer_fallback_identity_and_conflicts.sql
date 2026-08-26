-- Close the sparse-customer identity gap left by name + phone/email-only
-- matching. URL identity is a fallback only when the incoming row has neither
-- phone nor email, preventing branches that share a corporate site from being
-- merged automatically.

-- Compatibility for projects initialized before the conflict-visibility
-- migration. Existing conflict rows remain valid and gain the current fields.
create table if not exists public.customer_conflicts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  conflict_type text not null default 'DUPLICATE_IMPORT',
  status text not null default 'OPEN',
  details jsonb not null default '{}'::jsonb,
  reported_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.customer_conflicts add column if not exists reported_by uuid references auth.users(id);
alter table public.customer_conflicts add column if not exists conflict_type text not null default 'DUPLICATE_IMPORT';
alter table public.customer_conflicts add column if not exists status text not null default 'OPEN';
alter table public.customer_conflicts add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.customer_conflicts add column if not exists created_at timestamptz not null default now();

create or replace function public.normalize_customer_identity_url(value text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        split_part(split_part(trim(coalesce(value, '')), '#', 1), '?', 1),
        '^https?://(www\.)?', '', 'i'
      ),
      '/(index\.(html?|php))?$|/$', '', 'i'
    )
  );
$$;

-- Keep the oldest row for sparse identities already repeated in production.
create temporary table customer_fallback_duplicate_map (
  duplicate_id uuid primary key,
  keeper_id uuid not null
) on commit drop;

with normalized as (
  select
    id,
    created_at,
    lower(regexp_replace(trim(coalesce(company_name, '')), '\s+', ' ', 'g')) as normalized_name,
    regexp_replace(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '^00', '') as normalized_phone,
    lower(trim(coalesce(email, ''))) as normalized_email,
    public.normalize_customer_identity_url(website) as normalized_website,
    public.normalize_customer_identity_url(google_url) as normalized_google
  from public.customers
), identity_rows as (
  select id, created_at, 'website:' || normalized_name || '|' || normalized_website as identity_key
  from normalized
  where normalized_name <> '' and normalized_phone = '' and normalized_email = '' and normalized_website <> ''
  union all
  select id, created_at, 'google:' || normalized_name || '|' || normalized_google as identity_key
  from normalized
  where normalized_name <> '' and normalized_phone = '' and normalized_email = '' and normalized_google <> ''
), ranked as (
  select
    id as duplicate_id,
    first_value(id) over (partition by identity_key order by created_at asc nulls last, id) as keeper_id,
    first_value(created_at) over (partition by identity_key order by created_at asc nulls last, id) as keeper_created_at,
    row_number() over (partition by identity_key order by created_at asc nulls last, id) as identity_rank
  from identity_rows
), candidates as (
  select * from ranked where identity_rank > 1
)
insert into customer_fallback_duplicate_map (duplicate_id, keeper_id)
select distinct on (duplicate_id) duplicate_id, keeper_id
from candidates
where duplicate_id <> keeper_id
order by duplicate_id, keeper_created_at asc nulls last, keeper_id;

-- Retain import/audit traceability while removing the duplicate master row.
do $$
begin
  if to_regclass('public.import_rows') is not null then
    update public.import_rows row
       set customer_id = map.keeper_id
      from customer_fallback_duplicate_map map
     where row.customer_id = map.duplicate_id;
  end if;
  if to_regclass('public.audit_logs') is not null then
    update public.audit_logs log
       set target_id = map.keeper_id
      from customer_fallback_duplicate_map map
     where log.target_type = 'customer' and log.target_id = map.duplicate_id;
  end if;
  if to_regclass('public.customer_conflicts') is not null then
    delete from public.customer_conflicts conflict
     using customer_fallback_duplicate_map map
     where conflict.customer_id = map.duplicate_id;
  end if;
end;
$$;

insert into public.audit_logs (user_id, action, target_type, target_id, content)
select null, 'CUSTOMER_FALLBACK_DUPLICATE_CLEANUP', 'customer', keeper_id,
       jsonb_build_object('duplicate_customer_id', duplicate_id, 'permanent_delete', true)
from customer_fallback_duplicate_map;

delete from public.customers customer
using customer_fallback_duplicate_map map
where customer.id = map.duplicate_id;

-- The same importer/customer combination represents one open conflict, even
-- after repeated imports. Retain the earliest conflict snapshot.
delete from public.customer_conflicts newer
using public.customer_conflicts earlier
where newer.reported_by = earlier.reported_by
  and newer.customer_id = earlier.customer_id
  and newer.status = 'OPEN'
  and earlier.status = 'OPEN'
  and (newer.created_at, newer.id) > (earlier.created_at, earlier.id);

create unique index if not exists customer_conflicts_one_open_per_reporter_uidx
  on public.customer_conflicts(reported_by, customer_id)
  where status = 'OPEN' and reported_by is not null and customer_id is not null;

-- Block duplicates even when two import requests race. Phone/email remain the
-- strong identity. Website/Google identity is checked only for sparse rows.
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
  normalized_website text;
  normalized_google text;
  lock_keys text[];
  lock_key text;
begin
  normalized_name := lower(regexp_replace(trim(coalesce(new.company_name, '')), '\s+', ' ', 'g'));
  normalized_phone := regexp_replace(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '^00', '');
  normalized_email := lower(trim(coalesce(new.email, '')));
  normalized_website := public.normalize_customer_identity_url(new.website);
  normalized_google := public.normalize_customer_identity_url(new.google_url);

  if normalized_name = '' then return new; end if;

  select array_agg(value order by value)
    into lock_keys
    from unnest(array_remove(array[
      case when normalized_phone <> '' then 'phone:' || normalized_name || '|' || normalized_phone end,
      case when normalized_email <> '' then 'email:' || normalized_name || '|' || normalized_email end,
      case when normalized_website <> '' then 'website:' || normalized_name || '|' || normalized_website end,
      case when normalized_google <> '' then 'google:' || normalized_name || '|' || normalized_google end
    ], null)) as value;

  if lock_keys is null then return new; end if;
  foreach lock_key in array lock_keys loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;

  if exists (
    select 1
    from public.customers existing
    where existing.id <> new.id
      and lower(regexp_replace(trim(coalesce(existing.company_name, '')), '\s+', ' ', 'g')) = normalized_name
      and (
        (normalized_phone <> '' and regexp_replace(regexp_replace(coalesce(existing.phone, ''), '[^0-9]', '', 'g'), '^00', '') = normalized_phone)
        or (normalized_email <> '' and lower(trim(coalesce(existing.email, ''))) = normalized_email)
        or (
          normalized_phone = '' and normalized_email = '' and (
            (normalized_website <> '' and public.normalize_customer_identity_url(existing.website) = normalized_website)
            or (normalized_google <> '' and public.normalize_customer_identity_url(existing.google_url) = normalized_google)
          )
        )
      )
  ) then
    raise exception using errcode = '23505', message = '客户已存在于系统，保留最先导入的数据';
  end if;

  return new;
end;
$$;

drop trigger if exists customers_prevent_duplicate_identity on public.customers;
create trigger customers_prevent_duplicate_identity
before insert on public.customers
for each row execute function public.prevent_duplicate_customer_identity();
