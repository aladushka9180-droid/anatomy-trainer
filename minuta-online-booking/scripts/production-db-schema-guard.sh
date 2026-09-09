#!/usr/bin/env bash
set -euo pipefail

db="${1:?database URL is required}"
node minuta-online-booking/scripts/production-db-target-guard.mjs
marker="$(PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=5000' \
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
select current_database()='postgres'
  and current_user in('postgres','postgres.cawexmmrqjvothcbgjxr')
  and to_regclass('auth.users') is not null
  and to_regclass('storage.objects') is not null
  and to_regclass('public.organizations') is not null
  and to_regclass('public.organization_memberships') is not null
  and to_regclass('public.bookings') is not null
  and to_regclass('public.inventory_movements') is not null
  and to_regclass('public.notification_outbox') is not null
  and to_regprocedure('public.claim_minuta_notification_test_outbox_v128(uuid,text,text)') is not null
  and to_regprocedure('public.fail_minuta_notification_test_outbox_v128(uuid,uuid,text,uuid,text,text,text)') is not null;
SQL
)"
test "$marker" = t
echo 'production database schema marker: OK'
