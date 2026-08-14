-- DTSmart AI CRM V2 additive compatibility migration.
-- No legacy table or column is removed. New tables default to deny under RLS.
create extension if not exists pgcrypto;

create table if not exists public.organizations (id uuid primary key default gen_random_uuid(), name text not null, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, name text, email text, avatar_url text, phone text, timezone text default 'Asia/Shanghai', language text default 'zh-CN', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.roles (id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade, code text not null, name text not null, created_at timestamptz not null default now(), unique(organization_id,code));
create table if not exists public.role_permissions (id uuid primary key default gen_random_uuid(), role_id uuid not null references public.roles(id) on delete cascade, permission text not null, unique(role_id,permission));
create table if not exists public.organization_members (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, role_id uuid references public.roles(id), status text not null default 'ACTIVE', created_at timestamptz not null default now(), unique(organization_id,user_id));
create table if not exists public.user_preferences (user_id uuid primary key references auth.users(id) on delete cascade, theme text default 'sky', table_columns jsonb not null default '{}'::jsonb, page_sizes jsonb not null default '{}'::jsonb, notifications jsonb not null default '{}'::jsonb, ai_preferences jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
create table if not exists public.saved_filters (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, name text not null, module text not null, definition jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

alter table public.customers add column if not exists organization_id uuid references public.organizations(id);
alter table public.customers add column if not exists owner_user_id uuid references auth.users(id);
alter table public.customers add column if not exists customer_name text;
alter table public.customers add column if not exists customer_name_normalized text;
alter table public.customers add column if not exists country_code text;
alter table public.customers add column if not exists city text;
alter table public.customers add column if not exists primary_contact_name text;
alter table public.customers add column if not exists primary_phone_raw text;
alter table public.customers add column if not exists primary_phone_normalized text;
alter table public.customers add column if not exists primary_email_raw text;
alter table public.customers add column if not exists primary_email_normalized text;
alter table public.customers add column if not exists website_url text;
alter table public.customers add column if not exists website_domain text;
alter table public.customers add column if not exists google_maps_url text;
alter table public.customers add column if not exists google_maps_place_id text;
alter table public.customers add column if not exists customer_type text;
alter table public.customers add column if not exists source_type text;
alter table public.customers add column if not exists source_reference text;
alter table public.customers add column if not exists business_status_id uuid;
alter table public.customers add column if not exists ai_status text not null default 'PENDING';
alter table public.customers add column if not exists ai_grade text;
alter table public.customers add column if not exists current_protection_id uuid;
alter table public.customers add column if not exists last_valid_activity_at timestamptz;
alter table public.customers add column if not exists next_followup_at timestamptz;
alter table public.customers add column if not exists row_version integer not null default 1;
update public.customers
set created_by = (select id from public.users where role = 'ADMIN' and status = 'ACTIVE' order by created_at asc limit 1)
where owner_id is null
  and created_by is null
  and exists (select 1 from public.users where role = 'ADMIN' and status = 'ACTIVE');
update public.customers set customer_name=coalesce(customer_name,company_name), owner_user_id=coalesce(owner_user_id,owner_id,created_by), primary_contact_name=coalesce(primary_contact_name,contact_name), primary_phone_raw=coalesce(primary_phone_raw,phone), primary_email_raw=coalesce(primary_email_raw,email), website_url=coalesce(website_url,website), google_maps_url=coalesce(google_maps_url,google_url), source_type=coalesce(source_type,source,'MANUAL'), ai_grade=coalesce(ai_grade,ai_level) where customer_name is null or owner_user_id is null;

create table if not exists public.customer_contacts (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete cascade, type text not null, value_raw text not null, value_normalized text, source text not null default 'MANUAL', is_primary boolean not null default false, created_at timestamptz not null default now());
create table if not exists public.customer_sources (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete cascade, source_type text not null, source_reference text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table if not exists public.customer_identity_keys (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete cascade, key_type text not null, key_hash text not null, created_at timestamptz not null default now(), unique(key_type,key_hash));
create table if not exists public.customer_protections (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete cascade, owner_user_id uuid not null references auth.users(id), starts_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '90 days'), status text not null default 'ACTIVE', reason text, created_at timestamptz not null default now());
create table if not exists public.protection_extension_requests (id uuid primary key default gen_random_uuid(), protection_id uuid not null references public.customer_protections(id) on delete cascade, requested_by uuid not null references auth.users(id), requested_days integer not null, reason text not null, status text not null default 'PENDING', reviewed_by uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.customer_conflicts (id uuid primary key default gen_random_uuid(), customer_id uuid references public.customers(id), import_row_id uuid, conflict_type text not null, status text not null default 'PENDING', details jsonb not null default '{}'::jsonb, reviewed_by uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.customer_status_definitions (id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id), code text not null, name text not null, sort_order integer not null default 0, is_active boolean not null default true, unique(organization_id,code));
create table if not exists public.customer_status_history (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete cascade, from_status text, to_status text not null, changed_by uuid references auth.users(id), reason text, created_at timestamptz not null default now());
create table if not exists public.customer_tags (id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id), name text not null, color text, unique(organization_id,name));
create table if not exists public.customer_tag_links (customer_id uuid not null references public.customers(id) on delete cascade, tag_id uuid not null references public.customer_tags(id) on delete cascade, primary key(customer_id,tag_id));

create table if not exists public.imports (id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id), created_by uuid not null references auth.users(id), filename text not null, status text not null default 'UPLOADED', total_count integer not null default 0, success_count integer not null default 0, skipped_count integer not null default 0, failed_count integer not null default 0, created_at timestamptz not null default now(), completed_at timestamptz);
create table if not exists public.import_rows (id uuid primary key default gen_random_uuid(), import_id uuid not null references public.imports(id) on delete cascade, row_number integer not null, raw_data jsonb not null, normalized_data jsonb, validation_status text not null default 'PENDING', validation_errors jsonb not null default '[]'::jsonb, customer_id uuid references public.customers(id), created_at timestamptz not null default now());
create table if not exists public.import_mapping_templates (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), name text not null, mapping jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table if not exists public.ai_screening_tasks (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), status text not null default 'PENDING', total_count integer not null default 0, success_count integer not null default 0, failed_count integer not null default 0, cancel_requested boolean not null default false, created_at timestamptz not null default now(), completed_at timestamptz);
create table if not exists public.ai_screening_task_items (id uuid primary key default gen_random_uuid(), task_id uuid not null references public.ai_screening_tasks(id) on delete cascade, customer_id uuid not null references public.customers(id) on delete cascade, status text not null default 'PENDING', progress integer not null default 0, error_message text, started_at timestamptz, completed_at timestamptz, unique(task_id,customer_id));
create table if not exists public.ai_screening_results (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete cascade, task_item_id uuid references public.ai_screening_task_items(id), score integer check(score between 0 and 100), grade text check(grade in ('A','B','C','D')), target_decision text not null default 'PENDING', customer_type text, summary text, priority text, followup_suggestion text, model text, created_at timestamptz not null default now());
create table if not exists public.ai_screening_evidence (id uuid primary key default gen_random_uuid(), result_id uuid not null references public.ai_screening_results(id) on delete cascade, evidence_type text not null, source_url text, title text, content text, metadata jsonb not null default '{}'::jsonb, fetched_at timestamptz not null default now());
create table if not exists public.ai_screening_rules (id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id), name text not null, definition jsonb not null default '{}'::jsonb, is_active boolean not null default true, updated_at timestamptz not null default now());
create table if not exists public.followup_reminders (id uuid primary key default gen_random_uuid(), followup_id uuid references public.followups(id) on delete cascade, customer_id uuid not null references public.customers(id) on delete cascade, user_id uuid not null references auth.users(id), remind_at timestamptz not null, status text not null default 'PENDING', created_at timestamptz not null default now());
create table if not exists public.quotes (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete cascade, created_by uuid not null references auth.users(id), quote_number text not null unique, currency text not null default 'USD', amount numeric(14,2) not null default 0, status text not null default 'DRAFT', valid_until date, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id) on delete cascade, description text not null, quantity numeric(12,2) not null default 1, unit_price numeric(14,2) not null default 0, amount numeric(14,2) generated always as (quantity*unit_price) stored);
create table if not exists public.attachments (id uuid primary key default gen_random_uuid(), customer_id uuid references public.customers(id) on delete cascade, followup_id uuid references public.followups(id) on delete cascade, uploaded_by uuid not null references auth.users(id), filename text not null, storage_path text not null, mime_type text, size_bytes bigint, created_at timestamptz not null default now());

alter table public.audit_logs add column if not exists organization_id uuid references public.organizations(id);
alter table public.audit_logs add column if not exists before_data jsonb;
alter table public.audit_logs add column if not exists after_data jsonb;
alter table public.audit_logs add column if not exists ip_address inet;
alter table public.audit_logs add column if not exists result text default 'SUCCESS';

create index if not exists customers_v2_owner_idx on public.customers(owner_user_id,deleted_at);
create index if not exists customers_v2_org_idx on public.customers(organization_id,deleted_at);
create index if not exists customers_v2_ai_idx on public.customers(owner_user_id,ai_status,deleted_at);
create index if not exists customer_contacts_lookup_idx on public.customer_contacts(customer_id,type,value_normalized);
create index if not exists protections_v2_active_idx on public.customer_protections(customer_id,status,expires_at);
create index if not exists ai_task_items_status_idx on public.ai_screening_task_items(task_id,status);
create index if not exists reminders_due_idx on public.followup_reminders(user_id,status,remind_at);

do $$ declare t text; begin foreach t in array array['organizations','profiles','roles','role_permissions','organization_members','user_preferences','saved_filters','customer_contacts','customer_sources','customer_identity_keys','customer_protections','protection_extension_requests','customer_conflicts','customer_status_definitions','customer_status_history','customer_tags','customer_tag_links','imports','import_rows','import_mapping_templates','ai_screening_tasks','ai_screening_task_items','ai_screening_results','ai_screening_evidence','ai_screening_rules','followup_reminders','quotes','quote_items','attachments'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists preferences_self on public.user_preferences;
create policy preferences_self on public.user_preferences for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists saved_filters_self on public.saved_filters;
create policy saved_filters_self on public.saved_filters for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists imports_self on public.imports;
create policy imports_self on public.imports for all to authenticated using(created_by=auth.uid()) with check(created_by=auth.uid());
drop policy if exists ai_tasks_self on public.ai_screening_tasks;
create policy ai_tasks_self on public.ai_screening_tasks for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists reminders_self on public.followup_reminders;
create policy reminders_self on public.followup_reminders for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists quotes_self on public.quotes;
create policy quotes_self on public.quotes for all to authenticated using(created_by=auth.uid()) with check(created_by=auth.uid());
drop policy if exists attachments_self on public.attachments;
create policy attachments_self on public.attachments for all to authenticated using(uploaded_by=auth.uid()) with check(uploaded_by=auth.uid());

-- 客户数据必须同时在数据库层按当前用户隔离。替换旧版公共池/部门共享策略。
drop policy if exists customers_select on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists customers_delete on public.customers;
drop policy if exists customers_private_select on public.customers;
drop policy if exists customers_private_insert on public.customers;
drop policy if exists customers_private_update on public.customers;
drop policy if exists customers_private_delete on public.customers;

create policy customers_private_select on public.customers
for select to authenticated
using (
  deleted_at is null
  and coalesce(owner_user_id, owner_id, created_by) = auth.uid()
);

create policy customers_private_insert on public.customers
for insert to authenticated
with check (
  coalesce(owner_user_id, owner_id, created_by) = auth.uid()
  and created_by = auth.uid()
);

create policy customers_private_update on public.customers
for update to authenticated
using (coalesce(owner_user_id, owner_id, created_by) = auth.uid())
with check (coalesce(owner_user_id, owner_id, created_by) = auth.uid());

-- 不创建 DELETE 策略：客户删除统一通过 deleted_at 软删除，防止绕过审计永久删除。
