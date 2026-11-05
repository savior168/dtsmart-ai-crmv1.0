-- Supplier settlement terms may change as commercial agreements evolve.
-- Keep the supplier code immutable once PI/receipt records reference it, while
-- freezing the terms that applied when each supplier delivery note was opened.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.supplier_delivery_notes
  add column settlement_cycle_snapshot text
    check (settlement_cycle_snapshot in ('CASH','WEEKLY','SEMI_MONTHLY','MONTHLY','NET_DAYS','OTHER','UNSET')),
  add column settlement_days_snapshot integer
    check (settlement_days_snapshot between 1 and 365),
  add column settlement_terms_snapshot text;

-- Existing notes get a one-time baseline from the supplier's current terms.
-- Future notes are snapshotted by the trigger below, so later master changes
-- cannot rewrite the historical reconciliation view.
update public.supplier_delivery_notes d
set settlement_cycle_snapshot = s.settlement_cycle,
    settlement_days_snapshot = s.settlement_days,
    settlement_terms_snapshot = s.settlement_terms_original
from public.suppliers s
where s.id = d.supplier_id;

create function public.snapshot_supplier_settlement_terms()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.settlement_cycle_snapshot is null then
    select s.settlement_cycle, s.settlement_days, s.settlement_terms_original
      into new.settlement_cycle_snapshot, new.settlement_days_snapshot, new.settlement_terms_snapshot
      from public.suppliers s where s.id = new.supplier_id;
    if new.settlement_cycle_snapshot is null then
      raise exception '送货单供应商不存在，无法记录商务条件快照';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.snapshot_supplier_settlement_terms() from public, anon, authenticated;
create trigger supplier_delivery_note_terms_snapshot
before insert on public.supplier_delivery_notes
for each row execute function public.snapshot_supplier_settlement_terms();

-- Supplier identity is immutable after it has been used; settlement terms are
-- deliberately excluded and remain editable by supplier managers.
create or replace function public.prevent_linked_supplier_identity_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.system_code is distinct from old.system_code
    or new.legacy_code is distinct from old.legacy_code)
    and (exists (select 1 from public.supplier_delivery_notes d
      where d.supplier_id = old.id)
      or exists (select 1 from public.stock_order_items i
        where upper(btrim(coalesce(i.warehouse_supplier_code,''))) = old.system_code)) then
    raise exception '已有 PI 备货行或送货单关联的供应商代码不可修改';
  end if;
  return new;
end;
$$;

-- Reports read the immutable terms recorded on the delivery note, not today's
-- supplier-master terms. Fail closed if the expected query shape has drifted.
do $$
declare
  definition text;
  previous text;
begin
  definition := pg_get_functiondef('public.supplier_reconciliation_report(date,date,uuid,integer,integer)'::regprocedure);
  previous := definition;
  definition := replace(definition,
    'select d.*, s.system_code, s.short_name, s.english_short_name,' || chr(10) ||
    '      s.settlement_cycle, s.settlement_days from public.supplier_delivery_notes d',
    'select d.*, s.system_code, s.short_name, s.english_short_name,' || chr(10) ||
    '      coalesce(d.settlement_cycle_snapshot,s.settlement_cycle) as settlement_cycle,' || chr(10) ||
    '      coalesce(d.settlement_days_snapshot,s.settlement_days) as settlement_days,' || chr(10) ||
    '      coalesce(d.settlement_terms_snapshot,s.settlement_terms_original) as settlement_terms_original' || chr(10) ||
    '      from public.supplier_delivery_notes d');
  if definition = previous then
    raise exception '供应商对账查询定义与预期不一致；需人工核对后再迁移';
  end if;
  previous := definition;
  definition := replace(definition,
    'settlement_cycle,settlement_days,count(*) as note_count,',
    'settlement_cycle,settlement_days,settlement_terms_original,count(*) as note_count,');
  if definition = previous then
    raise exception '供应商汇总商务条件字段与预期不一致；需人工核对后再迁移';
  end if;
  previous := definition;
  definition := replace(definition,
    'group by supplier_id,system_code,short_name,english_short_name,settlement_cycle,settlement_days) x)',
    'group by supplier_id,system_code,short_name,english_short_name,settlement_cycle,settlement_days,settlement_terms_original) x)');
  if definition = previous then
    raise exception '供应商汇总商务条件分组与预期不一致；需人工核对后再迁移';
  end if;
  previous := definition;
  definition := replace(definition,
    '''settlement_cycle'',n.settlement_cycle,''settlement_days'',n.settlement_days,',
    '''settlement_cycle'',n.settlement_cycle,''settlement_days'',n.settlement_days,' ||
    '''settlement_terms_original'',n.settlement_terms_original,');
  if definition = previous then
    raise exception '送货单商务条件输出字段与预期不一致；需人工核对后再迁移';
  end if;
  execute definition;
end;
$$;

commit;
