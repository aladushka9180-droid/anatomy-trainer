-- ISOLATED TEST DATABASE ONLY. Apply v173 first; this transaction leaves no rows.
begin;

create function pg_temp.v173_assert(ok boolean,label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'v173_assert:%',label; end if;
end
$$;

select pg_temp.v173_assert(
  to_regclass('public.minuta_abuse_rate_buckets_v173') is not null,
  'rate_bucket_present'
);
select pg_temp.v173_assert(
  (select array_agg(attribute_row.attname order by attribute_row.attnum)=array[
     'scope_kind','scope_sha256','window_seconds','window_started_at','request_count','expires_at'
   ]::name[]
   from pg_catalog.pg_attribute attribute_row
   where attribute_row.attrelid='public.minuta_abuse_rate_buckets_v173'::regclass
     and attribute_row.attnum>0 and not attribute_row.attisdropped),
  'bucket_contains_no_raw_scope_or_pii'
);
select pg_temp.v173_assert(
  not has_function_privilege('anon','public.minuta_consume_abuse_limit_v173(text,text,integer,integer)','execute')
  and not has_function_privilege('authenticated','public.minuta_consume_abuse_limit_v173(text,text,integer,integer)','execute')
  and not has_function_privilege('service_role','public.minuta_consume_abuse_limit_v173(text,text,integer,integer)','execute'),
  'internal_helper_acl'
);
select pg_temp.v173_assert(
  (select position('v_request_role not in(''anon'',''authenticated'') then return new' in procedure_row.prosrc)>0
   from pg_catalog.pg_proc procedure_row
   where procedure_row.oid='public.guard_minuta_public_booking_v173()'::regprocedure)
  and (select position('coalesce(auth.role(),'''') not in(''anon'',''authenticated'') then return new' in procedure_row.prosrc)>0
   from pg_catalog.pg_proc procedure_row
   where procedure_row.oid='public.guard_minuta_waitlist_v173()'::regprocedure)
  and (select position('coalesce(auth.role(),'''') not in(''anon'',''authenticated'') then return new' in procedure_row.prosrc)>0
   from pg_catalog.pg_proc procedure_row
   where procedure_row.oid='public.guard_minuta_message_v173()'::regprocedure),
  'trusted_provider_and_import_paths_bypass_public_budgets'
);

select public.minuta_consume_abuse_limit_v173('booking_phone_hour','v173:allowed',3600,3);
select public.minuta_consume_abuse_limit_v173('booking_phone_hour','v173:allowed',3600,3);
select public.minuta_consume_abuse_limit_v173('booking_phone_hour','v173:allowed',3600,3);
do $$
begin
  begin
    perform public.minuta_consume_abuse_limit_v173('booking_phone_hour','v173:allowed',3600,3);
    raise exception 'v173_expected_limit_missing';
  exception when others then
    if sqlerrm<>'request_rate_limited' then raise; end if;
  end;
end
$$;
select pg_temp.v173_assert(
  (select request_count=3 from public.minuta_abuse_rate_buckets_v173
   where scope_kind='booking_phone_hour'
     and scope_sha256=encode(extensions.digest(convert_to('v173:allowed','UTF8'),'sha256'),'hex')),
  'denied_attempt_does_not_corrupt_bucket'
);

select public.minuta_consume_abuse_limit_v173('waitlist_phone_hour','v173:recovery',3600,1);
update public.minuta_abuse_rate_buckets_v173
set window_started_at=window_started_at-interval '1 hour',expires_at=expires_at-interval '1 hour'
where scope_kind='waitlist_phone_hour'
  and scope_sha256=encode(extensions.digest(convert_to('v173:recovery','UTF8'),'sha256'),'hex');
select public.minuta_consume_abuse_limit_v173('waitlist_phone_hour','v173:recovery',3600,1);
select pg_temp.v173_assert(
  (select count(*)=2 from public.minuta_abuse_rate_buckets_v173
   where scope_kind='waitlist_phone_hour'
     and scope_sha256=encode(extensions.digest(convert_to('v173:recovery','UTF8'),'sha256'),'hex')),
  'new_window_recovers'
);

do $$
begin
  begin
    set local role anon;
    perform public.minuta_consume_abuse_limit_v173('booking_phone_hour','v173:denied',3600,1);
    reset role;
    raise exception 'v173_expected_acl_denial_missing';
  exception when insufficient_privilege then
    reset role;
  end;
end
$$;

select pg_temp.v173_assert(
  (select count(*)=3 from pg_catalog.pg_trigger trigger_row
   where trigger_row.tgname in('bookings_abuse_guard_v173','waitlist_abuse_guard_v173','messages_abuse_guard_v173')
     and not trigger_row.tgisinternal and trigger_row.tgenabled='O'),
  'three_guards_enabled'
);

rollback;
