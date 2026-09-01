#!/usr/bin/env bash
set -euo pipefail

: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"

target_id="00000000-0000-4000-8000-000000006606"
target_email="v66-concurrent-specialist@example.invalid"
owner_id="$(psql "$MINUTA_TEST_DATABASE_URL" -X -Atc "select legacy_performer_id from public.organizations where legacy_performer_id is not null order by id limit 1;")"
organization_id="$(psql "$MINUTA_TEST_DATABASE_URL" -X -Atc "select id from public.organizations where legacy_performer_id = '$owner_id'::uuid;")"

if [[ -z "$owner_id" || -z "$organization_id" ]]; then
  echo "v66 concurrency test requires the v65 legacy owner" >&2
  exit 1
fi

cleanup() {
  psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
    -v target_id="$target_id" -v target_email="$target_email" -v organization_id="$organization_id" <<'SQL'
delete from public.organization_audit_log audit
using public.organization_invitations invitation
where invitation.organization_id = :'organization_id'::uuid
  and lower(invitation.email) = lower(:'target_email')
  and audit.organization_id = invitation.organization_id
  and audit.subject_type = 'invitation'
  and audit.subject_id = invitation.id::text;
delete from public.organization_invitations
where organization_id = :'organization_id'::uuid
  and lower(email) = lower(:'target_email');
delete from public.performer_profiles where id = :'target_id'::uuid;
delete from auth.users where id = :'target_id'::uuid;
SQL
}
trap cleanup EXIT
cleanup

psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v target_id="$target_id" -v target_email="$target_email" <<'SQL'
set session_replication_role = replica;
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  :'target_id'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', :'target_email', now(),
  '{}'::jsonb, '{"display_name":"V66 Concurrent"}'::jsonb, now(), now()
);
set session_replication_role = origin;
SQL

psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v owner_id="$owner_id" -v organization_id="$organization_id" -v target_email="$target_email" <<'SQL' &
begin;
select set_config('request.jwt.claim.sub', :'owner_id', true);
set local role authenticated;
select public.invite_minuta_member(:'organization_id'::uuid, :'target_email', 'specialist', true);
select pg_sleep(2);
commit;
SQL
invite_pid=$!

lock_seen=false
for _ in $(seq 1 50); do
  lock_available="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -Atc \
    "select pg_try_advisory_xact_lock(pg_catalog.hashtextextended('$target_email', 66));")"
  if [[ "$lock_available" = "f" ]]; then
    lock_seen=true
    break
  fi
  sleep 0.1
done
if [[ "$lock_seen" != "true" ]]; then
  wait "$invite_pid"
  echo "invite transaction did not expose the expected email lock" >&2
  exit 1
fi

psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v target_id="$target_id" <<'SQL'
insert into public.performer_profiles (id, display_name)
values (:'target_id'::uuid, 'V66 Concurrent');
SQL
wait "$invite_pid"

result="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -Atc \
  "select not exists (select 1 from public.organizations where legacy_performer_id = '$target_id'::uuid) and not exists (select 1 from public.organization_memberships where organization_id = '$organization_id'::uuid and user_id = '$target_id'::uuid) and exists (select 1 from public.organization_invitations where organization_id = '$organization_id'::uuid and lower(email) = lower('$target_email') and status = 'pending');")"
test "$result" = "t"

# A repeated full release must detect the complete v65 foundation and skip v65.
# Reapplying v65 here would create an unwanted personal organization.
foundation_count="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -Atc \
  "select (to_regclass('public.organizations') is not null)::int + (to_regclass('public.locations') is not null)::int + (to_regclass('public.organization_memberships') is not null)::int;")"
test "$foundation_count" = "3"
psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f minuta-online-booking/supabase-migration-v66.sql
rerun_result="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -Atc \
  "select not exists (select 1 from public.organizations where legacy_performer_id = '$target_id'::uuid) and exists (select 1 from public.organization_invitations where organization_id = '$organization_id'::uuid and lower(email) = lower('$target_email') and status = 'pending');")"
test "$rerun_result" = "t"
echo "multi-tenant v66 concurrency test: OK"
