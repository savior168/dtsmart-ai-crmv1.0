begin;

-- QUOTE remains a quotation-document concept, not a customer stage. Preserve
-- existing quotation records, protection expiry, status history and audit
-- trails; only the live customer stage is folded into FOLLOWING.
update public.customers set status = 'FOLLOWING' where status = 'QUOTE';

alter table public.customers
  add constraint customers_no_quote_stage_check check (status <> 'QUOTE');

-- A newly selected intention/deal stage requires both primary contact fields.
-- Legacy records already in those stages are not rewritten or blocked from
-- unrelated edits; this guard applies when a stage is newly selected.
create or replace function public.require_customer_stage_contacts()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status in ('FOLLOWING', 'DEAL')
    and (tg_op = 'INSERT' or old.status is distinct from new.status)
    and (nullif(btrim(coalesce(new.phone, '')), '') is null
      or nullif(btrim(coalesce(new.email, '')), '') is null) then
    raise exception '意向客户和成交客户必须同时填写联系电话和邮箱'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists customers_require_stage_contacts on public.customers;
create trigger customers_require_stage_contacts
before insert or update of status, phone, email on public.customers
for each row execute function public.require_customer_stage_contacts();

commit;
