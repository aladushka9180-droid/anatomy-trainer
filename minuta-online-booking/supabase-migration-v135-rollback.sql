-- v135 rollback: fail closed once an operator has stored a block reason.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='organization_client_profiles'
        and column_name='online_booking_block_reason') then
    if exists(select 1 from public.organization_client_profiles where online_booking_block_reason is not null) then
      raise exception using errcode='55000',message='v135_rollback_preserves_client_block_reasons';
    end if;
  end if;
end
$guard$;

drop function if exists public.get_minuta_client_profile_v135(uuid,text);
drop function if exists public.set_minuta_client_online_booking_block_v135(uuid,text,boolean,text);
alter table public.organization_client_profiles
  drop constraint if exists organization_client_profiles_block_reason_v135_check,
  drop column if exists online_booking_block_reason;

notify pgrst,'reload schema';
commit;
