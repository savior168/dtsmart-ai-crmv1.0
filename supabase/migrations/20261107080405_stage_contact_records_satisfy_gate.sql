begin;

-- Align the database-level stage guard with the customer profile and public-pool
-- claim checks: any one of the four contact channels is sufficient. Some
-- verified/AI-imported contacts live in customer_contacts rather than the
-- legacy columns on customers.
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
    and jsonb_array_length(coalesce(new.whatsapp_numbers, '[]'::jsonb)) = 0
    and not exists (
      select 1 from public.customer_contacts contact
      where contact.customer_id = new.id
        and contact.type in ('PHONE', 'EMAIL', 'WECHAT', 'WHATSAPP')
        and nullif(btrim(coalesce(contact.value_raw, '')), '') is not null
    ) then
    raise exception '意向客户和成交客户至少填写电话、邮箱、微信或 WhatsApp 其中一项'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

commit;
