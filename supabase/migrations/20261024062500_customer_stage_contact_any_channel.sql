begin;
set local lock_timeout = '5s';

-- Match the current application rule: FOLLOWING and DEAL require at least one
-- usable contact channel, not both phone and email. WhatsApp is intentionally
-- not included here; the customer-stage rule names phone, email, or WeChat.
create or replace function public.require_customer_stage_contacts()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status in ('FOLLOWING', 'DEAL')
    and (tg_op = 'INSERT' or old.status is distinct from new.status)
    and nullif(btrim(coalesce(new.phone, '')), '') is null
    and nullif(btrim(coalesce(new.email, '')), '') is null
    and nullif(btrim(coalesce(new.wechat, '')), '') is null then
    raise exception '意向客户和成交客户至少填写微信、邮箱或电话其中一项'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_require_stage_contacts on public.customers;
create trigger customers_require_stage_contacts
before insert or update of status, phone, email, wechat on public.customers
for each row execute function public.require_customer_stage_contacts();

commit;
