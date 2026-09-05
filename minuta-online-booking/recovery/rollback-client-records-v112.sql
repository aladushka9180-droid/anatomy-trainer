begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
-- Non-destructive rollback: revoke application access; retain all private files
-- and metadata for recovery. Reapplying v112 restores permissions, not activation.
update public.client_record_settings set enabled=false,updated_at=now();
revoke execute on function public.set_minuta_client_records_enabled(uuid,boolean),public.get_minuta_client_records(uuid,text,integer),
  public.create_minuta_client_record(uuid,text,uuid,uuid,text,text,text,text,integer),
  public.complete_minuta_client_file(uuid),public.archive_minuta_client_record(uuid),
  public.can_use_minuta_client_object(text,text) from authenticated;
drop policy if exists client_record_object_read_v112 on storage.objects;
drop policy if exists client_record_object_upload_v112 on storage.objects;
drop policy if exists client_record_object_delete_v112 on storage.objects;
-- Leave the restrictive bucket guards in place: even unrelated broad Storage
-- policies must not expose retained client files while this feature is disabled.
-- These two guards no longer invoke the helper whose EXECUTE was revoked.
drop policy if exists client_record_object_guard_v112 on storage.objects;
create policy client_record_object_guard_v112 on storage.objects as restrictive for select to authenticated
using(bucket_id<>'minuta-client-records');
drop policy if exists client_record_object_insert_guard_v112 on storage.objects;
create policy client_record_object_insert_guard_v112 on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'minuta-client-records');
commit;
