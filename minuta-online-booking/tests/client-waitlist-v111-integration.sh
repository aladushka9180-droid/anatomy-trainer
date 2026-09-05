#!/usr/bin/env bash
set -euo pipefail
node minuta-online-booking/scripts/migration-config-guard.mjs
# Apply twice, exercise real roles/RPCs, revoke entry and reapply. Everything,
# including synthetic fixtures and the new schema, is rolled back on connection exit.
{
  printf 'begin;\n'
  for pass in 1 2; do
    sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/Id' minuta-online-booking/supabase-migration-v111.sql
  done
  cat minuta-online-booking/tests/client-waitlist-v111-schema-check.sql
  cat minuta-online-booking/tests/client-waitlist-v111-integration.sql
  sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/Id' minuta-online-booking/supabase-migration-v111-rollback.sql
  printf '\nselect pg_temp.check_waitlist_rollback();\n'
  sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/Id' minuta-online-booking/supabase-migration-v111.sql
  printf "select pg_temp.waitlist_assert(has_function_privilege('anon','public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text)','EXECUTE'),'reapply_failed');\nrollback;\n"
} | psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 > /dev/null
echo 'PASS: v111 SQL apply twice, scoped joins, token privacy, RLS, status, rollback, reapply and legacy preservation'
