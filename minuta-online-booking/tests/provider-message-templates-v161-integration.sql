\set ON_ERROR_STOP on
begin;
set local statement_timeout='60s';
set local lock_timeout='10s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v161_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v161_assert:%',label; end if; end $$;

do $fixture$
declare
  owner_id uuid:=gen_random_uuid(); colleague_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); organization_id uuid:=gen_random_uuid();
begin
  perform set_config('v161.owner',owner_id::text,true);
  perform set_config('v161.colleague',colleague_id::text,true);
  perform set_config('v161.outsider',outsider_id::text,true);
  perform set_config('v161.organization',organization_id::text,true);
  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (colleague_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',colleague_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (outsider_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',outsider_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values(owner_id,'V160 owner'),(colleague_id,'V160 colleague'),(outsider_id,'V160 outsider');
  insert into public.organizations(id,name,public_slug,status,created_by)
    values(organization_id,'V160 organization','v161-'||replace(organization_id::text,'-',''),'active',owner_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by) values
    (organization_id,owner_id,'owner',true,true,owner_id),(organization_id,colleague_id,'specialist',true,true,owner_id);
end $fixture$;

select set_config('request.jwt.claim.sub',current_setting('v161.owner'),true);
set local role authenticated;
select pg_temp.v161_assert((public.save_provider_message_template_v161(
  current_setting('v161.organization')::uuid,'reminder','  Мой шаблон {имя}  ',0,'10000000-0000-4000-8000-000000000001'::uuid)->>'version')::bigint=1,'owner_insert');
select pg_temp.v161_assert((public.save_provider_message_template_v161(
  current_setting('v161.organization')::uuid,'reminder','Мой шаблон {имя}',0,'10000000-0000-4000-8000-000000000001'::uuid)->>'version')::bigint=1,'idempotent_retry');
select pg_temp.v161_assert((public.save_provider_message_template_v161(
  current_setting('v161.organization')::uuid,'reminder','Новая версия {дата}',1,'10000000-0000-4000-8000-000000000002'::uuid)->>'version')::bigint=2,'version_increment');
select pg_temp.v161_assert((public.get_provider_message_templates_v161(current_setting('v161.organization')::uuid)->'templates'->0->>'body')='Новая версия {дата}','owner_read');
do $$ begin
  begin
    perform public.save_provider_message_template_v161(current_setting('v161.organization')::uuid,'reminder','Устаревшая версия',1,'10000000-0000-4000-8000-000000000003'::uuid);
    raise exception 'v161_stale_version_was_accepted';
  exception when serialization_failure then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('v161.colleague'),true);
set local role authenticated;
select pg_temp.v161_assert(jsonb_array_length(public.get_provider_message_templates_v161(current_setting('v161.organization')::uuid)->'templates')=0,'templates_are_personal');
select pg_temp.v161_assert((public.save_provider_message_template_v161(
  current_setting('v161.organization')::uuid,'cancellation','Личный шаблон коллеги',0,'20000000-0000-4000-8000-000000000001'::uuid)->>'performer_id')=current_setting('v161.colleague'),'colleague_insert');
do $$ begin
  begin
    perform public.save_provider_message_template_v161(current_setting('v161.organization')::uuid,'other','Неверный тип',0,gen_random_uuid());
    raise exception 'v161_invalid_kind_was_accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('v161.outsider'),true);
set local role authenticated;
do $$ begin
  begin
    perform public.get_provider_message_templates_v161(current_setting('v161.organization')::uuid);
    raise exception 'v161_outsider_was_accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select pg_temp.v161_assert(not has_table_privilege('authenticated','public.provider_message_templates_v161','SELECT,INSERT,UPDATE,DELETE'),'authenticated_table_closed');
select pg_temp.v161_assert(not has_table_privilege('anon','public.provider_message_templates_v161','SELECT,INSERT,UPDATE,DELETE'),'anon_table_closed');
select pg_temp.v161_assert(has_function_privilege('authenticated','public.get_provider_message_templates_v161(uuid)','EXECUTE'),'authenticated_get_open');
select pg_temp.v161_assert(has_function_privilege('authenticated','public.save_provider_message_template_v161(uuid,text,text,bigint,uuid)','EXECUTE'),'authenticated_save_open');
select pg_temp.v161_assert(not has_function_privilege('anon','public.get_provider_message_templates_v161(uuid)','EXECUTE'),'anon_get_closed');
rollback;
