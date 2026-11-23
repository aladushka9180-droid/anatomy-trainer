-- Synthetic rows only, inside the runner's transaction; every change rolls back.
create function pg_temp.day_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'day_v192_assert:%',label;end if;end $$;
select set_config('v123.date',(current_date+2)::text,true);
select set_config('v192.request',gen_random_uuid()::text,true);
select set_config('v192.absent',gen_random_uuid()::text,true);
select set_config('v192.block',gen_random_uuid()::text,true);
update public.provider_schedule set enabled=false where performer_id=current_setting('v123.actor')::uuid and weekday=extract(isodow from current_setting('v123.date')::date);
set local role authenticated;
select set_config('v192.before',public.get_minuta_provider_day_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date)::text,true);
select pg_temp.day_assert((current_setting('v192.before')::jsonb->>'working')::boolean=false,'closed_weekday');
select pg_temp.day_assert(not exists(select 1 from public.get_minuta_provider_day_slots_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.service')::uuid,current_setting('v123.date')::date,current_setting('v123.date')::date)),'ordinary_closed');
select pg_temp.day_assert(exists(select 1 from public.get_minuta_day_exception_slots_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date,current_setting('v123.service')::uuid,null) where booking_time='12:00'),'one_off_slots');
select pg_temp.day_assert(public.block_minuta_day_exception_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v192.block')::uuid,current_setting('v123.date')::date,'12:00',30,'Перерыв','')->>'booking_id'=current_setting('v192.block'),'native_block');
select pg_temp.day_assert(public.block_minuta_day_exception_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v192.block')::uuid,current_setting('v123.date')::date,'12:00',30,'Перерыв','')->>'booking_id'=current_setting('v192.block'),'block_replay');
select pg_temp.day_assert(not exists(select 1 from public.get_minuta_day_exception_slots_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date,current_setting('v123.service')::uuid,null) where booking_time='12:00'),'native_overlap_retained');
select pg_temp.day_assert((public.get_minuta_provider_day_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date)->>'working')::boolean=false,'one_off_did_not_open_day');
select pg_temp.day_assert((public.save_minuta_provider_day_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date,current_setting('v192.request')::uuid,'11:00','17:00',true,current_setting('v192.before')::jsonb->>'revision')->>'confirmed')::boolean,'dated_hours');
select pg_temp.day_assert((public.save_minuta_provider_day_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date,current_setting('v192.request')::uuid,'11:00','17:00',true,current_setting('v192.before')::jsonb->>'revision')->>'confirmed')::boolean,'hours_replay');
select pg_temp.day_assert((public.resolve_minuta_provider_day_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date,current_setting('v192.request')::uuid)->>'confirmed')::boolean,'resolve_applied');
select pg_temp.day_assert((public.resolve_minuta_provider_day_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date,current_setting('v192.absent')::uuid)->>'notApplied')::boolean,'resolve_tombstone');
select pg_temp.day_assert((public.save_minuta_provider_day_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date,current_setting('v192.absent')::uuid,'10:00','15:00',false,'obsolete')->>'notApplied')::boolean,'late_request_cannot_apply');
select pg_temp.day_assert(exists(select 1 from public.get_minuta_provider_day_slots_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.service')::uuid,current_setting('v123.date')::date,current_setting('v123.date')::date) where booking_time='14:00'),'dated_slots');
do $$ begin
  begin
    perform public.save_minuta_provider_day_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date,gen_random_uuid(),'10:00','15:00',true,current_setting('v192.before')::jsonb->>'revision');
    raise exception 'stale_revision_accepted';
  exception when serialization_failure then if sqlerrm<>'day_schedule_changed' then raise;end if;end;
  begin
    perform public.get_minuta_provider_day_v192(current_setting('v123.org')::uuid,gen_random_uuid(),current_setting('v123.date')::date);
    raise exception 'wrong_scope_accepted';
  exception when insufficient_privilege then if sqlerrm<>'day_scope_denied' then raise;end if;end;
end $$;
-- Native client creation must work without opening the remaining day.
select set_config('v192.client_request',gen_random_uuid()::text,true);
select set_config('v192.client_result',public.book_minuta_day_exception_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v192.client_request')::uuid,current_setting('v123.service')::uuid,current_setting('v123.date')::date,'18:00','Тестовый клиент','79990000001',1000,60)::text,true);
select pg_temp.day_assert(current_setting('v192.client_result')::jsonb->>'request_id'=current_setting('v192.client_request'),'native_client_ack');
select pg_temp.day_assert(public.book_minuta_day_exception_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v192.client_request')::uuid,current_setting('v123.service')::uuid,current_setting('v123.date')::date,'18:00','Тестовый клиент','79990000001',1000,60)=current_setting('v192.client_result')::jsonb,'native_client_replay');
select pg_temp.day_assert((public.get_minuta_provider_day_v192(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.date')::date)->>'end')='17:00','exception_kept_dated_hours');
reset role;
select pg_temp.day_assert(not (select enabled from public.provider_schedule where performer_id=current_setting('v123.actor')::uuid and weekday=extract(isodow from current_setting('v123.date')::date)),'weekday_unchanged');
select pg_temp.day_assert((select count(*)=1 from public.bookings where id=current_setting('v192.block')::uuid),'one_native_row');
select pg_temp.day_assert(not has_function_privilege('anon','public.save_minuta_provider_day_v192(uuid,uuid,date,uuid,time,time,boolean,text)','EXECUTE'),'anon_denied');
select pg_temp.day_assert(not has_table_privilege('authenticated','public.provider_day_schedule_v192','SELECT'),'direct_table_denied');
