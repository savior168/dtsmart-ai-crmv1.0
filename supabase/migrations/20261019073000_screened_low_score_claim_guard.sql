begin;

-- Keep unfinished and below-threshold screening results for audit. Only an
-- analyzed score of at least 60 may become a self-claimed customer, including
-- when an authenticated client calls the claim RPC directly.
create or replace function public.reject_low_score_self_claim()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.ai_screening_done is not true or old.ai_score is null or old.ai_score < 60 then
    raise exception '客户须完成 AI 分析且评分达到 60 分后才能认领';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_low_score_self_claim() from public, anon, authenticated;

drop trigger if exists customers_reject_low_score_self_claim on public.customers;
create trigger customers_reject_low_score_self_claim
before update on public.customers
for each row
when (old.owner_id is null and new.owner_id is not null and new.assigned_via = 'SELF_CLAIM')
execute function public.reject_low_score_self_claim();

commit;
