begin;
set local lock_timeout='10s';

do $rollback_guard$
begin
  if to_regclass('public.benefit_application_requests') is not null
     and exists(select 1 from public.benefit_application_requests) then
    raise exception using errcode='55000',message='v149_rollback_blocked_by_application_history';
  end if;
end
$rollback_guard$;

drop function if exists public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid);
drop trigger if exists benefit_application_requests_immutable_v149 on public.benefit_application_requests;
drop function if exists public.protect_minuta_benefit_application_v149();
drop table if exists public.benefit_application_requests;

commit;
