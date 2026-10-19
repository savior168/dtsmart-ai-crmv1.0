-- Read-only permission regression for server-only SECURITY DEFINER helpers.
do $$
declare
  helper regprocedure;
begin
  foreach helper in array array[
    'public.ai_screening_usage_totals(uuid)'::regprocedure,
    'public.next_product_sku()'::regprocedure,
    'public.next_product_category_code()'::regprocedure
  ] loop
    if has_function_privilege('anon', helper, 'EXECUTE')
      or has_function_privilege('authenticated', helper, 'EXECUTE')
      or not has_function_privilege('service_role', helper, 'EXECUTE') then
      raise exception 'Unsafe execute grants on %', helper;
    end if;
  end loop;
end $$;
