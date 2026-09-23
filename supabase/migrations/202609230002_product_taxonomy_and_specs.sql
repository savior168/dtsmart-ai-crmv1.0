-- Stable system-owned category codes and source-specific product specifications.
begin;

create sequence if not exists public.product_category_code_sequence start 1;

create or replace function public.next_product_category_code()
returns text language plpgsql volatile security definer set search_path=public as $$
declare candidate text;
begin
  loop
    candidate := 'CAT-' || lpad(nextval('public.product_category_code_sequence')::text, 6, '0');
    exit when not exists (select 1 from public.product_categories where code=candidate);
  end loop;
  return candidate;
end $$;

alter table public.product_categories alter column code set default public.next_product_category_code();

create or replace function public.keep_product_category_code()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.code is distinct from old.code then
    raise exception '商品分类编码创建后不可修改';
  end if;
  return new;
end $$;

drop trigger if exists product_category_code_immutable on public.product_categories;
create trigger product_category_code_immutable before update on public.product_categories
for each row execute function public.keep_product_category_code();

-- Seed only a fresh catalog. Existing production taxonomy is never overwritten.
insert into public.product_categories(code,name_zh,name_en,sort_order)
select seed.code,seed.name_zh,seed.name_en,seed.sort_order
from (values
  ('SCR','屏幕及触控组件','Screens and touch assemblies',10),
  ('BAT','电池','Batteries',20),
  ('COV','后盖及外壳组件','Covers and housings',30),
  ('PRT','维修小配件','Repair parts',40)
) as seed(code,name_zh,name_en,sort_order)
where not exists (select 1 from public.product_categories)
on conflict(code) do nothing;

alter table public.products
  add column if not exists manufacturer_brand text,
  add column if not exists display_technology text,
  add column if not exists origin_type text;

-- The PI and warehouse order retain the product type that sales selected.
-- A revised PI copies the prior snapshot, even if the product master changes.
alter table public.quote_items add column if not exists product_type_snapshot text;
alter table public.stock_order_items add column if not exists product_type_snapshot text;

create or replace function public.capture_quote_product_type()
returns trigger language plpgsql set search_path=public as $$
declare previous_quote uuid;
begin
  if new.product_type_snapshot is null then
    select supersedes_quote_id into previous_quote from public.quotes where id=new.quote_id;
    if previous_quote is not null then
      select product_type_snapshot into new.product_type_snapshot
      from public.quote_items where quote_id=previous_quote and line_number=new.line_number
        and product_id is not distinct from new.product_id;
    end if;
    if new.product_type_snapshot is null and new.product_id is not null then
      select part_type into new.product_type_snapshot from public.products where id=new.product_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists quote_product_type_snapshot on public.quote_items;
create trigger quote_product_type_snapshot before insert on public.quote_items
for each row execute function public.capture_quote_product_type();

create or replace function public.capture_stock_product_type_and_cost()
returns trigger language plpgsql set search_path=public as $$
declare source_item public.quote_items;
begin
  select qi.* into source_item from public.quote_items qi
  join public.stock_orders so on so.quote_id=qi.quote_id
  where so.id=new.stock_order_id and qi.line_number=new.line_number;
  if source_item.id is not null then
    new.product_type_snapshot := coalesce(new.product_type_snapshot,source_item.product_type_snapshot);
    if coalesce(new.procurement_cost,0)=0 and source_item.unit_cost_cny is not null then
      new.procurement_cost := source_item.unit_cost_cny;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists stock_product_type_and_cost_snapshot on public.stock_order_items;
create trigger stock_product_type_and_cost_snapshot before insert on public.stock_order_items
for each row execute function public.capture_stock_product_type_and_cost();

commit;
