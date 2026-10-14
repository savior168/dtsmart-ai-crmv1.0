-- Emergency rollback for the four PI migrations after the business-contact snapshot.
-- Run only after restoring the previous app deployment. Newly synchronized market
-- rate snapshots are disposable; this does not alter existing PI or stock data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop function if exists public.delete_never_submitted_pi_draft(uuid,integer);
delete from public.role_permission_settings where permission_code='orders.delete_draft';

do $$
declare
  signature text;
  definition text;
  margin_guard text := chr(10) || '      or x.unit_price_cny<=x.estimated_unit_cost_cny';
begin
  foreach signature in array array[
    'public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)',
    'public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(margin_guard in definition) = 0 then
      raise exception 'PI margin guard changed; inspect % before rollback', signature;
    end if;
    execute replace(definition, margin_guard, '');
  end loop;
end $$;

do $$
declare
  signature text;
  definition text;
  current_guard text := 'if target.pi_revision is distinct from p_expected_revision then';
begin
  foreach signature in array array[
    'public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)',
    'public.submit_direct_pi_order(uuid,integer)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(current_guard in definition) = 0 then
      raise exception 'PI revision guard changed; inspect % before rollback', signature;
    end if;
    execute replace(definition, current_guard,
      'if target.pi_revision<>p_expected_revision then');
  end loop;
end $$;

drop trigger if exists guard_direct_pi_submit_margin on public.sales_orders;
drop function if exists public.guard_direct_pi_submit_margin();
drop function if exists public.set_direct_pi_change_note(uuid,integer,text);
drop table if exists public.pi_exchange_rate_snapshots;

commit;
