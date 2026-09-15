with state as (
  select
    to_regprocedure('public.minuta_provider_repeat_visit_payload_v164(uuid,uuid)') as payload,
    to_regprocedure('public.get_provider_repeat_visit_v164(uuid)') as preview,
    to_regprocedure('public.provider_repeat_appointment_v164(uuid,uuid,text,date,time without time zone,text,text,integer,text)') as create_repeat,
    to_regprocedure('public.consume_minuta_inventory_for_booking(uuid)') as consume
), facts as (
  select *,
    case
      when payload is null and preview is null and create_repeat is null
        and coalesce(obj_description(consume,'pg_proc'),'')<>'minuta:v164:repeat-visit:inventory' then 'absent'
      when payload is not null and preview is not null and create_repeat is not null and consume is not null
        and obj_description(payload,'pg_proc')='minuta:v164:repeat-visit:payload'
        and obj_description(preview,'pg_proc')='minuta:v164:repeat-visit:preview'
        and obj_description(create_repeat,'pg_proc')='minuta:v164:repeat-visit:create'
        and obj_description(consume,'pg_proc')='minuta:v164:repeat-visit:inventory' then 'exact'
      else 'partial'
    end as classification
  from state
)
select json_build_object(
  'classification',classification,
  'structuralExact',classification in ('absent','exact'),
  'payloadPresent',payload is not null,
  'previewPresent',preview is not null,
  'createPresent',create_repeat is not null,
  'consumePresent',consume is not null,
  'authenticatedPreviewExecute',case when preview is null then false else has_function_privilege('authenticated',preview,'execute') end,
  'authenticatedCreateExecute',case when create_repeat is null then false else has_function_privilege('authenticated',create_repeat,'execute') end,
  'anonPreviewExecute',case when preview is null then false else has_function_privilege('anon',preview,'execute') end,
  'anonCreateExecute',case when create_repeat is null then false else has_function_privilege('anon',create_repeat,'execute') end
) from facts;
