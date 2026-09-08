// Real multi-connection PostgreSQL, never PGlite. No production URL accepted.
// npm install --no-save pg; node tests/booking-concurrency-v123-postgres-test.mjs
// Requires the standard MINUTA_TEST_* guard variables. Logs no credentials/data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=new URL('../',import.meta.url);
execFileSync(process.execPath,[fileURLToPath(new URL('scripts/migration-config-guard.mjs',root))],{stdio:'inherit'});
const {Client}=await import(process.env.MINUTA_PG_MODULE?pathToFileURL(process.env.MINUTA_PG_MODULE).href:'pg');
const read=name=>readFileSync(new URL(name,root),'utf8');
const transactionBody=sql=>sql.replace(/^\s*(?:begin|commit);\s*$/gmi,'');
const clients=[];
const connect=async()=>{const c=new Client({connectionString:process.env.MINUTA_TEST_DATABASE_URL,application_name:'minuta-v123-isolated-test'});await c.connect();clients.push(c);await c.query("set statement_timeout='20s'; set lock_timeout='15s'");return c;};
const admin=await connect();
const apply=read('supabase-migration-v123.sql');
const undo=read('supabase-migration-v123-rollback.sql');
let fixture;
const blockSQL='select public.create_provider_block_v123($1,$2,$3,$4,$5,$6,$7,$8,$9) result';
const seriesSQL='select public.manage_minuta_booking_series_v123($1,$2,$3,$4,$5,$6,$7) result';
const args=(time,id,duration=15)=>[fixture.org,fixture.loc,fixture.service,fixture.date,time,duration,id,'Перерыв',''];
const actor=async c=>{await c.query("select set_config('request.jwt.claim.sub',$1,false)",[fixture.actor]);await c.query('set role authenticated');};
const awaitBlocked=async(c,pid)=>{
 for(let i=0;i<100;i++){
  const {rows}=await c.query("select wait_event_type='Lock' as blocked from pg_stat_activity where pid=$1",[pid]);
  if(rows[0]?.blocked)return;
  await new Promise(r=>setTimeout(r,25));
 }
 throw Error('second_session_did_not_wait_for_real_lock');
};
const outcome=p=>p.then(value=>({value}),error=>({error}));
try{
 // Byte-exact existing management source is restored by rollback. Migration may
 // already have been applied by the outer release job; normalize to its baseline.
 await admin.query(undo);
 const before=(await admin.query("select prosrc from pg_proc where oid='public.manage_minuta_booking_series(uuid,text,text,date,time)'::regprocedure")).rows[0].prosrc;
 await admin.query(apply);await admin.query(apply);await admin.query(undo);
 assert.equal((await admin.query("select prosrc from pg_proc where oid='public.manage_minuta_booking_series(uuid,text,text,date,time)'::regprocedure")).rows[0].prosrc,before);
 await admin.query(apply);
 // Boundary counter replaces only the HTTP transport, not the booking trigger
 // or any slot/payment/tenant/resource logic. Always rolled back.
 await admin.query('begin');
 await admin.query(`create or replace function supabase_functions.http_request() returns trigger language plpgsql as $$
 begin perform set_config('v123.http_calls',(coalesce(nullif(current_setting('v123.http_calls',true),''),'0')::integer+1)::text,true);return new;end $$;`);
 await admin.query(read('tests/booking-concurrency-v123-fixture.sql'));
 await admin.query(read('tests/booking-concurrency-v123-integration.sql'));
 assert.equal((await admin.query("select coalesce(nullif(current_setting('v123.http_calls',true),''),'0')::integer n")).rows[0].n,0);
 await admin.query('rollback');
 console.log('PASS: SQL apply/reapply/rollback, ACL, exact short gap, schedule/break/day-off/shift/resource, idempotency, zero payment/outbox/HTTP');

 // Committed randomly named synthetic fixture is necessary for independent
 // sessions. Both contender calls below invoke the unmodified real RPC.
 await admin.query('begin');
 await admin.query(read('tests/booking-concurrency-v123-fixture.sql'));
 fixture=(await admin.query("select current_setting('v123.actor') actor,current_setting('v123.org') org,current_setting('v123.loc') loc,current_setting('v123.service') service,current_setting('v123.date') date")).rows[0];
 await admin.query('commit');
 const a=await connect(),b=await connect();await actor(a);await actor(b);
 const bpid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const one=randomUUID(),two=randomUUID();
 await a.query('begin');await a.query(blockSQL,args('10:00',one));
 const race=outcome(b.query(blockSQL,args('10:00',two)));
 await awaitBlocked(admin,bpid);await a.query('commit');
 const raced=await race;assert.equal(raced.error?.code,'23P01');assert.equal(raced.error?.message,'block_slot_unavailable');
 assert.equal((await admin.query('select count(*)::integer n from public.bookings where id=any($1::uuid[])',[[one,two]])).rows[0].n,1);
 console.log('PASS: simultaneous distinct block requests produce exactly one booking');

 const replay=randomUUID();await a.query('begin');await a.query(blockSQL,args('11:00',replay));
 const retry=outcome(b.query(blockSQL,args('11:00',replay)));
 await awaitBlocked(admin,bpid);await a.query('commit');
 assert.equal((await retry).value?.rows[0].result.replayed,true);
 console.log('PASS: lost-success same request ID waits, then replays one exact booking');

 // A series consists of real bookings and the original v79 booking-series row.
 // Synthetic sentinel clients suppress all outbound channels during the test.
 const anchor=randomUUID(),tail=randomUUID(),series=randomUUID();
 await a.query(blockSQL,args('12:00',anchor));
 const nextDate=(await admin.query("select ($1::date+7)::text value",[fixture.date])).rows[0].value;
 const tailArgs=args('12:00',tail);tailArgs[3]=nextDate;await a.query(blockSQL,tailArgs);
 await admin.query(`insert into public.booking_series(id,performer_id,service_id,client_name,client_phone,start_date,booking_time,interval_weeks,occurrence_count)
 values($1,$2,$3,'V123 isolated series','0000000000',$4,'12:00',1,2)`,[series,fixture.actor,fixture.service,fixture.date]);
 await admin.query('update public.bookings set series_id=$1,series_occurrence=case when id=$2 then 1 else 2 end where id=any($3::uuid[])',[series,anchor,[anchor,tail]]);
 // Nonzero recorded prepayment is deliberately synthetic, not a payment RPC.
 await admin.query("update public.bookings set deposit_amount_rub=200,payment_status='paid',refund_status='pending' where id=any($1::uuid[])",[[anchor,tail]]);
 await a.query('begin');await a.query(seriesSQL,[anchor,'reschedule','all',fixture.date,'13:00',fixture.date,'12:00']);
 const stale=outcome(b.query(seriesSQL,[anchor,'reschedule','all',fixture.date,'14:00',fixture.date,'12:00']));
 await awaitBlocked(admin,bpid);await a.query('commit');
 const staleResult=await stale;assert.equal(staleResult.error?.code,'40001');assert.equal(staleResult.error?.message,'series_anchor_changed');
 let rows=(await admin.query('select booking_time::text,deposit_amount_rub,payment_status,refund_status from public.bookings where series_id=$1 order by series_occurrence',[series])).rows;
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.booking_time==='13:00:00'&&r.deposit_amount_rub===200&&r.payment_status==='paid'&&r.refund_status==='pending'));
 // Existing API retains last-writer semantics but uses the fresh anchor, so the
 // second move reaches exactly 14:00, not the erroneous compounded 15:00.
 await b.query('select public.manage_minuta_booking_series($1,$2,$3,$4,$5)',[anchor,'reschedule','all',fixture.date,'14:00']);
 rows=(await admin.query('select booking_time::text from public.bookings where series_id=$1',[series])).rows;
 assert.ok(rows.every(r=>r.booking_time==='14:00:00'));
 console.log('PASS: real concurrent expected-coordinate series move rejects stale request; legacy API does not compound; prepayment preserved');
 // Cancellation competes on the same original series/advisory/booking order.
 await a.query('begin');await a.query(seriesSQL,[anchor,'cancel','all',null,null,fixture.date,'14:00']);
 const afterCancel=outcome(b.query(seriesSQL,[anchor,'reschedule','all',fixture.date,'15:00',fixture.date,'14:00']));
 await awaitBlocked(admin,bpid);await a.query('commit');
 assert.ok((await afterCancel).error,'stale cancelled series must reject');
 assert.equal((await admin.query("select count(*)::integer n from public.bookings where series_id=$1 and status='cancelled'",[series])).rows[0].n,2);
 assert.equal((await admin.query('select count(*)::integer n from public.notification_outbox where performer_id=$1',[fixture.actor])).rows[0].n,0);
 console.log('PASS: cancellation-versus-reschedule preserves cancelled series and no sentinel outbox');
}finally{
 for(const c of clients){try{await c.query('rollback');await c.query('reset role');}catch{}}
 if(fixture){
  // Only this run's freshly generated actor/organizations can enter cleanup.
  // Dependency-order retry handles optional schema modules without CASCADE,
  // trigger disabling, or deleting any pre-existing cloned tenant/user.
  await admin.query("select set_config('v123.cleanup_actor',$1,false)",[fixture.actor]);
  await admin.query(`do $$ declare item record; attempts integer; remaining integer; v_actor uuid:=current_setting('v123.cleanup_actor')::uuid; v_orgs uuid[];
   begin
    if not exists(select 1 from public.performer_profiles where id=v_actor and display_name='V123 isolated fixture') then raise exception 'v123_cleanup_identity_mismatch';end if;
    select array_agg(id) into v_orgs from public.organizations where created_by=v_actor or legacy_performer_id=v_actor;
    for attempts in 1..20 loop
     remaining:=0;
     for item in select c.table_name,c.column_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name)
      where c.table_schema='public' and t.table_type='BASE TABLE' and c.column_name in ('organization_id','performer_id')
       and c.data_type='uuid' order by c.table_name loop
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
 for(const c of clients)await c.end();
}
