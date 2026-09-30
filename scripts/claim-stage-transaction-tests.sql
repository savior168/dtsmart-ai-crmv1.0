-- Run using an administration connection; all fixtures are rolled back.
begin;
set local statement_timeout = '15s';
do $$
declare actor_id uuid; customer_id_value uuid; chosen text; result jsonb;
  protection public.customer_protection; rejected boolean;
begin
  select id into actor_id from public.users where role='ADMIN' and status='ACTIVE' order by created_at limit 1;
  if actor_id is null then raise exception 'Active administrator required'; end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated')::text,true);
  foreach chosen in array array['CLAIMED','FOLLOWING','QUOTE','DEAL'] loop
    customer_id_value:=gen_random_uuid();
    insert into public.customers(id,company_name,country,created_by,status,acquisition_scope,pool_status)
    values(customer_id_value,'__ROLLBACK_CLAIM_STAGE_TEST__ '||chosen,'英国',actor_id,'UNCLAIMED','PUBLIC_POOL','AVAILABLE');
    result:=public.claim_public_customer(customer_id_value,'EMAIL','已核实联系结果','测试下一步计划',
      actor_id::text||'/rollback-test.pdf','rollback-test.pdf','application/pdf',1,chosen);
    if not exists(select 1 from public.customers where id=customer_id_value and owner_id=actor_id and status=chosen and pool_status='CLAIMED') then
      raise exception 'Claim stage/ownership mismatch: %',chosen;
    end if;
    select * into protection from public.customer_protection where customer_id=customer_id_value and status='ACTIVE';
    if chosen='DEAL' then
      if protection.type<>'DEAL' or protection.expire_date is not null then raise exception 'DEAL protection must be permanent'; end if;
    elsif chosen='QUOTE' then
      if protection.type<>'QUOTE' or protection.expire_date<>now()+interval '180 days' then raise exception 'QUOTE protection must be 180 days'; end if;
    else
      if protection.type<>'INTENT' or protection.expire_date<>now()+interval '90 days' then raise exception 'Initial protection must be 90 days'; end if;
    end if;
    if not exists(select 1 from public.customer_followup_queue where customer_id=customer_id_value and id=(result->>'followup_id')::uuid) then
      raise exception 'Claim initial followup excluded from current cycle';
    end if;
  end loop;
  rejected:=false;
  begin
    perform public.claim_public_customer(gen_random_uuid(),'EMAIL','联系结果','测试计划',null,null,null,null,'RELEASED');
  exception when others then
    if sqlerrm like '%不能通过认领阶段操作%' then rejected:=true; else raise; end if;
  end;
  if not rejected then raise exception 'RELEASED was accepted as a claim stage'; end if;
end $$;
rollback;
