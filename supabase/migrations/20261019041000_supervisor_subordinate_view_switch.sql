begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.users
  add column if not exists supervisor_can_view_subordinates boolean not null default false;

comment on column public.users.supervisor_can_view_subordinates is
  '仅系统管理员可授权主管读取直属下属数据；默认关闭。';

-- A later role change must not reactivate a previous supervisor grant.
create or replace function public.reset_supervisor_subordinate_view_on_role_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role
    or (new.status is distinct from old.status and new.status <> 'ACTIVE') then
    new.supervisor_can_view_subordinates := false;
  end if;
  return new;
end;
$$;
drop trigger if exists reset_supervisor_subordinate_view_on_role_change on public.users;
create trigger reset_supervisor_subordinate_view_on_role_change
before update of role, status on public.users
for each row execute function public.reset_supervisor_subordinate_view_on_role_change();

create or replace function public.supervisor_can_read_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users actor
    join public.users subordinate on subordinate.id = p_user_id
    where actor.id = auth.uid() and actor.role = 'SUPERVISOR' and actor.status = 'ACTIVE'
      and not actor.must_change_password
      and (actor.locked_until is null or actor.locked_until <= now())
      and public.current_session_is_current(actor.force_logout_at)
      and (subordinate.id = actor.id or (
        actor.supervisor_can_view_subordinates and subordinate.manager_id = actor.id
        and subordinate.status = 'ACTIVE'
      ))
  );
$$;

revoke all on function public.supervisor_can_read_user(uuid) from public, anon;
grant execute on function public.supervisor_can_read_user(uuid) to authenticated, service_role;

create or replace function public.supervisor_can_read_customer(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c where c.id = p_customer_id and c.deleted_at is null
      and public.supervisor_can_read_user(auth.uid())
      and (public.supervisor_can_read_user(coalesce(c.owner_id, c.owner_user_id, c.created_by))
        or (c.owner_id is null and c.acquisition_scope = 'PUBLIC_POOL'
          and c.pool_status = 'AVAILABLE' and c.status = 'UNCLAIMED'))
  );
$$;

revoke all on function public.supervisor_can_read_customer(uuid) from public, anon;
grant execute on function public.supervisor_can_read_customer(uuid) to authenticated, service_role;

create or replace function public.set_supervisor_subordinate_view(
  p_supervisor_id uuid,
  p_enabled boolean,
  p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.users;
begin
  select * into actor from public.users
  where id = auth.uid() and role = 'ADMIN' and status = 'ACTIVE' and not must_change_password
    and (locked_until is null or locked_until <= now())
    and public.current_session_is_current(force_logout_at);
  if actor.id is null then raise exception '仅已启用的系统管理员可以设置主管数据范围'; end if;
  if p_enabled is null or nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500 then
    raise exception '必须提供开关状态和 1 至 500 字的操作原因';
  end if;
  select * into target from public.users where id = p_supervisor_id and role = 'SUPERVISOR' for update;
  if target.id is null then raise exception '指定用户不是主管'; end if;
  if p_enabled and target.status <> 'ACTIVE' then raise exception '只能为已启用主管开启下属数据查看'; end if;
  if target.supervisor_can_view_subordinates = p_enabled then return; end if;
  update public.users set supervisor_can_view_subordinates = p_enabled where id = target.id;
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
  values (actor.id, 'ADMIN_SUPERVISOR_DATA_SCOPE', 'user', target.id,
    jsonb_build_object('previous_enabled', target.supervisor_can_view_subordinates,
      'next_enabled', p_enabled, 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.set_supervisor_subordinate_view(uuid,boolean,text) from public, anon;
grant execute on function public.set_supervisor_subordinate_view(uuid,boolean,text) to authenticated;

-- Restrictive SELECT policies are AND-ed with all existing permissive policies.
-- A client holding a Supabase token cannot bypass the application switch by
-- querying PostgREST directly. This does not grant any cross-user writes.
drop policy if exists users_supervisor_data_scope on public.users;
create policy users_supervisor_data_scope on public.users as restrictive
for select to authenticated using (
  -- users contains account/security metadata, so direct Data API access is
  -- always self-only. The server returns a narrow colleague directory view.
  public.current_user_role() <> 'SUPERVISOR' or id = auth.uid()
);

drop policy if exists customers_supervisor_data_scope on public.customers;
create policy customers_supervisor_data_scope on public.customers as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR'
  or public.supervisor_can_read_user(coalesce(owner_id, owner_user_id, created_by))
  or (owner_id is null and acquisition_scope = 'PUBLIC_POOL' and pool_status = 'AVAILABLE' and status = 'UNCLAIMED')
);

-- Historical permissive elevated-role policies are still present. Read access
-- must never become an implicit cross-user write grant for supervisors.
drop policy if exists customers_supervisor_own_insert on public.customers;
create policy customers_supervisor_own_insert on public.customers as restrictive
for insert to authenticated with check (
  public.current_user_role() <> 'SUPERVISOR'
  or (created_by = auth.uid() and coalesce(owner_id, owner_user_id, created_by) = auth.uid())
);
drop policy if exists customers_supervisor_own_update on public.customers;
create policy customers_supervisor_own_update on public.customers as restrictive
for update to authenticated
using (public.current_user_role() <> 'SUPERVISOR' or coalesce(owner_id, owner_user_id, created_by) = auth.uid())
with check (public.current_user_role() <> 'SUPERVISOR' or coalesce(owner_id, owner_user_id, created_by) = auth.uid());
drop policy if exists customers_supervisor_own_delete on public.customers;
create policy customers_supervisor_own_delete on public.customers as restrictive
for delete to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or coalesce(owner_id, owner_user_id, created_by) = auth.uid()
);

drop policy if exists quotes_supervisor_data_scope on public.quotes;
create policy quotes_supervisor_data_scope on public.quotes as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_user(owner_id)
);
drop policy if exists quotes_supervisor_own_insert on public.quotes;
create policy quotes_supervisor_own_insert on public.quotes as restrictive
for insert to authenticated with check (
  public.current_user_role() <> 'SUPERVISOR' or (
    owner_id = auth.uid() and created_by = auth.uid() and exists (
      select 1 from public.customers c where c.id = customer_id
        and coalesce(c.owner_id, c.owner_user_id, c.created_by) = auth.uid()
    )
  )
);
drop policy if exists quotes_supervisor_own_update on public.quotes;
create policy quotes_supervisor_own_update on public.quotes as restrictive
for update to authenticated
using (public.current_user_role() <> 'SUPERVISOR' or owner_id = auth.uid())
with check (public.current_user_role() <> 'SUPERVISOR' or (
  owner_id = auth.uid() and exists (
    select 1 from public.customers c where c.id = customer_id
      and coalesce(c.owner_id, c.owner_user_id, c.created_by) = auth.uid()
  )
));

drop policy if exists quote_items_supervisor_data_scope on public.quote_items;
create policy quote_items_supervisor_data_scope on public.quote_items as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.quotes q where q.id = quote_id and public.supervisor_can_read_user(q.owner_id)
  )
);

drop policy if exists sales_orders_supervisor_data_scope on public.sales_orders;
create policy sales_orders_supervisor_data_scope on public.sales_orders as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_user(sales_user_id)
);
drop policy if exists sales_orders_supervisor_direct_report on public.sales_orders;
create policy sales_orders_supervisor_direct_report on public.sales_orders
for select to authenticated using (
  public.current_user_role() = 'SUPERVISOR' and public.supervisor_can_read_user(sales_user_id)
);

drop policy if exists sales_order_items_supervisor_data_scope on public.sales_order_items;
create policy sales_order_items_supervisor_data_scope on public.sales_order_items as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.sales_orders o where o.id = sales_order_id and public.supervisor_can_read_user(o.sales_user_id)
  )
);
drop policy if exists sales_order_items_supervisor_direct_report on public.sales_order_items;
create policy sales_order_items_supervisor_direct_report on public.sales_order_items
for select to authenticated using (
  public.current_user_role() = 'SUPERVISOR' and exists (
    select 1 from public.sales_orders o where o.id = sales_order_id and public.supervisor_can_read_user(o.sales_user_id)
  )
);

drop policy if exists stock_orders_supervisor_data_scope on public.stock_orders;
create policy stock_orders_supervisor_data_scope on public.stock_orders as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_user(sales_user_id)
);
drop policy if exists stock_orders_supervisor_direct_report on public.stock_orders;
create policy stock_orders_supervisor_direct_report on public.stock_orders
for select to authenticated using (
  public.current_user_role() = 'SUPERVISOR' and public.supervisor_can_read_user(sales_user_id)
);

drop policy if exists stock_order_items_supervisor_data_scope on public.stock_order_items;
create policy stock_order_items_supervisor_data_scope on public.stock_order_items as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.stock_orders s where s.id = stock_order_id and public.supervisor_can_read_user(s.sales_user_id)
  )
);
drop policy if exists stock_order_items_supervisor_direct_report on public.stock_order_items;
create policy stock_order_items_supervisor_direct_report on public.stock_order_items
for select to authenticated using (
  public.current_user_role() = 'SUPERVISOR' and exists (
    select 1 from public.stock_orders s where s.id = stock_order_id and public.supervisor_can_read_user(s.sales_user_id)
  )
);

drop policy if exists stock_order_events_supervisor_data_scope on public.stock_order_events;
create policy stock_order_events_supervisor_data_scope on public.stock_order_events as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.stock_orders s where s.id = stock_order_id and public.supervisor_can_read_user(s.sales_user_id)
  )
);
drop policy if exists stock_order_events_supervisor_direct_report on public.stock_order_events;
create policy stock_order_events_supervisor_direct_report on public.stock_order_events
for select to authenticated using (
  public.current_user_role() = 'SUPERVISOR' and exists (
    select 1 from public.stock_orders s where s.id = stock_order_id and public.supervisor_can_read_user(s.sales_user_id)
  )
);

drop policy if exists followups_supervisor_data_scope on public.followups;
create policy followups_supervisor_data_scope on public.followups as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR'
  or public.supervisor_can_read_customer(customer_id)
);
drop policy if exists followups_supervisor_own_insert on public.followups;
create policy followups_supervisor_own_insert on public.followups as restrictive
for insert to authenticated with check (
  public.current_user_role() <> 'SUPERVISOR' or (
    user_id = auth.uid() and exists (
      select 1 from public.customers c where c.id = customer_id
        and coalesce(c.owner_id, c.owner_user_id, c.created_by) = auth.uid()
    )
  )
);
drop policy if exists followups_supervisor_own_update on public.followups;
create policy followups_supervisor_own_update on public.followups as restrictive
for update to authenticated
using (public.current_user_role() <> 'SUPERVISOR' or user_id = auth.uid())
with check (public.current_user_role() <> 'SUPERVISOR' or (
  user_id = auth.uid() and exists (
    select 1 from public.customers c where c.id = customer_id
      and coalesce(c.owner_id, c.owner_user_id, c.created_by) = auth.uid()
  )
));

drop policy if exists import_tasks_supervisor_data_scope on public.import_tasks;
create policy import_tasks_supervisor_data_scope on public.import_tasks as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_user(created_by)
);
drop policy if exists import_tasks_supervisor_own_update on public.import_tasks;
create policy import_tasks_supervisor_own_update on public.import_tasks as restrictive
for update to authenticated
using (public.current_user_role() <> 'SUPERVISOR' or created_by = auth.uid())
with check (public.current_user_role() <> 'SUPERVISOR' or created_by = auth.uid());

drop policy if exists ai_tasks_supervisor_data_scope on public.ai_screening_tasks;
create policy ai_tasks_supervisor_data_scope on public.ai_screening_tasks as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_user(user_id)
);
drop policy if exists ai_tasks_supervisor_own_insert on public.ai_screening_tasks;
create policy ai_tasks_supervisor_own_insert on public.ai_screening_tasks as restrictive
for insert to authenticated with check (
  public.current_user_role() <> 'SUPERVISOR' or user_id = auth.uid()
);
drop policy if exists ai_tasks_supervisor_own_update on public.ai_screening_tasks;
create policy ai_tasks_supervisor_own_update on public.ai_screening_tasks as restrictive
for update to authenticated
using (public.current_user_role() <> 'SUPERVISOR' or user_id = auth.uid())
with check (public.current_user_role() <> 'SUPERVISOR' or user_id = auth.uid());
drop policy if exists ai_tasks_supervisor_own_delete on public.ai_screening_tasks;
create policy ai_tasks_supervisor_own_delete on public.ai_screening_tasks as restrictive
for delete to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or user_id = auth.uid()
);

drop policy if exists ai_task_items_supervisor_data_scope on public.ai_screening_task_items;
create policy ai_task_items_supervisor_data_scope on public.ai_screening_task_items as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.ai_screening_tasks t where t.id = task_id and public.supervisor_can_read_user(t.user_id)
  )
);

drop policy if exists ai_results_supervisor_data_scope on public.ai_screening_results;
create policy ai_results_supervisor_data_scope on public.ai_screening_results as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.ai_screening_tasks t where t.id = task_id and public.supervisor_can_read_user(t.user_id)
  )
);

drop policy if exists ai_evidence_supervisor_data_scope on public.ai_screening_evidence;
create policy ai_evidence_supervisor_data_scope on public.ai_screening_evidence as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.ai_screening_tasks t where t.id = task_id and public.supervisor_can_read_user(t.user_id)
  )
);

drop policy if exists customer_claims_supervisor_data_scope on public.customer_claims;
create policy customer_claims_supervisor_data_scope on public.customer_claims as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_protection_supervisor_data_scope on public.customer_protection;
create policy customer_protection_supervisor_data_scope on public.customer_protection as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);
drop policy if exists customer_protection_supervisor_own_insert on public.customer_protection;
create policy customer_protection_supervisor_own_insert on public.customer_protection as restrictive
for insert to authenticated with check (
  public.current_user_role() <> 'SUPERVISOR' or (
    owner_id = auth.uid() and exists (
      select 1 from public.customers c where c.id = customer_id
        and coalesce(c.owner_id, c.owner_user_id, c.created_by) = auth.uid()
    )
  )
);
drop policy if exists customer_protection_supervisor_own_update on public.customer_protection;
create policy customer_protection_supervisor_own_update on public.customer_protection as restrictive
for update to authenticated
using (public.current_user_role() <> 'SUPERVISOR' or owner_id = auth.uid())
with check (public.current_user_role() <> 'SUPERVISOR' or (
  owner_id = auth.uid() and exists (
    select 1 from public.customers c where c.id = customer_id
      and coalesce(c.owner_id, c.owner_user_id, c.created_by) = auth.uid()
  )
));
drop policy if exists customer_protection_supervisor_own_delete on public.customer_protection;
create policy customer_protection_supervisor_own_delete on public.customer_protection as restrictive
for delete to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or owner_id = auth.uid()
);

drop policy if exists customer_renewals_supervisor_data_scope on public.customer_protection_renewal_requests;
create policy customer_renewals_supervisor_data_scope on public.customer_protection_renewal_requests as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_contacts_supervisor_data_scope on public.customer_contacts;
create policy customer_contacts_supervisor_data_scope on public.customer_contacts as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_decision_makers_supervisor_data_scope on public.customer_decision_makers;
create policy customer_decision_makers_supervisor_data_scope on public.customer_decision_makers as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_sources_supervisor_data_scope on public.customer_sources;
create policy customer_sources_supervisor_data_scope on public.customer_sources as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_history_supervisor_data_scope on public.customer_status_history;
create policy customer_history_supervisor_data_scope on public.customer_status_history as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_supplements_supervisor_data_scope on public.customer_private_supplements;
create policy customer_supplements_supervisor_data_scope on public.customer_private_supplements as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_conflicts_supervisor_data_scope on public.customer_conflicts;
create policy customer_conflicts_supervisor_data_scope on public.customer_conflicts as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_identity_supervisor_data_scope on public.customer_identity_keys;
create policy customer_identity_supervisor_data_scope on public.customer_identity_keys as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_tags_supervisor_data_scope on public.customer_tag_links;
create policy customer_tags_supervisor_data_scope on public.customer_tag_links as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_v2_protections_supervisor_data_scope on public.customer_protections;
create policy customer_v2_protections_supervisor_data_scope on public.customer_protections as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_customer(customer_id)
);

drop policy if exists customer_v2_extensions_supervisor_data_scope on public.protection_extension_requests;
create policy customer_v2_extensions_supervisor_data_scope on public.protection_extension_requests as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.customer_protections p
    where p.id = protection_id and public.supervisor_can_read_customer(p.customer_id)
  )
);

drop policy if exists attachments_supervisor_data_scope on public.attachments;
create policy attachments_supervisor_data_scope on public.attachments as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR'
  or uploaded_by = auth.uid() or public.supervisor_can_read_customer(customer_id)
);
drop policy if exists attachments_supervisor_own_insert on public.attachments;
create policy attachments_supervisor_own_insert on public.attachments as restrictive
for insert to authenticated with check (
  public.current_user_role() <> 'SUPERVISOR' or (
    uploaded_by = auth.uid()
    and (customer_id is null or exists (
      select 1 from public.customers c where c.id = customer_id
        and coalesce(c.owner_id, c.owner_user_id, c.created_by) = auth.uid()
    ))
    and (followup_id is null or exists (
      select 1 from public.followups f where f.id = followup_id and f.user_id = auth.uid()
    ))
    and (quote_id is null or exists (
      select 1 from public.quotes q where q.id = quote_id and q.owner_id = auth.uid()
    ))
    and (stock_order_id is null or exists (
      select 1 from public.stock_orders s where s.id = stock_order_id and s.sales_user_id = auth.uid()
    ))
  )
);
drop policy if exists attachments_supervisor_own_update on public.attachments;
create policy attachments_supervisor_own_update on public.attachments as restrictive
for update to authenticated
using (public.current_user_role() <> 'SUPERVISOR' or uploaded_by = auth.uid())
with check (public.current_user_role() <> 'SUPERVISOR' or (
  uploaded_by = auth.uid()
  and (customer_id is null or exists (
    select 1 from public.customers c where c.id = customer_id
      and coalesce(c.owner_id, c.owner_user_id, c.created_by) = auth.uid()
  ))
  and (followup_id is null or exists (
    select 1 from public.followups f where f.id = followup_id and f.user_id = auth.uid()
  ))
  and (quote_id is null or exists (
    select 1 from public.quotes q where q.id = quote_id and q.owner_id = auth.uid()
  ))
  and (stock_order_id is null or exists (
    select 1 from public.stock_orders s where s.id = stock_order_id and s.sales_user_id = auth.uid()
  ))
));

drop policy if exists followup_reminders_supervisor_data_scope on public.followup_reminders;
create policy followup_reminders_supervisor_data_scope on public.followup_reminders as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_user(user_id)
);

drop policy if exists imports_supervisor_data_scope on public.imports;
create policy imports_supervisor_data_scope on public.imports as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_user(created_by)
);

drop policy if exists import_rows_supervisor_data_scope on public.import_rows;
create policy import_rows_supervisor_data_scope on public.import_rows as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.imports i where i.id = import_id and public.supervisor_can_read_user(i.created_by)
  )
);

drop policy if exists ai_model_calls_supervisor_data_scope on public.ai_screening_model_calls;
create policy ai_model_calls_supervisor_data_scope on public.ai_screening_model_calls as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.ai_screening_tasks t where t.id = task_id and public.supervisor_can_read_user(t.user_id)
  )
);

drop policy if exists ai_stage_events_supervisor_data_scope on public.ai_screening_stage_events;
create policy ai_stage_events_supervisor_data_scope on public.ai_screening_stage_events as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or exists (
    select 1 from public.ai_screening_tasks t where t.id = task_id and public.supervisor_can_read_user(t.user_id)
  )
);

drop policy if exists ai_usage_ledger_supervisor_data_scope on public.ai_screening_usage_ledger;
create policy ai_usage_ledger_supervisor_data_scope on public.ai_screening_usage_ledger as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_user(user_id)
);

drop policy if exists ai_completion_ledger_supervisor_data_scope on public.ai_screening_completion_ledger;
create policy ai_completion_ledger_supervisor_data_scope on public.ai_screening_completion_ledger as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR' or public.supervisor_can_read_user(user_id)
);

-- These are SECURITY DEFINER reporting RPCs: table RLS does not constrain
-- their internals. Assert the known definition before adding the switch so a
-- changed upstream function aborts this transaction instead of leaking data.
do $report_scope$
declare
  definition text;
  updated text;
  old_fragment text;
begin
  definition := pg_get_functiondef('public.dashboard_overview(timestamptz,timestamptz,uuid,text,text)'::regprocedure);
  old_fragment := 'elsif exists (select 1 from public.users u where u.id = p_scope_user_id and u.manager_id = actor.id and u.status = ''ACTIVE'') then';
  if position(old_fragment in definition) = 0 then raise exception 'dashboard_overview 主管范围定义已变化，需要人工复核'; end if;
  updated := replace(definition, old_fragment,
    'elsif actor.supervisor_can_view_subordinates and exists (select 1 from public.users u where u.id = p_scope_user_id and u.manager_id = actor.id and u.status = ''ACTIVE'') then');
  execute updated;

  definition := pg_get_functiondef('public.sales_report_breakdowns(timestamptz,timestamptz,uuid)'::regprocedure);
  old_fragment := 'elsif exists (select 1 from public.users u where u.id=p_user_id and u.manager_id=actor.id and u.status=''ACTIVE'') then';
  if position(old_fragment in definition) = 0 then raise exception 'sales_report_breakdowns 主管范围定义已变化，需要人工复核'; end if;
  updated := replace(definition, old_fragment,
    'elsif actor.supervisor_can_view_subordinates and exists (select 1 from public.users u where u.id=p_user_id and u.manager_id=actor.id and u.status=''ACTIVE'') then');
  execute updated;

  definition := pg_get_functiondef('public.sales_performance_report(timestamptz,timestamptz)'::regprocedure);
  if position('select id,role from public.users' in definition) = 0 then
    raise exception 'sales_performance_report actor 定义已变化，需要人工复核';
  end if;
  updated := replace(definition, 'select id,role from public.users',
    'select id,role,supervisor_can_view_subordinates from public.users');
  old_fragment := '(a.role=''SUPERVISOR'' and (u.id=a.id or u.manager_id=a.id))';
  if position(old_fragment in updated) = 0 then raise exception 'sales_performance_report 主管范围定义已变化，需要人工复核'; end if;
  updated := replace(updated, old_fragment,
    '(a.role=''SUPERVISOR'' and (u.id=a.id or (a.supervisor_can_view_subordinates and u.manager_id=a.id)))');
  execute updated;

  definition := pg_get_functiondef('public.review_customer_protection_renewal(uuid,text,text)'::regprocedure);
  old_fragment := 'if actor.role=''SUPERVISOR'' and request_owner.manager_id is distinct from actor.id then';
  if position(old_fragment in definition) = 0 then raise exception 'review_customer_protection_renewal 主管范围定义已变化，需要人工复核'; end if;
  updated := replace(definition, old_fragment,
    'if actor.role=''SUPERVISOR'' and (not actor.supervisor_can_view_subordinates or request_owner.manager_id is distinct from actor.id) then');
  execute updated;
end;
$report_scope$;

commit;
