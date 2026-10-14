-- A direct PI's internal change note is separate from warehouse packing instructions.
-- The existing confirmation_note field is unused by direct PI orders. No historic rows change.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.set_direct_pi_change_note(
  p_order_id uuid, p_expected_revision integer, p_note text
) returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  target public.sales_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或PI订单不存在'; end if;
  if target.confirmation_method<>'DIRECT_PI' or target.status<>'DRAFT'
    or (target.sales_user_id<>actor.id and actor.role<>'ADMIN') then
    raise exception '只能修改归属自己的PI草稿说明';
  end if;
  if not public.current_user_has_business_permission('orders.edit') then
    raise exception '没有PI草稿编辑权限';
  end if;
  if target.pi_revision is distinct from p_expected_revision then
    raise exception 'PI草稿已被修改，请刷新核对后重试';
  end if;
  if length(coalesce(p_note,''))>2000 then raise exception '订单变更说明最多2000字'; end if;
  update public.sales_orders set confirmation_note=nullif(trim(coalesce(p_note,'')),''),
    pi_revision=pi_revision+1,updated_at=now() where id=target.id returning * into target;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_CHANGE_NOTE_UPDATE','sales_order',target.id,
    jsonb_build_object('revision_after',target.pi_revision,'has_note',target.confirmation_note is not null));
  return target;
end $$;

revoke execute on function public.set_direct_pi_change_note(uuid,integer,text) from public,anon;
grant execute on function public.set_direct_pi_change_note(uuid,integer,text) to authenticated;
commit;
