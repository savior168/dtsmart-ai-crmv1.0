begin;
revoke all on function public.prevent_duplicate_customer_identity() from public, anon, authenticated;
commit;

