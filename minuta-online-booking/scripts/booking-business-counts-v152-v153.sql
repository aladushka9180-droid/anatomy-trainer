begin transaction isolation level repeatable read read only;

do $guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_events') is null
     or to_regclass('public.notification_outbox') is null
     or to_regclass('public.notification_delivery_attempts') is null
     or to_regclass('public.notification_marks') is null
     or to_regclass('public.telegram_notification_log') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.payment_events') is null
     or to_regclass('public.payment_provider_attempts') is null
     or to_regclass('public.payment_provider_refunds') is null
     or to_regclass('public.payment_provider_events') is null
     or to_regclass('public.payment_provider_reconciliations') is null
     or to_regclass('public.payment_provider_audit_log') is null
     or to_regclass('public.integration_provider_events_v144') is null
     or to_regclass('public.integration_webhook_outbox_v142') is null then
    raise exception using errcode='55000',message='v152_v153_business_count_prerequisites_missing';
  end if;
end
$guard$;

select json_build_object(
  'bookings',(select count(*) from public.bookings),
  'bookingEvents',(select count(*) from public.booking_events),
  'notificationOutbox',(select count(*) from public.notification_outbox),
  'notificationAttempts',(select count(*) from public.notification_delivery_attempts),
  'notificationMarks',(select count(*) from public.notification_marks),
  'telegramNotificationLog',(select count(*) from public.telegram_notification_log),
  'payments',(select count(*) from public.payments),
  'paymentEvents',(select count(*) from public.payment_events),
  'paymentProviderAttempts',(select count(*) from public.payment_provider_attempts),
  'paymentProviderRefunds',(select count(*) from public.payment_provider_refunds),
  'paymentProviderEvents',(select count(*) from public.payment_provider_events),
  'paymentProviderReconciliations',(select count(*) from public.payment_provider_reconciliations),
  'paymentProviderAuditLog',(select count(*) from public.payment_provider_audit_log),
  'integrationProviderEvents',(select count(*) from public.integration_provider_events_v144),
  'integrationWebhookOutbox',(select count(*) from public.integration_webhook_outbox_v142)
);

rollback;
