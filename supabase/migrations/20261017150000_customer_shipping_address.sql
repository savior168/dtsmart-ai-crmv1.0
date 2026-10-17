begin;

alter table public.customers
  add column if not exists shipping_address text;

comment on column public.customers.shipping_address is '客户指定的收货地址；独立于公司地址与货代地址。PI 创建时复制为收货地址快照。';

commit;
