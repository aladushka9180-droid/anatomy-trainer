\set ON_ERROR_STOP on
begin;

select set_config('minuta.v122.portfolio_user',(
  select id::text from public.performer_profiles order by id limit 1
),true);
do $$ begin
  if nullif(current_setting('minuta.v122.portfolio_user',true),'') is null then
    raise exception 'v122_test_requires_one_performer_profile';
  end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('minuta.v122.portfolio_user'),true);
select set_config('minuta.v122.portfolio_item',gen_random_uuid()::text,true);
select set_config('minuta.v122.photo_one',
  current_setting('minuta.v122.portfolio_user')||'/'||current_setting('minuta.v122.portfolio_item')||'/00000000-0000-4000-8000-000000122101.webp',true);
select set_config('minuta.v122.photo_two',
  current_setting('minuta.v122.portfolio_user')||'/'||current_setting('minuta.v122.portfolio_item')||'/00000000-0000-4000-8000-000000122102.webp',true);

set local role authenticated;
select set_config('minuta.v122.portfolio_first',public.save_provider_portfolio_item(
  current_setting('minuta.v122.portfolio_item')::uuid,null,
  jsonb_build_object('procedure_name','V122 test','body_area','test','session_count',1,
    'description','transactional fixture','sort_order',10,'published',false,'consent_confirmed_at',null),
  jsonb_build_array(jsonb_build_object('photo_type','before','storage_path',current_setting('minuta.v122.photo_one'),
    'alt_text','V122 before','width',320,'height',240))
)::text,true);

select set_config('minuta.v122.portfolio_second',public.save_provider_portfolio_item(
  current_setting('minuta.v122.portfolio_item')::uuid,
  (current_setting('minuta.v122.portfolio_first')::jsonb->>'updated_at')::timestamptz,
  jsonb_build_object('procedure_name','V122 test updated','body_area','test','session_count',2,
    'description','transactional fixture','sort_order',10,'published',false,'consent_confirmed_at',null),
  jsonb_build_array(jsonb_build_object('photo_type','before','storage_path',current_setting('minuta.v122.photo_two'),
    'alt_text','V122 before updated','width',640,'height',480))
)::text,true);

do $$ begin
  if current_setting('minuta.v122.portfolio_second')::jsonb->'retired_paths'
      <>jsonb_build_array(current_setting('minuta.v122.photo_one')) then
    raise exception 'v122_portfolio_retired_path_missing';
  end if;
  if (select count(*) from public.portfolio_items where id=current_setting('minuta.v122.portfolio_item')::uuid
      and performer_id=current_setting('minuta.v122.portfolio_user')::uuid and procedure_name='V122 test updated')<>1
    or (select count(*) from public.portfolio_photos where portfolio_item_id=current_setting('minuta.v122.portfolio_item')::uuid
      and storage_path=current_setting('minuta.v122.photo_two'))<>1 then
    raise exception 'v122_portfolio_atomic_switch_failed';
  end if;
  begin
    perform public.save_provider_portfolio_item(current_setting('minuta.v122.portfolio_item')::uuid,
      (current_setting('minuta.v122.portfolio_first')::jsonb->>'updated_at')::timestamptz-interval '1 second',
      jsonb_build_object('procedure_name','stale'),'[]'::jsonb);
    raise exception 'v122_portfolio_stale_write_accepted';
  exception when sqlstate '40001' then
    if sqlerrm<>'portfolio_item_changed' then raise; end if;
  end;
end $$;

reset role;
rollback;
