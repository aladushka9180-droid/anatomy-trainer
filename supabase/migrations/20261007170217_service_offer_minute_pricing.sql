-- Fixed price for a per-minute ADDON only. No catalog rate or primary pricing changes.
-- Apply after the two offer migrations, exclusively through the release owner.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';

do $provenance$
declare v_function regprocedure; v_source text; v_definition record;
begin
  if to_regclass('public.service_booking_offers') is null
    or to_regprocedure('extensions.digest(bytea,text)') is null
  then raise exception 'service_offer_minute_prerequisites_missing' using errcode='55000'; end if;
  for v_definition in select * from (values
    ('public.save_minuta_service_offer(uuid,jsonb)','1024eb750af02e1ea554a5cfd8f368406f04442889b6aa886beb515695eeaec4','69b7f431f9581f833c21ee9783f0065211889aa107da7b48911a55d085755cee','v',false),
    ('public.get_public_minuta_service_offers(text,uuid,uuid)','00232a9dd1c5cce5ccafb797d5a822ec6ad9e7bda33ec8e6f33b0925d3ca1a11','1c627787df5cf9f2fec35fd04fd8336978b0fe84126145fccafc5702ef5a145e','s',true)
  ) expected(signature,old_sha,new_sha,volatility,allow_anon)
  loop
    v_function:=to_regprocedure(v_definition.signature);
    if v_function is null then raise exception 'service_offer_minute_prerequisites_missing' using errcode='55000'; end if;
    select encode(extensions.digest(convert_to(replace(p.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')
      into v_source from pg_proc p where p.oid=v_function;
    if v_source not in(v_definition.old_sha,v_definition.new_sha) then
      raise exception 'service_offer_minute_source_drift' using errcode='55000';
    end if;
    if not exists(select 1 from pg_proc p where p.oid=v_function and p.prosecdef
      and p.provolatile::text=v_definition.volatility and p.proconfig=array['search_path=""']::text[]
      and p.prorettype='jsonb'::regtype and pg_get_userbyid(p.proowner)='postgres'
      and p.prolang=(select oid from pg_language where lanname='plpgsql'))
      or not has_function_privilege('authenticated',v_function,'EXECUTE')
      or has_function_privilege('anon',v_function,'EXECUTE') is distinct from v_definition.allow_anon
      or has_function_privilege('service_role',v_function,'EXECUTE')
      or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=v_function and a.grantee=0 and a.privilege_type='EXECUTE')
    then raise exception 'service_offer_minute_privilege_drift' using errcode='55000'; end if;
  end loop;
end
$provenance$;

alter table public.service_booking_offers add column if not exists addon_price_rub integer;
do $column$
begin
  if not exists(select 1 from pg_attribute where attrelid='public.service_booking_offers'::regclass
    and attname='addon_price_rub' and atttypid='integer'::regtype and not attnotnull and not atthasdef and not attisdropped)
  then raise exception 'service_offer_minute_column_drift' using errcode='55000'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.service_booking_offers'::regclass
    and conname='service_offer_addon_price_bound') then
    alter table public.service_booking_offers add constraint service_offer_addon_price_bound
      check(addon_price_rub between 0 and 1000000);
  end if;
end
$column$;
create or replace function public.save_minuta_service_offer(p_performer uuid,p_offer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_id uuid; v_old public.service_booking_offers%rowtype; v_row public.service_booking_offers%rowtype;
  v_primary uuid[]; v_addon public.services%rowtype; v_kind text; v_discount numeric;
  v_enabled boolean; v_minutes integer; v_revision integer; v_priority integer;
  v_price numeric; v_base_price integer;
begin
  if auth.uid() is null or auth.uid() is distinct from p_performer then
    raise exception 'service_offer_access_denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_offer) is distinct from 'object' then raise exception 'service_offer_invalid'; end if;
  v_id:=nullif(p_offer->>'id','')::uuid;
  v_revision:=(p_offer->>'revision')::integer;
  v_enabled:=(p_offer->>'enabled')::boolean;
  if v_enabled is null or v_revision is null then raise exception 'service_offer_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('service-offers:'||p_performer::text,0));
  if v_id is not null then
    select * into v_old from public.service_booking_offers where id=v_id and performer_id=p_performer for update;
    if not found then raise exception 'service_offer_access_denied' using errcode='42501'; end if;
    if v_old.revision<>v_revision then raise exception 'service_offer_revision_conflict'; end if;
    -- Turning off an archived offer remains possible without restoring services.
    if not v_enabled then
      update public.service_booking_offers set enabled=false,revision=revision+1,updated_at=now()
      where id=v_id returning * into v_row;
      return jsonb_build_object('offer',to_jsonb(v_row));
    end if;
  elsif v_revision<>0 then raise exception 'service_offer_revision_conflict'; end if;
  if jsonb_typeof(p_offer->'primary_service_ids') is distinct from 'array' then raise exception 'service_offer_invalid'; end if;
  select array_agg(distinct x::uuid order by x::uuid) into v_primary from jsonb_array_elements_text(p_offer->'primary_service_ids') x;
  v_kind:=p_offer->>'discount_kind'; v_discount:=(p_offer->>'discount_value')::numeric;
  v_minutes:=(p_offer->>'additional_minutes')::integer; v_priority:=(p_offer->>'priority')::integer;
  select * into v_addon from public.services where id=(p_offer->>'addon_service_id')::uuid
    and performer_id=p_performer and active for share;
  if not found or v_addon.duration_minutes is null or v_addon.duration_minutes<1 then raise exception 'service_offer_service_unavailable'; end if;
  if v_addon.duration_minutes=1 then
    if jsonb_typeof(p_offer->'addon_price_rub') is distinct from 'number' then
      raise exception 'service_offer_fixed_price_required' using errcode='22023';
    end if;
    v_price:=(p_offer->>'addon_price_rub')::numeric;
    if v_price<0 or v_price>1000000 or v_price<>trunc(v_price) then
      raise exception 'service_offer_fixed_price_invalid' using errcode='22023';
    end if;
    v_base_price:=v_price::integer;
  else
    if coalesce(p_offer->'addon_price_rub','null'::jsonb)<>'null'::jsonb then
      raise exception 'service_offer_fixed_price_not_applicable' using errcode='22023';
    end if;
    v_price:=null;
    v_base_price:=v_addon.price_rub;
  end if;
  if cardinality(v_primary) is null or cardinality(v_primary) not between 1 and 50
     or v_addon.id=any(v_primary) or v_base_price is null or v_base_price<0 or v_minutes is null or v_minutes not between 0 and 480
     or v_priority is null or v_priority not between 0 and 99
     or v_kind is null or v_kind not in('none','percent','rubles')
     or v_discount is null or v_discount<0
     or (v_kind='none' and v_discount<>0) or (v_kind='percent' and v_discount>100)
     or (v_kind='rubles' and (v_discount>v_base_price or v_discount<>trunc(v_discount)))
     or char_length(btrim(coalesce(p_offer->>'benefit_text',''))) not between 1 and 160
     or exists(select 1 from unnest(v_primary) p where not exists(select 1 from public.services s
       where s.id=p and s.performer_id=p_performer and s.active and s.duration_minutes>1))
  then raise exception 'service_offer_invalid' using errcode='22023'; end if;
  if v_enabled and exists(select 1 from unnest(v_primary) p where
    (select count(*) from public.service_booking_offers o where o.performer_id=p_performer and o.enabled
      and p=any(o.primary_service_ids) and o.id is distinct from v_id)>=3
    or exists(select 1 from public.service_booking_offers o where o.performer_id=p_performer and o.enabled
      and p=any(o.primary_service_ids) and o.addon_service_id=v_addon.id and o.id is distinct from v_id))
  then raise exception 'service_offer_limit'; end if;
  insert into public.service_booking_offers(id,performer_id,primary_service_ids,addon_service_id,addon_price_rub,benefit_text,
    discount_kind,discount_value,additional_minutes,enabled,priority,revision)
  values(coalesce(v_id,gen_random_uuid()),p_performer,v_primary,v_addon.id,v_price::integer,btrim(coalesce(p_offer->>'benefit_text','')),
    v_kind,v_discount,v_minutes,v_enabled,v_priority,coalesce(v_old.revision,0)+1)
  on conflict(id) do update set primary_service_ids=excluded.primary_service_ids,addon_service_id=excluded.addon_service_id,
    addon_price_rub=excluded.addon_price_rub,
    benefit_text=excluded.benefit_text,discount_kind=excluded.discount_kind,discount_value=excluded.discount_value,
    additional_minutes=excluded.additional_minutes,enabled=excluded.enabled,priority=excluded.priority,
    revision=excluded.revision,updated_at=now() returning * into v_row;
  return jsonb_build_object('offer',to_jsonb(v_row));
end $$;

create or replace function public.get_public_minuta_service_offers(p_slug text,p_location uuid,p_service uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_service public.services%rowtype; v_catalog jsonb;
begin
  v_service:=minuta_offer_private.context(p_slug,p_location,p_service);
  if v_service.duration_minutes is null or v_service.duration_minutes<=1 then return jsonb_build_object('offers','[]'::jsonb); end if;
  v_catalog:=public.get_public_minuta_catalog_v5(p_slug);
  return jsonb_build_object('offers',coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'revision',o.revision,'service_id',s.id,'name',s.name,'benefit_text',o.benefit_text,
    'original_price_rub',quoted.base_price,'price_rub',case o.discount_kind
      when 'percent' then round(quoted.base_price*(100-o.discount_value)/100)::integer
      when 'rubles' then greatest(0,quoted.base_price-o.discount_value)::integer else quoted.base_price end,
    'additional_minutes',o.additional_minutes) order by o.priority,o.id)
    from public.service_booking_offers o join public.services s on s.id=o.addon_service_id
    cross join lateral (select case when s.duration_minutes=1 then o.addon_price_rub else s.price_rub end base_price) quoted
    where o.performer_id=v_service.performer_id and p_service=any(o.primary_service_ids) and o.enabled
      and s.performer_id=v_service.performer_id and s.active
      and ((s.duration_minutes=1 and o.addon_price_rub is not null)
        or (s.duration_minutes>1 and o.addon_price_rub is null))
      and quoted.base_price is not null and quoted.base_price>=0
      and o.addon_service_id<>p_service
      and (o.discount_kind<>'rubles' or o.discount_value<=quoted.base_price)
      and exists(select 1 from jsonb_array_elements(v_catalog->'services') c
        where c->>'id'=s.id::text and c->'location_ids' ? p_location::text)), '[]'::jsonb));
end $$;

commit;
