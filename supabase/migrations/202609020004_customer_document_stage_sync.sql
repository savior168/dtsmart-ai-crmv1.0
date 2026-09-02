-- Keep customer stage/protection aligned with real quotation and order events.
create or replace function public.promote_customer_stage_from_business_document()
returns trigger language plpgsql security definer set search_path=public as $$
declare customer_id_value uuid; owner_id_value uuid; desired text; expires_at timestamptz;
begin
  if tg_table_name='quotes' then
    if new.status not in ('DRAFT','GENERATED','SENT','CONFIRMED') then return new; end if;
    customer_id_value:=new.customer_id; desired:='QUOTE'; expires_at:=now()+interval '180 days';
  else
    if new.status='CANCELLED' then return new; end if;
    customer_id_value:=new.customer_id; desired:='DEAL'; expires_at:=null;
  end if;
  select owner_id into owner_id_value from public.customers where id=customer_id_value and deleted_at is null;
  if owner_id_value is null then return new; end if;
  if desired='QUOTE' and exists(select 1 from public.sales_orders where customer_id=customer_id_value and status<>'CANCELLED') then return new; end if;
  update public.customer_protection set status='SUPERSEDED' where customer_id=customer_id_value and owner_id=owner_id_value and status='ACTIVE';
  insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
  values(customer_id_value,owner_id_value,desired,now(),expires_at,'ACTIVE',0);
  update public.customers set status=desired,updated_at=now() where id=customer_id_value and (desired='DEAL' or status<>'DEAL');
  return new;
end $$;

drop trigger if exists quotes_promote_customer_stage on public.quotes;
create trigger quotes_promote_customer_stage after insert or update of status on public.quotes
for each row execute function public.promote_customer_stage_from_business_document();

drop trigger if exists sales_orders_promote_customer_stage on public.sales_orders;
create trigger sales_orders_promote_customer_stage after insert or update of status on public.sales_orders
for each row execute function public.promote_customer_stage_from_business_document();
