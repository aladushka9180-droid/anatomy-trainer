#!/usr/bin/env bash
set -euo pipefail

# Isolated full-schema test only. Never accepts a production DSN.
test -n "${MINUTA_TEST_DATABASE_URL:-}"
test -n "${MINUTA_TEST_PROJECT_REF:-}"
test -n "${MINUTA_PRODUCTION_PROJECT_REF:-}"
test "$MINUTA_TEST_PROJECT_REF" != "$MINUTA_PRODUCTION_PROJECT_REF"
case "$MINUTA_TEST_DATABASE_URL" in
  *"$MINUTA_TEST_PROJECT_REF"*) ;;
  *) echo 'Test DSN does not contain the test project ref' >&2; exit 1 ;;
esac
case "$MINUTA_TEST_DATABASE_URL" in
  *"$MINUTA_PRODUCTION_PROJECT_REF"*) echo 'Production project ref in test DSN' >&2; exit 1 ;;
esac

db="${MINUTA_TEST_DATABASE_URL/:6543/:5432}"
marker="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 --set=expected_ref="$MINUTA_TEST_PROJECT_REF" <<'SQL'
select count(*) from minuta_migration_guard.target
where project_ref=:'expected_ref' and allow_migrations is true;
SQL
)"
test "$(tr -d '[:space:]' <<<"$marker")" = 1

installed="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select coalesce(obj_description('public.process_minuta_auto_completed_visits_v106(integer)'::regprocedure,'pg_proc'),'')")"
case "$installed" in
  ''|'minuta:v181:auto-complete-inventory-shortfall') ;;
  *) echo 'Unknown auto-completion function marker in test database' >&2; exit 1 ;;
esac
if test "$installed" = 'minuta:v181:auto-complete-inventory-shortfall'; then
  psql "$db" -X -q -v ON_ERROR_STOP=1 -f minuta-online-booking/supabase-migration-v181-rollback.sql
fi
baseline="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select md5(pg_get_functiondef('public.process_minuta_auto_completed_visits_v106(integer)'::regprocedure))")"
test -n "$baseline"
test "$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select position('limit p_limit' in lower(pg_get_functiondef('public.process_minuta_auto_completed_visits_v106(integer)'::regprocedure)))>0")" = t

psql "$db" -X -q -v ON_ERROR_STOP=1 -f minuta-online-booking/supabase-migration-v181.sql
psql "$db" -X -q -v ON_ERROR_STOP=1 -f minuta-online-booking/supabase-migration-v181.sql
psql "$db" -X -q -v ON_ERROR_STOP=1 -f minuta-online-booking/tests/auto-complete-inventory-v181-integration.sql
psql "$db" -X -q -v ON_ERROR_STOP=1 -f minuta-online-booking/supabase-migration-v181-rollback.sql
restored="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select md5(pg_get_functiondef('public.process_minuta_auto_completed_visits_v106(integer)'::regprocedure))")"
test "$restored" = "$baseline"
psql "$db" -X -q -v ON_ERROR_STOP=1 -f minuta-online-booking/supabase-migration-v181.sql
psql "$db" -X -q -v ON_ERROR_STOP=1 -f minuta-online-booking/tests/auto-complete-inventory-v181-integration.sql
echo 'v181 isolated full-schema apply/reapply/rollback/reapply: PASS'
