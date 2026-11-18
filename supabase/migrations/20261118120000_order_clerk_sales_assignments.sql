begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- One explicit, per-clerk seller assignment governs PI creation and PI/stock
-- reads. Existing clerks are seeded with their prior scope; new clerks get none.
create table public.order_clerk_sales_assignments (
  clerk_user_id uuid not null references public.users(id) on delete cascade,
  sales_user_id uuid not null references public.users(id) on delete cascade,
  assigned_by uuid references public.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (clerk_user_id, sales_user_id)
);
create index order_clerk_sales_assignments_sales_idx on public.order_clerk_sales_assignments(sales_user_id);
alter table public.order_clerk_sales_assignments enable row level security;
revoke all on public.order_clerk_sales_assignments from public, anon, authenticated;

insert into public.order_clerk_sales_assignments(clerk_user_id, sales_user_id)
select clerk.id, seller.id from public.users clerk cross join public.users seller
where clerk.role = 'ORDER_CLERK' and seller.role in ('SALES', 'SUPERVISOR');

create or replace function public.order_clerk_has_sales_scope(p_sales_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users clerk
    join public.order_clerk_sales_assignments scope on scope.clerk_user_id = clerk.id
    where clerk.id = auth.uid() and clerk.role = 'ORDER_CLERK' and clerk.status = 'ACTIVE'
      and scope.sales_user_id = p_sales_user_id
  )
$$;
revoke all on function public.order_clerk_has_sales_scope(uuid) from public, anon;
grant execute on function public.order_clerk_has_sales_scope(uuid) to authenticated;

-- Restrictive policies intersect every pre-existing permissive policy, including
-- the historic "clerk read all" policies and direct PostgREST table access.
create policy sales_orders_clerk_assigned_boundary on public.sales_orders as restrictive
  for select to authenticated using (
    public.current_user_role() is distinct from 'ORDER_CLERK'
    or (confirmation_method = 'DIRECT_PI' and public.order_clerk_has_sales_scope(sales_user_id)));
create policy sales_items_clerk_assigned_boundary on public.sales_order_items as restrictive
  for select to authenticated using (
    public.current_user_role() is distinct from 'ORDER_CLERK'
    or exists (select 1 from public.sales_orders pi where pi.id = sales_order_id));
create policy stock_orders_clerk_assigned_boundary on public.stock_orders as restrictive
  for select to authenticated using (
    public.current_user_role() is distinct from 'ORDER_CLERK'
    or public.order_clerk_has_sales_scope(sales_user_id));
create policy stock_items_clerk_assigned_boundary on public.stock_order_items as restrictive
  for select to authenticated using (
    public.current_user_role() is distinct from 'ORDER_CLERK'
    or exists (select 1 from public.stock_orders stock where stock.id = stock_order_id));
create policy stock_events_clerk_assigned_boundary on public.stock_order_events as restrictive
  for select to authenticated using (
    public.current_user_role() is distinct from 'ORDER_CLERK'
    or exists (select 1 from public.stock_orders stock where stock.id = stock_order_id));

create or replace function public.can_read_stock_order(
  p_sales_user_id uuid, p_status text, p_sales_order_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_user_has_business_permission('stock.view')
    and (p_sales_user_id = auth.uid() or
      (public.current_user_has_business_permission('stock.data_all')
        and (public.current_user_role() <> 'SUPERVISOR'
          or public.supervisor_can_read_user(p_sales_user_id))
        and (public.current_user_role() <> 'ORDER_CLERK'
          or public.order_clerk_has_sales_scope(p_sales_user_id))
        and (public.current_user_role() <> 'WAREHOUSE' or p_status <> 'DRAFT'
          or public.is_legacy_stock_sales_order(p_sales_order_id))))
$$;

-- SECURITY DEFINER functions bypass table RLS, so each clerk branch must
-- explicitly intersect the same assignment. Refuse deployment on source drift.
do $scope$
declare definition text; changed text;
begin
  definition := pg_get_functiondef('public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure);
  changed := replace(definition,
    '(actor.role = ''ORDER_CLERK'' and sales_owner.id is null)',
    '(actor.role = ''ORDER_CLERK'' and (sales_owner.id is null or not public.order_clerk_has_sales_scope(sales_owner.id)))');
  if changed = definition then raise exception 'create_direct_pi_order clerk guard drifted'; end if;
  execute changed;

  definition := pg_get_functiondef('public.create_direct_pi_order_with_fees(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb,uuid)'::regprocedure);
  changed := replace(definition,
    'u.role in (''SALES'',''SUPERVISOR'') and u.status = ''ACTIVE''',
    'u.role in (''SALES'',''SUPERVISOR'') and u.status = ''ACTIVE'' and public.order_clerk_has_sales_scope(u.id)');
  if changed = definition then raise exception 'create_direct_pi_order_with_fees clerk guard drifted'; end if;
  execute changed;

  definition := pg_get_functiondef('public.stock_order_dashboard()'::regprocedure);
  changed := replace(definition,
    '(scope_id is null or s.sales_user_id=scope_id)',
    '(scope_id is null or s.sales_user_id=scope_id) and (actor.role<>''ORDER_CLERK'' or public.order_clerk_has_sales_scope(s.sales_user_id))');
  if changed = definition then raise exception 'stock_order_dashboard clerk scope drifted'; end if;
  execute changed;

  definition := pg_get_functiondef('public.correct_direct_pi_line_prices(uuid,uuid,integer,numeric,numeric,numeric,numeric,text)'::regprocedure);
  changed := replace(definition,
    'or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id',
    'or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id
    or (actor.role = ''ORDER_CLERK'' and not public.order_clerk_has_sales_scope(target.sales_user_id))');
  if changed = definition then raise exception 'correct_direct_pi_line_prices clerk scope drifted'; end if;
  execute changed;

  definition := pg_get_functiondef('public.request_direct_pi_amendment(uuid,integer,jsonb,text)'::regprocedure);
  changed := replace(definition,
    'or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id',
    'or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id
    or (actor.role = ''ORDER_CLERK'' and not public.order_clerk_has_sales_scope(target.sales_user_id))');
  if changed = definition then raise exception 'request_direct_pi_amendment clerk scope drifted'; end if;
  execute changed;

  definition := pg_get_functiondef('public.review_shipped_pi_seller_cost(uuid,uuid,numeric,numeric,text)'::regprocedure);
  changed := replace(definition,
    'or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id',
    'or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id
    or (actor.role = ''ORDER_CLERK'' and not public.order_clerk_has_sales_scope(target.sales_user_id))');
  if changed = definition then raise exception 'review_shipped_pi_seller_cost clerk scope drifted'; end if;
  execute changed;
end;
$scope$;

create or replace function public.set_order_clerk_sales_assignments(
  p_clerk_id uuid, p_sales_ids uuid[], p_reason text
)
returns void language plpgsql security definer set search_path = '' as $$
declare old_ids uuid[]; requested uuid[] := coalesce(p_sales_ids, array[]::uuid[]);
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'ADMIN' and status = 'ACTIVE') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.users where id = p_clerk_id and role = 'ORDER_CLERK') then
    raise exception '请选择制单员账号';
  end if;
  if coalesce(array_length(requested, 1), 0) > 500
    or coalesce(length(trim(p_reason)), 0) not between 1 and 500
    or (select count(*) from unnest(requested) as candidate(user_id)) <>
       (select count(distinct user_id) from unnest(requested) as candidate(user_id))
    or exists (select 1 from unnest(requested) as candidate(user_id) left join public.users u on u.id = candidate.user_id
      where u.id is null or u.role not in ('SALES', 'SUPERVISOR')) then
    raise exception '授权名单或原因无效';
  end if;
  select coalesce(array_agg(sales_user_id order by sales_user_id), array[]::uuid[]) into old_ids
    from public.order_clerk_sales_assignments where clerk_user_id = p_clerk_id;
  delete from public.order_clerk_sales_assignments
    where clerk_user_id = p_clerk_id and not (sales_user_id = any(requested));
  insert into public.order_clerk_sales_assignments(clerk_user_id, sales_user_id, assigned_by)
    select p_clerk_id, candidate.user_id, auth.uid() from unnest(requested) as candidate(user_id)
    on conflict (clerk_user_id, sales_user_id) do nothing;
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
    values (auth.uid(), 'ADMIN_CLERK_SALES_SCOPE_UPDATE', 'user', p_clerk_id,
      jsonb_build_object('before', old_ids, 'after', requested, 'reason', trim(p_reason)));
end $$;
revoke all on function public.set_order_clerk_sales_assignments(uuid,uuid[],text) from public, anon;
grant execute on function public.set_order_clerk_sales_assignments(uuid,uuid[],text) to authenticated;

commit;
