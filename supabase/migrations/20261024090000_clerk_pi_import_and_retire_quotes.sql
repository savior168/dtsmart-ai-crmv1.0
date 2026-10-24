-- Retire the standalone quote module without removing historical quote rows
-- that back existing PI/stock snapshots. Keep PI writes scoped to the preparer.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

delete from public.user_permission_overrides where permission_code like 'quotes.%'
  or permission_code in ('system.roles.view','system.roles.manage');
delete from public.role_permission_settings where permission_code like 'quotes.%'
  or permission_code in ('system.roles.view','system.roles.manage');
insert into public.role_permission_settings(role_code, permission_code, enabled)
values ('ORDER_CLERK','orders.import',true),('ORDER_CLERK','orders.cancel',true)
on conflict (role_code,permission_code) do update set enabled=true;

-- Older direct PIs were created by their sales owner before preparer tracking.
do $$
begin
  if exists (
    select 1 from public.sales_orders o where o.confirmation_method='DIRECT_PI' and o.prepared_by is null
      and not exists (select 1 from public.audit_logs a where a.target_type='sales_order'
        and a.target_id=o.id and a.action='PI_DRAFT_CREATE' and a.user_id=o.sales_user_id)
  ) then raise exception 'Historical PI creator cannot be proven; stop preparer backfill'; end if;
end $$;
update public.sales_orders set prepared_by=sales_user_id
where confirmation_method='DIRECT_PI' and prepared_by is null;

do $$
declare definition text; changed text; entry record;
begin
  definition := pg_get_functiondef('public.create_pi_import_draft(text,text,jsonb)'::regprocedure);
  changed := replace(definition, 'actor.role not in (''SALES'',''SUPERVISOR'',''ADMIN'')',
    'actor.role not in (''SALES'',''SUPERVISOR'',''ADMIN'',''ORDER_CLERK'')');
  if changed=definition then raise exception 'PI import role guard changed; review migration'; end if;
  execute changed;

  for entry in select * from (values
    ('public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)',
     '(actor.role=''ORDER_CLERK'' and target.prepared_by is distinct from actor.id) or (actor.role<>''ORDER_CLERK'' and target.sales_user_id<>actor.id and actor.role<>''ADMIN'')',
     'target.prepared_by is distinct from actor.id'),
    ('public.submit_direct_pi_order(uuid,integer)',
     '(actor.role=''ORDER_CLERK'' and target.prepared_by is distinct from actor.id) or (actor.role<>''ORDER_CLERK'' and target.sales_user_id<>actor.id and actor.role<>''ADMIN'')',
     'target.prepared_by is distinct from actor.id'),
    ('public.save_direct_pi_customer_text(uuid,integer,jsonb)',
     '((actor.role=''ORDER_CLERK'' and target.prepared_by is distinct from actor.id) or (actor.role<>''ORDER_CLERK'' and target.sales_user_id<>actor.id and actor.role<>''ADMIN''))',
     '(target.prepared_by is distinct from actor.id)'),
    ('public.set_direct_pi_change_note(uuid,integer,text)',
     '(actor.role=''ORDER_CLERK'' and target.prepared_by is distinct from actor.id) or (actor.role<>''ORDER_CLERK'' and target.sales_user_id<>actor.id and actor.role<>''ADMIN'')',
     'target.prepared_by is distinct from actor.id'),
    ('public.recall_direct_pi_order(uuid,text)',
     'actor.role=''ORDER_CLERK'' or (target.sales_user_id<>actor.id and actor.role<>''ADMIN'')',
     'target.prepared_by is distinct from actor.id')
  ) as guards(signature, old_guard, new_guard) loop
    definition := pg_get_functiondef(entry.signature::regprocedure);
    changed := replace(definition,entry.old_guard,entry.new_guard);
    if changed=definition then raise exception 'PI preparer guard changed in %',entry.signature; end if;
    execute changed;
  end loop;

  definition := pg_get_functiondef('public.cancel_sales_order(uuid,text)'::regprocedure);
  changed := replace(definition,
    'actor.id is null or target.id is null or actor.role=''ORDER_CLERK''',
    'actor.id is null or target.id is null or (actor.role=''ORDER_CLERK'' and target.confirmation_method<>''DIRECT_PI'')');
  if changed=definition then raise exception 'PI cancellation role guard changed'; end if;
  definition := changed;
  changed := replace(definition,
    'if target.sales_user_id<>actor.id and actor.role<>''ADMIN'' then',
    'if (target.confirmation_method=''DIRECT_PI'' and target.prepared_by is distinct from actor.id)'
    || E'\n    ' || 'or (target.confirmation_method<>''DIRECT_PI'' and target.sales_user_id<>actor.id and actor.role<>''ADMIN'') then');
  if changed=definition then raise exception 'PI cancellation ownership guard changed'; end if;
  execute changed;

  definition := pg_get_functiondef('public.delete_never_submitted_pi_draft(uuid,integer)'::regprocedure);
  changed := replace(definition,
    'if actor.role<>''ADMIN'' and target.sales_user_id<>actor.id then',
    'if target.prepared_by is distinct from actor.id then');
  if changed=definition then raise exception 'PI draft deletion ownership guard changed'; end if;
  execute changed;
end $$;

-- A new overload carries the explicitly selected sales owner into the same
-- checked creator as manual PI. The draft remains owned by the importer.
create function public.convert_pi_import_draft_with_fees(
  p_draft_id uuid,p_expected_revision integer,
  p_customer_id uuid,p_warehouse_reference_number text,p_currency text,p_fx_rate numeric,p_shipping_cny numeric,
  p_payment_method text,p_payment_account_id uuid,p_valid_until date,p_delivery_date date,
  p_delivery_recipient text,p_delivery_phone text,p_delivery_email text,p_delivery_address text,
  p_stocking_requirements text,p_items jsonb,p_fees jsonb,p_sales_user_id uuid
) returns public.sales_orders language plpgsql security definer set search_path = '' as $$
declare actor public.users; target public.pi_import_drafts; sales_owner public.users; result public.sales_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('orders.import')
    or not public.current_user_has_business_permission('orders.create') then raise exception '没有PI导入或创建权限'; end if;
  select * into target from public.pi_import_drafts where id=p_draft_id for update;
  if target.id is null or target.owner_id<>actor.id or target.status<>'PENDING' then raise exception '导入草稿不可转换'; end if;
  if target.revision is distinct from p_expected_revision then raise exception '导入草稿已更新，请刷新后重试'; end if;
  select * into sales_owner from public.users where id=p_sales_user_id and status='ACTIVE'
    and role in ('SALES','SUPERVISOR');
  if sales_owner.id is null then raise exception '请选择在职销售员或主管'; end if;
  if nullif(trim(coalesce(target.payload->>'sales_account_email','')),'') is not null
    and lower(trim(target.payload->>'sales_account_email'))<>lower(sales_owner.email) then
    raise exception '所选销售员账号与导入文件不一致';
  end if;
  result := public.create_direct_pi_order_with_fees(p_customer_id,p_warehouse_reference_number,p_currency,p_fx_rate,p_shipping_cny,
    p_payment_method,p_payment_account_id,p_valid_until,p_delivery_date,p_delivery_recipient,p_delivery_phone,
    p_delivery_email,p_delivery_address,p_stocking_requirements,p_items,p_fees,p_sales_user_id);
  update public.sales_orders set pi_source='EXCEL_IMPORT' where id=result.id returning * into result;
  update public.pi_import_drafts set status='CONVERTED',converted_order_id=result.id,revision=revision+1,updated_at=now()
    where id=target.id;
  return result;
end $$;
revoke all on function public.convert_pi_import_draft_with_fees(uuid,integer,uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.convert_pi_import_draft_with_fees(uuid,integer,uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb,uuid) to authenticated;
revoke execute on function public.convert_pi_import_draft_with_fees(uuid,integer,uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb) from authenticated;

-- Legacy quote RPCs must not remain callable around the closed UI/API.
revoke execute on function public.cancel_quote(uuid,text) from authenticated;
revoke execute on function public.confirm_quote_create_sales_order(uuid,text,text,text) from authenticated;
revoke execute on function public.create_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb) from authenticated;
revoke execute on function public.revise_quote(uuid) from authenticated;
revoke execute on function public.update_quote_customer_fields(uuid,text,text,date,text,date,text,text,numeric,text,jsonb) from authenticated;
revoke execute on function public.update_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb) from authenticated;

commit;
