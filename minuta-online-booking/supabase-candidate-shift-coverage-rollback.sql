begin;
set local search_path=public,extensions,pg_catalog;

-- Removing the guard from an active organization needs a deliberate disable.
do $guard$
begin
  if exists(select 1 from public.organization_shift_settings where enabled) then
    raise exception using errcode='55000',message='disable_branch_shifts_before_coverage_rollback';
  end if;
end $guard$;

drop function public.set_minuta_branch_shifts_enabled(uuid,boolean);
drop function public.set_minuta_branch_shifts_enabled_v2(uuid,boolean,boolean,text);
drop function public.preview_minuta_shift_coverage(uuid);
alter function public.set_minuta_branch_shifts_enabled_v71_core(uuid,boolean)
  rename to set_minuta_branch_shifts_enabled;
revoke all on function public.set_minuta_branch_shifts_enabled(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_branch_shifts_enabled(uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
