begin;

do $$
declare
  sales_user public.users;
  manager_user public.users;
  admin_user public.users;
  test_customer_id uuid;
  result jsonb;
  renewal_request_id uuid;
  index_no integer;
begin
  select * into sales_user from public.users
  where role='SALES' and manager_id is not null
  order by (status='ACTIVE') desc, created_at limit 1;
  if sales_user.id is null then raise exception '测试前置条件缺失：没有已设置直属上级的销售员'; end if;
  -- 线上当前可能只有停用销售员。仅在本事务内临时启用，最终统一回滚，不改变真实账号。
  if sales_user.status<>'ACTIVE' then
    update public.users set status='ACTIVE' where id=sales_user.id;
    sales_user.status:='ACTIVE';
  end if;
  select * into manager_user from public.users where id=sales_user.manager_id and role='SUPERVISOR' and status='ACTIVE';
  if manager_user.id is null then raise exception '测试前置条件缺失：直属主管不可用'; end if;
  select * into admin_user from public.users where role='ADMIN' and status='ACTIVE' order by created_at limit 1;
  if admin_user.id is null then raise exception '测试前置条件缺失：没有启用的系统管理员'; end if;

  insert into public.customers(company_name,country,phone,source,status,created_by,owner_id,owner_user_id,acquisition_scope,pool_status)
  values('E2E-ROLLBACK-'||gen_random_uuid()::text,'TEST','+999'||floor(random()*1000000000)::bigint,'SYSTEM_ACQUISITION','UNCLAIMED',admin_user.id,null,null,'PUBLIC_POOL','AVAILABLE')
  returning id into test_customer_id;

  perform set_config('request.jwt.claim.sub',sales_user.id::text,true);
  result:=public.claim_public_customer(test_customer_id,'EMAIL','已通过测试邮件确认客户身份','下一步发送测试报价','e2e/claim.png','claim.png','image/png',128);
  if not exists(select 1 from public.customers where id=test_customer_id and owner_id=sales_user.id and pool_status='CLAIMED') then
    raise exception '认领后客户归属或公海状态错误';
  end if;

  for index_no in 1..3 loop
    update public.customer_protection set expire_date=now()+interval '1 day'
    where customer_protection.customer_id=test_customer_id and owner_id=sales_user.id and status='ACTIVE';
    result:=public.submit_customer_protection_renewal(test_customer_id,'EMAIL','第'||index_no||'次测试跟进已确认','继续测试跟进','e2e/renew-'||index_no||'.png','renew.png','image/png',128);
    if index_no<=2 and result->>'status'<>'APPROVED' then raise exception '前两次续期未自动生效'; end if;
    if index_no=3 and result->>'status'<>'PENDING' then raise exception '第三次续期未进入主管审批'; end if;
  end loop;
  renewal_request_id:=(result->>'request_id')::uuid;

  perform set_config('request.jwt.claim.sub',manager_user.id::text,true);
  result:=public.review_customer_protection_renewal(renewal_request_id,'APPROVED','事务回滚测试通过');
  if result->>'status'<>'APPROVED' then raise exception '直属主管续期审批未生效'; end if;

  perform set_config('request.jwt.claim.sub',sales_user.id::text,true);
  perform public.release_customer(test_customer_id,'事务回滚测试释放');
  if not exists(select 1 from public.customers where id=test_customer_id and owner_id is null and pool_status='AVAILABLE') then
    raise exception '公海客户释放后未返回待认领状态';
  end if;

  perform set_config('request.jwt.claim.sub',admin_user.id::text,true);
  result:=public.admin_assign_eligible_customers(array[test_customer_id],sales_user.id,'事务回滚分配测试','验证管理员仅可分配无归属客户');
  if not exists(select 1 from public.customers where id=test_customer_id and owner_id=sales_user.id and pool_status='CLAIMED') then
    raise exception '管理员分配未生效';
  end if;
  begin
    perform public.admin_assign_eligible_customers(array[test_customer_id],sales_user.id,'禁止重分配测试','该操作必须失败');
    raise exception '管理员错误地强制重分配了已有归属客户';
  exception when others then
    if sqlerrm='管理员错误地强制重分配了已有归属客户' then raise; end if;
  end;
end $$;

rollback;
