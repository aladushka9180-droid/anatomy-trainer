begin transaction isolation level repeatable read read only;

select json_build_object(
  'bookings',(select count(*) from public.bookings),
  'bookingEvents',(select count(*) from public.booking_events),
  'bookingMutations',(select count(*) from public.booking_mutations),
  'bookingOutcomes',(select count(*) from public.booking_outcomes),
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
