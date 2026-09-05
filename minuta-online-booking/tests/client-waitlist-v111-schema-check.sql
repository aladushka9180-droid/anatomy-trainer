-- Read-only assertions; safe to run after installation or inside validation TX.
do $$ begin
  if not coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.organization_waitlist_requests')),false)
    or not has_function_privilege('anon','public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text)','EXECUTE')
    or not has_function_privilege('anon','public.get_minuta_waitlist_request_v111(uuid)','EXECUTE')
    or not has_function_privilege('anon','public.cancel_minuta_waitlist_request_v111(uuid)','EXECUTE')
    or has_function_privilege('anon','public.set_minuta_waitlist_status_v111(uuid,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.set_minuta_waitlist_status_v111(uuid,text)','EXECUTE')
    or has_table_privilege('anon','public.organization_waitlist_requests','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.organization_waitlist_requests','INSERT,UPDATE,DELETE')
    or not has_table_privilege('authenticated','public.organization_waitlist_requests','SELECT')
    or not exists(select 1 from pg_policy where polrelid='public.organization_waitlist_requests'::regclass and polname='organization_waitlist_read')
  then raise exception 'waitlist_v111_schema_or_acl_invalid'; end if;
end $$;
