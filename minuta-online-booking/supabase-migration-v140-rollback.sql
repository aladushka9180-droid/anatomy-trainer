\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';

do $guard$
declare v_nonempty boolean:=false; v_table text;
begin
  foreach v_table in array array[
    'public.yandex_booking_connections_v140',
    'public.yandex_booking_mappings_v140',
    'public.yandex_booking_receipts_v140'
  ] loop
    if to_regclass(v_table) is not null then
      execute format('select exists(select 1 from %s limit 1)',v_table) into v_nonempty;
      if v_nonempty then
        raise exception using errcode='55000',message='v140_rollback_blocked_live_partner_state';
      end if;
    end if;
  end loop;
end
$guard$;

drop function if exists public.cancel_yandex_booking_v140(text,text,text,text,text);
drop function if exists public.update_yandex_booking_v140(text,text,text,text,text,timestamptz,text);
drop function if exists public.get_yandex_booking_v140(text,text);
drop function if exists public.create_yandex_booking_v140(text,text,text,text,text[],text,timestamptz,text,text,text,text,text,boolean);
drop function if exists public.get_yandex_booking_special_conditions_v140(text,text,text[],text,timestamptz);
drop function if exists public.get_yandex_booking_available_time_slots_v140(text,text,text[],text,date);
drop function if exists public.get_yandex_booking_available_dates_v140(text,text,text[],text,date,date);
drop function if exists public.get_yandex_booking_resources_v140(text,text,text[]);
drop function if exists public.get_yandex_booking_services_v140(text,text,text);
drop function if exists public.get_yandex_booking_feed_v140(text,text,integer);
drop function if exists public.consume_yandex_booking_rate_limit_v140(text,text,text,text);
drop function if exists public.minuta_yandex_booking_snapshot_v140(text,text);
drop function if exists public.minuta_yandex_iso_datetime_v140(timestamp without time zone,text);
drop function if exists public.minuta_yandex_services_v140(text,uuid);
drop function if exists public.minuta_yandex_all_services_v140(text,uuid);
drop function if exists public.minuta_yandex_connection_v140(text,text);
drop function if exists public.minuta_yandex_service_payment_free_v140(uuid,uuid,uuid,uuid);

drop table if exists public.yandex_booking_receipts_v140;
drop table if exists public.yandex_booking_mappings_v140;
drop table if exists public.yandex_booking_connections_v140;
drop table if exists public.yandex_booking_rate_limits_v140;

notify pgrst,'reload schema';
commit;
