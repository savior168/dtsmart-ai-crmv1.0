begin;

-- Return every raw country group so the API can merge equivalent ISO codes and
-- localized country names before selecting the actual top ten.
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
    select coalesce(nullif(trim(country),''),'未知') label,count(*) count from scoped_customers group by 1
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

commit;
