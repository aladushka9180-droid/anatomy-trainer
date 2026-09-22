-- v173: server-side abuse budgets for public bookings, waitlist and messages.
-- This is a candidate migration. Do not apply to production without the normal
-- backup, isolated rehearsal and rollback gates.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $dependency_guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.organization_waitlist_requests') is null
     or to_regclass('public.conversation_messages_v162') is null
     or to_regclass('public.message_participants_v162') is null
     or to_regclass('public.message_conversations_v162') is null
     or to_regclass('public.organization_memberships') is null
     or to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is null
     or to_regprocedure('public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text)') is null
     or to_regprocedure('public.minuta_send_message_core_v162(uuid,uuid,text,text,uuid,text)') is null
     or to_regprocedure('auth.role()') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v173_abuse_guard_prerequisites_missing';
  end if;
end
$dependency_guard$;

do $overwrite_guard$
begin
  if to_regclass('public.minuta_abuse_rate_buckets_v173') is not null
     and obj_description(to_regclass('public.minuta_abuse_rate_buckets_v173'),'pg_class')
       is distinct from 'minuta_abuse_guard_v173' then
    raise exception using errcode='55000',message='v173_abuse_guard_newer_state';
  end if;
end
$overwrite_guard$;

create table if not exists public.minuta_abuse_rate_buckets_v173(
  scope_kind text not null check(scope_kind in(
    'booking_organization_hour','booking_phone_hour',
    'waitlist_organization_hour','waitlist_phone_hour',
    'message_conversation_minute','message_participant_minute','message_participant_hour'
  )),
  scope_sha256 text not null check(scope_sha256~'^[0-9a-f]{64}$'),
  window_seconds integer not null check(window_seconds in(60,3600)),
  window_started_at timestamptz not null,
  request_count integer not null check(request_count>0),
  expires_at timestamptz not null,
  primary key(scope_kind,scope_sha256,window_seconds,window_started_at),
  check(expires_at>window_started_at)
);
create index if not exists minuta_abuse_rate_buckets_v173_expiry_idx
  on public.minuta_abuse_rate_buckets_v173(expires_at);
comment on table public.minuta_abuse_rate_buckets_v173 is 'minuta_abuse_guard_v173';
alter table public.minuta_abuse_rate_buckets_v173 enable row level security;
alter table public.minuta_abuse_rate_buckets_v173 force row level security;
revoke all on table public.minuta_abuse_rate_buckets_v173 from public,anon,authenticated,service_role;

create or replace function public.minuta_consume_abuse_limit_v173(
  p_scope_kind text,p_scope_value text,p_window_seconds integer,p_limit integer
) returns void language plpgsql volatile security definer set search_path to '' as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_window timestamptz;
  v_scope_sha256 text;
  v_count integer;
begin
  if coalesce(p_scope_kind,'') not in(
       'booking_organization_hour','booking_phone_hour',
       'waitlist_organization_hour','waitlist_phone_hour',
       'message_conversation_minute','message_participant_minute','message_participant_hour'
     )
     or char_length(coalesce(p_scope_value,'')) not between 1 and 500
     or p_window_seconds not in(60,3600)
     or p_limit not between 1 and 10000 then
    raise exception using errcode='22023',message='invalid_abuse_limit_scope';
  end if;

  v_window:=to_timestamp(
    floor(extract(epoch from v_now)/p_window_seconds)*p_window_seconds
  );
  v_scope_sha256:=encode(
    extensions.digest(convert_to(p_scope_value,'UTF8'),'sha256'),'hex'
  );

  insert into public.minuta_abuse_rate_buckets_v173(
    scope_kind,scope_sha256,window_seconds,window_started_at,request_count,expires_at
  ) values(
    p_scope_kind,v_scope_sha256,p_window_seconds,v_window,1,
    v_window+make_interval(secs=>p_window_seconds*2)
  )
  on conflict(scope_kind,scope_sha256,window_seconds,window_started_at)
  do update set
    request_count=public.minuta_abuse_rate_buckets_v173.request_count+1,
    expires_at=excluded.expires_at
  returning request_count into v_count;

  if mod(pg_catalog.hashtextextended(v_scope_sha256,172),16)=0 then
    delete from public.minuta_abuse_rate_buckets_v173 bucket
    where bucket.ctid in(
      select expired.ctid
      from public.minuta_abuse_rate_buckets_v173 expired
      where expired.expires_at<v_now
      order by expired.expires_at
      limit 64
    );
  end if;

  if v_count>p_limit then
    raise exception using errcode='P0001',message='request_rate_limited';
  end if;
end
$$;

create or replace function public.guard_minuta_public_booking_v173()
returns trigger language plpgsql volatile security definer set search_path to '' as $$
declare
  v_phone text;
  v_name text;
  v_actor uuid;
  v_request_role text:=coalesce(auth.role(),'');
  v_provider_member boolean:=false;
begin
  if v_request_role not in('anon','authenticated') then return new; end if;
  -- Preserve the legacy provider contract (some imported records use a local
  -- ten-digit number) while bounding work before regex/digest/storage paths.
  if octet_length(coalesce(new.client_phone,''))>40
     or octet_length(coalesce(new.client_name,''))>480 then
    raise exception using errcode='P0001',message='invalid_booking_data';
  end if;
  v_phone:=regexp_replace(coalesce(new.client_phone,''),'[^0-9]','','g');
  v_name:=btrim(coalesce(new.client_name,''));
  if char_length(v_name) not between 2 and 120
     or char_length(v_phone) not between 10 and 15 then
    raise exception using errcode='P0001',message='invalid_booking_data';
  end if;
  v_actor:=auth.uid();
  if v_actor is not null then
    select exists(
      select 1 from public.organization_memberships membership
      where membership.organization_id=new.organization_id
        and membership.user_id=v_actor and membership.active
    ) into v_provider_member;
  end if;
  if not v_provider_member then
    perform public.minuta_consume_abuse_limit_v173(
      'booking_organization_hour',new.organization_id::text,3600,120
    );
    perform public.minuta_consume_abuse_limit_v173(
      'booking_phone_hour',new.organization_id::text||':'||v_phone,3600,5
    );
  end if;
  return new;
end
$$;

create or replace function public.guard_minuta_waitlist_v173()
returns trigger language plpgsql volatile security definer set search_path to '' as $$
declare
  v_phone text;
begin
  if coalesce(auth.role(),'') not in('anon','authenticated') then return new; end if;
  if octet_length(coalesce(new.client_phone,''))>40
     or octet_length(coalesce(new.client_name,''))>320 then
    raise exception using errcode='P0001',message='invalid_client_data';
  end if;
  v_phone:=regexp_replace(coalesce(new.client_phone,''),'[^0-9]','','g');
  if char_length(btrim(coalesce(new.client_name,''))) not between 2 and 80
     or v_phone!~'^[0-9]{11}$' then
    raise exception using errcode='P0001',message='invalid_client_data';
  end if;
  perform public.minuta_consume_abuse_limit_v173(
    'waitlist_organization_hour',new.organization_id::text,3600,300
  );
  perform public.minuta_consume_abuse_limit_v173(
    'waitlist_phone_hour',new.organization_id::text||':'||v_phone,3600,5
  );
  return new;
end
$$;

create or replace function public.guard_minuta_message_v173()
returns trigger language plpgsql volatile security definer set search_path to '' as $$
declare
  v_conversation uuid;
begin
  if coalesce(auth.role(),'') not in('anon','authenticated') then return new; end if;
  select participant.conversation_id into v_conversation
  from public.message_participants_v162 participant
  where participant.id=new.sender_participant_id
    and participant.conversation_id=new.conversation_id
    and participant.active;
  if v_conversation is null then
    raise exception using errcode='42501',message='message_sender_denied';
  end if;
  perform public.minuta_consume_abuse_limit_v173(
    'message_conversation_minute',v_conversation::text,60,60
  );
  perform public.minuta_consume_abuse_limit_v173(
    'message_participant_minute',new.sender_participant_id::text,60,12
  );
  perform public.minuta_consume_abuse_limit_v173(
    'message_participant_hour',new.sender_participant_id::text,3600,120
  );
  return new;
end
$$;

drop trigger if exists bookings_abuse_guard_v173 on public.bookings;
create trigger bookings_abuse_guard_v173
before insert on public.bookings
for each row execute function public.guard_minuta_public_booking_v173();

drop trigger if exists waitlist_abuse_guard_v173 on public.organization_waitlist_requests;
create trigger waitlist_abuse_guard_v173
before insert on public.organization_waitlist_requests
for each row execute function public.guard_minuta_waitlist_v173();

drop trigger if exists messages_abuse_guard_v173 on public.conversation_messages_v162;
create trigger messages_abuse_guard_v173
before insert on public.conversation_messages_v162
for each row execute function public.guard_minuta_message_v173();

alter function public.minuta_consume_abuse_limit_v173(text,text,integer,integer) owner to postgres;
alter function public.guard_minuta_public_booking_v173() owner to postgres;
alter function public.guard_minuta_waitlist_v173() owner to postgres;
alter function public.guard_minuta_message_v173() owner to postgres;
revoke all on function public.minuta_consume_abuse_limit_v173(text,text,integer,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.guard_minuta_public_booking_v173()
  from public,anon,authenticated,service_role;
revoke all on function public.guard_minuta_waitlist_v173()
  from public,anon,authenticated,service_role;
revoke all on function public.guard_minuta_message_v173()
  from public,anon,authenticated,service_role;
comment on function public.minuta_consume_abuse_limit_v173(text,text,integer,integer)
  is 'minuta_abuse_guard_v173';
comment on function public.guard_minuta_public_booking_v173() is 'minuta_abuse_guard_v173';
comment on function public.guard_minuta_waitlist_v173() is 'minuta_abuse_guard_v173';
comment on function public.guard_minuta_message_v173() is 'minuta_abuse_guard_v173';

notify pgrst,'reload schema';
commit;
