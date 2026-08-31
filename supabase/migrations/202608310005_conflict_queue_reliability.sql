-- 修复历史生产库：customer_conflicts 已启用RLS但策略缺失，导致所有用户会话写入失败。
alter table public.customer_conflicts enable row level security;

drop policy if exists customer_conflicts_select on public.customer_conflicts;
create policy customer_conflicts_select on public.customer_conflicts
for select to authenticated using (
  reported_by = auth.uid()
  or exists (
    select 1 from public.users actor
    where actor.id = auth.uid() and actor.role in ('ADMIN', 'SUPERVISOR') and actor.status = 'ACTIVE'
  )
);

drop policy if exists customer_conflicts_insert on public.customer_conflicts;
create policy customer_conflicts_insert on public.customer_conflicts
for insert to authenticated with check (reported_by = auth.uid());

drop policy if exists customer_conflicts_update on public.customer_conflicts;
create policy customer_conflicts_update on public.customer_conflicts
for update to authenticated using (
  reported_by = auth.uid()
  or exists (
    select 1 from public.users actor
    where actor.id = auth.uid() and actor.role = 'ADMIN' and actor.status = 'ACTIVE'
  )
) with check (
  reported_by = auth.uid()
  or exists (
    select 1 from public.users actor
    where actor.id = auth.uid() and actor.role = 'ADMIN' and actor.status = 'ACTIVE'
  )
);

create index if not exists customer_conflicts_reporter_created_idx
  on public.customer_conflicts (reported_by, created_at desc);

-- 把RLS故障期间安全降级保存的审计快照恢复到正式冲突队列。
-- 每个“提交人 + 客户”只恢复最新一条，客户主数据不会复制或改变归属。
insert into public.customer_conflicts (customer_id, reported_by, conflict_type, status, details, created_at)
select distinct on (log.user_id, log.target_id)
  log.target_id,
  log.user_id,
  coalesce(nullif(log.content ->> 'conflict_type', ''), 'CROSS_OWNER_DUPLICATE'),
  'OPEN',
  case
    when jsonb_typeof(log.content -> 'details') = 'object' then log.content -> 'details'
    when jsonb_typeof(log.content) = 'object' then log.content
    else '{}'::jsonb
  end,
  log.created_at
from public.audit_logs log
where log.action = 'CUSTOMER_CONFLICT_DETECTED'
  and log.user_id is not null
  and log.target_id is not null
  and exists (select 1 from auth.users actor where actor.id = log.user_id)
  and exists (select 1 from public.customers customer where customer.id = log.target_id)
  and not exists (
    select 1 from public.customer_conflicts conflict
    where conflict.reported_by = log.user_id
      and conflict.customer_id = log.target_id
      and conflict.status = 'OPEN'
  )
order by log.user_id, log.target_id, log.created_at desc
on conflict do nothing;
