-- Salespeople retain access to their own historical activity after a customer is transferred.
drop policy if exists claims_reports_select on public.customer_claims;
create policy claims_reports_select on public.customer_claims for select to authenticated using (
  user_id = auth.uid() or public.current_user_role() = 'ADMIN'
);

drop policy if exists followups_reports_select on public.followups;
create policy followups_reports_select on public.followups for select to authenticated using (
  user_id = auth.uid() or public.current_user_role() = 'ADMIN'
);

create index if not exists customers_created_by_created_at_idx on public.customers(created_by, created_at);
create index if not exists customer_claims_user_created_at_idx on public.customer_claims(user_id, created_at);
create index if not exists followups_user_created_at_idx on public.followups(user_id, created_at);
create index if not exists audit_logs_user_action_created_at_idx on public.audit_logs(user_id, action, created_at);

drop function if exists public.sales_performance_report(timestamptz, timestamptz);
create function public.sales_performance_report(p_from timestamptz, p_to timestamptz)
returns table (
  user_id uuid, name text, email text, new_customers bigint, claimed bigint,
  released bigint, followups bigint, quotes bigint, deals bigint,
  ai_valid bigint, customer_count bigint, conversion_rate numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select id, role from public.users where id = auth.uid() and status = 'ACTIVE'
  ), sales as (
    select u.id, coalesce(nullif(u.name, ''), u.email) as name, u.email
    from public.users u cross join actor a
    where u.status = 'ACTIVE' and (
      (a.role = 'ADMIN' and u.role in ('SALES', 'MANAGER')) or u.id = a.id
    )
  ), customer_stats as (
    select s.id,
      count(c.id) filter (where c.created_by = s.id and c.created_at between p_from and p_to) as new_customers,
      count(c.id) filter (where c.owner_id = s.id and c.ai_score >= 60 and c.deleted_at is null) as ai_valid
    from sales s left join public.customers c on c.created_by = s.id or c.owner_id = s.id group by s.id
  ), claim_stats as (
    select s.id,
      count(cc.id) filter (where cc.action in ('CLAIM', 'TRANSFER')) as claimed,
      count(cc.id) filter (where cc.action = 'RELEASE') as released,
      count(distinct cc.customer_id) filter (where cc.action in ('CLAIM', 'TRANSFER')) as customer_count
    from sales s left join public.customer_claims cc on cc.user_id = s.id and cc.created_at between p_from and p_to group by s.id
  ), followup_stats as (
    select s.id, count(f.id) as followups from sales s
    left join public.followups f on f.user_id = s.id and f.created_at between p_from and p_to group by s.id
  ), stage_stats as (
    select s.id,
      count(a.id) filter (where a.content ->> 'status' = 'QUOTE') as quotes,
      count(a.id) filter (where a.content ->> 'status' = 'DEAL') as deals
    from sales s left join public.audit_logs a on a.user_id = s.id and a.action = 'CUSTOMER_STAGE'
      and a.created_at between p_from and p_to group by s.id
  )
  select s.id, s.name, s.email, cs.new_customers, cl.claimed, cl.released, fs.followups,
    st.quotes, st.deals, cs.ai_valid, cl.customer_count,
    coalesce(round(st.deals::numeric * 100 / nullif(cl.customer_count, 0), 1), 0) as conversion_rate
  from sales s join customer_stats cs on cs.id = s.id join claim_stats cl on cl.id = s.id
  join followup_stats fs on fs.id = s.id join stage_stats st on st.id = s.id
  order by st.deals desc,
    coalesce(round(st.deals::numeric * 100 / nullif(cl.customer_count, 0), 1), 0) desc,
    fs.followups desc;
$$;

revoke execute on function public.sales_performance_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.sales_performance_report(timestamptz, timestamptz) to authenticated;
