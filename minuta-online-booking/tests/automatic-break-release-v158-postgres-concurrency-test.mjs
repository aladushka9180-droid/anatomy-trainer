// Real multi-connection PostgreSQL only. The standard guard rejects production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
execFileSync(process.execPath,[fileURLToPath(new URL('scripts/migration-config-guard.mjs',root))],{stdio:'inherit'});
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
const clients=[];
const connect=async()=>{ const client=new Client({connectionString:process.env.MINUTA_TEST_DATABASE_URL,application_name:'minuta-v158-concurrency'}); await client.connect(); clients.push(client); await client.query("set statement_timeout='25s'; set lock_timeout='20s'"); return client; };
const asActor=async(client,actor)=>{ await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]); await client.query('set role authenticated'); };
const awaitBlocked=async(observer,pid)=>{ for(let i=0;i<120;i++){ const {rows}=await observer.query('select coalesce(cardinality(pg_blocking_pids($1)),0)>0 blocked',[pid]); if(rows[0]?.blocked)return; await new Promise(r=>setTimeout(r,25)); } throw new Error('v158_session_did_not_wait'); };

const admin=await connect(); let fixture;
try {
  await admin.query('begin');
  await admin.query(readFileSync(new URL('tests/booking-concurrency-v123-fixture.sql',root),'utf8'));
  fixture=(await admin.query("select current_setting('v123.actor') actor,current_setting('v123.org') org,current_setting('v123.loc') loc,current_setting('v123.service') service,current_setting('v123.date') date")).rows[0];
  await admin.query(`insert into public.booking_policies(performer_id,booking_buffer_enabled,booking_buffer_minutes) values($1,false,60)
    on conflict(performer_id) do update set booking_buffer_enabled=false,booking_buffer_minutes=60`,[fixture.actor]);
  for(const [time,name,phone] of [['11:00','V158 concurrent first','79990000183'],['13:00','V158 concurrent second','79990000184']]){
    const code=(await admin.query('select public.provider_book_appointment($1,$2,$3,$4,$5) code',[fixture.service,fixture.date,time,name,'0000000000'])).rows[0].code;
    await admin.query('update public.bookings set client_phone=$2,organization_id=$3,location_id=$4 where booking_code=$1',[code,phone,fixture.org,fixture.loc]);
  }
  await admin.query('update public.booking_policies set booking_buffer_enabled=true where performer_id=$1',[fixture.actor]);
  await admin.query('commit');

  const first=await connect(),second=await connect();
  await asActor(first,fixture.actor); await asActor(second,fixture.actor);
  const segment=(await first.query('select * from public.get_minuta_provider_automatic_breaks_v158($1) where start_time=$2 and end_time=$3',[fixture.date,'12:00','13:00'])).rows[0];
  assert.equal(segment.source_count,2);
  const request=randomUUID();
  const args=[request,fixture.date,'12:00','13:00',segment.segment_fingerprint];
  const secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
  await first.query('begin');
  const firstResult=(await first.query('select public.release_minuta_provider_automatic_break_v158($1,$2,$3,$4,$5) result',args)).rows[0].result;
  const replayPromise=second.query('select public.release_minuta_provider_automatic_break_v158($1,$2,$3,$4,$5) result',args);
  await awaitBlocked(admin,secondPid);
  await first.query('commit');
  const replay=(await replayPromise).rows[0].result;
  assert.equal(firstResult.request_id,request);
  assert.equal(replay.request_id,request);
  assert.equal(replay.replayed,true);
  assert.equal((await admin.query('select count(*)::integer n from public.booking_buffer_release_requests_v158 where request_id=$1',[request])).rows[0].n,1);
  assert.equal((await admin.query(`select count(*)::integer n from public.booking_buffer_release_sources_v158 source
    join public.booking_buffer_release_requests_v158 request on request.id=source.release_id where request.request_id=$1`,[request])).rows[0].n,2);

  // A booking racing the release waits for the day lock, then uses the released slot exactly once.
  const third=await connect(); await asActor(third,fixture.actor);
  const thirdPid=(await third.query('select pg_backend_pid() pid')).rows[0].pid;
  await first.query('begin');
  await first.query('select pg_advisory_xact_lock(hashtextextended($1::text||$2::text,0))',[fixture.actor,fixture.date]);
  const bookingRace=third.query('select public.provider_book_appointment($1,$2,$3,$4,$5) code',[fixture.service,fixture.date,'12:00','V158 released slot','79990000185']);
  await awaitBlocked(admin,thirdPid);
  await first.query('commit');
  const booked=await bookingRace;
  assert.match(booked.rows[0].code,/^MIN-/i);
  assert.equal((await admin.query("select count(*)::integer n from public.bookings where performer_id=$1 and booking_date=$2 and booking_time='12:00' and status<>'cancelled'",[fixture.actor,fixture.date])).rows[0].n,1);
  console.log('PASS: v158 release replay and booking race serialize without duplicate history');
} finally {
  for(const client of clients){ try{await client.query('rollback');await client.query('reset role');}catch{} }
  if(fixture?.actor){
    await admin.query("select set_config('v158.cleanup_actor',$1,false)",[fixture.actor]);
    await admin.query(`do $$ declare item record;attempts integer;remaining integer;v_actor uuid:=current_setting('v158.cleanup_actor')::uuid;v_orgs uuid[];
      begin
        if not exists(select 1 from public.performer_profiles where id=v_actor and display_name='V123 isolated fixture') then raise exception 'v158_cleanup_identity_mismatch'; end if;
        select array_agg(id) into v_orgs from public.organizations where created_by=v_actor or legacy_performer_id=v_actor;
        delete from public.booking_buffer_release_requests_v158 where performer_id=v_actor;
        update public.bookings set series_id=null,series_occurrence=null where performer_id=v_actor and series_id is not null;
        for attempts in 1..20 loop remaining:=0;
          for item in select c.table_name,c.column_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name)
            where c.table_schema='public' and t.table_type='BASE TABLE' and c.column_name in('organization_id','performer_id')
              and c.table_name<>'organization_memberships' and c.data_type='uuid' order by c.table_name loop
            begin if item.column_name='organization_id' then execute format('delete from public.%I where organization_id=any($1)',item.table_name) using v_orgs;
              else execute format('delete from public.%I where performer_id=$1',item.table_name) using v_actor; end if;
            exception when foreign_key_violation then remaining:=remaining+1; end;
          end loop; exit when remaining=0; end loop;
        delete from public.organizations where id=any(v_orgs); delete from public.performer_profiles where id=v_actor; delete from auth.users where id=v_actor;
      end $$;`);
  }
  for(const client of clients) await client.end();
}
