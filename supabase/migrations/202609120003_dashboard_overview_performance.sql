begin;

-- The dashboard previously paged every matching customer to the application
-- server and calculated its cards there.  Keep the same business scope, but
-- aggregate inside Postgres so a large date range cannot hit statement_timeout.
create index if not exists customers_dashboard_created_active_idx
  on public.customers (created_at desc)
  where deleted_at is null;

create index if not exists customers_dashboard_owner_created_active_idx
  on public.customers (owner_id, created_at desc)
  where deleted_at is null;

create or replace function public.dashboard_overview(
  p_from timestamptz,
  p_to timestamptz,
  p_scope_user_id uuid default null,
  p_country text default null,
  p_ai_level text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor public.users;
  effective_scope uuid;
  today_start timestamptz := date_trunc('day', now());
  tomorrow timestamptz := date_trunc('day', now()) + interval '1 day';
  protection_end timestamptz := date_trunc('day', now()) + interval '8 days';
  result jsonb;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role = 'WAREHOUSE' then
    raise exception '无权查看工作台';
  end if;

  if actor.role = 'ADMIN' then
    effective_scope := p_scope_user_id;
  elsif actor.role = 'SUPERVISOR' then
    if p_scope_user_id is null or p_scope_user_id = actor.id then
      effective_scope := actor.id;
    elsif exists (select 1 from public.users u where u.id = p_scope_user_id and u.manager_id = actor.id and u.status = 'ACTIVE') then
      effective_scope := p_scope_user_id;
    else
      raise exception '无权查看该用户的数据';
    end if;
  else
    effective_scope := actor.id;
  end if;

  with scoped_customers as materialized (
    select c.id,c.company_name,c.phone,c.email,c.country,c.ai_level,c.ai_score,c.status,c.last_contact_time,c.created_at
    from public.customers c
    where c.deleted_at is null
      and c.created_at >= p_from
      and c.created_at < p_to
      and (effective_scope is null or c.owner_id = effective_scope)
  ), filtered_customers as materialized (
    select * from scoped_customers c
    where (nullif(trim(p_country),'') is null or lower(coalesce(c.country,'')) like '%' || lower(trim(p_country)) || '%')
      and (nullif(trim(p_ai_level),'') is null or c.ai_level = trim(p_ai_level))
  ), country_options as (
    select array_agg(country order by country) as countries
    from (select distinct trim(country) as country from scoped_customers where nullif(trim(country),'') is not null) rows
  ), distribution as (
    select case
      when ai_score is null then '未筛选'
      when ai_level in ('A','B','C','D') then ai_level
      when ai_score >= 80 then 'A'
      when ai_score >= 60 then 'B'
      when ai_score >= 40 then 'C'
      else 'D'
    end as grade, count(*)::integer as count
    from filtered_customers
    group by 1
  ), distribution_rows as (
    select grade,count from distribution
    union all select required.grade,0 from unnest(array['A','B','C','D','未筛选']) as required(grade)
    where not exists (select 1 from distribution d where d.grade = required.grade)
  ), country_rows as (
    select coalesce(nullif(trim(country),''),'未知') as name,count(*)::integer as count
    from filtered_customers group by 1 order by count desc,name limit 10
  ), protection_rows as (
    select p.id,p.customer_id,p.expire_date,c.company_name,c.country,
      greatest(0,ceil(extract(epoch from (p.expire_date - today_start)) / 86400))::integer as days
    from public.customer_protection p
    join filtered_customers c on c.id = p.customer_id
    where p.status = 'ACTIVE' and p.expire_date is not null
      and p.expire_date >= today_start and p.expire_date < protection_end
    order by p.expire_date asc
  ), due_followups as (
    select distinct on (f.customer_id) f.id,f.customer_id,f.type,f.next_follow_date,c.company_name,c.phone,c.email,c.country,c.ai_level,c.last_contact_time,c.status
    from public.followups f
    join filtered_customers c on c.id = f.customer_id
    where f.next_follow_date >= today_start and f.next_follow_date < tomorrow
      and c.status in ('CLAIMED','FOLLOWING','QUOTE')
    order by f.customer_id,f.next_follow_date asc,f.created_at desc
  ), activity_rows as (
    select a.id,a.action,a.target_id,a.content,a.created_at,c.company_name
    from public.audit_logs a
    join filtered_customers c on c.id = a.target_id
    where a.target_type = 'customer'
    order by a.created_at desc
    limit 5
  ), totals as (
    select count(*)::integer as my_customers,
      count(*) filter(where ai_score is null)::integer as pending_ai,
      count(*) filter(where ai_score >= 60)::integer as valid_customers,
      count(*) filter(where status in ('CLAIMED','FOLLOWING'))::integer as intentions,
      count(*) filter(where status = 'QUOTE')::integer as quotes,
      count(*) filter(where status = 'DEAL')::integer as deals
    from filtered_customers
  )
  select jsonb_build_object(
    'filters',jsonb_build_object('countries',coalesce((select to_jsonb(countries) from country_options),'[]'::jsonb)),
    'totals',jsonb_build_object(
      'my_customers',(select my_customers from totals),
      'pending_ai',(select pending_ai from totals),
      'valid_customers',(select valid_customers from totals),
      'intentions',(select intentions from totals),
      'today_followups',(select count(*)::integer from due_followups),
      'expiring_protection',(select count(*)::integer from protection_rows),
      'quotes',(select quotes from totals),'deals',(select deals from totals)
    ),
    'distribution',coalesce((select jsonb_agg(jsonb_build_object('grade',grade,'count',count) order by array_position(array['A','B','C','D','未筛选'],grade)) from distribution_rows),'[]'::jsonb),
    'country_top',coalesce((select jsonb_agg(jsonb_build_object('name',name,'count',count) order by count desc,name) from country_rows),'[]'::jsonb),
    'protections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'customer_id',customer_id,'customer_name',company_name,'country',country,'expires_at',expire_date,'days',days) order by days,customer_name) from (select * from protection_rows limit 20) rows),'[]'::jsonb),
    'followups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'customer_id',customer_id,'customer_name',company_name,'phone',phone,'email',email,'country',country,'ai_level',ai_level,'last_followup',last_contact_time,'followup_time',next_follow_date,'type',type,'status',status,'protection_days',null) order by next_follow_date,company_name) from (select * from due_followups limit 5) rows),'[]'::jsonb),
    'activities',coalesce((select jsonb_agg(jsonb_build_object('id',id,'action',action,'customer_name',company_name,'content',content,'created_at',created_at) order by created_at desc) from activity_rows),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke execute on function public.dashboard_overview(timestamptz,timestamptz,uuid,text,text) from public,anon;
grant execute on function public.dashboard_overview(timestamptz,timestamptz,uuid,text,text) to authenticated;

commit;
