-- Product family determines which saleable specifications a category uses.
-- Existing products remain readable; missing source specifications are not invented.
begin;

alter table public.product_categories
  add column if not exists product_family text not null default 'OTHER';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='product_categories_product_family_check' and conrelid='public.product_categories'::regclass) then
    alter table public.product_categories add constraint product_categories_product_family_check
      check (product_family in ('SCREEN','BATTERY','COVER','SMALL_PART','OTHER'));
  end if;
end $$;

update public.product_categories set product_family='SCREEN' where code='SCR' and product_family='OTHER';
update public.product_categories set product_family='BATTERY' where code='BAT' and product_family='OTHER';
update public.product_categories set product_family='COVER' where code='COV' and product_family='OTHER';
update public.product_categories set product_family='SMALL_PART' where code='PRT' and product_family='OTHER';

alter table public.products
  add column if not exists specifications jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='products_specifications_object_check' and conrelid='public.products'::regclass) then
    alter table public.products add constraint products_specifications_object_check
      check (jsonb_typeof(specifications)='object');
  end if;
end $$;

alter table public.quote_items
  add column if not exists product_specifications_snapshot jsonb,
  add column if not exists product_color_snapshot text;
alter table public.stock_order_items
  add column if not exists product_specifications_snapshot jsonb,
  add column if not exists product_color_snapshot text;

create or replace function public.capture_quote_product_specifications()
returns trigger language plpgsql set search_path=public as $$
declare previous_quote uuid;
begin
  if new.product_specifications_snapshot is null or new.product_color_snapshot is null then
    select supersedes_quote_id into previous_quote from public.quotes where id=new.quote_id;
    if previous_quote is not null then
      select coalesce(new.product_specifications_snapshot,product_specifications_snapshot),
             coalesce(new.product_color_snapshot,product_color_snapshot)
      into new.product_specifications_snapshot,new.product_color_snapshot
      from public.quote_items
      where quote_id=previous_quote and line_number=new.line_number
        and product_id is not distinct from new.product_id;
    end if;
    if (new.product_specifications_snapshot is null or new.product_color_snapshot is null) and new.product_id is not null then
      select coalesce(new.product_specifications_snapshot,specifications),
             coalesce(new.product_color_snapshot,color)
      into new.product_specifications_snapshot,new.product_color_snapshot
      from public.products where id=new.product_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists quote_product_specifications_snapshot on public.quote_items;
create trigger quote_product_specifications_snapshot before insert on public.quote_items
for each row execute function public.capture_quote_product_specifications();

create or replace function public.capture_stock_product_specifications()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.product_specifications_snapshot is null or new.product_color_snapshot is null then
    select coalesce(new.product_specifications_snapshot,qi.product_specifications_snapshot),
           coalesce(new.product_color_snapshot,qi.product_color_snapshot)
    into new.product_specifications_snapshot,new.product_color_snapshot
    from public.quote_items qi
    join public.stock_orders so on so.quote_id=qi.quote_id
    where so.id=new.stock_order_id and qi.line_number=new.line_number;
  end if;
  return new;
end $$;

drop trigger if exists stock_product_specifications_snapshot on public.stock_order_items;
create trigger stock_product_specifications_snapshot before insert on public.stock_order_items
for each row execute function public.capture_stock_product_specifications();

commit;
