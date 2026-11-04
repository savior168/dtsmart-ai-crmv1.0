-- Run only after the foundation migration on the isolated local fixture.
do $$ begin
  if exists (select 1 from pg_trigger where tgname='stock_receipt_requires_supplier_document') then
    raise exception 'foundation migration activated the cutover trigger too early';
  end if;
end $$;
insert into public.stock_order_items(id,stock_order_id,line_number,item_name,quantity)
values('66666666-6666-4666-8666-666666666664',
  '66666666-6666-4666-8666-666666666662',2,'Compatibility-window product',5);
update public.stock_order_items set received_quantity=1
where id='66666666-6666-4666-8666-666666666664';
