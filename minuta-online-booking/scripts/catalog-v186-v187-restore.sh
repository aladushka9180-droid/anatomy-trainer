#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Called only after the existing ephemeral restore has loaded public data.
# Never accepts a database URL or uses a networked PostgreSQL connection.
test "$#" -eq 7
container="$1"
private_log="$2"
result="$3"
[[ "$container" =~ ^minuta-restore-[0-9]+$ ]]
test -f "$private_log"
test -f "$result"
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none

files=("$4" "$5" "$6" "$7")
hashes=(
  4b744d779b6acd9e365c6239c75a63a0d885572051f196288211d4ccc86c4c45
  05f4c6f2fff3d66e5bdc1018dc71d6ec0eeafb3e878784d4092eaeea7d50055a
  3d9f8b399460995b16f62f745750cd7058129ccfe0ab131c87c2f95bbacf9031
  ac196802a201ac37f8e5cc52849dcc6c5d58805df0fb6cf5e8e1111bc5b43a53
)
for i in 0 1 2 3; do
  test -f "${files[$i]}"
  test "$(sha256sum "${files[$i]}" | cut -d' ' -f1)" = "${hashes[$i]}"
  docker cp "${files[$i]}" "$container:/tmp/catalog-$i.sql" >/dev/null
done

# A repeatable plain dump of the existing business tables detects changes
# beyond counts while keeping rows and their digest out of public logs.
# The fixed restrict key is only for comparing dumps; this output is never run.
tables=(
  --table=public.services
  --table=public.service_public_details_v159
  --table=public.inventory_items
  --table=public.inventory_stock_balances
  --table=public.inventory_movements
  --table=public.bookings
)
business_digest() {
  docker exec "$container" pg_dump -U postgres -d postgres --data-only \
    --no-owner --no-privileges --restrict-key=CatalogCompareOnly \
    "${tables[@]}" --file=/tmp/catalog-business.sql \
    >>"$private_log" 2>&1
  docker exec "$container" sha256sum /tmp/catalog-business.sql | cut -d' ' -f1
}
baseline="$(business_digest)"
[[ "$baseline" =~ ^[0-9a-f]{64}$ ]]

contract_present() {
  docker exec "$container" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "select (
      to_regclass('public.inventory_catalog_requests_v186') is not null
      and to_regclass('public.service_catalog_requests_v187') is not null
      and to_regprocedure('public.get_minuta_inventory_workspace_v186(uuid)') is not null
      and to_regprocedure('public.get_minuta_service_catalog_draft_v187(uuid,uuid)') is not null
      and to_regprocedure('public.save_minuta_inventory_item_draft_v186(uuid,uuid,uuid,text,text,text,text,numeric,boolean)') is not null
      and to_regprocedure('public.save_minuta_service_catalog_draft_v187(uuid,uuid,uuid,text,text,integer,integer,boolean)') is not null
      and has_function_privilege('authenticated','public.save_minuta_inventory_item_draft_v186(uuid,uuid,uuid,text,text,text,text,numeric,boolean)','execute')
      and has_function_privilege('authenticated','public.save_minuta_service_catalog_draft_v187(uuid,uuid,uuid,text,text,integer,integer,boolean)','execute')
      and not has_function_privilege('anon','public.save_minuta_inventory_item_draft_v186(uuid,uuid,uuid,text,text,text,text,numeric,boolean)','execute')
      and not has_function_privilege('anon','public.save_minuta_service_catalog_draft_v187(uuid,uuid,uuid,text,text,integer,integer,boolean)','execute')
      and (select relrowsecurity from pg_class where oid='public.inventory_catalog_requests_v186'::regclass)
      and (select relrowsecurity from pg_class where oid='public.service_catalog_requests_v187'::regclass)
      and (select count(*) from public.inventory_catalog_requests_v186)=0
      and (select count(*) from public.service_catalog_requests_v187)=0
    )::int" 2>>"$private_log"
}
contract_absent() {
  docker exec "$container" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "select (
      to_regclass('public.inventory_catalog_requests_v186') is null
      and to_regclass('public.service_catalog_requests_v187') is null
      and to_regprocedure('public.get_minuta_inventory_workspace_v186(uuid)') is null
      and to_regprocedure('public.get_minuta_service_catalog_draft_v187(uuid,uuid)') is null
      and to_regprocedure('public.save_minuta_inventory_item_draft_v186(uuid,uuid,uuid,text,text,text,text,numeric,boolean)') is null
      and to_regprocedure('public.save_minuta_service_catalog_draft_v187(uuid,uuid,uuid,text,text,integer,integer,boolean)') is null
    )::int" 2>>"$private_log"
}
apply_stage() {
  local stage="$1" index="$2"
  if ! docker exec "$container" psql -U postgres -d postgres -X -q \
    -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f "/tmp/catalog-$index.sql" \
    >>"$private_log" 2>&1; then
    echo "catalog isolated rehearsal refused $stage; private output withheld" >&2
    return 1
  fi
  test "$(business_digest)" = "$baseline"
}

test "$(contract_absent)" = 1
apply_stage v186 0
apply_stage v187 1
test "$(contract_present)" = 1
apply_stage v187-rollback 2
apply_stage v186-rollback 3
test "$(contract_absent)" = 1
apply_stage v186-reapply 0
apply_stage v187-reapply 1
test "$(contract_present)" = 1

jq '. + {catalogCandidateVersion:"v186-v187",candidateMigrationApplied:true,
  candidateRollbackVerified:true,candidateReapplied:true,
  catalogBusinessRowsPreserved:true,catalogRlsAndPrivilegesVerified:true}' \
  "$result" > "$result.catalog"
mv "$result.catalog" "$result"
