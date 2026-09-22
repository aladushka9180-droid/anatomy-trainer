\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=pg_catalog,public,extensions;

do $$ begin
  if to_regclass('public.client_result_assets') is null
     or to_regclass('public.client_result_series') is null
     or to_regclass('public.client_record_entries') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('public.get_minuta_client_results_v120(uuid,text,integer)') is null
     or to_regprocedure('public.get_minuta_client_result_v120(uuid,uuid)') is null
     or to_regprocedure('public.can_access_minuta_client_result_v120(uuid)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='P0001',message='v171_requires_client_results_v120_and_booking_outcomes';
  end if;
end $$;

alter table public.client_result_assets
  add column if not exists keep_from_cleanup boolean not null default false,
  add column if not exists retention_visit_date date,
  add column if not exists retention_keep_updated_at timestamptz,
  add column if not exists retention_keep_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists retention_claim_token uuid,
  add column if not exists retention_claimed_at timestamptz,
  add column if not exists retention_delete_started_at timestamptz,
  add column if not exists retention_cleanup_attempted_at timestamptz;

create table if not exists public.client_result_retention_policy(
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  retention_months integer not null default 12 check(retention_months=12),
  updated_at timestamptz not null default now()
);
insert into public.client_result_retention_policy(singleton,enabled,retention_months)
values(true,false,12) on conflict(singleton) do nothing;

create table if not exists public.client_result_retention_audit(
  record_entry_id uuid primary key,
  result_id uuid not null,
  organization_id uuid not null,
  purpose text not null check(purpose in ('before','after')),
  visit_date date not null,
  eligible_after date not null,
  object_path_sha256 text not null check(object_path_sha256 ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz not null default clock_timestamp(),
  reason text not null default 'completed_visit_12_months' check(reason='completed_visit_12_months')
);

do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_result_assets' and column_name='keep_from_cleanup' and data_type='boolean')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_result_assets' and column_name='retention_visit_date' and data_type='date')
     or exists(select 1 from public.client_result_retention_policy where retention_months<>12) then
    raise exception using errcode='P0001',message='v171_incompatible_existing_schema';
  end if;
end $$;

create index if not exists client_result_assets_retention_v171_idx
  on public.client_result_assets(retention_visit_date,record_entry_id)
  where not keep_from_cleanup;

alter table public.client_result_retention_policy enable row level security;
alter table public.client_result_retention_audit enable row level security;
revoke all on public.client_result_retention_policy,public.client_result_retention_audit
  from public,anon,authenticated,service_role;
grant all on public.client_result_retention_policy,public.client_result_retention_audit to service_role;

create or replace function public.set_client_result_retention_visit_v171()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select booking.booking_date into new.retention_visit_date
  from public.client_result_series result
  join public.bookings booking on booking.id=result.booking_id and booking.organization_id=result.organization_id
  where result.id=new.result_id;
  return new;
end $$;
revoke all on function public.set_client_result_retention_visit_v171() from public,anon,authenticated,service_role;

drop trigger if exists client_result_assets_retention_visit_v171 on public.client_result_assets;
create trigger client_result_assets_retention_visit_v171
before insert on public.client_result_assets for each row
execute function public.set_client_result_retention_visit_v171();

update public.client_result_assets asset set retention_visit_date=booking.booking_date
from public.client_result_series result
join public.bookings booking on booking.id=result.booking_id and booking.organization_id=result.organization_id
where result.id=asset.result_id and asset.retention_visit_date is null;

create or replace function public.get_minuta_client_results_v171(p_organization uuid,p_phone text,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_base jsonb; v_media jsonb; v_enabled boolean;
begin
  v_base:=public.get_minuta_client_results_v120(p_organization,p_phone,p_offset);
  select enabled into v_enabled from public.client_result_retention_policy where singleton=true;
  select coalesce(jsonb_agg(item||jsonb_build_object(
    'retention_managed',asset.record_entry_id is not null,
    'retention_active',coalesce(v_enabled,false),
    'keep_from_cleanup',coalesce(asset.keep_from_cleanup,false),
    'retention_due_on',case when asset.retention_visit_date is null then null
      else (asset.retention_visit_date+interval '12 months')::date end
  ) order by item->>'result_id',item->>'purpose'),'[]'::jsonb) into v_media
  from jsonb_array_elements(coalesce(v_base->'media','[]'::jsonb)) item
  left join public.client_result_assets asset on asset.record_entry_id=(item->>'id')::uuid;
  return jsonb_set(v_base,'{media}',v_media,true);
end $$;

create or replace function public.get_minuta_client_result_v171(p_organization uuid,p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_base jsonb; v_media jsonb; v_enabled boolean;
begin
  v_base:=public.get_minuta_client_result_v120(p_organization,p_booking);
  select enabled into v_enabled from public.client_result_retention_policy where singleton=true;
  select coalesce(jsonb_agg(item||jsonb_build_object(
    'retention_managed',asset.record_entry_id is not null,
    'retention_active',coalesce(v_enabled,false),
    'keep_from_cleanup',coalesce(asset.keep_from_cleanup,false),
    'retention_due_on',case when asset.retention_visit_date is null then null
      else (asset.retention_visit_date+interval '12 months')::date end
  ) order by item->>'purpose'),'[]'::jsonb) into v_media
  from jsonb_array_elements(coalesce(v_base->'media','[]'::jsonb)) item
  left join public.client_result_assets asset on asset.record_entry_id=(item->>'id')::uuid;
  return jsonb_set(v_base,'{media}',v_media,true);
end $$;

create or replace function public.set_minuta_client_result_media_keep_v171(p_id uuid,p_keep boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_asset public.client_result_assets%rowtype;
begin
  if auth.uid() is null or p_id is null or p_keep is null then
    raise exception using errcode='22023',message='invalid_client_result_keep';
  end if;
  select * into v_asset from public.client_result_assets asset where asset.record_entry_id=p_id for update;
  if not found or not public.can_access_minuta_client_result_v120(v_asset.result_id) then
    raise exception using errcode='42501',message='client_result_access_denied';
  end if;
  if p_keep and v_asset.retention_delete_started_at is not null then
    raise exception using errcode='P0001',message='client_result_media_delete_in_progress';
  end if;
  update public.client_result_assets set
    keep_from_cleanup=p_keep,
    retention_keep_updated_at=clock_timestamp(),
    retention_keep_updated_by=auth.uid(),
    retention_claim_token=case when p_keep then null else retention_claim_token end,
    retention_claimed_at=case when p_keep then null else retention_claimed_at end,
    retention_cleanup_attempted_at=case when p_keep then null else retention_cleanup_attempted_at end
  where record_entry_id=p_id;
  return jsonb_build_object('id',p_id,'keep_from_cleanup',p_keep,'retention_managed',true);
end $$;

-- Dry run never changes rows and remains available while execution is disabled.
-- Execute first marks a candidate, then waits one hour before exposing its object path.
create or replace function public.claim_minuta_client_result_retention_v171(p_limit integer default 100,p_execute boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row record; v_result jsonb:='[]'::jsonb; v_enabled boolean;
begin
  select enabled into v_enabled from public.client_result_retention_policy where singleton=true;
  if p_execute and v_enabled is not true then
    raise exception using errcode='P0001',message='client_result_retention_disabled';
  end if;
  for v_row in
    select asset.record_entry_id,asset.result_id,asset.purpose,asset.retention_visit_date,
      asset.retention_claim_token,asset.retention_claimed_at,asset.retention_delete_started_at,
      result.organization_id,entry.object_path
    from public.client_result_assets asset
    join public.client_result_series result on result.id=asset.result_id
    join public.client_record_entries entry on entry.id=asset.record_entry_id
    join public.bookings booking on booking.id=result.booking_id and booking.organization_id=result.organization_id
    join public.booking_outcomes outcome on outcome.booking_id=booking.id
    where asset.purpose in ('before','after') and not asset.keep_from_cleanup
      and asset.retention_visit_date=booking.booking_date
      and booking.status<>'cancelled' and outcome.visit_status='completed'
      and entry.kind='file' and entry.ready and not entry.archived
      and entry.object_path is not null
      and (asset.retention_visit_date+interval '12 months')::date<=current_date
    order by asset.retention_cleanup_attempted_at nulls first,asset.retention_visit_date,asset.record_entry_id
    limit least(100,greatest(1,coalesce(p_limit,100)))
    for update of asset skip locked
  loop
    if p_execute is not true then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'id',v_row.record_entry_id,'result_id',v_row.result_id,'organization_id',v_row.organization_id,
        'purpose',v_row.purpose,'eligible_after',(v_row.retention_visit_date+interval '12 months')::date,
        'state',case when v_row.retention_delete_started_at is not null then 'delete_started'
          when v_row.retention_claimed_at is not null then 'grace_period' else 'eligible' end));
    elsif v_row.retention_claimed_at is null then
      update public.client_result_assets set retention_claim_token=gen_random_uuid(),
        retention_claimed_at=clock_timestamp(),retention_cleanup_attempted_at=clock_timestamp()
      where record_entry_id=v_row.record_entry_id;
    elsif v_row.retention_claimed_at<now()-interval '1 hour' then
      update public.client_result_assets set retention_cleanup_attempted_at=clock_timestamp()
      where record_entry_id=v_row.record_entry_id;
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'id',v_row.record_entry_id,'claim_token',v_row.retention_claim_token,
        'state',case when v_row.retention_delete_started_at is null then 'ready' else 'delete_started' end));
    end if;
  end loop;
  return v_result;
end $$;

create or replace function public.authorize_minuta_client_result_retention_delete_v171(p_id uuid,p_claim uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row record; v_enabled boolean;
begin
  select enabled into v_enabled from public.client_result_retention_policy where singleton=true;
  if v_enabled is not true then raise exception using errcode='P0001',message='client_result_retention_disabled'; end if;
  select asset.record_entry_id,asset.result_id,asset.purpose,asset.retention_visit_date,asset.keep_from_cleanup,
    asset.retention_claim_token,asset.retention_claimed_at,result.organization_id,entry.object_path
  into v_row
  from public.client_result_assets asset
  join public.client_result_series result on result.id=asset.result_id
  join public.client_record_entries entry on entry.id=asset.record_entry_id
  join public.bookings booking on booking.id=result.booking_id and booking.organization_id=result.organization_id
  join public.booking_outcomes outcome on outcome.booking_id=booking.id
  where asset.record_entry_id=p_id and asset.retention_claim_token=p_claim
    and asset.purpose in ('before','after') and not asset.keep_from_cleanup
    and asset.retention_visit_date=booking.booking_date
    and booking.status<>'cancelled' and outcome.visit_status='completed'
    and entry.kind='file' and entry.ready and not entry.archived and entry.object_path is not null
    and (asset.retention_visit_date+interval '12 months')::date<=current_date
  for update of asset;
  if not found or v_row.retention_claimed_at is null or v_row.retention_claimed_at>=now()-interval '1 hour' then
    raise exception using errcode='P0001',message='client_result_retention_claim_invalid';
  end if;
  update public.client_result_assets set retention_delete_started_at=coalesce(retention_delete_started_at,clock_timestamp()),
    retention_cleanup_attempted_at=clock_timestamp() where record_entry_id=p_id;
  return jsonb_build_object('id',p_id,'claim_token',p_claim,'bucket','minuta-client-records','object_path',v_row.object_path);
end $$;

create or replace function public.finish_minuta_client_result_retention_v171(p_id uuid,p_claim uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_row record;
begin
  select asset.record_entry_id,asset.result_id,asset.purpose,asset.retention_visit_date,
    asset.retention_claim_token,asset.retention_delete_started_at,result.organization_id,entry.object_path
  into v_row from public.client_result_assets asset
  join public.client_result_series result on result.id=asset.result_id
  join public.client_record_entries entry on entry.id=asset.record_entry_id
  where asset.record_entry_id=p_id for update of asset;
  if not found then return exists(select 1 from public.client_result_retention_audit audit where audit.record_entry_id=p_id); end if;
  if v_row.retention_claim_token is distinct from p_claim or v_row.retention_delete_started_at is null then return false; end if;
  if exists(select 1 from storage.objects where bucket_id='minuta-client-records' and name=v_row.object_path) then return false; end if;
  insert into public.client_result_retention_audit(
    record_entry_id,result_id,organization_id,purpose,visit_date,eligible_after,object_path_sha256
  ) values(
    v_row.record_entry_id,v_row.result_id,v_row.organization_id,v_row.purpose,v_row.retention_visit_date,
    (v_row.retention_visit_date+interval '12 months')::date,
    encode(extensions.digest(convert_to(v_row.object_path,'UTF8'),'sha256'),'hex')
  ) on conflict(record_entry_id) do nothing;
  delete from public.client_record_entries where id=p_id;
  return true;
end $$;

create or replace function public.cancel_minuta_client_result_retention_v171(p_id uuid,p_claim uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.client_result_assets asset
    join public.client_record_entries entry on entry.id=asset.record_entry_id
    join storage.objects object on object.bucket_id='minuta-client-records' and object.name=entry.object_path
    where asset.record_entry_id=p_id and asset.retention_claim_token=p_claim) then return false; end if;
  update public.client_result_assets set retention_claim_token=null,retention_claimed_at=null,
    retention_delete_started_at=null,retention_cleanup_attempted_at=null
  where record_entry_id=p_id and retention_claim_token=p_claim;
  return found;
end $$;

revoke all on function public.get_minuta_client_results_v171(uuid,text,integer),
  public.get_minuta_client_result_v171(uuid,uuid),
  public.set_minuta_client_result_media_keep_v171(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_client_results_v171(uuid,text,integer),
  public.get_minuta_client_result_v171(uuid,uuid),
  public.set_minuta_client_result_media_keep_v171(uuid,boolean) to authenticated;

revoke all on function public.claim_minuta_client_result_retention_v171(integer,boolean),
  public.authorize_minuta_client_result_retention_delete_v171(uuid,uuid),
  public.finish_minuta_client_result_retention_v171(uuid,uuid),
  public.cancel_minuta_client_result_retention_v171(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_minuta_client_result_retention_v171(integer,boolean),
  public.authorize_minuta_client_result_retention_delete_v171(uuid,uuid),
  public.finish_minuta_client_result_retention_v171(uuid,uuid),
  public.cancel_minuta_client_result_retention_v171(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
