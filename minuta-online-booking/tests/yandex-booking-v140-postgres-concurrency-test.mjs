// Real multi-connection PostgreSQL only; never run against production.
// The v140 migration must already be applied to the guarded isolated test DB.
// Requires the standard MINUTA_TEST_* guard variables and the `pg` module.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
execFileSync(process.execPath, [fileURLToPath(new URL('scripts/migration-config-guard.mjs', root))], { stdio: 'inherit' });
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
assert.equal(typeof Client, 'function', 'PostgreSQL Client constructor unavailable');

const tls = process.env.MINUTA_TEST_PG_TLS_NO_VERIFY === 'MIGRATION_TEST_ONLY'
  ? { rejectUnauthorized: false }
  : undefined;
const clients = [];
const connect = async applicationName => {
  const client = new Client({
    connectionString: process.env.MINUTA_TEST_DATABASE_URL,
    application_name: applicationName,
    ...(tls ? { ssl: tls } : {})
  });
  await client.connect();
  clients.push(client);
  await client.query("set statement_timeout='45s'; set lock_timeout='15s'");
  return client;
};
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const awaitBlocked = async (observer, pid, label) => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const row = (await observer.query(
      "select wait_event_type='Lock' as blocked from pg_stat_activity where pid=$1",
      [pid]
    )).rows[0];
    if (row?.blocked) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`v140_${label}_did_not_wait_for_a_real_lock`);
};

const ids = {
  actor: randomUUID(),
  organization: randomUUID(),
  location: randomUUID(),
  service: randomUUID(),
  connection: randomUUID()
};
const company = `v140-race-${randomUUID().replaceAll('-', '')}`;
const slug = `v140-${ids.organization.replaceAll('-', '')}`;
const createSql = `select public.create_yandex_booking_v140(
  $1,$2,$3,$4,$5::text[],$6,$7::timestamptz,$8,$9,$10,$11,$12,$13
) result`;
const createArgs = ({ requestKey, hash, datetime, lastName = 'Race', comment = null }) => [
  'testing', requestKey, hash, company, [ids.service], ids.actor, datetime,
  'V140', lastName, '0000000000', null, comment, false
];

let admin;
let fixtureCommitted = false;
try {
  admin = await connect('minuta-v140-yandex-race-admin');
  const schema = (await admin.query(`select
    to_regprocedure('public.create_yandex_booking_v140(text,text,text,text,text[],text,timestamp with time zone,text,text,text,text,text,boolean)') is not null as create_ready,
    to_regclass('public.yandex_booking_connections_v140') is not null as table_ready`)).rows[0];
  assert.equal(schema.create_ready, true, 'Apply v140 to the isolated test DB before the race test');
  assert.equal(schema.table_ready, true, 'v140 tables are unavailable');

  await admin.query('begin');
  await admin.query('set local session_replication_role=replica');
  await admin.query(`insert into auth.users(
    id,instance_id,aud,role,email,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),'{}','{}',now(),now())`,
  [ids.actor, `${ids.actor}@example.invalid`]);
  await admin.query('set local session_replication_role=origin');
  await admin.query("insert into public.performer_profiles(id,display_name) values($1,'V140 isolated race specialist')", [ids.actor]);
  await admin.query(`insert into public.organizations(
    id,name,public_slug,status,public_booking_enabled,created_by
  ) values($1,'V140 isolated race organization',$2,'active',true,$3)`,
  [ids.organization, slug, ids.actor]);
  await admin.query(`insert into public.locations(
    id,organization_id,name,timezone,address,active,is_primary
  ) values($1,$2,'V140 race location','Europe/Samara','V140 race address',true,true)`,
  [ids.location, ids.organization]);
  await admin.query(`insert into public.organization_memberships(
    organization_id,user_id,role,is_bookable,active,created_by
  ) values($1,$2,'owner',true,true,$2)`, [ids.organization, ids.actor]);
  await admin.query(`insert into public.services(
    id,performer_id,name,duration_minutes,price_rub,active
  ) values($1,$2,'V140 race service',60,1400,true)`, [ids.service, ids.actor]);
  await admin.query(`insert into public.provider_schedule(
    performer_id,weekday,enabled,start_time,end_time,slot_interval_minutes
  ) select $1,day,true,'09:00','18:00',15 from generate_series(1,7) day`, [ids.actor]);
  await admin.query(`insert into public.yandex_booking_connections_v140(
    id,partner_name,environment,external_company_id,organization_id,location_id,
    approval_status,enabled,rubrics,permalink,booking_url
  ) values($1,'yandex','testing',$2,$3,$4,'approved',true,array['beauty'],'v140-race','https://example.invalid/v140-race')`,
  [ids.connection, company, ids.organization, ids.location]);
  await admin.query('commit');
  fixtureCommitted = true;

  const datetimes = (await admin.query(`select
    (((clock_timestamp() at time zone 'Europe/Samara')::date+7+time '10:00') at time zone 'Europe/Samara')::text as exact_time,
    (((clock_timestamp() at time zone 'Europe/Samara')::date+7+time '12:00') at time zone 'Europe/Samara')::text as conflict_time,
    (((clock_timestamp() at time zone 'Europe/Samara')::date+7+time '14:00') at time zone 'Europe/Samara')::text as slot_time`)).rows[0];
  const first = await connect('minuta-v140-yandex-race-first');
  const second = await connect('minuta-v140-yandex-race-second');
  await first.query('set role service_role');
  await second.query('set role service_role');
  const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;

  const exactKey = `exact-${randomUUID()}`;
  const exactArgs = createArgs({ requestKey: exactKey, hash: 'a'.repeat(64), datetime: datetimes.exact_time });
  await first.query('begin');
  const exactWinner = (await first.query(createSql, exactArgs)).rows[0].result;
  const exactRace = outcome(second.query(createSql, exactArgs));
  await awaitBlocked(admin, secondPid, 'exact_replay');
  await first.query('commit');
  const exactReplay = await exactRace;
  assert.equal(exactReplay.error, undefined);
  assert.deepEqual(exactReplay.value.rows[0].result, exactWinner);
  assert.equal(exactWinner.ok, true);

  const conflictKey = `conflict-${randomUUID()}`;
  const originalArgs = createArgs({
    requestKey: conflictKey,
    hash: 'b'.repeat(64),
    datetime: datetimes.conflict_time,
    comment: 'original'
  });
  const changedArgs = createArgs({
    requestKey: conflictKey,
    hash: 'c'.repeat(64),
    datetime: datetimes.conflict_time,
    lastName: 'Changed',
    comment: 'changed'
  });
  await first.query('begin');
  const conflictWinner = (await first.query(createSql, originalArgs)).rows[0].result;
  const conflictRace = outcome(second.query(createSql, changedArgs));
  await awaitBlocked(admin, secondPid, 'changed_replay');
  await first.query('commit');
  const conflictLoser = await conflictRace;
  assert.equal(conflictLoser.error, undefined);
  assert.deepEqual(conflictLoser.value.rows[0].result, { ok: false, error: 'request_conflict' });
  assert.equal(conflictWinner.ok, true);

  const slotArgsA = createArgs({
    requestKey: `slot-a-${randomUUID()}`,
    hash: 'd'.repeat(64),
    datetime: datetimes.slot_time
  });
  const slotArgsB = createArgs({
    requestKey: `slot-b-${randomUUID()}`,
    hash: 'e'.repeat(64),
    datetime: datetimes.slot_time,
    lastName: 'Other'
  });
  await first.query('begin');
  const slotWinner = (await first.query(createSql, slotArgsA)).rows[0].result;
  const slotRace = outcome(second.query(createSql, slotArgsB));
  await awaitBlocked(admin, secondPid, 'slot_collision');
  await first.query('commit');
  const slotLoser = await slotRace;
  assert.equal(slotLoser.error, undefined);
  assert.equal(slotWinner.ok, true);
  assert.deepEqual(slotLoser.value.rows[0].result, { ok: false, error: 'slot_unavailable' });

  const state = (await admin.query(`select
    (select count(*)::integer from public.yandex_booking_mappings_v140 where connection_id=$1) as mappings,
    (select count(*)::integer from public.yandex_booking_receipts_v140 where connection_id=$1 and operation_kind='create') as receipts,
    (select count(*)::integer from public.bookings booking join public.yandex_booking_mappings_v140 mapping
      on mapping.local_booking_id=booking.id where mapping.connection_id=$1) as bookings`, [ids.connection])).rows[0];
  assert.deepEqual(state, { mappings: 3, receipts: 3, bookings: 3 });
  console.log('PASS: v140 exact replay, changed replay conflict and same-slot race serialize on real PostgreSQL locks');
} finally {
  for (const client of clients) {
    try { await client.query('rollback'); } catch {}
    try { await client.query('reset role'); } catch {}
  }
  if (admin && fixtureCommitted) {
    await admin.query('begin');
    try {
      await admin.query('set local session_replication_role=replica');
      await admin.query('delete from public.yandex_booking_receipts_v140 where connection_id=$1', [ids.connection]);
      await admin.query('delete from public.yandex_booking_mappings_v140 where connection_id=$1', [ids.connection]);
      await admin.query('delete from public.yandex_booking_connections_v140 where id=$1', [ids.connection]);
      await admin.query("select set_config('minuta.v140.cleanup_actor',$1,true),set_config('minuta.v140.cleanup_org',$2,true)",
        [ids.actor, ids.organization]);
      await admin.query(`do $$
      declare
        item record;
        attempts integer;
        remaining integer;
        cleanup_actor uuid:=current_setting('minuta.v140.cleanup_actor')::uuid;
        cleanup_org uuid:=current_setting('minuta.v140.cleanup_org')::uuid;
      begin
        if not exists(select 1 from public.performer_profiles
          where id=cleanup_actor and display_name='V140 isolated race specialist') then
          raise exception 'v140_cleanup_identity_mismatch';
        end if;
        for attempts in 1..20 loop
          remaining:=0;
          for item in
            select columns.table_name,columns.column_name
            from information_schema.columns columns
            join information_schema.tables tables using(table_schema,table_name)
            where columns.table_schema='public' and tables.table_type='BASE TABLE'
              and columns.column_name in('organization_id','performer_id')
              and columns.table_name<>'organization_memberships'
              and columns.data_type='uuid'
            order by columns.table_name,columns.column_name
          loop
            begin
              if item.column_name='organization_id' then
                execute format('delete from public.%I where organization_id=$1',item.table_name) using cleanup_org;
              else
                execute format('delete from public.%I where performer_id=$1',item.table_name) using cleanup_actor;
              end if;
            exception when foreign_key_violation then
              remaining:=remaining+1;
            end;
          end loop;
          exit when remaining=0;
        end loop;
        delete from public.organization_memberships where organization_id=cleanup_org;
        delete from public.locations where organization_id=cleanup_org;
        delete from public.organizations where id=cleanup_org;
        delete from public.performer_profiles where id=cleanup_actor;
        delete from auth.users where id=cleanup_actor;
      end
      $$`);
      await admin.query('commit');
    } catch (error) {
      await admin.query('rollback');
      throw error;
    }
  }
  for (const client of clients) await client.end().catch(() => {});
}
