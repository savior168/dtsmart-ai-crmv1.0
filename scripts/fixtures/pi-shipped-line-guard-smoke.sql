-- Run only on a fresh local PostgreSQL fixture after supplier-ledger-bootstrap.sql.
alter table public.stock_order_items
  add column product_specifications_snapshot jsonb,
  add column product_color_snapshot text,
  add column preparation_requirement text,
  add column internal_note text,
  add column estimated_unit_cost_cny numeric(14,2);
-- The production migration updates the installed draft-write guard. Provide
-- minimal signatures so its fail-closed patch is also parsed in this fixture.
create function public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,
  text,uuid,date,date,text,text,text,text,text,jsonb)
returns public.sales_orders language plpgsql as $$
declare actor public.users; target public.sales_orders;
begin
  if (actor.role='ORDER_CLERK' and target.prepared_by is distinct from actor.id) or (actor.role<>'ORDER_CLERK' and target.sales_user_id<>actor.id and actor.role<>'ADMIN') then
    raise exception 'creator only';
  end if;
  return target;
end $$;
create function public.set_direct_pi_change_note(uuid,integer,text)
returns public.sales_orders language plpgsql as $$
declare actor public.users; target public.sales_orders;
begin
  if (actor.role='ORDER_CLERK' and target.prepared_by is distinct from actor.id) or (actor.role<>'ORDER_CLERK' and target.sales_user_id<>actor.id and actor.role<>'ADMIN') then
    raise exception 'creator only';
  end if;
  return target;
end $$;
create function public.delete_never_submitted_pi_draft(uuid,integer)
returns void language plpgsql as $$
declare actor public.users; target public.sales_orders;
begin
  if actor.role<>'ADMIN' and target.sales_user_id<>actor.id then
    raise exception 'creator only';
  end if;
end $$;
\if :{?production_cancel_variant}
create function public.cancel_sales_order(uuid,text)
returns public.sales_orders language plpgsql as $$
declare actor public.users; target public.sales_orders;
begin
  if actor.id is null or target.id is null or (actor.role='ORDER_CLERK' and target.confirmation_method<>'DIRECT_PI') then
    raise exception 'clerk blocked before configurable grant';
  end if;
  if (target.confirmation_method='DIRECT_PI' and target.prepared_by is distinct from actor.id)
    or (target.confirmation_method<>'DIRECT_PI' and target.sales_user_id<>actor.id and actor.role<>'ADMIN') then
    raise exception 'owner only';
  end if;
  return target;
end $$;
\else
create function public.cancel_sales_order(uuid,text)
returns public.sales_orders language plpgsql as $$
declare actor public.users; target public.sales_orders;
begin
  if actor.id is null or target.id is null or actor.role='ORDER_CLERK' then
    raise exception 'clerk blocked before configurable grant';
  end if;
  if target.sales_user_id<>actor.id and actor.role<>'ADMIN' then
    raise exception 'owner only';
  end if;
  return target;
end $$;
\endif
\i supabase/migrations/20261102060003_pi_recall_stock_start_guard.sql

do $$
declare
  creator_guard text := 'coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id';
begin
  if position(creator_guard in pg_get_functiondef('public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure))=0
    or position(creator_guard in pg_get_functiondef('public.set_direct_pi_change_note(uuid,integer,text)'::regprocedure))=0
    or position(creator_guard in pg_get_functiondef('public.delete_never_submitted_pi_draft(uuid,integer)'::regprocedure))=0
    or position(creator_guard in pg_get_functiondef('public.cancel_sales_order(uuid,text)'::regprocedure))=0 then
    raise exception 'PI creator-only write guard was not installed';
  end if;
end $$;

insert into public.stock_order_items(id,stock_order_id,line_number,item_name,model,
  quantity,received_quantity,prepared_quantity,shipped_quantity)
values ('66666666-6666-4666-8666-666666666664',
  '66666666-6666-4666-8666-666666666662',2,'Shipped line','A',5,5,5,1);
insert into public.stock_order_items(id,stock_order_id,line_number,item_name,model,
  quantity,received_quantity,prepared_quantity,shipped_quantity)
values ('66666666-6666-4666-8666-666666666665',
  '66666666-6666-4666-8666-666666666662',3,'Received line','B',8,3,0,0);
insert into public.stock_order_items(id,stock_order_id,line_number,item_name,model,
  quantity,received_quantity,prepared_quantity,shipped_quantity)
values ('66666666-6666-4666-8666-666666666666',
  '66666666-6666-4666-8666-666666666662',4,'Unreceived line','C',5,0,0,0);

do $$
declare blocked boolean;
begin
  blocked := false;
  begin
    update public.stock_order_items set quantity=6
      where id='66666666-6666-4666-8666-666666666664';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'shipped quantity amendment was accepted'; end if;

  blocked := false;
  begin
    update public.stock_order_items set quality='replacement'
      where id='66666666-6666-4666-8666-666666666664';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'shipped identity amendment was accepted'; end if;

  blocked := false;
  begin
    update public.stock_order_items set estimated_unit_cost_cny=42
      where id='66666666-6666-4666-8666-666666666664';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'shipped commercial estimate amendment was accepted'; end if;

  blocked := false;
  begin
    update public.stock_order_items set shipped_quantity=0
      where id='66666666-6666-4666-8666-666666666664';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'shipped physical quantity rollback was accepted'; end if;

  blocked := false;
  begin
    delete from public.stock_order_items
      where id='66666666-6666-4666-8666-666666666664';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'shipped line deletion was accepted'; end if;

  blocked := false;
  begin
    update public.stock_order_items set model='Changed model'
      where id='66666666-6666-4666-8666-666666666665';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'received product identity changed before warehouse reconciliation'; end if;

  blocked := false;
  begin
    update public.stock_order_items set quantity=9
      where id='66666666-6666-4666-8666-666666666665';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'received product quantity changed outside amendment workflow'; end if;

  blocked := false;
  begin
    delete from public.stock_order_items
      where id='66666666-6666-4666-8666-666666666665';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'received product line deleted before physical reconciliation'; end if;

  update public.stock_order_items set procurement_cost=12
    where id='66666666-6666-4666-8666-666666666665';

  update public.stock_order_items set received_quantity=5
    where id='66666666-6666-4666-8666-666666666664';
  update public.stock_order_items set item_name='Unshipped corrected line'
    where id='66666666-6666-4666-8666-666666666666';
end $$;
