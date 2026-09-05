#!/usr/bin/env bash
set -euo pipefail
: "${MINUTA_CRM_EPHEMERAL_DB_URL:?Ephemeral local database required}"
node --input-type=module -e '
  const u=new URL(process.env.MINUTA_CRM_EPHEMERAL_DB_URL);
  if(!["localhost","127.0.0.1"].includes(u.hostname) || u.pathname!=="/crm_ephemeral") throw Error("Only the disposable local CI database is allowed");
'
db="$MINUTA_CRM_EPHEMERAL_DB_URL"
node minuta-online-booking/tests/client-record-postgres-fixture.mjs | psql "$db" -X -v ON_ERROR_STOP=1 >/dev/null
psql "$db" -X -v ON_ERROR_STOP=1 -f minuta-online-booking/supabase-migration-v112.sql >/dev/null
psql "$db" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.set_minuta_client_records_enabled('00000000-0000-4000-8000-000000000010',true);
select public.create_minuta_client_record('00000000-0000-4000-8000-000000000010','79990000112',
  '00000000-0112-4000-8000-000000000009',null,'file','','concurrency.pdf','application/pdf',12);
reset role;
update public.client_record_entries set created_at=clock_timestamp()-interval '7 days'+interval '3 seconds';
commit;
SQL

# The upload passes RLS before TTL, then holds its transaction past TTL.
PGAPPNAME=crm-upload-lock-test psql "$db" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into storage.objects(bucket_id,name,metadata) values('minuta-client-records',
 '00000000-0000-4000-8000-000000000010/00000000-0112-4000-8000-000000000009.pdf',
 '{"size":12,"mimetype":"application/pdf"}');
select pg_sleep(8);
commit;
SQL
writer=$!
trap 'kill "$writer" 2>/dev/null || true' EXIT
holding=false
for attempt in {1..50}; do
  if [ "$(psql "$db" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where application_name='crm-upload-lock-test' and wait_event='PgSleep'")" = 1 ]; then
    holding=true; break
  fi
  sleep 0.1
done
test "$holding" = true
psql "$db" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
select pg_sleep(4);
do $$ begin
  if not exists(select 1 from public.client_record_entries where created_at<now()-interval '7 days') then
    raise exception 'Fixture has not crossed TTL';
  end if;
  if public.claim_expired_minuta_client_records(100,true)<>'[]'::jsonb
    or exists(select 1 from public.client_record_entries where expired_at is not null) then
    raise exception 'Cleanup claimed an in-flight Storage INSERT';
  end if;
end $$;
SQL
wait "$writer"
trap - EXIT
psql "$db" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin
  perform public.claim_expired_minuta_client_records(100,true);
  if not exists(select 1 from public.client_record_entries where expired_at is not null) then
    raise exception 'Cleanup did not claim after upload transaction committed';
  end if;
  if public.finish_expired_minuta_client_record('00000000-0112-4000-8000-000000000009') then
    raise exception 'Cleanup bypassed grace/object-presence guard';
  end if;
end $$;
SQL
echo 'PASS: real PostgreSQL connections protect in-flight Storage INSERT from cleanup; grace remains enforced'
