begin;

-- Never erase an operational payment/refund audit trail. After the first
-- attempt, rollback means disabling the organization setting and deploying a
-- forward fix; this destructive schema rollback is intentionally blocked.
do $$
begin
  if to_regclass('public.payment_provider_attempts') is not null
     and exists(select 1 from public.payment_provider_attempts) then
    raise exception using errcode='55000',message='v87_rollback_blocked_payment_data_exists';
  end if;
end $$;

drop function if exists public.record_yookassa_reconciliation(uuid,text,uuid,text,text,bigint,text,text,text,text,text);
drop function if exists public.process_yookassa_refund_event(uuid,text,text,text,text,text,bigint,text,text,timestamp with time zone);
drop function if exists public.process_yookassa_payment_event(uuid,text,text,text,text,bigint,text,text,timestamp with time zone,boolean);
drop function if exists public.fail_yookassa_refund(uuid,text,boolean);
drop function if exists public.complete_yookassa_refund(uuid,text,text,bigint,text,text,timestamp with time zone);
drop function if exists public.prepare_yookassa_refund(uuid,uuid,bigint,uuid,text,uuid);
drop function if exists public.fail_yookassa_payment_attempt(uuid,text,boolean);
drop function if exists public.complete_yookassa_payment_creation(uuid,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone,boolean);
drop function if exists public.sync_minuta_yookassa_legacy_payment(uuid);
drop function if exists public.refresh_minuta_yookassa_booking(uuid);
drop function if exists public.prepare_yookassa_payment(uuid,uuid);
drop function if exists public.get_yookassa_payment_capability(uuid);
drop function if exists public.get_minuta_payment_workspace(uuid);
drop function if exists public.set_minuta_yookassa_settings(uuid,boolean,text,boolean,text,integer,text);
drop function if exists public.require_minuta_payment_role(uuid,uuid,text[]);

do $$
begin
  if to_regclass('public.organization_payment_provider_settings') is not null then
    drop trigger if exists payment_provider_settings_touch on public.organization_payment_provider_settings;
  end if;
  if to_regclass('public.payment_provider_attempts') is not null then
    drop trigger if exists payment_provider_attempts_touch on public.payment_provider_attempts;
  end if;
  if to_regclass('public.payment_provider_refunds') is not null then
    drop trigger if exists payment_provider_refunds_touch on public.payment_provider_refunds;
  end if;
  if to_regclass('public.organizations') is not null then
    drop trigger if exists organizations_payment_provider_settings on public.organizations;
  end if;
end $$;

drop function if exists public.touch_minuta_payment_provider_row();
drop function if exists public.ensure_minuta_payment_provider_settings();

drop table if exists public.payment_provider_audit_log;
drop table if exists public.payment_provider_reconciliations;
drop table if exists public.payment_provider_events;
drop table if exists public.payment_provider_refunds;
drop table if exists public.payment_provider_attempts;
drop table if exists public.organization_payment_provider_settings;

commit;
