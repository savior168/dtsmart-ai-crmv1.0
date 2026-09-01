begin;

create or replace function public.cancel_quote(p_quote_id uuid,p_reason text)
returns public.quotes language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.quotes; reason text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  reason:=trim(coalesce(p_reason,''));
  select * into target from public.quotes where id=p_quote_id for update;
  if actor.id is null or target.id is null then raise exception '账号或报价单不存在'; end if;
  if target.owner_id<>actor.id and actor.role<>'ADMIN' then raise exception '只能取消归属自己的报价单'; end if;
  if target.status='CANCELLED' then return target; end if;
  if target.status in ('CONFIRMED','SUPERSEDED') then raise exception '报价已进入后续业务流程，不能取消'; end if;
  if target.status not in ('DRAFT','GENERATED','SENT','EXPIRED') then raise exception '当前报价状态不能取消'; end if;
  if reason='' then raise exception '取消报价必须填写真实原因'; end if;
  update public.quotes set status='CANCELLED',cancellation_reason=reason,cancelled_at=now(),updated_at=now()
  where id=target.id returning * into target;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'QUOTE_CANCEL','quote',target.id,jsonb_build_object('quote_number',target.quote_number,'reason',reason));
  return target;
end $$;

revoke execute on function public.cancel_quote(uuid,text) from public,anon;
grant execute on function public.cancel_quote(uuid,text) to authenticated;

commit;
