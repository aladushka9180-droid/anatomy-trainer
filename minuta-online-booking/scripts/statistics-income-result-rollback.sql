-- Additive inverse: retain every original outcome, transaction and posting.
begin;
drop function if exists public.get_minuta_unposted_visit_payments_v1(uuid,date,date,uuid);
drop function if exists public.post_minuta_unposted_visit_payment_v1(uuid,uuid,uuid,uuid,date,text);
drop function if exists public.save_minuta_visit_payment_v1(uuid,text,integer,integer,date,uuid,uuid);
drop function if exists public.get_minuta_visit_payment_capabilities_v1(uuid);
drop function if exists public._post_minuta_visit_payment_v1(uuid,uuid,uuid,uuid,date,text,text);
commit;
