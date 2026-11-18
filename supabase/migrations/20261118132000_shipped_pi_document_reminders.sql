begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The database must enforce the same document parent permission and hard
-- sales/clerk exclusion as the application, including direct RPC calls.
do $$
declare
  function_sql text;
  old_rule constant text := 'when p_permission like ''suppliers.%'' then ''suppliers.view''';
  new_rule constant text := 'when p_permission like ''supplier.documents.%'' then ''supplier.documents.view''' || E'\n    ' || old_rule;
  old_guard constant text := 'if p_permission is null or p_permission like ''quotes.%'' then return false; end if;';
  new_guard constant text := old_guard || E'\n  ' ||
    'if actor.role in (''SALES'',''ORDER_CLERK'') and p_permission like ''supplier.documents.%'' then return false; end if;';
begin
  select pg_get_functiondef('public.current_user_has_business_permission(text)'::regprocedure) into function_sql;
  if function_sql is null or position(old_rule in function_sql)=0 or position(old_guard in function_sql)=0 then
    raise exception 'Expected business permission mapping not found; migration aborted';
  end if;
  execute replace(replace(function_sql, old_rule, new_rule), old_guard, new_guard);
end $$;

insert into public.role_permission_settings(role_code, permission_code, enabled)
select role_code, permission_code, enabled from (values
  ('ADMIN','supplier.documents.view',true),('ADMIN','supplier.documents.manage',true),
  ('WAREHOUSE','supplier.documents.view',true),('WAREHOUSE','supplier.documents.manage',true),
  ('FINANCE','supplier.documents.view',true),('FINANCE','supplier.documents.manage',false),
  ('SUPERVISOR','supplier.documents.view',false),('SUPERVISOR','supplier.documents.manage',false),
  ('SALES','supplier.documents.view',false),('SALES','supplier.documents.manage',false),
  ('ORDER_CLERK','supplier.documents.view',false),('ORDER_CLERK','supplier.documents.manage',false)
) grants(role_code,permission_code,enabled)
on conflict (role_code,permission_code) do nothing;

insert into public.notification_delivery_policies(type, popup_enabled, voice_enabled)
values ('STOCK_DOCUMENT_MISSING', false, false)
on conflict (type) do nothing;

-- A shipped PI can contain multiple supplier notes. Every shipped product's
-- receipt source must have a real number and at least one paper image.
create function public.refresh_shipped_pi_document_reminders()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  created_count integer := 0;
  resolved_count integer := 0;
begin
  with missing as (
    select distinct o.id, coalesce(o.warehouse_reference_number, o.order_number, o.id::text) as order_number
    from public.stock_orders o
    join public.stock_order_items i on i.stock_order_id = o.id and i.shipped_quantity > 0
    where o.status <> 'CANCELLED'
      and (
        not exists (
          select 1 from public.supplier_receipt_allocations a
          where a.stock_order_item_id = i.id and a.quantity > 0 and a.correction_of is null
        )
        or exists (
          select 1 from public.supplier_receipt_allocations a
          join public.supplier_delivery_notes d on d.id = a.delivery_note_id
          where a.stock_order_item_id = i.id and a.quantity > 0 and a.correction_of is null
            and (d.number_pending or not exists (
              select 1 from public.attachments f where f.supplier_delivery_note_id = d.id
            ))
        )
      )
  ), inserted as (
    insert into public.system_notifications(
      recipient_id,type,category,title,content,href,entity_type,entity_id,
      dedupe_key,action_status)
    select u.id,'STOCK_DOCUMENT_MISSING','STOCK',
      '已交货代 PI 待补送货单凭证',
      '备货单 ' || m.order_number || ' 已交货代，但回货来源仍缺真实送货单号或纸单照片。请核对并补齐。',
      '/stock-orders/' || m.id::text,'stock_order',m.id,
      'stock-document-missing:' || m.id::text || ':' || (floor(extract(epoch from current_date)::numeric / 259200))::text,
      'PENDING'
    from missing m cross join public.users u
    where u.role = 'WAREHOUSE' and u.status = 'ACTIVE'
      and (u.locked_until is null or u.locked_until <= now())
      and not exists (
        select 1 from (values ('stock.view'),('stock.update'),
          ('stock.procurement.edit'),('supplier.documents.view'),
          ('supplier.documents.manage'),('notifications.view')) as required(code)
        where coalesce(
          (select override.effect = 'ALLOW' from public.user_permission_overrides override
            where override.user_id = u.id and override.permission_code = required.code),
          (select role_default.enabled from public.role_permission_settings role_default
            where role_default.role_code = u.role and role_default.permission_code = required.code),
          false) = false
      )
    on conflict(recipient_id,dedupe_key) where dedupe_key is not null do nothing
    returning id
  ) select count(*) into created_count from inserted;

  update public.system_notifications n
    set action_status = 'RESOLVED', archived_at = now()
    where n.type = 'STOCK_DOCUMENT_MISSING' and n.action_status = 'PENDING'
      and not exists (
        select 1 from public.stock_orders o
        join public.stock_order_items i on i.stock_order_id = o.id and i.shipped_quantity > 0
        where o.id = n.entity_id and o.status <> 'CANCELLED'
          and (not exists (
            select 1 from public.supplier_receipt_allocations a
            where a.stock_order_item_id = i.id and a.quantity > 0 and a.correction_of is null
          ) or exists (
            select 1 from public.supplier_receipt_allocations a
            join public.supplier_delivery_notes d on d.id = a.delivery_note_id
            where a.stock_order_item_id = i.id and a.quantity > 0 and a.correction_of is null
              and (d.number_pending or not exists (
                select 1 from public.attachments f where f.supplier_delivery_note_id = d.id
              ))
          ))
      );
  get diagnostics resolved_count = row_count;
  return jsonb_build_object('created',created_count,'resolved',resolved_count);
end;
$$;
revoke all on function public.refresh_shipped_pi_document_reminders() from public, anon, authenticated;
grant execute on function public.refresh_shipped_pi_document_reminders() to service_role;

create function public.list_missing_shipped_pi_documents(p_limit integer default 50, p_offset integer default 0)
returns table(stock_order_id uuid, order_number text, missing_number_count bigint,
  missing_image_count bigint, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_user_role() not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.view')
    or not public.current_user_has_business_permission('supplier.documents.view') then
    raise exception '无查看待补送货凭证权限';
  end if;
  if p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    raise exception '分页参数无效';
  end if;
  return query
  with missing as (
    select o.id, coalesce(o.warehouse_reference_number, o.order_number, o.id::text) as display_number,
      count(*) filter (where d.id is null or d.number_pending)::bigint as number_count,
      count(*) filter (where d.id is null or not exists (
        select 1 from public.attachments f where f.supplier_delivery_note_id = d.id
      ))::bigint as image_count
    from public.stock_orders o
    join public.stock_order_items i on i.stock_order_id = o.id and i.shipped_quantity > 0
    left join public.supplier_receipt_allocations a on a.stock_order_item_id = i.id
      and a.quantity > 0 and a.correction_of is null
    left join public.supplier_delivery_notes d on d.id = a.delivery_note_id
    where o.status <> 'CANCELLED'
    group by o.id, o.warehouse_reference_number, o.order_number
    having count(*) filter (where d.id is null or d.number_pending or not exists (
      select 1 from public.attachments f where f.supplier_delivery_note_id = d.id
    )) > 0
  )
  select m.id, m.display_number, m.number_count, m.image_count, count(*) over()::bigint
  from missing m order by m.display_number desc limit p_limit offset p_offset;
end;
$$;
revoke all on function public.list_missing_shipped_pi_documents(integer,integer) from public, anon;
grant execute on function public.list_missing_shipped_pi_documents(integer,integer) to authenticated;

commit;
