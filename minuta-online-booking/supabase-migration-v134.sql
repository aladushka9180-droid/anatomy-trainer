\set ON_ERROR_STOP on

begin;
set local search_path = pg_catalog, public, extensions;

do $$ begin
  if to_regclass('public.organization_client_profiles') is null
     or to_regclass('public.organization_imported_clients') is null
     or to_regclass('public.organization_imported_booking_history') is null
     or to_regclass('public.client_field_values') is null
     or to_regclass('public.client_record_entries') is null
     or to_regclass('public.client_result_series') is null
     or to_regclass('public.client_notes') is null
     or to_regclass('public.client_labels') is null
     or to_regclass('public.client_avatars') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('public.is_organization_member(uuid)') is null then
    raise exception using errcode='P0001',message='v134_requires_client_profile_stack';
  end if;
end $$;

-- An avatar remains private inside its owner's folder. Its storage folder can keep
-- the previous phone after a profile correction, so the photo is not copied or lost.
alter table public.client_avatars
  drop constraint if exists client_avatars_storage_path_scope_check;
alter table public.client_avatars
  add constraint client_avatars_storage_path_scope_check
  check (storage_path ~ ('^'||performer_id::text||'/[0-9]{10,15}/avatar[.]webp$'));

create or replace function public.save_minuta_client_identity_v134(
  p_organization uuid,
  p_client_phone text,
  p_client_name text,
  p_new_client_phone text
) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid();
  v_old_phone text:=public.normalize_client_phone(p_client_phone);
  v_new_phone text:=public.normalize_client_phone(p_new_client_phone);
  v_name text:=regexp_replace(btrim(coalesce(p_client_name,'')),'[[:space:]]+',' ','g');
begin
  if v_actor is null or not public.is_organization_member(p_organization) then
    raise exception using errcode='42501',message='organization_write_denied';
  end if;
  if v_old_phone !~ '^7[0-9]{10}$' or v_new_phone !~ '^7[0-9]{10}$' then
    raise exception using errcode='22023',message='invalid_client_phone';
  end if;
  if char_length(v_name) not between 2 and 80 or v_name ~ '[[:cntrl:]]' then
    raise exception using errcode='22023',message='invalid_client_name';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||least(v_old_phone,v_new_phone),134));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||greatest(v_old_phone,v_new_phone),134));

  if not exists(
    select 1 from public.bookings booking
    where booking.organization_id=p_organization
      and public.normalize_client_phone(booking.client_phone)=v_old_phone
  ) and not exists(
    select 1 from public.organization_imported_clients imported
    where imported.organization_id=p_organization and imported.normalized_phone=v_old_phone
  ) then
    raise exception using errcode='P0002',message='client_not_found';
  end if;

  if v_new_phone<>v_old_phone and (
    exists(select 1 from public.bookings booking where booking.organization_id=p_organization and public.normalize_client_phone(booking.client_phone)=v_new_phone)
    or exists(select 1 from public.organization_imported_clients imported where imported.organization_id=p_organization and imported.normalized_phone=v_new_phone)
    or exists(select 1 from public.organization_imported_booking_history history where history.organization_id=p_organization and history.normalized_phone=v_new_phone)
    or exists(select 1 from public.organization_client_profiles profile where profile.organization_id=p_organization and profile.normalized_phone=v_new_phone)
    or exists(select 1 from public.client_field_values value where value.organization_id=p_organization and value.client_phone=v_new_phone)
    or exists(select 1 from public.client_record_entries entry where entry.organization_id=p_organization and entry.client_phone=v_new_phone)
    or exists(select 1 from public.client_result_series result where result.organization_id=p_organization and result.client_phone=v_new_phone)
  ) then
    raise exception using errcode='23505',message='client_phone_conflict';
  end if;

  if v_new_phone<>v_old_phone and (
    exists(select 1 from public.client_notes note where note.performer_id=v_actor and note.client_phone=v_new_phone)
    or exists(select 1 from public.client_labels label_row where label_row.performer_id=v_actor and label_row.client_phone=v_new_phone)
    or exists(select 1 from public.client_avatars avatar where avatar.performer_id=v_actor and avatar.client_phone=v_new_phone)
  ) then
    raise exception using errcode='23505',message='client_metadata_conflict';
  end if;

  update public.bookings booking set
    client_name=v_name,
    client_phone=case when v_new_phone<>v_old_phone then v_new_phone else booking.client_phone end
  where booking.organization_id=p_organization
    and public.normalize_client_phone(booking.client_phone)=v_old_phone;

  update public.organization_imported_clients imported set
    client_name=v_name,
    normalized_phone=v_new_phone,
    display_phone=v_new_phone,
    updated_at=clock_timestamp()
  where imported.organization_id=p_organization and imported.normalized_phone=v_old_phone;

  update public.organization_imported_booking_history history set
    client_name=v_name,
    normalized_phone=v_new_phone,
    display_phone=v_new_phone
  where history.organization_id=p_organization and history.normalized_phone=v_old_phone;

  if v_new_phone<>v_old_phone then
    update public.organization_client_profiles profile set
      normalized_phone=v_new_phone,updated_at=clock_timestamp(),updated_by=v_actor
    where profile.organization_id=p_organization and profile.normalized_phone=v_old_phone;
    update public.client_field_values value set
      client_phone=v_new_phone,updated_at=clock_timestamp(),updated_by=v_actor
    where value.organization_id=p_organization and value.client_phone=v_old_phone;
    update public.client_record_entries entry set client_phone=v_new_phone
    where entry.organization_id=p_organization and entry.client_phone=v_old_phone;
    update public.client_result_series result set client_phone=v_new_phone
    where result.organization_id=p_organization and result.client_phone=v_old_phone;
    update public.client_notes note set client_phone=v_new_phone
    where note.performer_id=v_actor and note.client_phone=v_old_phone;
    update public.client_labels label_row set client_phone=v_new_phone,updated_at=clock_timestamp()
    where label_row.performer_id=v_actor and label_row.client_phone=v_old_phone;
    update public.client_avatars avatar set client_phone=v_new_phone,updated_at=clock_timestamp()
    where avatar.performer_id=v_actor and avatar.client_phone=v_old_phone;
  end if;

  return jsonb_build_object(
    'client_phone',v_new_phone,
    'client_name',v_name,
    'phone_changed',v_new_phone<>v_old_phone
  );
end $$;

revoke all on function public.save_minuta_client_identity_v134(uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.save_minuta_client_identity_v134(uuid,text,text,text)
  to authenticated;

notify pgrst,'reload schema';
commit;
