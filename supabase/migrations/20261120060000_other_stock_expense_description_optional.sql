begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Keep the expense item mandatory. A description adds context but is optional.
alter table public.stock_order_expense_entries
  drop constraint stock_expense_fields_check;
alter table public.stock_order_expense_entries
  add constraint stock_expense_fields_check check (
    (expense_type='PACKAGING' and supplier_id is not null and delivery_note_id is not null)
    or (expense_type='SHIPPING' and supplier_id is null and delivery_note_id is null)
    or (expense_type='OTHER' and supplier_id is null and delivery_note_id is null
      and char_length(btrim(coalesce(expense_item,''))) between 2 and 100
      and char_length(btrim(coalesce(description,''))) <= 500)
  );

alter table public.stock_order_shipment_expense_corrections
  drop constraint shipment_expense_correction_fields;
alter table public.stock_order_shipment_expense_corrections
  add constraint shipment_expense_correction_fields check (
    (expense_type='PACKAGING' and
      ((revised_cny=0 and supplier_id is null and delivery_note_id is null)
        or (revised_cny>0 and supplier_id is not null and delivery_note_id is not null)))
    or (expense_type='SHIPPING' and supplier_id is null and delivery_note_id is null)
    or (expense_type='OTHER' and supplier_id is null and delivery_note_id is null
      and (revised_cny=0 or (char_length(btrim(coalesce(expense_item,''))) between 2 and 100
        and char_length(btrim(coalesce(description,''))) <= 500)))
  );

do $$
declare
  target_name text;
  target_oid oid;
  definition text;
  old_check constant text := 'char_length(btrim(coalesce(p_description,''''))) not between 2 and 500';
  new_check constant text := 'char_length(btrim(coalesce(p_description,''''))) > 500';
begin
  foreach target_name in array array[
    'record_stock_order_expense',
    'correct_stock_order_expense_entry',
    'correct_stock_order_shipment_expense'
  ] loop
    select p.oid into strict target_oid from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=target_name;
    definition := pg_get_functiondef(target_oid);
    if position(old_check in definition)=0 then
      raise exception 'Expected description validation missing from %', target_name;
    end if;
    execute replace(definition,old_check,new_check);
  end loop;
end;
$$;

commit;
