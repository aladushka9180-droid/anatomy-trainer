// Synthetic local database only. Uses the canonical v64/v162 schema and readers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite');
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const source = read('../supabase-migration-v162.sql');
const oldRpc = read('../supabase-migration-v64.sql');
const migration = read('../recovery/booking-delete-dialog-candidate.sql');
const rollback = read('../recovery/booking-delete-dialog-rollback.sql');
const ddl = name => {
  const match = source.match(new RegExp(`create table if not exists public\\.${name}\\([\\s\\S]*?\\n\\);`));
  assert.ok(match, name); return match[0];
};
const fn = name => {
  const match = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(match, name); return match[0];
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1), stranger=id(2), colleague=id(3), owner=id(4), org=id(5), account=id(6);
const booking=id(10), other=id(11), conversation=id(20), otherConversation=id(21);
const participant=id(30), providerParticipant=id(31);
const db = new PGlite();
const q = async (sql, params=[]) => (await db.query(sql,params)).rows;
const scalar = async (sql,params=[]) => Object.values((await q(sql,params))[0])[0];
const actorAs = user => q("select set_config('test.actor',$1,false)",[user||'']);
const remove = target => scalar('select public.provider_delete_booking($1)',[target]);
const tables = ['bookings','booking_reviews','payments','payment_events',
  'message_conversations_v162','message_participants_v162','conversation_messages_v162',
  'conversation_system_events_v162','message_audit_events_v162','conversation_message_actions_v162'];
async function snapshot(names=tables) {
  const result={};
  for(const name of names) result[name]=await q(`select to_jsonb(t) row from public.${name} t order by id`);
  return JSON.stringify(result);
}
const history = () => snapshot(['conversation_messages_v162','conversation_system_events_v162','message_audit_events_v162']);
async function transaction(test) {
  await db.exec('begin');
  try { await test(); } finally { await db.exec('rollback'); }
}
async function rejectedStatement(action, predicate) {
  await db.exec('savepoint expected_error');
  try { await assert.rejects(action(), predicate); }
  finally { await db.exec('rollback to expected_error; release expected_error'); }
}
let passed=0;
const pass = text => { passed++; console.log(`PASS ${passed}: ${text}`); };
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table organizations(id uuid primary key,status text default 'active');
    create table organization_memberships(organization_id uuid,user_id uuid,role text,active boolean default true);
    create table client_accounts(id uuid primary key);
    create table bookings(id uuid primary key,performer_id uuid,organization_id uuid,client_account_id uuid);
    create table booking_reviews(id uuid primary key,booking_id uuid references bookings on delete cascade);
    create table payments(id uuid primary key,booking_id uuid references bookings on delete restrict);
    create table payment_events(id uuid primary key,payment_id uuid references payments on delete restrict);
    create table booking_events(id bigint primary key,booking_id uuid references bookings on delete set null);
    create table client_identity_sessions_v155(id uuid primary key,claimed_booking_id uuid references bookings on delete cascade);
    create function public.minuta_message_client_identity_v162(text)
      returns table(session_id uuid,client_account_id uuid,organization_id uuid,claimed_booking_id uuid,session_scope text)
      language sql as $$select '${id(50)}'::uuid,'${account}'::uuid,'${org}'::uuid,null::uuid,
        case $1 when 'valid-account' then 'account' else 'none' end$$;
    insert into auth.users values('${actor}'),('${stranger}'),('${colleague}'),('${owner}');
    insert into organizations(id) values('${org}');
    insert into organization_memberships(organization_id,user_id,role) values
      ('${org}','${actor}','specialist'),('${org}','${stranger}','specialist'),
      ('${org}','${colleague}','specialist'),('${org}','${owner}','owner');
    insert into client_accounts values('${account}');
    insert into bookings values('${booking}','${actor}','${org}',null),('${other}','${actor}','${org}',null);
    insert into payments values('${booking}','${booking}');
    insert into payment_events values('${booking}','${booking}');
    insert into booking_events values(1,'${booking}');
  `);
  const messageTables=['message_conversations_v162','message_participants_v162',
    'conversation_messages_v162','conversation_system_events_v162','conversation_message_actions_v162','message_audit_events_v162'];
  for(const table of messageTables) await db.exec(ddl(table));
  for(const name of ['protect_minuta_message_immutable_v162','minuta_message_provider_role_v162',
    'minuta_message_provider_can_access_v162','minuta_message_client_can_access_v162',
    'minuta_message_next_sequence_v162','minuta_message_timeline_core_v162',
    'get_minuta_provider_message_timeline_v162','get_minuta_client_message_timeline_v162']) await db.exec(fn(name));
  for(const table of ['conversation_messages_v162','conversation_system_events_v162','message_audit_events_v162']) {
    await db.exec(`create trigger immutable before update or delete on ${table} for each row execute function protect_minuta_message_immutable_v162()`);
  }
  for(const table of messageTables) await db.exec(`alter table ${table} enable row level security;
    alter table ${table} force row level security; revoke all on ${table} from public,anon,authenticated,service_role;`);
  await db.exec(`
    insert into message_conversations_v162(id,conversation_kind,organization_id,primary_booking_id,next_sequence)
      values('${conversation}','client','${org}','${booking}',2),('${otherConversation}','client','${org}','${other}',0);
    insert into message_participants_v162(id,conversation_id,participant_kind,booking_id,participant_role)
      values('${participant}','${conversation}','booking_client','${booking}','client');
    insert into message_participants_v162(id,conversation_id,participant_kind,user_id,participant_role)
      values('${providerParticipant}','${conversation}','organization_user','${actor}','specialist'),
        ('${id(32)}','${conversation}','organization_user','${colleague}','specialist');
    insert into conversation_messages_v162(id,conversation_id,sequence,sender_participant_id,body,client_request_id,payload_sha256)
      values('${id(40)}','${conversation}',1,'${participant}','Synthetic retained message','${id(41)}',repeat('a',64));
    insert into conversation_system_events_v162(conversation_id,sequence,source_booking_event_id,event_type)
      values('${conversation}',2,1,'booking_created');
    insert into message_audit_events_v162(conversation_id,message_id,actor_kind,actor_ref,event_type)
      values('${conversation}','${id(40)}','client','test-client','message_sent');
  `);
  await actorAs(actor);
  await db.exec(oldRpc);
  const initial=await snapshot();
  await assert.rejects(remove(booking),e=>e.code==='23503'&&e.constraint==='message_conversations_v162_primary_booking_id_fkey');
  assert.equal(await snapshot(),initial);
  pass('original RPC reproduces the confirmed FK refusal and rolls back payment cleanup');

  await db.exec(migration);
  const applied=await snapshot();
  await db.exec(migration);
  assert.equal(await snapshot(),applied);
  assert.equal(await scalar(`select count(*)::int from message_conversations_v162 where deleted_booking_id is not null`),0);
  pass('apply and reapply preserve existing rows; applying migration does not delete bookings');

  const baseline=await snapshot();
  await actorAs(stranger);
  await assert.rejects(remove(booking),e=>e.code==='42501');
  await actorAs(null);
  await assert.rejects(remove(booking),e=>e.code==='42501');
  await actorAs(actor);
  assert.equal(await snapshot(),baseline);
  await transaction(async()=>{
    await q('insert into booking_reviews values($1,$1)',[booking]);
    const before=await snapshot();
    assert.equal(await remove(booking),'review_protected');
    assert.equal(await snapshot(),before);
  });
  pass('anonymous/foreign-owner/review safeguards run before archiving and preserve all rows');

  await transaction(async()=>{
    await db.exec(`create table protected_history(id uuid primary key,booking_id uuid references bookings on delete restrict);
      insert into protected_history values('${booking}','${booking}')`);
    const before=await snapshot();
    await rejectedStatement(()=>remove(booking),e=>e.code==='23503'&&e.constraint==='protected_history_booking_id_fkey');
    assert.equal(await snapshot(),before);
  });
  await transaction(async()=>{
    await q(`insert into conversation_message_actions_v162(id,conversation_id,message_id,booking_id,action_type,
      public_payload,expected_booking_sha256,expires_at) values($1,$2,$3,$4,'propose_time','{}',repeat('a',64),now()+interval '1 day')`,
      [id(45),conversation,id(40),booking]);
    const before=await snapshot();
    await rejectedStatement(()=>remove(booking),e=>e.code==='23503'&&e.constraint==='conversation_message_actions_v162_booking_id_fkey');
    assert.equal(await snapshot(),before);
  });
  pass('unrelated history/action protections remain RESTRICT; their refusal rolls back archives and payments');

  const retainedHistory=await history();
  const retainedOther=JSON.stringify(await q('select * from message_conversations_v162 where id=$1',[otherConversation]));
  const participantAccess=await q('select * from message_participants_v162 where participant_kind=$1 order by id',['organization_user']);
  await db.exec('set role authenticated');
  assert.equal(await remove(booking),'deleted');
  await db.exec('reset role');
  assert.equal(await history(),retainedHistory);
  assert.equal(JSON.stringify(await q('select * from message_conversations_v162 where id=$1',[otherConversation])),retainedOther);
  assert.deepEqual(await q('select * from message_participants_v162 where participant_kind=$1 order by id',['organization_user']),participantAccess);
  assert.equal(await scalar('select count(*)::int from bookings where id=$1',[booking]),0);
  assert.equal(await scalar('select count(*)::int from bookings where id=$1',[other]),1);
  assert.equal(await scalar('select count(*)::int from payments'),0);
  const archived=(await q('select * from message_conversations_v162 where id=$1',[conversation]))[0];
  assert.equal(archived.primary_booking_id,null); assert.equal(archived.deleted_booking_id,booking);
  assert.equal(archived.state,'closed'); assert.ok(archived.closed_at);
  const archivedParticipant=(await q('select * from message_participants_v162 where id=$1',[participant]))[0];
  assert.equal(archivedParticipant.booking_id,null); assert.equal(archivedParticipant.deleted_booking_id,booking);
  assert.equal(archivedParticipant.active,false); assert.ok(archivedParticipant.left_at);
  assert.equal(await remove(booking),'not_found');
  pass('authenticated owner deletes only target; immutable history/authors/provider participants/other booking remain; retry is idempotent');

  for(const who of [actor,colleague,owner]) {
    await actorAs(who);
    const timeline=await scalar('select public.get_minuta_provider_message_timeline_v162($1)',[conversation]);
    assert.equal(timeline.items.length,2); assert.equal(timeline.items[0].body,'Synthetic retained message');
  }
  await actorAs(stranger);
  await assert.rejects(q('select public.get_minuta_provider_message_timeline_v162($1)',[conversation]),e=>e.code==='42501');
  await actorAs(actor);
  await assert.rejects(q('select public.minuta_message_next_sequence_v162($1)',[conversation]),/conversation_unavailable/);
  await transaction(async()=>{
    await q('update message_conversations_v162 set client_account_id=$1 where id=$2',[account,conversation]);
    const timeline=await scalar('select get_minuta_client_message_timeline_v162($1,$2)',['valid-account',conversation]);
    assert.equal(timeline.items.length,2);
    await assert.rejects(q('select get_minuta_client_message_timeline_v162($1,$2)',['invalid-account',conversation]),e=>e.code==='42501');
  });
  pass('unchanged timeline/ACL functions retain owner, assigned specialist and account-client history; unrelated staff denied; closed dialog cannot send');

  for(const role of ['anon','authenticated','service_role']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(q('select * from message_conversations_v162'),e=>e.code==='42501');
    await assert.rejects(q('update message_participants_v162 set active=true'),e=>e.code==='42501');
    if(role!=='authenticated') await assert.rejects(remove(other),e=>e.code==='42501');
    await db.exec('reset role');
  }
  await assert.rejects(q('delete from conversation_messages_v162'),/message_history_is_immutable/);
  await assert.rejects(q('update message_conversations_v162 set state=$1 where id=$2',['open',conversation]),e=>e.code==='23514');
  await assert.rejects(q('update message_participants_v162 set active=true,left_at=null where id=$1',[participant]),e=>e.code==='23514');
  pass('RLS/grants/history immutability remain; archived client conversation/participant cannot be reopened');

  const beforeRollback=await snapshot();
  await db.exec(rollback); await db.exec(rollback);
  assert.equal(await snapshot(),beforeRollback);
  await assert.rejects(remove(other),e=>e.code==='23503');
  assert.equal(await snapshot(),beforeRollback);
  await db.exec(migration);
  assert.equal(await remove(other),'deleted');
  assert.equal(await history(),retainedHistory);
  pass('rollback after actual synthetic deletion preserves archives; old refusal returns; reapply restores fix');

  // Existing writer shape is still accepted during mixed-version operation.
  await q('insert into bookings values($1,$2,$3,null)',[id(90),actor,org]);
  await q(`insert into message_conversations_v162(id,conversation_kind,organization_id,primary_booking_id)
    values($1,'support',$2,$3)`,[id(91),org,id(90)]);
  await q(`insert into message_participants_v162(id,conversation_id,participant_kind,booking_id,participant_role)
    values($1,$2,'booking_client',$3,'client')`,[id(92),id(91),id(90)]);
  assert.equal(await remove(id(90)),'deleted');
  assert.equal(await scalar('select state from message_conversations_v162 where id=$1',[id(91)]),'open');
  pass('legacy insert columns remain compatible; associated support conversation is retained without closing support');
  console.log(`All ${passed} isolated PostgreSQL/PGlite scenarios passed. Full-schema/concurrency/release checks are separate.`);
} catch(error) {
  console.error(JSON.stringify({error:error.message,code:error.code,constraint:error.constraint,where:error.where,query:error.query}));
  process.exitCode=1;
} finally { await db.close(); }
