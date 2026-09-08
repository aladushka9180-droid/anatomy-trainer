\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.claim_minuta_notification_test_outbox_v128(uuid,text,text)') is null
     or to_regprocedure('public.fail_minuta_notification_test_outbox_v128(uuid,uuid,text,uuid,text,text,text)') is null then
    raise exception using errcode='55000',message='v128_rollback_requires_v128';
  end if;
end
$guard$;

-- Compatibility shims keep a newer dispatcher fail-closed while database code
-- is rolled back. Neither shim changes outbox state.
create or replace function public.claim_minuta_notification_test_outbox_v128(
  p_organization uuid,p_event_key text,p_channel text
)
returns table(
  outbox_id uuid,lock_token uuid,event_key text,organization_id uuid,
  performer_id uuid,booking_id uuid,kind text,channel text,audience text,
  attempt_no integer,destination jsonb,message_payload jsonb
)
language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='notification_test_service_role_required';
  end if;
  raise exception using errcode='55000',message='notification_test_mode_unavailable';
end
$$;

create or replace function public.fail_minuta_notification_test_outbox_v128(
  p_outbox uuid,p_lock_token uuid,p_event_key text,p_organization uuid,p_channel text,
  p_error_code text,p_error text
)
returns text language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='notification_test_service_role_required';
  end if;
  raise exception using errcode='55000',message='notification_test_mode_unavailable';
end
$$;

revoke all on function public.claim_minuta_notification_test_outbox_v128(uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.fail_minuta_notification_test_outbox_v128(uuid,uuid,text,uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_minuta_notification_test_outbox_v128(uuid,text,text)
  to service_role;
grant execute on function public.fail_minuta_notification_test_outbox_v128(uuid,uuid,text,uuid,text,text,text)
  to service_role;

commit;
