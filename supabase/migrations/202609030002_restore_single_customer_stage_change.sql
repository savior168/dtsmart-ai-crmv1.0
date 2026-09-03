begin;

-- Customer stage and follow-up state are operator decisions. Business
-- documents and uploaded follow-up evidence remain linked facts, but may not
-- silently mutate either state.
drop trigger if exists attachments_promote_evidenced_interest on public.attachments;
drop trigger if exists quotes_promote_customer_stage on public.quotes;
drop trigger if exists sales_orders_promote_customer_stage on public.sales_orders;

-- The legacy quote RPC also changed the customer stage directly after the
-- quote was inserted. Replace it with the same transactional quote creation
-- logic minus that side effect. System administrators maintain the platform;
-- they do not create sales documents on behalf of salespeople.
create or replace function public.create_quote_with_items(
  p_customer_id uuid,
  p_status text,
  p_currency text,
  p_valid_until date,
  p_payment_method text,
  p_delivery_date date,
  p_customer_short_name text,
  p_destination_country text,
  p_stocking_requirements text,
  p_shipping_cost numeric,
  p_notes text,
  p_items jsonb
) returns public.quotes language plpgsql security definer set search_path=public as $$
declare actor public.users; customer public.customers; created_quote public.quotes; quote_no text; subtotal_value numeric;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role in ('WAREHOUSE','ADMIN') then raise exception '当前账号不能创建销售报价单'; end if;
  select * into customer from public.customers where id=p_customer_id and deleted_at is null for update;
  if customer.id is null then raise exception '客户不存在'; end if;
  if coalesce(customer.owner_user_id,customer.owner_id,customer.created_by)<>actor.id then raise exception '只能为归属自己的客户创建报价单'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '请至少添加一条产品明细'; end if;
  if p_status not in ('DRAFT','GENERATED','SENT') then raise exception '无效的报价状态'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(item_name text,quantity numeric,unit_price numeric,procurement_cost numeric)
    where nullif(trim(coalesce(item_name,'')),'') is null or coalesce(quantity,0)<=0 or coalesce(unit_price,-1)<0 or coalesce(procurement_cost,-1)<0)
  then raise exception '产品名称、数量、销售单价或采购成本不正确'; end if;
  select coalesce(sum(quantity*unit_price),0) into subtotal_value
  from jsonb_to_recordset(p_items) as x(quantity numeric,unit_price numeric);
  quote_no:='PI-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.quotes(customer_id,created_by,owner_id,quote_number,currency,amount,status,valid_until,notes,
    subtotal,shipping_cost,total_amount,payment_method,delivery_date,customer_short_name,destination_country,stocking_requirements)
  values(customer.id,actor.id,actor.id,quote_no,upper(coalesce(nullif(trim(p_currency),''),'USD')),
    subtotal_value+greatest(coalesce(p_shipping_cost,0),0),p_status,p_valid_until,nullif(trim(coalesce(p_notes,'')),''),
    subtotal_value,greatest(coalesce(p_shipping_cost,0),0),subtotal_value+greatest(coalesce(p_shipping_cost,0),0),
    nullif(trim(coalesce(p_payment_method,'')),''),p_delivery_date,
    coalesce(nullif(trim(coalesce(p_customer_short_name,'')),''),customer.company_name),
    coalesce(nullif(trim(coalesce(p_destination_country,'')),''),customer.country),nullif(trim(coalesce(p_stocking_requirements,'')),''))
  returning * into created_quote;
  insert into public.quote_items(quote_id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,procurement_cost,preparation_requirement)
  select created_quote.id,row_number() over(),trim(item_name),nullif(trim(coalesce(brand,'')),''),nullif(trim(coalesce(model,'')),''),
    nullif(trim(coalesce(quality,'')),''),coalesce(description,''),nullif(trim(coalesce(description_zh,'')),''),quantity,unit_price,procurement_cost,
    nullif(trim(coalesce(preparation_requirement,'')),'')
  from jsonb_to_recordset(p_items) as x(item_name text,brand text,model text,quality text,description text,description_zh text,quantity numeric,unit_price numeric,procurement_cost numeric,preparation_requirement text);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'QUOTE_CREATE','quote',created_quote.id,jsonb_build_object('quote_number',quote_no,'customer_id',customer.id,'status',p_status,'item_count',jsonb_array_length(p_items)));
  return created_quote;
end $$;

-- The old evidence-free RPC is no longer a valid public write path.
revoke execute on function public.set_customer_stage(uuid,text) from public,anon,authenticated;

-- Private/manual/imported customers already have an owner and therefore are
-- potential customers, not unclaimed public-pool records.
update public.customers
set status='CLAIMED',pool_status='CLAIMED',updated_at=now()
where owner_id is not null and status='UNCLAIMED';

-- A customer stage may be corrected manually for one customer at a time, but
-- every change is reasoned and the commercially meaningful stages require an
-- uploaded evidence file. Bulk stage mutation remains deliberately unsupported.
create or replace function public.change_customer_stage_with_evidence(
  p_customer_id uuid,
  p_status text,
  p_reason text,
  p_storage_path text default null,
  p_filename text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.users;
  target public.customers;
  target_status text:=upper(trim(coalesce(p_status,'')));
  reason_value text:=trim(coalesce(p_reason,''));
  attachment_id uuid;
  expires_at timestamptz;
  protection_type text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号不存在或未启用'; end if;

  select * into target from public.customers
  where id=p_customer_id and deleted_at is null
  for update;
  if target.id is null then raise exception '客户不存在或已删除'; end if;
  if target.owner_id is null then raise exception '公海待认领客户不能直接修改阶段，请先分配或由销售员认领'; end if;
  if actor.role<>'ADMIN' and target.owner_id<>actor.id then
    raise exception '只能修改归属自己的客户阶段';
  end if;
  if target_status not in ('CLAIMED','FOLLOWING','QUOTE','DEAL','RELEASED') then
    raise exception '请选择有效的客户阶段';
  end if;
  if target.status=target_status then raise exception '客户当前已经是所选阶段'; end if;
  if reason_value='' then raise exception '请填写真实、可追溯的阶段变更原因'; end if;

  if target_status in ('FOLLOWING','QUOTE','DEAL') then
    if nullif(trim(coalesce(p_storage_path,'')),'') is null
      or nullif(trim(coalesce(p_filename,'')),'') is null then
      raise exception '变更为意向客户、报价中或已成交时必须上传真实凭证';
    end if;
    if coalesce(p_mime_type,'') not in ('image/jpeg','image/png','image/webp','application/pdf') then
      raise exception '阶段凭证仅支持 JPG、PNG、WebP 图片或 PDF 文件';
    end if;
  end if;

  if nullif(trim(coalesce(p_storage_path,'')),'') is not null then
    insert into public.attachments(
      customer_id,uploaded_by,filename,original_filename,storage_path,mime_type,size_bytes,kind
    ) values(
      target.id,actor.id,trim(p_filename),trim(p_filename),trim(p_storage_path),p_mime_type,p_size_bytes,'STAGE_EVIDENCE'
    ) returning id into attachment_id;
  end if;

  update public.customer_protection
  set status='SUPERSEDED'
  where customer_id=target.id and owner_id=target.owner_id and status='ACTIVE';

  if target_status<>'RELEASED' then
    expires_at:=case target_status when 'DEAL' then null when 'QUOTE' then now()+interval '180 days' else now()+interval '90 days' end;
    protection_type:=case target_status when 'DEAL' then 'DEAL' when 'QUOTE' then 'QUOTE' else 'INTENT' end;
    insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
    values(target.id,target.owner_id,protection_type,now(),expires_at,'ACTIVE',0);
  end if;

  update public.customers
  set status=target_status,
      pool_status='CLAIMED',
      updated_at=now()
  where id=target.id;

  insert into public.customer_status_history(customer_id,from_status,to_status,changed_by,reason)
  values(target.id,target.status,target_status,actor.id,reason_value);

  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'CUSTOMER_STAGE','customer',target.id,jsonb_build_object(
    'customer_name',target.company_name,
    'from_status',target.status,
    'to_status',target_status,
    'reason',reason_value,
    'evidence_attachment_id',attachment_id
  ));

  return jsonb_build_object(
    'customer_id',target.id,
    'from_status',target.status,
    'to_status',target_status,
    'evidence_attachment_id',attachment_id
  );
end $$;

grant execute on function public.change_customer_stage_with_evidence(uuid,text,text,text,text,text,bigint) to authenticated;

create or replace function public.change_customer_followup_status(
  p_customer_id uuid,
  p_followup_status text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.users;
  target public.customers;
  next_status text:=upper(trim(coalesce(p_followup_status,'')));
  previous_status text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号不存在或未启用'; end if;
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在或已删除'; end if;
  if target.owner_id is null then raise exception '公海待认领客户没有跟进状态，请先分配或认领'; end if;
  if actor.role<>'ADMIN' and target.owner_id<>actor.id then raise exception '只能修改归属自己的客户跟进状态'; end if;
  if next_status not in ('WAITING_CONTACT','FOLLOWUP_REQUIRED','WAITING_REPLY','PAUSED','NO_FOLLOWUP') then raise exception '请选择有效的跟进状态'; end if;
  previous_status:=coalesce(nullif(target.followup_status,''),'WAITING_CONTACT');
  if previous_status=next_status then raise exception '客户当前已经是所选跟进状态'; end if;
  update public.customers set followup_status=next_status,updated_at=now() where id=target.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'CUSTOMER_FOLLOWUP_STATUS','customer',target.id,jsonb_build_object(
    'customer_name',target.company_name,'from_status',previous_status,'to_status',next_status
  ));
  return jsonb_build_object('customer_id',target.id,'from_status',previous_status,'to_status',next_status);
end $$;

grant execute on function public.change_customer_followup_status(uuid,text) to authenticated;

commit;
