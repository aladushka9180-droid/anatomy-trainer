begin transaction isolation level repeatable read read only;

do $guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_events') is null
     or to_regclass('public.notification_outbox') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.commercial_sales') is null
     or to_regclass('public.commercial_sale_lines') is null
     or to_regclass('public.commercial_sale_refunds') is null
     or to_regclass('public.inventory_movements') is null
     or to_regclass('public.financial_transactions') is null
     or to_regclass('public.financial_postings') is null
     or to_regclass('public.client_accounts') is null
     or to_regclass('public.client_device_sessions') is null
     or to_regclass('public.client_benefit_instruments') is null
     or to_regclass('public.benefit_redemptions') is null
     or to_regclass('public.benefit_ledger') is null
     or to_regclass('public.benefit_audit_log') is null then
    raise exception using errcode='55000',message='v155_business_count_prerequisites_missing';
  end if;
end
$guard$;

select json_build_object(
  'bookings',(select count(*) from public.bookings),
  'bookingEvents',(select count(*) from public.booking_events),
  'notificationOutbox',(select count(*) from public.notification_outbox),
  'payments',(select count(*) from public.payments),
  'commercialSales',(select count(*) from public.commercial_sales),
  'commercialSaleLines',(select count(*) from public.commercial_sale_lines),
  'commercialSaleRefunds',(select count(*) from public.commercial_sale_refunds),
  'inventoryMovements',(select count(*) from public.inventory_movements),
  'financialTransactions',(select count(*) from public.financial_transactions),
  'financialPostings',(select count(*) from public.financial_postings),
  'clientAccounts',(select count(*) from public.client_accounts),
  'clientDeviceSessions',(select count(*) from public.client_device_sessions),
  'benefitInstruments',(select count(*) from public.client_benefit_instruments),
  'benefitRedemptions',(select count(*) from public.benefit_redemptions),
  'benefitLedger',(select count(*) from public.benefit_ledger),
  'benefitAudit',(select count(*) from public.benefit_audit_log)
);

rollback;
