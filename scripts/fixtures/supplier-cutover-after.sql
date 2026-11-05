-- Run only after the cutover migration on the isolated local fixture.
do $$ begin
  if (select quantity from public.supplier_receipt_legacy_baselines
    where stock_order_item_id='66666666-6666-4666-8666-666666666664') <> 1 then
    raise exception 'compatibility-window receipt was not preserved as a baseline';
  end if;
  begin
    update public.stock_order_items set received_quantity=2
    where id='66666666-6666-4666-8666-666666666664';
    raise exception 'undocumented receipt succeeded after cutover';
  exception when others then
    if sqlerrm='undocumented receipt succeeded after cutover' then raise; end if;
  end;
  if (select received_quantity from public.stock_order_items
    where id='66666666-6666-4666-8666-666666666664') <> 1 then
    raise exception 'rejected undocumented receipt changed physical quantity';
  end if;
end $$;
