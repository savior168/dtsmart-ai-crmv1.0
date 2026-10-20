-- Match claim RPC authorization to the public-pool list and API preflight.
-- The legacy eight-argument overload has no stage/evidence contract and is
-- no longer called by the application; keep it for history but revoke access.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

revoke all on function public.claim_public_customer(uuid,text,text,text,text,text,text,bigint)
  from public, anon, authenticated;

do $$
declare
  definition text;
  signature text := 'public.claim_public_customer(uuid,text,text,text,text,text,text,bigint,text)';
  old_actor text := 'if actor.id is null';
  old_scope text := 'if target.acquisition_scope<>''PUBLIC_POOL'' or target.pool_status<>''AVAILABLE'' or target.owner_id is not null';
begin
  definition := pg_get_functiondef(signature::regprocedure);
  if position(old_actor in definition) = 0 or position(old_scope in definition) = 0 then
    raise exception 'Claim RPC has changed; review before applying';
  end if;
  definition := replace(definition, old_actor,
    'if not public.current_user_has_business_permission(''customers.claim'') then raise exception ''当前账号未获客户认领权限''; end if;' || chr(10) || old_actor);
  definition := replace(definition, old_scope,
    'if target.status<>''UNCLAIMED'' or target.ai_screening_done is distinct from true or target.ai_score is null or target.ai_score<60 then raise exception ''客户尚未完成达标AI分析或当前不可认领''; end if;' || chr(10) || old_scope);
  execute definition;
end $$;

commit;
