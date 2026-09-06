\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=pg_catalog,public,extensions;

revoke execute on function public.get_minuta_client_results_v120(uuid,text,integer),
  public.get_minuta_client_result_v120(uuid,uuid),
  public.save_minuta_client_result_v120(uuid,text,uuid,uuid,text,text,text,text,boolean,boolean,uuid),
  public.create_minuta_client_result_media_v120(uuid,text,uuid,uuid,text,text,integer),
  public.complete_minuta_client_result_media_v120(uuid),public.archive_minuta_client_result_media_v120(uuid)
  from authenticated;

drop function if exists public.get_minuta_client_results_v120(uuid,text,integer);
drop function if exists public.get_minuta_client_result_v120(uuid,uuid);
drop function if exists public.save_minuta_client_result_v120(uuid,text,uuid,uuid,text,text,text,text,boolean,boolean,uuid);
drop function if exists public.create_minuta_client_result_media_v120(uuid,text,uuid,uuid,text,text,integer);
drop function if exists public.complete_minuta_client_result_media_v120(uuid);
drop function if exists public.archive_minuta_client_result_media_v120(uuid);
drop function if exists public.client_result_consent_active_v120(uuid,text);
drop function if exists public.can_access_minuta_client_result_v120(uuid);

-- Retained result media stays hidden from the generic v112 list.
create or replace function public.get_minuta_client_records(p_organization uuid,p_phone text,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_phone text:=public.normalize_client_phone(p_phone); v_role text; v_enabled boolean; v_rows jsonb;
begin
  v_role:=public.get_minuta_client_field_role(p_organization);
  if not public.can_access_minuta_client_record(p_organization,v_phone) then
    raise exception using errcode='42501',message='client_records_access_denied';
  end if;
  select coalesce((select enabled from public.client_record_settings where organization_id=p_organization),false) into v_enabled;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]'::jsonb) into v_rows from(
    select entry.id,entry.booking_id,entry.visit_label,entry.kind,entry.body,entry.file_name,entry.mime_type,
      entry.byte_size,entry.object_path,entry.created_at,(entry.created_by=auth.uid() or v_role in ('owner','admin')) can_delete
    from public.client_record_entries entry
    where entry.organization_id=p_organization and entry.client_phone=v_phone and entry.ready and not entry.archived and v_enabled
      and not exists(select 1 from public.client_result_assets asset where asset.record_entry_id=entry.id)
      and public.can_access_minuta_client_record(entry.organization_id,entry.client_phone,entry.booking_id)
      and (not entry.booking_was_linked or v_role in ('owner','admin') or entry.booking_performer_id=auth.uid())
    order by entry.created_at desc,entry.id desc limit 31 offset greatest(0,least(coalesce(p_offset,0),100000))
  ) e;
  return jsonb_build_object('enabled',v_enabled,'can_enable',v_role in ('owner','admin'),'entries',v_rows);
end $$;

-- Fail closed for retained result objects while v120 application RPCs are disabled.
create or replace function public.can_use_minuta_client_object(p_name text,p_action text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_upload public.client_record_entries%rowtype;
begin
  if exists(select 1 from public.client_result_assets asset join public.client_record_entries entry
    on entry.id=asset.record_entry_id where entry.object_path=p_name) then return false; end if;
  if p_action='upload' then
    select * into v_upload from public.client_record_entries where object_path=p_name for share;
    if not found or v_upload.ready or v_upload.expired_at is not null or v_upload.created_at<now()-interval '7 days' then return false; end if;
  end if;
  return exists(select 1 from public.client_record_entries entry
    join public.client_record_settings setting on setting.organization_id=entry.organization_id
    where entry.object_path=p_name and entry.kind='file'
      and public.can_access_minuta_client_record(entry.organization_id,entry.client_phone,entry.booking_id)
      and (not entry.booking_was_linked or entry.booking_performer_id=auth.uid()
        or public.get_minuta_client_field_role(entry.organization_id) in ('owner','admin'))
      and case p_action when 'read' then setting.enabled and entry.ready and not entry.archived
        when 'upload' then setting.enabled and not entry.ready and not entry.archived and entry.created_by=auth.uid()
          and entry.expired_at is null and entry.created_at>=now()-interval '7 days' else false end);
end $$;

revoke all on public.client_result_series,public.client_result_assets,public.client_result_consents
  from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
