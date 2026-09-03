begin;

alter table public.customer_private_supplements
  drop constraint if exists customer_private_supplements_field_name_check;

alter table public.customer_private_supplements
  add constraint customer_private_supplements_field_name_check
  check (field_name in ('contact_name','phone','whatsapp','email','website','google_url','address'));

commit;
