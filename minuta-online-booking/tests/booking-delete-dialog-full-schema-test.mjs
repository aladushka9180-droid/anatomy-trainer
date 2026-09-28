// Isolated existing full schema only. Every fixture and schema change rolls back.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=new URL('../',import.meta.url);
const endpoint=new URL(process.env.MINUTA_TEST_DATABASE_URL);
assert.equal(process.env.MINUTA_DELETE_EPHEMERAL_CONFIRM,'SCHEMA_ONLY_EMPTY_DATABASE');
assert.ok(['127.0.0.1','localhost'].includes(endpoint.hostname));
assert.equal(endpoint.pathname,'/eldion-delete-fixture');
execFileSync(process.execPath,[fileURLToPath(new URL('scripts/migration-config-guard.mjs',root))],{stdio:'inherit'});
const pg=await import(process.env.MINUTA_PG_MODULE?pathToFileURL(process.env.MINUTA_PG_MODULE).href:'pg');
const Client=pg.Client||pg.default?.Client;
const db=new Client({connectionString:process.env.MINUTA_TEST_DATABASE_URL,
  application_name:'eldion-booking-delete-dialog-isolated-test'});
await db.connect();
const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
const one=async(sql,params=[]) => Object.values((await q(sql,params))[0])[0];
const read=name=>readFileSync(new URL(name,root),'utf8').replace(/\r\n/g,'\n');
function transactionalBody(name) {
  const sql=read(name);
  assert.equal((sql.match(/^begin;$/gm)||[]).length,1);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
  return sql.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
}
const apply=()=>db.query(transactionalBody('recovery/booking-delete-dialog-candidate.sql'));
const revert=()=>db.query(transactionalBody('recovery/booking-delete-dialog-rollback.sql'));
const remove=booking=>one('select public.provider_delete_booking($1)',[booking]);
async function rejected(action,predicate) {
  await db.query('savepoint expected_error');
  try { await assert.rejects(action(),predicate); }
  finally { await db.query('rollback to expected_error; release expected_error'); }
}
let initialDefinition;
try {
  await db.query("begin; set local statement_timeout='90s'; set local lock_timeout='5s'");
  const guard=await one(`select count(*)::int from minuta_migration_guard.target
    where project_ref=$1 and allow_migrations is true`,[process.env.MINUTA_TEST_PROJECT_REF]);
  assert.equal(guard,1,'must match the isolated database marker');
  initialDefinition=await one("select pg_get_functiondef('public.provider_delete_booking(uuid)'::regprocedure)");
  await db.query(read('tests/booking-concurrency-v123-fixture.sql'));
  const fixture=(await q(`select current_setting('v123.actor') actor,current_setting('v123.org') org,
    current_setting('v123.loc') loc,current_setting('v123.service') service,current_setting('v123.date') date`))[0];
  const target=randomUUID(),other=randomUUID();
  await db.query("select set_config('minuta.booking_organization',$1,true),set_config('minuta.booking_location',$2,true)",[fixture.org,fixture.loc]);
  for(const [booking,time] of [[target,'15:00'],[other,'17:00']]) {
    await db.query(`insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,
      client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,
      status,deposit_amount_rub,payment_status,payment_url,booking_policy_snapshot)
      values($1,$2,$3,$4,$5,'Synthetic delete fixture','79990000001',$6,$7,60,1000,1000,
        'confirmed',0,'not_required','','{}')`,
      [booking,booking.replaceAll('-','').slice(0,10).toUpperCase(),randomUUID(),fixture.actor,fixture.service,fixture.date,time]);
  }
  const guestToken=randomBytes(32).toString('hex'),accountToken=randomBytes(32).toString('hex');
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const account=randomUUID();
  await db.query(`insert into public.client_accounts(id,normalized_phone,access_code_hash)
    values($1,$2,$3)`,[account,'7999'+String(Number.parseInt(randomBytes(3).toString('hex'),16)%10000000).padStart(7,'0'),hash(randomBytes(32))]);
  await db.query('update public.bookings set client_account_id=$1 where id=$2',[account,other]);
  await db.query(`insert into public.client_identity_sessions_v155(claimed_booking_id,token_hash,session_scope,session_source,expires_at)
    values($1,$2,'booking','manage_token',now()+interval '1 day')`,[target,hash(guestToken)]);
  await db.query(`insert into public.client_identity_sessions_v155(client_account_id,token_hash,session_scope,session_source,expires_at)
    values($1,$2,'account','legacy_upgrade',now()+interval '1 day')`,[account,hash(accountToken)]);
  await db.query(`insert into public.message_center_settings_v162(organization_id,client_chat_enabled)
    values($1,true) on conflict(organization_id) do update set client_chat_enabled=true`,[fixture.org]);
  const conversations=[];
  for(const booking of [target,other]) {
    const opened=await one('select public.open_minuta_provider_conversation_v162($1,$2,$3)',[fixture.org,booking,randomUUID()]);
    assert.ok(opened.conversation_id,'real open-conversation RPC must return an identifier');
    conversations.push(opened.conversation_id);
    await one('select public.send_minuta_provider_message_v162($1,$2,$3)',[opened.conversation_id,randomUUID(),'Synthetic retained history']);
  }
  const [conversation,otherConversation]=conversations;
  assert.equal((await one('select public.get_minuta_client_message_timeline_v162($1,$2)',[guestToken,conversation])).items.length,1);
  const snapshot=async()=>JSON.stringify(await q(`select
    (select jsonb_agg(to_jsonb(m) order by m.id) from public.conversation_messages_v162 m where conversation_id=$1) messages,
    (select jsonb_agg(to_jsonb(e) order by e.id) from public.conversation_system_events_v162 e where conversation_id=$1) events,
    (select jsonb_agg(to_jsonb(a) order by a.id) from public.message_audit_events_v162 a where conversation_id=$1) audit`,[conversation]));
  const history=await snapshot();
  await rejected(()=>remove(target),e=>e.code==='23503'&&['message_conversations_v162_primary_booking_id_fkey','message_participants_v162_booking_id_fkey'].includes(e.constraint));
  await apply(); await apply();
  const otherBefore=JSON.stringify(await q('select to_jsonb(b) booking from public.bookings b where id=$1',[other]));
  await db.query('set local role authenticated');
  assert.equal(await remove(target),'deleted');
  assert.equal(await remove(target),'not_found');
  const timeline=await one('select public.get_minuta_provider_message_timeline_v162($1)',[conversation]);
  assert.ok(timeline.items.some(item=>item.body==='Synthetic retained history'));
  await rejected(()=>one('select public.send_minuta_provider_message_v162($1,$2,$3)',[conversation,randomUUID(),'must not send']),e=>e.message==='conversation_unavailable');
  await db.query('reset role');
  assert.equal(await snapshot(),history);
  assert.equal(JSON.stringify(await q('select to_jsonb(b) booking from public.bookings b where id=$1',[other])),otherBefore);
  assert.equal(await one('select count(*)::int from public.bookings where id=$1',[target]),0);
  assert.equal(await one('select count(*)::int from public.resolve_client_identity_session_v155($1)',[guestToken]),0);
  await rejected(()=>one('select public.get_minuta_client_message_timeline_v162($1,$2)',[guestToken,conversation]),e=>e.code==='42501');
  assert.equal(await one('select state from public.message_conversations_v162 where id=$1',[otherConversation]),'open');
  await revert();
  assert.equal(await one("select pg_get_functiondef('public.provider_delete_booking(uuid)'::regprocedure)"),initialDefinition);
  assert.equal(await snapshot(),history);
  await rejected(()=>remove(other),e=>e.code==='23503');
  await apply();
  assert.equal(await remove(other),'deleted');
  assert.equal(await snapshot(),history);
  assert.ok((await one('select public.get_minuta_client_message_timeline_v162($1,$2)',[accountToken,otherConversation])).items.some(item=>item.body==='Synthetic retained history'));
  console.log('PASS: full-schema original failure, apply/reapply, authenticated deletion, history/readers, unrelated booking, rollback/reapply; guest session ends, account session retains history');
} catch(error) {
  console.error(JSON.stringify({error:error.message,code:error.code,constraint:error.constraint}));
  process.exitCode=1;
} finally {
  try {
    await db.query('rollback');
    if(initialDefinition) assert.equal(await one("select pg_get_functiondef('public.provider_delete_booking(uuid)'::regprocedure)"),initialDefinition);
    console.log('Rolled back all synthetic rows and schema changes; production was not connected.');
  } finally { await db.end(); }
}
