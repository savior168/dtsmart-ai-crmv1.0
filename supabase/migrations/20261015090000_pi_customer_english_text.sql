-- Customer-facing English is independent of the warehouse's original wording.
alter table public.sales_order_items add column if not exists quality_en text;
alter table public.sales_order_items add column if not exists description_en text;

create or replace function public.save_direct_pi_customer_text(
  p_order_id uuid, p_expected_revision integer, p_rows jsonb
) returns public.sales_orders
language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  target public.sales_orders;
  result public.sales_orders;
  item_count integer;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null or target.confirmation_method<>'DIRECT_PI'
    or target.status='CANCELLED' or (target.sales_user_id<>actor.id and actor.role<>'ADMIN')
    or not public.current_user_has_business_permission('orders.edit') then
    raise exception '无权核对该PI的客户英文内容';
  end if;
  if target.pi_revision<>p_expected_revision then
    raise exception 'PI已被其他操作更新，请刷新后再核对英文内容';
  end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception '英文内容格式不正确'; end if;
  select count(*) into item_count from public.sales_order_items where sales_order_id=p_order_id;
  if jsonb_array_length(p_rows)<>item_count or item_count=0
    or (select count(distinct x.line_number) from jsonb_to_recordset(p_rows) as x(line_number integer))<>item_count
    or exists (
      select 1 from jsonb_to_recordset(p_rows) as x(line_number integer,quality_en text,description_en text)
      left join public.sales_order_items i on i.sales_order_id=p_order_id and i.line_number=x.line_number
      where i.id is null or length(coalesce(x.quality_en,''))>160 or length(coalesce(x.description_en,''))>1000
        or coalesce(x.quality_en,'') ~ '[㐀-鿿]' or coalesce(x.description_en,'') ~ '[㐀-鿿]'
        or (target.status<>'DRAFT' and
          ((coalesce(i.quality,'') ~ '[㐀-鿿]' and nullif(btrim(coalesce(x.quality_en,'')),'') is null)
            or (coalesce(i.description,'') ~ '[㐀-鿿]' and nullif(btrim(coalesce(x.description_en,'')),'') is null)))
    ) then raise exception '请按原产品行逐项填写有效的英文质量和描述'; end if;
  update public.sales_order_items i
    set quality_en=nullif(btrim(coalesce(x.quality_en,'')),''),
        description_en=nullif(btrim(coalesce(x.description_en,'')),'')
  from jsonb_to_recordset(p_rows) as x(line_number integer,quality_en text,description_en text)
  where i.sales_order_id=p_order_id and i.line_number=x.line_number;
  update public.sales_orders set pi_revision=pi_revision+1,updated_at=now()
    where id=p_order_id returning * into result;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'PI_CUSTOMER_ENGLISH_REVIEW','sales_order',p_order_id,
      jsonb_build_object('revision_before',p_expected_revision,'revision_after',result.pi_revision,'item_count',item_count));
  return result;
end $$;
revoke all on function public.save_direct_pi_customer_text(uuid,integer,jsonb) from public,anon;
grant execute on function public.save_direct_pi_customer_text(uuid,integer,jsonb) to authenticated;

create or replace function public.require_direct_pi_customer_english()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.confirmation_method='DIRECT_PI' and old.status='DRAFT' and new.status<>'DRAFT'
    and exists (
      select 1 from public.sales_order_items i where i.sales_order_id=new.id
        and ((coalesce(i.quality,'') ~ '[㐀-鿿]' and nullif(btrim(coalesce(i.quality_en,'')),'') is null)
          or (coalesce(i.description,'') ~ '[㐀-鿿]' and nullif(btrim(coalesce(i.description_en,'')),'') is null))
    ) then
    raise exception '产品质量或描述包含中文，请先逐行核对客户英文内容后再提交仓库';
  end if;
  return new;
end $$;
revoke all on function public.require_direct_pi_customer_english() from public,anon,authenticated;
drop trigger if exists require_direct_pi_customer_english on public.sales_orders;
create trigger require_direct_pi_customer_english before update of status on public.sales_orders
for each row execute function public.require_direct_pi_customer_english();
