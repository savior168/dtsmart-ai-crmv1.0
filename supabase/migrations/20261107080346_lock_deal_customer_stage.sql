begin;

-- A completed customer is a terminal lifecycle stage. Enforce this invariant
-- below the API/RPC layer so alternate authenticated write paths cannot
-- downgrade a DEAL customer and erase the business meaning of its history.
create or replace function public.prevent_deal_customer_stage_downgrade()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'DEAL' and new.status is distinct from old.status then
    raise exception '已成交客户阶段已锁定，不能降级为潜在或意向客户';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_prevent_deal_stage_downgrade on public.customers;
create trigger customers_prevent_deal_stage_downgrade
before update of status on public.customers
for each row
execute function public.prevent_deal_customer_stage_downgrade();

commit;
