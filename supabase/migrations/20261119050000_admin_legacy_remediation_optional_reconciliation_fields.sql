begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Preserve the existing audited attribution logic; only permit the system
-- administrator to use the same guarded workflow as warehouse staff.
do $migration$
declare
  definition text := pg_get_functiondef('public.link_legacy_supplier_receipt_source(uuid,uuid,text,date,integer,numeric,timestamptz)'::regprocedure);
  old_guard text := 'actor.role <> ''WAREHOUSE''';
begin
  if strpos(definition, old_guard) = 0 then
    raise exception 'legacy supplier receipt guard changed; review migration';
  end if;
  execute replace(definition, old_guard, 'actor.role not in (''WAREHOUSE'',''ADMIN'')');
end;
$migration$;

-- A blank voucher number is allowed, but nonblank voucher numbers retain
-- their existing per-note uniqueness and cross-supplier checks.
alter table public.supplier_payments
  drop constraint supplier_payments_payment_reference_check;
alter table public.supplier_payments
  add constraint supplier_payments_payment_reference_check
  check (char_length(btrim(payment_reference)) <= 200);
drop index public.supplier_payments_reference_unique;
create unique index supplier_payments_reference_unique
  on public.supplier_payments(delivery_note_id, payment_method, upper(btrim(payment_reference)))
  where btrim(payment_reference) <> '';

do $migration$
declare
  definition text := pg_get_functiondef('public.record_supplier_payment(uuid,numeric,date,text,text)'::regprocedure);
  old_validation text := $old$or nullif(btrim(coalesce(p_payment_reference,'')), '') is null
    or char_length(btrim(p_payment_reference)) > 200$old$;
  old_lock text := 'perform pg_advisory_xact_lock(hashtextextended(';
  old_end text := $old$  end if;
  select coalesce(sum(amount_cny),0) into due_amount$old$;
begin
  if strpos(definition, old_validation) = 0
    or strpos(definition, old_lock) = 0
    or strpos(definition, old_end) = 0 then
    raise exception 'supplier payment function changed; review migration';
  end if;
  definition := replace(definition, old_validation,
    'or char_length(btrim(coalesce(p_payment_reference,''''))) > 200');
  definition := replace(definition,
    '请填写有效的付款金额、日期、方式和不可重复使用的付款凭证号',
    '请填写有效的付款金额、日期和方式；凭证号最多200字');
  definition := replace(definition, old_lock,
    'if nullif(btrim(coalesce(p_payment_reference,'''')), '''') is not null then' || chr(10) || '  ' || old_lock);
  definition := replace(definition, old_end,
    '  end if;' || chr(10) || '  end if;' || chr(10)
    || '  select coalesce(sum(amount_cny),0) into due_amount');
  execute definition;
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef('public.confirm_supplier_note_paper_total(uuid,numeric,timestamptz,text)'::regprocedure);
  old_validation text := $old$or nullif(btrim(coalesce(p_reason,'')), '') is null
    or char_length(btrim(p_reason)) > 500$old$;
begin
  if strpos(definition, old_validation) = 0 then
    raise exception 'paper total function changed; review migration';
  end if;
  definition := replace(definition, old_validation,
    'or char_length(btrim(coalesce(p_reason,''''))) > 500');
  definition := replace(definition,
    '请填写有效纸单金额和核对说明（最多500字）',
    '请填写有效纸单金额；核对说明最多500字');
  execute definition;
end;
$migration$;
commit;
