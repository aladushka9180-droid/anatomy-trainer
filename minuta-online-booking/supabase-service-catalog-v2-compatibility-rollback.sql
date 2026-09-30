-- Optional full RPC rollback. First roll back catalog/UI; never erase choices to satisfy this guard.
begin;
set local lock_timeout='5s';
lock table public.minuta_performer_professions_v160 in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.minuta_performer_professions_v160 choice
    where not exists(select 1 from public.minuta_professions_v160 known
      where known.catalog_version=1 and known.locale=choice.locale and known.profession_id=choice.profession_id)) then
    raise exception 'service_catalog_compatibility_still_required';
  end if;
end $$;
do $guard$ declare
  target oid := 'public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)'::regprocedure;
  body_hash text;
  definition text;
begin
  select md5(replace(prosrc,E'\r\n',E'\n')) into body_hash from pg_proc where oid=target;
  if body_hash='3c33d158776cd2b09ca0da06e1de96d4' then return; end if;
  if body_hash<>'7d8d007229593a7cc237169679a549db' then
    raise exception 'service_catalog_rpc_definition_changed';
  end if;
  definition := replace(pg_get_functiondef(target),E'\r\n',E'\n');
  definition := replace(definition,$old$where choice.performer_id=v_uid and not (choice.profession_id=any(v_professions))
    and exists(select 1 from public.minuta_professions_v160 known
      where known.catalog_version=p_catalog_version and known.locale=v_locale
        and known.profession_id=choice.profession_id);$old$,$new$where choice.performer_id=v_uid and not (choice.profession_id=any(v_professions));$new$);
  definition := replace(definition,$old$'profession_ids',(select coalesce(jsonb_agg(choice.profession_id order by choice.profession_id),'[]'::jsonb)
      from public.minuta_performer_professions_v160 choice where choice.performer_id=v_uid),'created_count',v_created,$old$,$new$'profession_ids',to_jsonb(v_professions),'created_count',v_created,$new$);
  execute definition;
end $guard$;
commit;
