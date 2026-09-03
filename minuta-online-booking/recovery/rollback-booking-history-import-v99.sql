\set ON_ERROR_STOP on

begin;
do $$
begin
  if to_regclass('public.organization_imported_booking_history') is not null
     and exists(select 1 from public.organization_imported_booking_history) then
    raise exception using errcode='P0001',message='v99_rollback_blocked_history_exists';
  end if;
end $$;

drop function if exists public.get_minuta_imported_booking_history(uuid,integer,integer);
drop function if exists public.import_minuta_booking_history(uuid,jsonb,uuid,text);
create temporary table v99_client_batches_on_rollback(id uuid primary key) on commit drop;
insert into v99_client_batches_on_rollback select client_import_batch_id from public.booking_history_import_batches;
drop table if exists public.organization_imported_booking_history;
drop table if exists public.booking_history_import_batches;
delete from public.client_import_batches client_batch
using v99_client_batches_on_rollback history_batch
where client_batch.id=history_batch.id;
commit;
