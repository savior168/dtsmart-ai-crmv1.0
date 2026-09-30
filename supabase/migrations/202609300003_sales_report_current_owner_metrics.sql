begin;

-- Sales customer counts use the same active, currently owned population as the
-- dashboard. Creation events in the public pool and soft-deleted leads are not
-- sales customers. Keep the existing function signature for API compatibility.
create or replace function public.sales_performance_report(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid,name text,email text,new_customers bigint,claimed bigint,released bigint,followups bigint,quotes bigint,deals bigint,ai_valid bigint,customer_count bigint,conversion_rate numeric)
language sql stable security definer set search_path = public as $$
  with actor as (
    select id,role from public.users where id=auth.uid() and status='ACTIVE' and role<>'WAREHOUSE'
  ), sales as (
    select u.id,coalesce(nullif(u.name,''),u.email) as name,u.email
    from public.users u cross join actor a
    where u.status='ACTIVE' and (
      (a.role='ADMIN' and (u.role in ('SALES','MANAGER','SUPERVISOR') or u.id=a.id))
      or (a.role='SUPERVISOR' and (u.id=a.id or u.manager_id=a.id))
      or (a.role not in ('ADMIN','SUPERVISOR') and u.id=a.id)
    )
  ), customer_stats as (
    select s.id,
      count(c.id) filter(where c.created_at>=p_from and c.created_at<p_to) as new_customers,
      count(c.id) filter(where c.ai_screening_done is true and c.is_target_customer is true) as ai_valid,
      count(c.id) as customer_count,
      count(c.id) filter(where c.status='DEAL') as current_deals
    from sales s left join public.customers c on c.owner_id=s.id and c.deleted_at is null
    group by s.id
  ), claim_stats as (
    select s.id,
      count(cc.id) filter(where cc.action in ('CLAIM','TRANSFER')) as claimed,
      count(cc.id) filter(where cc.action='RELEASE') as released
    from sales s left join public.customer_claims cc on cc.user_id=s.id and cc.created_at>=p_from and cc.created_at<p_to
    group by s.id
  ), followup_stats as (
    select s.id,count(f.id) as followups
    from sales s left join public.followups f on f.user_id=s.id and f.created_at>=p_from and f.created_at<p_to
    group by s.id
  ), quote_stats as (
    select s.id,count(q.id) as quotes
    from sales s left join public.quotes q on q.owner_id=s.id and q.created_at>=p_from and q.created_at<p_to
    group by s.id
  ), deal_stats as (
    select s.id,count(distinct a.target_id) filter(where a.content->>'status'='DEAL') as deals
    from sales s left join public.audit_logs a on a.user_id=s.id and a.action='CUSTOMER_STAGE'
      and a.created_at>=p_from and a.created_at<p_to
    group by s.id
  )
  select s.id,s.name,s.email,cs.new_customers,cl.claimed,cl.released,fs.followups,qs.quotes,ds.deals,
    cs.ai_valid,cs.customer_count,
    coalesce(round(cs.current_deals::numeric*100/nullif(cs.customer_count,0),1),0)
  from sales s
  join customer_stats cs on cs.id=s.id
  join claim_stats cl on cl.id=s.id
  join followup_stats fs on fs.id=s.id
  join quote_stats qs on qs.id=s.id
  join deal_stats ds on ds.id=s.id
  order by ds.deals desc,coalesce(round(cs.current_deals::numeric*100/nullif(cs.customer_count,0),1),0) desc,fs.followups desc
$$;

create or replace function public.sales_report_breakdowns(p_from timestamptz,p_to timestamptz,p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor public.users; scope_id uuid; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role='WAREHOUSE' then raise exception '无权查看销售报表'; end if;
  if actor.role='ADMIN' then
    scope_id:=p_user_id;
  elsif actor.role='SUPERVISOR' then
    if p_user_id is null or p_user_id=actor.id then
      scope_id:=actor.id;
    elsif exists (select 1 from public.users u where u.id=p_user_id and u.manager_id=actor.id and u.status='ACTIVE') then
      scope_id:=p_user_id;
    else
      raise exception '无权查看该用户的数据';
    end if;
  else
    scope_id:=actor.id;
  end if;
  with scoped_customers as (
    select c.* from public.customers c
    where c.deleted_at is null and c.owner_id is not null and (scope_id is null or c.owner_id=scope_id)
  ), ai_rows as (
    select coalesce(nullif(ai_level,''),'未筛选') label,count(*) count from scoped_customers group by 1 order by 2 desc
  ), country_rows as (
    select coalesce(nullif(trim(country),''),'未知') label,count(*) count from scoped_customers group by 1 order by 2 desc limit 10
  ), stage_rows as (
    select status label,count(*) count from scoped_customers group by 1 order by 2 desc
  ), followup_rows as (
    select coalesce(nullif(type,''),'其他') label,count(*) count from public.followups
    where created_at>=p_from and created_at<p_to and (scope_id is null or user_id=scope_id) group by 1 order by 2 desc
  ), quote_rows as (
    select status label,count(*) count,coalesce(sum(total_amount),0) amount from public.quotes
    where created_at>=p_from and created_at<p_to and (scope_id is null or owner_id=scope_id) group by 1 order by 2 desc
  ), stock_rows as (
    select status label,count(*) count from public.stock_orders
    where created_at>=p_from and created_at<p_to and (scope_id is null or sales_user_id=scope_id) group by 1 order by 2 desc
  ), days as (
    select generate_series(date_trunc('day',p_from),date_trunc('day',p_to-interval '1 millisecond'),interval '1 day') as day_value
  ), trend_rows as (
    select to_char(d.day_value,'YYYY-MM-DD') date,
      (select count(*) from scoped_customers c where c.created_at>=d.day_value and c.created_at<d.day_value+interval '1 day') customers,
      (select count(*) from public.followups f where f.created_at>=d.day_value and f.created_at<d.day_value+interval '1 day' and (scope_id is null or f.user_id=scope_id)) followups,
      (select count(*) from public.quotes q where q.created_at>=d.day_value and q.created_at<d.day_value+interval '1 day' and (scope_id is null or q.owner_id=scope_id)) quotes
    from days d order by d.day_value
  )
  select jsonb_build_object(
    'ai_levels',coalesce((select jsonb_agg(ai_rows) from ai_rows),'[]'::jsonb),
    'countries',coalesce((select jsonb_agg(country_rows) from country_rows),'[]'::jsonb),
    'customer_stages',coalesce((select jsonb_agg(stage_rows) from stage_rows),'[]'::jsonb),
    'followup_types',coalesce((select jsonb_agg(followup_rows) from followup_rows),'[]'::jsonb),
    'quote_statuses',coalesce((select jsonb_agg(quote_rows) from quote_rows),'[]'::jsonb),
    'stock_statuses',coalesce((select jsonb_agg(stock_rows) from stock_rows),'[]'::jsonb),
    'trend',coalesce((select jsonb_agg(trend_rows) from trend_rows),'[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke execute on function public.sales_performance_report(timestamptz,timestamptz) from public,anon;
grant execute on function public.sales_performance_report(timestamptz,timestamptz) to authenticated;
revoke execute on function public.sales_report_breakdowns(timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.sales_report_breakdowns(timestamptz,timestamptz,uuid) to authenticated;

commit;
