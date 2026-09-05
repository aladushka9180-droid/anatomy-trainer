begin;
drop function if exists public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text);
drop function if exists public.reserve_minuta_public_benefit_v115(uuid,uuid,text);
-- public_benefit_booking_requests_v115 is intentionally retained: its immutable
-- request bindings prevent a later rollout from spending an old request twice.
commit;
