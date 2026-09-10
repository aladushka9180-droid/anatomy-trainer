\set ON_ERROR_STOP on
begin;
\ir booking-concurrency-v123-fixture.sql

create function pg_temp.v141_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v141_assert:%',label; end if; end $$;

delete from public.services where performer_id=current_setting('v123.actor')::uuid;
select set_config('v141.block',gen_random_uuid()::text,true);
select set_config('v141.other',gen_random_uuid()::text,true);

set local role authenticated;
select pg_temp.v141_assert(exists(
  select 1 from public.get_provider_block_slots_v141(
    current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,
    current_setting('v123.date')::date,30,null
  ) where booking_time='10:00'
),'slots_without_active_service');

select public.create_provider_block_v141(
  current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,
  current_setting('v123.date')::date,'10:00',30,current_setting('v141.block')::uuid,
  'Перерыв','Без услуги'
);

select pg_temp.v141_assert(exists(
  select 1 from public.get_provider_block_slots_v141(
    current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,
    current_setting('v123.date')::date,45,current_setting('v141.block')::uuid
  ) where booking_time='10:00'
),'edit_slots_ignore_current_and_use_selected_duration');

select public.update_provider_block_v141(
  current_setting('v141.block')::uuid,current_setting('v123.date')::date,'11:00',45,
  current_setting('v123.date')::date,'10:00',30,'Личный перерыв','Обновлено'
);

select public.create_provider_block_v141(
  current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,
  current_setting('v123.date')::date,'12:00',30,current_setting('v141.other')::uuid,
  'Перерыв',''
);

do $$ begin
  begin
    perform public.update_provider_block_v141(
      current_setting('v141.block')::uuid,current_setting('v123.date')::date,'12:15',45,
      current_setting('v123.date')::date,'11:00',45,'Личный перерыв','Обновлено'
    );
    raise exception 'overlap_update_accepted';
  exception when exclusion_violation then
    if sqlerrm<>'block_slot_unavailable' then raise; end if;
  end;
  begin
    perform public.update_provider_block_v141(
      current_setting('v141.block')::uuid,current_setting('v123.date')::date,'13:00',30,
      current_setting('v123.date')::date,'10:00',30,'Личный перерыв','Устарело'
    );
    raise exception 'stale_update_accepted';
  exception when serialization_failure then
    if sqlerrm<>'block_changed' then raise; end if;
  end;
end $$;
reset role;

select pg_temp.v141_assert((select count(*)=1 from public.services
  where performer_id=current_setting('v123.actor')::uuid and name='__MINUTA_SCHEDULE_BLOCK__'
    and not active and duration_minutes=60 and price_rub=0),'single_hidden_technical_service');
select pg_temp.v141_assert((select booking_time='11:00' and duration_minutes=45
  and client_name='Личный перерыв' and provider_note='Обновлено'
  from public.bookings where id=current_setting('v141.block')::uuid),'atomic_block_update');
select pg_temp.v141_assert(not exists(select 1 from public.notification_outbox
  where booking_id in (current_setting('v141.block')::uuid,current_setting('v141.other')::uuid)),'no_block_notifications');
select pg_temp.v141_assert(not has_function_privilege('anon','public.create_provider_block_v141(uuid,uuid,date,time without time zone,integer,uuid,text,text)','EXECUTE')
  and has_function_privilege('authenticated','public.create_provider_block_v141(uuid,uuid,date,time without time zone,integer,uuid,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.update_provider_block_v141(uuid,date,time without time zone,integer,date,time without time zone,integer,text,text)','EXECUTE')
  and has_function_privilege('authenticated','public.update_provider_block_v141(uuid,date,time without time zone,integer,date,time without time zone,integer,text,text)','EXECUTE'),
  'v141_acl');

rollback;


