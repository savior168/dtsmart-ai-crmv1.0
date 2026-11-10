begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.supplier_private_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  kind text not null check (kind in ('PHONE', 'WECHAT')),
  value text not null check (char_length(btrim(value)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index supplier_private_contacts_supplier_idx on public.supplier_private_contacts(supplier_id);
alter table public.supplier_private_contacts enable row level security;
revoke all on public.supplier_private_contacts from public, anon, authenticated;
grant select, insert, update, delete on public.supplier_private_contacts to service_role;

create function public.delete_unlinked_supplier(p_supplier_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare supplier_code text;
begin
  select system_code into supplier_code from public.suppliers where id = p_supplier_id for update;
  if not found then return false; end if;
  -- The supplier row lock conflicts with receipt creation's FOR SHARE lock.
  -- Lock the legacy stock table while checking its text-based supplier link.
  lock table public.stock_order_items in share mode;
  if exists(select 1 from public.supplier_delivery_notes where supplier_id = p_supplier_id)
    or exists(select 1 from public.stock_order_items
      where upper(btrim(coalesce(warehouse_supplier_code, ''))) = upper(btrim(supplier_code)))
    or exists(select 1 from public.supplier_private_contacts where supplier_id = p_supplier_id) then
    raise exception '该供应商已有业务关联或联系方式，请停用档案，不可删除';
  end if;
  delete from public.suppliers where id = p_supplier_id;
  return true;
end;
$$;
revoke all on function public.delete_unlinked_supplier(uuid) from public, anon, authenticated;
grant execute on function public.delete_unlinked_supplier(uuid) to service_role;
commit;
