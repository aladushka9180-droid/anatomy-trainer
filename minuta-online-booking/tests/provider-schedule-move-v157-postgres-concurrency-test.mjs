// Real multi-connection PostgreSQL only. The standard guard rejects production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
execFileSync(process.execPath, [fileURLToPath(new URL('scripts/migration-config-guard.mjs', root))], { stdio:'inherit' });
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
assert.equal(typeof Client, 'function', 'PostgreSQL Client constructor unavailable');

const clients = [];
const tls = process.env.MINUTA_TEST_PG_TLS_NO_VERIFY === 'MIGRATION_TEST_ONLY' ? { rejectUnauthorized:false } : undefined;
const connect = async () => {
  const client = new Client({
    connectionString:process.env.MINUTA_TEST_DATABASE_URL,
    application_name:'minuta-v157-concurrency-test',
    ...(tls ? { ssl:tls } : {})
  });
  await client.connect();
  clients.push(client);
  await client.query("set statement_timeout='25s'; set lock_timeout='20s'");
  return client;
};
const asActor = async (client, actor) => {
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  await client.query('set role authenticated');
};
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const awaitBlocked = async (observer, pid) => {
  for (let attempt=0; attempt<120; attempt+=1) {
    const { rows } = await observer.query('select coalesce(cardinality(pg_blocking_pids($1)),0)>0 blocked',[pid]);
    if (rows[0]?.blocked) return;
    await new Promise(resolve => setTimeout(resolve,25));
  }
  throw new Error('second_session_did_not_wait_for_v157_lock');
};

const admin = await connect();
let fixture;
try {
  await admin.query('begin');
  await admin.query(readFileSync(new URL('tests/booking-concurrency-v123-fixture.sql', root),'utf8'));
  fixture = (await admin.query("select current_setting('v123.actor') actor,current_setting('v123.org') org,current_setting('v123.loc') loc,current_setting('v123.service') service,current_setting('v123.date') date")).rows[0];
  const code = (await admin.query('select public.provider_book_appointment($1,$2,$3,$4,$5) code',[
    fixture.service,fixture.date,'10:00','V157 concurrency client','0000000000'
  ])).rows[0].code;
  fixture.booking = (await admin.query('select id,status from public.bookings where booking_code=$1',[code])).rows[0];
  // The legacy five-argument fixture helper predates organization scoping.
  // Complete the synthetic booking so it matches a real organization booking.
  await admin.query(`update public.bookings
    set client_phone='79990000157', organization_id=$2, location_id=$3
    where id=$1`,[fixture.booking.id,fixture.org,fixture.loc]);
  await admin.query('commit');

  const first = await connect();
  const second = await connect();
  await asActor(first,fixture.actor);
  await asActor(second,fixture.actor);
  const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
  const moveSql = `select public.move_minuta_provider_schedule_booking_v157(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
  ) result`;
  const moveArgs = (request,time,expectedTime) => [
    request,fixture.booking.id,fixture.date,time,fixture.org,fixture.loc,fixture.service,
    fixture.date,expectedTime,60,fixture.booking.status
  ];

  const firstMoveRequest = randomUUID();
  await first.query('begin');
  const firstMove = (await first.query(moveSql,moveArgs(firstMoveRequest,'11:00','10:00'))).rows[0].result;
  const staleRace = outcome(second.query(moveSql,moveArgs(randomUUID(),'12:00','10:00')));
  await awaitBlocked(admin,secondPid);
  await first.query('commit');
  const staleResult = await staleRace;
  assert.equal(staleResult.error?.code,'40001');
  assert.equal(staleResult.error?.message,'provider_schedule_booking_changed');
  assert.equal((await admin.query('select booking_time::text value from public.bookings where id=$1',[fixture.booking.id])).rows[0].value,'11:00:00');
  assert.equal((await admin.query("select count(*)::integer n from public.provider_schedule_moves_v157 where booking_id=$1 and operation='move'",[fixture.booking.id])).rows[0].n,1);

  await first.query('begin');
  const undoRequest = randomUUID();
  await first.query('select public.undo_minuta_provider_schedule_booking_v157($1,$2)',[undoRequest,firstMove.move_id]);
  const moveAgainstUndo = outcome(second.query(moveSql,moveArgs(randomUUID(),'12:00','11:00')));
  await awaitBlocked(admin,secondPid);
  await first.query('commit');
  const afterUndo = await moveAgainstUndo;
  assert.equal(afterUndo.error?.code,'40001');
  assert.equal(afterUndo.error?.message,'provider_schedule_booking_changed');
  assert.equal((await admin.query('select booking_time::text value from public.bookings where id=$1',[fixture.booking.id])).rows[0].value,'10:00:00');
  assert.equal((await admin.query("select count(*)::integer n from public.provider_schedule_moves_v157 where booking_id=$1 and operation='undo'",[fixture.booking.id])).rows[0].n,1);
  assert.equal((await admin.query("select count(*)::integer n from public.booking_events where booking_id=$1 and event_type='booking_rescheduled'",[fixture.booking.id])).rows[0].n,2);

  const secondMove = (await first.query(moveSql,moveArgs(randomUUID(),'11:00','10:00'))).rows[0].result;
  await first.query('begin');
  await first.query('select public.undo_minuta_provider_schedule_booking_v157($1,$2)',[randomUUID(),secondMove.move_id]);
  const competingUndo = outcome(second.query('select public.undo_minuta_provider_schedule_booking_v157($1,$2)',[randomUUID(),secondMove.move_id]));
  await awaitBlocked(admin,secondPid);
  await first.query('commit');
  const undoRace = await competingUndo;
  assert.equal(undoRace.error?.code,'40001');
  assert.equal(undoRace.error?.message,'provider_schedule_move_already_undone');
  assert.equal((await admin.query("select count(*)::integer n from public.provider_schedule_moves_v157 where booking_id=$1 and reverse_of=$2",[fixture.booking.id,secondMove.move_id])).rows[0].n,1);
  console.log('PASS: v157 concurrent move and undo serialize without stale overwrite or duplicate history');
} finally {
  for (const client of clients) {
    try { await client.query('rollback'); await client.query('reset role'); } catch {}
  }
  if (fixture?.actor) {
    await admin.query("select set_config('v157.cleanup_actor',$1,false)",[fixture.actor]);
    await admin.query(`do $$ declare item record; attempts integer; remaining integer; v_actor uuid:=current_setting('v157.cleanup_actor')::uuid; v_orgs uuid[];
      begin
        if not exists(select 1 from public.performer_profiles where id=v_actor and display_name='V123 isolated fixture') then raise exception 'v157_cleanup_identity_mismatch'; end if;
        select array_agg(id) into v_orgs from public.organizations where created_by=v_actor or legacy_performer_id=v_actor;
        delete from public.provider_schedule_moves_v157 where performer_id=v_actor;
        update public.bookings set series_id=null,series_occurrence=null where performer_id=v_actor and series_id is not null;
        for attempts in 1..20 loop
          remaining:=0;
          for item in select c.table_name,c.column_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name)
            where c.table_schema='public' and t.table_type='BASE TABLE' and c.column_name in ('organization_id','performer_id')
              and c.table_name<>'organization_memberships' and c.data_type='uuid' order by c.table_name loop
            begin
              if item.column_name='organization_id' then execute format('delete from public.%I where organization_id=any($1)',item.table_name) using v_orgs;
              else execute format('delete from public.%I where performer_id=$1',item.table_name) using v_actor; end if;
            exception when foreign_key_violation then remaining:=remaining+1; end;
          end loop;
          exit when remaining=0;
        end loop;
        delete from public.organizations where id=any(v_orgs);
        delete from public.performer_profiles where id=v_actor;
        delete from auth.users where id=v_actor;
      end $$;`);
  }
  for (const client of clients) await client.end();
}
