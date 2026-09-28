-- Alias lookup is read-only and restricted to server-side service-role calls.
-- Avoid a stored search column so historical products are searchable without
-- rewriting their rows or changing their audit history.
begin;

create or replace function public.find_product_alias_ids(p_query text)
returns table(id uuid) language sql stable set search_path=public as $$
  select p.id
  from public.products p
  where btrim(coalesce(p_query,''))<>''
    and exists (
      select 1 from unnest(p.aliases) as alias(value)
      where position(lower(btrim(p_query)) in lower(alias.value))>0
    )
  limit 101;
$$;

revoke all on function public.find_product_alias_ids(text) from public,anon,authenticated;
grant execute on function public.find_product_alias_ids(text) to service_role;

commit;
