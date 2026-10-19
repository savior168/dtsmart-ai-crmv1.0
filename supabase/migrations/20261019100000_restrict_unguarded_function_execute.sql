-- These security-definer helpers are server-side only. Historical direct grants
-- survived later REVOKE ... FROM PUBLIC migrations, leaving anon/authenticated
-- able to read cross-user AI usage or consume product numbering sequences.
revoke execute on function public.ai_screening_usage_totals(uuid) from public, anon, authenticated;
grant execute on function public.ai_screening_usage_totals(uuid) to service_role;

revoke execute on function public.next_product_sku() from public, anon, authenticated;
grant execute on function public.next_product_sku() to service_role;

revoke execute on function public.next_product_category_code() from public, anon, authenticated;
grant execute on function public.next_product_category_code() to service_role;
