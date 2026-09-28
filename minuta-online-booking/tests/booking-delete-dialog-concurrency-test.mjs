// Native multi-connection PostgreSQL. ONLY the empty, temporary schema-only clone.
// Rows commit here to make races real; the CI service is discarded afterwards.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const endpoint=new URL(process.env.MINUTA_TEST_DATABASE_URL);
assert.equal(process.env.MINUTA_DELETE_EPHEMERAL_CONFIRM,'SCHEMA_ONLY_EMPTY_DATABASE');
assert.ok(['127.0.0.1','localhost'].includes(endpoint.hostname));
assert.equal(endpoint.pathname,'/eldion-delete-fixture');
assert.equal(process.env.MINUTA_TEST_PROJECT_REF,'eldion-delete-fixture');
assert.notEqual(process.env.MINUTA_PRODUCTION_PROJECT_REF,process.env.MINUTA_TEST_PROJECT_REF);
const pg=await import(process.env.MINUTA_PG_MODULE?pathToFileURL(process.env.MINUTA_PG_MODULE).href:'pg');
const Client=pg.Client||pg.default?.Client;
const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const clients=[];
async function connect(actor) {
  const client=new Client({connectionString:endpoint.href,application_name:'eldion-delete-race'});
  await client.connect(); clients.push(client);
  await client.query("set statement_timeout='15s'; set lock_timeout='12s'");
  if(actor) {
    await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    await client.query('set role authenticated');
  }
  return client;
}
const one=async(client,sql,params=[])=>Object.values((await client.query(sql,params)).rows[0])[0];
const remove=(client,booking)=>one(client,'select public.provider_delete_booking($1)',[booking]);
const send=(client,conversation,body)=>one(client,'select public.send_minuta_provider_message_v162($1,$2,$3)',[conversation,randomUUID(),body]);
const pending=promise=>{
  const state={settled:false};
  state.result=promise.then(value=>{state.settled=true;return {value};},error=>{state.settled=true;return {error};});
  return state;
};
const admin=await connect();
async function blocked(pid,state) {
  const until=Date.now()+4000;
  while(Date.now()<until) {
    assert.equal(state.settled,false,'second request must actually overlap the first transaction');
    const waiting=await one(admin,"select coalesce((select wait_event_type='Lock' from pg_stat_activity where pid=$1),false)",[pid]);
    if(waiting)return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.fail('expected a real concurrent PostgreSQL lock wait');
}
let fixture;
try {
  assert.equal(await one(admin,"select current_database()"),'eldion-delete-fixture');
  assert.equal(await one(admin,"select count(*)::int from minuta_migration_guard.target where project_ref='eldion-delete-fixture' and allow_migrations"),1);
  for(const table of ['bookings','message_conversations_v162','conversation_messages_v162','client_identity_sessions_v155'])
    assert.equal(await one(admin,`select count(*)::int from public.${table}`),0,'clone must contain no source/client rows');
  await admin.query(read('recovery/booking-delete-dialog-candidate.sql'));
  await admin.query('begin');
  await admin.query(read('tests/booking-concurrency-v123-fixture.sql'));
  fixture=(await admin.query(`select current_setting('v123.actor') actor,current_setting('v123.org') org,
    current_setting('v123.loc') loc,current_setting('v123.service') service,current_setting('v123.date') date`)).rows[0];
  await admin.query("select set_config('minuta.booking_organization',$1,true),set_config('minuta.booking_location',$2,true)",[fixture.org,fixture.loc]);
  await admin.query('insert into public.message_center_settings_v162(organization_id,client_chat_enabled) values($1,true)',[fixture.org]);
  const bookings=[],conversations=[];
  for(const [index,time] of ['09:00','11:00','13:00','15:00','17:00'].entries()) {
    const booking=randomUUID(); bookings.push(booking);
    await admin.query(`insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,
      client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,
      status,deposit_amount_rub,payment_status,payment_url,booking_policy_snapshot)
      values($1,$2,$3,$4,$5,'Synthetic race fixture','79990000001',$6,$7,60,1000,1000,
      'confirmed',0,'not_required','','{}')`,
      [booking,booking.replaceAll('-','').slice(0,10).toUpperCase(),randomUUID(),fixture.actor,fixture.service,fixture.date,time]);
    if(index===3) {conversations.push(null);continue;}
    const opened=await one(admin,'select public.open_minuta_provider_conversation_v162($1,$2,$3)',[fixture.org,booking,randomUUID()]);
    conversations.push(opened.conversation_id);
    await send(admin,opened.conversation_id,'original retained message');
  }
  await admin.query('commit');
  const first=await connect(fixture.actor),second=await connect(fixture.actor);
  const secondPid=await one(second,'select pg_backend_pid()');

  // Delete obtains the conversation lock first: concurrent send cannot append.
  await first.query('begin');
  assert.equal(await remove(first,bookings[0]),'deleted');
  const losingSend=pending(send(second,conversations[0],'must not be appended'));
  await blocked(secondPid,losingSend);
  await first.query('commit');
  assert.equal((await losingSend.result).error?.message,'conversation_unavailable');
  assert.equal(await one(admin,'select count(*)::int from public.conversation_messages_v162 where conversation_id=$1',[conversations[0]]),1);
  console.log('PASS: deletion first blocks concurrent send; original history survives and no new message is appended');

  // Send holds the conversation lock first: delete waits and preserves that message.
  await first.query('begin');
  const accepted=await send(first,conversations[1],'accepted before deletion');
  const waitingDelete=pending(remove(second,bookings[1]));
  await blocked(secondPid,waitingDelete);
  await first.query('commit');
  assert.equal((await waitingDelete.result).value,'deleted');
  assert.equal(await one(admin,'select body from public.conversation_messages_v162 where id=$1',[accepted.message_id]),'accepted before deletion');
  assert.equal(await one(admin,'select count(*)::int from public.conversation_messages_v162 where conversation_id=$1',[conversations[1]]),2);
  console.log('PASS: send first commits before deletion; both immutable messages and their authors survive');

  // Two deletes do not repeat side effects after a lost response / duplicate click.
  await first.query('begin');
  assert.equal(await remove(first,bookings[2]),'deleted');
  const duplicate=pending(remove(second,bookings[2]));
  await blocked(secondPid,duplicate);
  await first.query('commit');
  assert.equal((await duplicate.result).value,'not_found');
  console.log('PASS: concurrent duplicate deletion returns deleted/not_found without duplicate side effects');

  // A new conversation must not outlive the booking it tries to reference.
  await first.query('begin');
  assert.equal(await remove(first,bookings[3]),'deleted');
  const createLink=pending(one(second,'select public.open_minuta_provider_conversation_v162($1,$2,$3)',[fixture.org,bookings[3],randomUUID()]));
  await blocked(secondPid,createLink);
  await first.query('commit');
  assert.equal((await createLink.result).error?.code,'23503');
  assert.equal(await one(admin,'select count(*)::int from public.message_conversations_v162 where primary_booking_id=$1',[bookings[3]]),0);
  assert.equal(await one(admin,'select count(*)::int from public.bookings where id=$1',[bookings[4]]),1);
  assert.equal(await one(admin,'select state from public.message_conversations_v162 where id=$1',[conversations[4]]),'open');
  for(const conversation of conversations.slice(0,3)) {
    const timeline=await one(first,'select public.get_minuta_provider_message_timeline_v162($1)',[conversation]);
    assert.ok(timeline.items.some(item=>item.body==='original retained message'));
  }
  console.log('PASS: concurrent new link is refused atomically; unrelated booking stays open and archived timelines remain readable');
} catch(error) {
  console.error(JSON.stringify({error:error.message,code:error.code,constraint:error.constraint}));
  process.exitCode=1;
} finally {
  for(const client of clients) {try {await client.query('rollback');}catch{} }
  for(const client of clients) await client.end();
  console.log('Only synthetic rows exist in the disposable CI clone; no shared test data is truncated or deleted.');
}
