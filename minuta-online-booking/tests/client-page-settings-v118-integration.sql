-- TEST DATABASE ONLY. Run after v118 inside a disposable database/transaction.
create function pg_temp.client_page_assert(ok boolean,message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;

do $$
declare actor uuid; org uuid;
begin
  select id into actor from auth.users order by created_at,id limit 1;
  perform pg_temp.client_page_assert(actor is not null,'client_page_fixture_user_missing');
  insert into public.organizations(name,public_booking_enabled,status)
    values('Client page v118 test',true,'active') returning id into org;
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
    values(org,actor,'owner',true,true);
  perform set_config('client_page.actor',actor::text,true);
  perform set_config('client_page.org',org::text,true);
  perform set_config('client_page.slug',(select public_slug from public.organizations where id=org),true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('client_page.actor'),true);
set local role authenticated;
select pg_temp.client_page_assert(
  (public.set_minuta_client_page_settings_v118(current_setting('client_page.org')::uuid,'noir-safari','care')->>'theme_key')='noir-safari',
  'owner_update_failed'
);
select pg_temp.client_page_assert(
  (public.get_minuta_client_page_settings_v118(current_setting('client_page.org')::uuid)->>'headline_key')='care',
  'member_read_failed'
);
reset role;

select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
  perform public.get_minuta_client_page_settings_v118(current_setting('client_page.org')::uuid);
  raise exception 'outsider_read_allowed';
exception when insufficient_privilege then
  perform pg_temp.client_page_assert(sqlerrm='organization_read_denied','wrong_outsider_read_error');
end $$;
do $$ begin
  perform public.set_minuta_client_page_settings_v118(current_setting('client_page.org')::uuid,'sage','booking');
  raise exception 'outsider_update_allowed';
exception when insufficient_privilege then
  perform pg_temp.client_page_assert(sqlerrm='organization_owner_required','wrong_outsider_update_error');
end $$;
reset role;

set local role anon;
do $$
declare catalog jsonb; appearance jsonb;
begin
  catalog:=public.get_public_minuta_catalog_v5(current_setting('client_page.slug'));
  appearance:=catalog->'client_page';
  perform pg_temp.client_page_assert(appearance=jsonb_build_object('theme_key','noir-safari','headline_key','care'),'public_catalog_wrong_shape');
  perform pg_temp.client_page_assert(not appearance ? 'updated_at' and not appearance ? 'updated_by','public_catalog_leaked_private_metadata');
  begin perform count(*) from public.organization_client_page_settings; raise exception 'anon_table_read_allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

create function pg_temp.check_client_page_v118_rollback() returns void language plpgsql as $$ begin
  perform pg_temp.client_page_assert(to_regprocedure('public.get_public_minuta_catalog_v5(text)') is null,'rollback_left_public_catalog');
  perform pg_temp.client_page_assert(to_regprocedure('public.set_minuta_client_page_settings_v118(uuid,text,text)') is null,'rollback_left_write_rpc');
  perform pg_temp.client_page_assert((select theme_key='noir-safari' from public.organization_client_page_settings where organization_id=current_setting('client_page.org')::uuid),'rollback_lost_settings');
end $$;

create function pg_temp.check_client_page_v118_reapply() returns void language plpgsql as $$ begin
  perform pg_temp.client_page_assert(to_regprocedure('public.get_public_minuta_catalog_v5(text)') is not null,'reapply_missing_public_catalog');
  perform pg_temp.client_page_assert((public.get_public_minuta_catalog_v5(current_setting('client_page.slug'))->'client_page'->>'theme_key')='noir-safari','reapply_lost_settings');
end $$;
