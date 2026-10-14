-- Reject loss-making PI lines in both create and draft-edit RPCs.
-- Existing orders are not rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  signature text;
  definition text;
  old_guard text := 'or x.estimated_unit_cost_cny<>round(x.estimated_unit_cost_cny,2)';
  new_guard text := old_guard || chr(10) ||
    '      or x.unit_price_cny<=x.estimated_unit_cost_cny';
begin
  foreach signature in array array[
    'public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)',
    'public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(old_guard in definition) = 0 or position('or x.unit_price_cny<=x.estimated_unit_cost_cny' in definition) > 0 then
      raise exception 'PI line validation changed; review % before applying', signature;
    end if;
    execute replace(definition, old_guard, new_guard);
  end loop;
end $$;

-- A direct RPC caller can pass NULL for the expected revision. SQL's <>
-- evaluates to NULL in that case, so use a null-safe comparison at both
-- draft edit and final submit boundaries.
do $$
declare
  signature text;
  definition text;
  old_guard text := 'if target.pi_revision<>p_expected_revision then';
begin
  foreach signature in array array[
    'public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)',
    'public.submit_direct_pi_order(uuid,integer)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(old_guard in definition) = 0 then
      raise exception 'PI revision guard changed; review % before applying', signature;
    end if;
    execute replace(definition, old_guard,
      'if target.pi_revision is distinct from p_expected_revision then');
  end loop;
end $$;

-- Previously saved drafts can predate the create/edit guard. Recheck at the
-- final DRAFT -> WAITING_STOCK boundary so they cannot enter warehouse work.
create or replace function public.guard_direct_pi_submit_margin()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.confirmation_method='DIRECT_PI' and old.status='DRAFT' and new.status='WAITING_STOCK'
    and exists (
      select 1 from public.sales_order_items i
      where i.sales_order_id=new.id
        and (i.unit_price_cny is null or i.estimated_unit_cost_cny is null
          or i.unit_price_cny<=i.estimated_unit_cost_cny)
    ) then
    raise exception 'PI商品售价必须高于成本价，请返回草稿核对';
  end if;
  return new;
end $$;
drop trigger if exists guard_direct_pi_submit_margin on public.sales_orders;
create trigger guard_direct_pi_submit_margin before update of status on public.sales_orders
for each row execute function public.guard_direct_pi_submit_margin();
revoke all on function public.guard_direct_pi_submit_margin() from public,anon,authenticated;

commit;
