begin;

-- Keep the database rule aligned with the create, import, claim and stage APIs.
-- Current active intention/deal rows all have a contact. Preserve that invariant
-- on insert and on every update, including removal of the last contact.
create or replace function public.require_customer_stage_contacts()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status in ('FOLLOWING', 'DEAL')
    and nullif(btrim(coalesce(new.phone, '')), '') is null
    and nullif(btrim(coalesce(new.email, '')), '') is null
    and nullif(btrim(coalesce(new.wechat, '')), '') is null
    and nullif(btrim(coalesce(new.whatsapp, '')), '') is null
    and jsonb_array_length(coalesce(new.phone_numbers, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(new.email_addresses, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(new.wechat_numbers, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(new.whatsapp_numbers, '[]'::jsonb)) = 0 then
    raise exception '意向客户和成交客户至少填写电话、邮箱、微信或 WhatsApp 其中一项'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_require_stage_contacts on public.customers;
create trigger customers_require_stage_contacts
before insert or update of status, phone, email, wechat, whatsapp, phone_numbers, email_addresses, wechat_numbers, whatsapp_numbers on public.customers
for each row execute function public.require_customer_stage_contacts();

commit;

