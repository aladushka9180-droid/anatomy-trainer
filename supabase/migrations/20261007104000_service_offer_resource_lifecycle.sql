-- Additive candidate for accepted offer visits. Requires owner restore/release gates.
-- Synthetic fixture/native CI are not full-schema restore proof.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';

do $provenance$
declare
 v_function regprocedure:=to_regprocedure('public.allocate_minuta_booking_resources(uuid)');
 v_original constant text:='fdbce567cd83210edc9d8c000b30e4e2ae4f647a780744500d0886f99af43313';
 v_wrapper constant text:='259760f77e889786210a9cea6d0fa92fa9d7bb61acf982e22a7f4c8665782dab';
 v_source text; v_sha text; v_marker text; v_helper regprocedure;
begin
 if v_function is null or to_regclass('minuta_offer_private.booking_requests') is null
  or to_regprocedure('extensions.digest(bytea,text)') is null
 then raise exception 'service_offer_resource_prerequisites_missing' using errcode='55000';end if;
 select p.prosrc,encode(extensions.digest(convert_to(replace(p.prosrc,E'\r',''),'UTF8'),'sha256'),'hex'),pg_catalog.obj_description(p.oid,'pg_proc')
 into v_source,v_sha,v_marker from pg_proc p where p.oid=v_function;
 if not exists(select 1 from pg_proc p where p.oid=v_function and p.prosecdef and p.provolatile='v'
  and p.proconfig=array['search_path=""']::text[] and p.prorettype='void'::regtype
  and pg_get_userbyid(p.proowner)='postgres' and p.prolang=(select oid from pg_language where lanname='plpgsql'))
  or has_function_privilege('anon',v_function,'EXECUTE') or has_function_privilege('authenticated',v_function,'EXECUTE')
  or has_function_privilege('service_role',v_function,'EXECUTE')
 then raise exception 'service_offer_resource_allocator_privilege_drift' using errcode='55000';end if;
 v_helper:=to_regprocedure('minuta_offer_private.allocate_original_resources(uuid)');
 if v_sha=v_original then
  if v_helper is not null or v_marker is not null then raise exception 'service_offer_resource_original_provenance_drift' using errcode='55000';end if;
  execute format('create function minuta_offer_private.allocate_original_resources(p_booking uuid) returns void language plpgsql security definer set search_path to %L as %L','',v_source);
  execute 'alter function minuta_offer_private.allocate_original_resources(uuid) owner to postgres';
  execute 'revoke all on function minuta_offer_private.allocate_original_resources(uuid) from public,anon,authenticated,service_role';
 elsif v_sha=v_wrapper and v_marker='minuta_offer_allocator_v1:source_sha256='||v_wrapper then
  if v_helper is null or not exists(select 1 from pg_proc p where p.oid=v_helper
    and encode(extensions.digest(convert_to(replace(p.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')=v_original
    and p.prosecdef and p.provolatile='v' and p.proconfig=array['search_path=""']::text[]
    and p.prorettype='void'::regtype and pg_get_userbyid(p.proowner)='postgres'
    and p.prolang=(select oid from pg_language where lanname='plpgsql'))
   or has_function_privilege('anon',v_helper,'EXECUTE') or has_function_privilege('authenticated',v_helper,'EXECUTE')
   or has_function_privilege('service_role',v_helper,'EXECUTE')
  then raise exception 'service_offer_resource_original_helper_drift' using errcode='55000';end if;
 else raise exception 'service_offer_resource_allocator_source_drift' using errcode='55000';end if;
end
$provenance$;

create or replace function minuta_offer_private.allocate_addon_resources(p_booking uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_book public.bookings%rowtype;v_services uuid[];v_req record;v_existing integer;v_resource uuid;
begin
 select * into v_book from public.bookings where id=p_booking;
 if not found or v_book.status='cancelled' or not exists(select 1 from minuta_offer_private.booking_requests where booking_id=p_booking) then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(v_book.organization_id::text||':'||v_book.location_id::text,6900));
 select coalesce(array_agg(distinct service_id) filter(where service_id is not null),'{}'::uuid[])||array[v_book.service_id]
 into v_services from public.booking_session_items where booking_id=p_booking;
 for v_req in select group_id,max(quantity) quantity from public.service_resource_requirements
  where organization_id=v_book.organization_id and service_id=any(v_services) and active group by group_id order by group_id
 loop
  if not coalesce((select active from public.resource_groups where id=v_req.group_id),false) then raise exception 'resource_unavailable';end if;
  select count(*) into v_existing from public.booking_resource_allocations a join public.resources r on r.id=a.resource_id
   where a.booking_id=p_booking and a.booking_status='active' and r.group_id=v_req.group_id;
  while v_existing<v_req.quantity loop
   select r.id into v_resource from public.resources r where r.organization_id=v_book.organization_id and r.location_id=v_book.location_id
    and r.group_id=v_req.group_id and r.active and not exists(select 1 from public.booking_resource_allocations a
     where a.resource_id=r.id and a.booking_status='active' and tsrange(v_book.booking_date+v_book.booking_time,
      v_book.booking_date+v_book.booking_time+make_interval(mins=>v_book.duration_minutes),'[)')&&tsrange(a.starts_at,a.ends_at,'[)'))
    order by r.id limit 1 for update;
   if v_resource is null then raise exception 'resource_unavailable';end if;
   insert into public.booking_resource_allocations(booking_id,resource_id,organization_id,location_id,starts_at,ends_at,booking_status)
   values(p_booking,v_resource,v_book.organization_id,v_book.location_id,v_book.booking_date+v_book.booking_time,
    v_book.booking_date+v_book.booking_time+make_interval(mins=>v_book.duration_minutes),'active');
   v_existing:=v_existing+1;
  end loop;
 end loop;
end $$;

create or replace function public.allocate_minuta_booking_resources(p_booking uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_book public.bookings%rowtype;v_service uuid;
begin
 select * into v_book from public.bookings where id=p_booking for update;
 if not found then return;end if;
 if exists(select 1 from minuta_offer_private.booking_requests where booking_id=p_booking) then
  for v_service in select id from (select service_id id from public.booking_session_items where booking_id=p_booking and service_id is not null
   union select v_book.service_id) ids where id is not null order by id
  loop
   perform pg_advisory_xact_lock(hashtextextended(v_book.organization_id::text||':'||v_service::text,6901));
  end loop;
 end if;
 perform minuta_offer_private.allocate_original_resources(p_booking);
 perform minuta_offer_private.allocate_addon_resources(p_booking);
end $$;
alter function public.allocate_minuta_booking_resources(uuid) owner to postgres;
revoke all on function public.allocate_minuta_booking_resources(uuid) from public,anon,authenticated,service_role;
comment on function public.allocate_minuta_booking_resources(uuid) is 'minuta_offer_allocator_v1:source_sha256=259760f77e889786210a9cea6d0fa92fa9d7bb61acf982e22a7f4c8665782dab';

create or replace function minuta_offer_private.refresh_requirement_visits()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_scope record;v_booking uuid;v_expected integer;v_processed integer;
begin
 for v_scope in select distinct organization_id,service_id from (
  select new.organization_id,new.service_id where tg_op<>'DELETE'
  union all select old.organization_id,old.service_id where tg_op<>'INSERT') scopes
 loop
  select count(*) into v_expected from public.bookings b where b.organization_id=v_scope.organization_id
   and b.status<>'cancelled' and b.booking_date>=current_date
   and exists(select 1 from minuta_offer_private.booking_requests q where q.booking_id=b.id)
   and (b.service_id=v_scope.service_id or exists(select 1 from public.booking_session_items i where i.booking_id=b.id and i.service_id=v_scope.service_id));
  v_processed:=0;
  for v_booking in select b.id from public.bookings b where b.organization_id=v_scope.organization_id
   and b.status<>'cancelled' and b.booking_date>=current_date
   and exists(select 1 from minuta_offer_private.booking_requests q where q.booking_id=b.id)
   and (b.service_id=v_scope.service_id or exists(select 1 from public.booking_session_items i where i.booking_id=b.id and i.service_id=v_scope.service_id))
   order by b.booking_date,b.booking_time,b.id for update of b skip locked
  loop
   v_processed:=v_processed+1;
   perform public.allocate_minuta_booking_resources(v_booking);
  end loop;
  if v_processed<>v_expected then raise exception 'service_offer_requirements_concurrent_booking_update' using errcode='40001';end if;
 end loop;
 return null;
end $$;
drop trigger if exists service_offer_requirements_recheck on public.service_resource_requirements;
create constraint trigger service_offer_requirements_recheck after insert or update or delete on public.service_resource_requirements
deferrable initially deferred for each row execute function minuta_offer_private.refresh_requirement_visits();
alter function minuta_offer_private.allocate_addon_resources(uuid) owner to postgres;
alter function minuta_offer_private.refresh_requirement_visits() owner to postgres;
revoke all on function minuta_offer_private.allocate_addon_resources(uuid),minuta_offer_private.refresh_requirement_visits()
 from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
