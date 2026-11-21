-- The PL/pgSQL record variable `supplier` shadows a table alias with the same
-- name in the final progress aggregation. Keep the existing atomic receipt
-- transaction and permissions unchanged; only disambiguate that table alias.
do $$
declare
  definition text := pg_get_functiondef(
    'public.record_supplier_receipts_batch(uuid,jsonb,timestamptz,text)'::regprocedure
  );
  old_join text := 'left join public.suppliers supplier on grouped.supplier_count = 1 and supplier.id = grouped.supplier_id';
  old_code text := 'then supplier.system_code else null end';
begin
  if definition is null
    or (length(definition) - length(replace(definition, old_join, ''))) / length(old_join) <> 1
    or (length(definition) - length(replace(definition, old_code, ''))) / length(old_code) <> 1 then
    raise exception '批量回货函数版本不匹配，未修改';
  end if;
  definition := replace(definition, old_join,
    'left join public.suppliers supplier_lookup on grouped.supplier_count = 1 and supplier_lookup.id = grouped.supplier_id');
  definition := replace(definition, old_code,
    'then supplier_lookup.system_code else null end');
  execute definition;
end;
$$;
