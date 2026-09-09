#!/usr/bin/env bash
set -euo pipefail

db="${1:?database URL is required}"
node minuta-online-booking/scripts/production-db-target-guard.mjs

state="$(PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=5000' \
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
with ids as (
  select
    to_regprocedure('public.provider_book_appointment(uuid,date,time without time zone,text,text)') legacy_oid,
    to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)') idempotent_oid,
    to_regprocedure('public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)') v131_oid
), details as (
  select
    ids.*,
    legacy.proowner legacy_owner,
    idempotent.proowner idempotent_owner,
    added.proowner v131_owner,
    md5(replace(legacy.prosrc, E'\r', '')) legacy_hash,
    md5(replace(idempotent.prosrc, E'\r', '')) idempotent_hash,
    md5(replace(added.prosrc, E'\r', '')) v131_hash,
    coalesce(added.prosecdef, false) v131_security_definer,
    coalesce(array_to_string(added.proconfig, ',') like '%search_path=""%', false) v131_search_path_fixed,
    coalesce(has_function_privilege('authenticated', ids.v131_oid, 'EXECUTE'), false) authenticated_execute,
    coalesce(has_function_privilege('anon', ids.v131_oid, 'EXECUTE'), false) anon_execute,
    coalesce(has_function_privilege('service_role', ids.v131_oid, 'EXECUTE'), false) service_role_execute,
    exists (
      select 1 from pg_indexes
      where schemaname='public' and tablename='bookings' and indexname='idx_bookings_request_id'
        and indexdef ilike 'create unique index%on public.bookings%request_id%'
    ) request_index_ready
  from ids
  left join pg_proc legacy on legacy.oid=ids.legacy_oid
  left join pg_proc idempotent on idempotent.oid=ids.idempotent_oid
  left join pg_proc added on added.oid=ids.v131_oid
), evaluated as (
  select *,
    legacy_oid is not null and idempotent_oid is not null and
      legacy_hash='653390c7c91458eef408e82593f38249' and
      idempotent_hash='abadc0c81de68738ba6382cd03dda62d' and request_index_ready prerequisites_ready,
    v131_oid is not null and legacy_owner=idempotent_owner and idempotent_owner=v131_owner owner_invariant,
    v131_oid is not null and v131_security_definer and v131_search_path_fixed and
      authenticated_execute and not anon_execute and not service_role_execute hardening_ready
  from details
)
select jsonb_build_object(
  'schemaServerVersion',current_setting('server_version'),
  'schemaServerMajor',current_setting('server_version_num')::integer / 10000,
  'prerequisitesReady',prerequisites_ready,
  'legacyHash',legacy_hash,
  'idempotentBookingHash',idempotent_hash,
  'requestIndexReady',request_index_ready,
  'v131Mode',case when v131_oid is null then 'absent'
    when owner_invariant and hardening_ready and v131_hash is not null then 'full' else 'partial' end,
  'v131Hash',v131_hash,
  'ownerInvariant',owner_invariant,
  'v131SecurityDefiner',v131_security_definer,
  'v131SearchPathFixed',v131_search_path_fixed,
  'authenticatedExecute',authenticated_execute,
  'anonExecute',anon_execute,
  'serviceRoleExecute',service_role_execute
)
from evaluated;
SQL
)"

jq -e 'type=="object" and (.v131Mode=="absent" or .v131Mode=="partial" or .v131Mode=="full")' <<<"$state" >/dev/null
jq -c . <<<"$state"
