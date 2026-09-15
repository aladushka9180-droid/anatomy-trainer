// Real multi-connection PostgreSQL only; migration-config-guard rejects production.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=new URL('../',import.meta.url);
execFileSync(process.execPath,[fileURLToPath(new URL('scripts/migration-config-guard.mjs',root))],{stdio:'inherit'});
const pg=await import(process.env.MINUTA_PG_MODULE?pathToFileURL(process.env.MINUTA_PG_MODULE).href:'pg');
const Client=pg.Client||pg.default?.Client;
assert.equal(typeof Client,'function');
const tls=process.env.MINUTA_TEST_PG_TLS_NO_VERIFY==='MIGRATION_TEST_ONLY'?{rejectUnauthorized:false}:undefined;
const clients=[];
const connect=async()=>{const c=new Client({connectionString:process.env.MINUTA_TEST_DATABASE_URL,
  application_name:'minuta-v162-message-concurrency',...(tls?{ssl:tls}:{})});await c.connect();clients.push(c);
  await c.query("set statement_timeout='30s'; set lock_timeout='20s'");return c;};
const sha256=value=>createHash('sha256').update(value).digest('hex');
const admin=await connect();let fixture;
try{
  await admin.query('begin');
  await admin.query(readFileSync(new URL('tests/booking-concurrency-v123-fixture.sql',root),'utf8'));
  fixture=(await admin.query("select current_setting('v123.actor') actor,current_setting('v123.org') org")).rows[0];
  fixture.loc=(await admin.query("select current_setting('v123.loc') value")).rows[0].value;
  fixture.service=(await admin.query("select current_setting('v123.service') value")).rows[0].value;
  fixture.date=(await admin.query("select current_setting('v123.date') value")).rows[0].value;
  const conversation=randomUUID(),participant=randomUUID();
  await admin.query(`insert into public.message_center_settings_v162(organization_id,support_enabled,updated_by)
    values($1,true,$2)`,[fixture.org,fixture.actor]);
  await admin.query(`insert into public.message_conversations_v162(id,conversation_kind,organization_id,subject)
    values($1,'support',$2,'v162 concurrency')`,[conversation,fixture.org]);
  await admin.query(`insert into public.message_participants_v162
    (id,conversation_id,participant_kind,user_id,participant_role) values($1,$2,'support_user',$3,'support')`,
    [participant,conversation,fixture.actor]);
  const account=randomUUID(),clientConversation=randomUUID(),clientParticipant=randomUUID(),providerParticipant=randomUUID();
  const actionMessage=randomUUID(),action=randomUUID(),sessionToken=randomBytes(32).toString('hex');
  fixture.account=account;fixture.sessionToken=sessionToken;
  await admin.query('insert into public.client_accounts(id,normalized_phone,access_code_hash) values($1,$2,$3)',
    [account,`7999${randomInt(0,10_000_000).toString().padStart(7,'0')}`,sha256(randomBytes(32))]);
  const code=(await admin.query('select public.provider_book_appointment($1,$2,$3,$4,$5) code',
    [fixture.service,fixture.date,'10:00','V162 confirmation client','0000000000'])).rows[0].code;
  fixture.booking=(await admin.query('select id from public.bookings where booking_code=$1',[code])).rows[0].id;
  await admin.query('update public.bookings set organization_id=$2,location_id=$3,client_account_id=$4,client_phone=$5 where id=$1',
    [fixture.booking,fixture.org,fixture.loc,account,'79990000160']);
  await admin.query(`insert into public.client_identity_sessions_v155(client_account_id,token_hash,session_scope,session_source,expires_at)
    values($1,$2,'account','legacy_upgrade',now()+interval '1 day')`,[account,sha256(sessionToken)]);
  await admin.query(`insert into public.message_conversations_v162(id,conversation_kind,organization_id,primary_booking_id,client_account_id,next_sequence)
    values($1,'client',$2,$3,$4,1)`,[clientConversation,fixture.org,fixture.booking,account]);
  await admin.query(`insert into public.message_participants_v162(id,conversation_id,participant_kind,client_account_id,participant_role)
    values($1,$2,'client_account',$3,'client')`,[clientParticipant,clientConversation,account]);
  await admin.query(`insert into public.message_participants_v162(id,conversation_id,participant_kind,user_id,participant_role)
    values($1,$2,'organization_user',$3,'specialist')`,[providerParticipant,clientConversation,fixture.actor]);
  await admin.query(`insert into public.conversation_messages_v162(id,conversation_id,sequence,sender_participant_id,message_kind,client_request_id,payload_sha256)
    values($1,$2,1,$3,'action',$4,$5)`,[actionMessage,clientConversation,providerParticipant,randomUUID(),sha256('action')]);
  await admin.query(`insert into public.conversation_message_actions_v162(id,conversation_id,message_id,booking_id,action_type,public_payload,expected_booking_sha256,expires_at)
    select $1,$2,$3,$4,'propose_time',jsonb_build_object('target_date',$5::date,'target_time','11:00'),
      public.minuta_message_booking_sha256_v162(booking),now()+interval '1 day' from public.bookings booking where booking.id=$4`,
    [action,clientConversation,actionMessage,fixture.booking,fixture.date]);
  fixture.action=action;
  const otherCode=(await admin.query('select public.provider_book_appointment($1,$2,$3,$4,$5) code',
    [fixture.service,fixture.date,'12:00','V162 same-account isolation','0000000000'])).rows[0].code;
  fixture.otherBooking=(await admin.query('select id from public.bookings where booking_code=$1',[otherCode])).rows[0].id;
  await admin.query('update public.bookings set organization_id=$2,location_id=$3,client_account_id=$4,client_phone=$5 where id=$1',
    [fixture.otherBooking,fixture.org,fixture.loc,account,'79990000160']);
  assert.equal((await admin.query('select count(*)::int n from public.conversation_system_events_v162 where conversation_id=$1',[clientConversation])).rows[0].n,0,
    'same-account booking event leaked into another booking conversation');
  await admin.query('commit');
  const first=await connect(),second=await connect();
  const request=randomUUID(),actorKey=`support:${fixture.actor}`,body='lost ACK replay';
  const sql='select public.minuta_send_message_core_v162($1,$2,$3,$4,$5,$6) result';
  const args=[conversation,participant,'support',actorKey,request,body];
  const [a,b]=await Promise.all([first.query(sql,args),second.query(sql,args)]);
  const results=[a.rows[0].result,b.rows[0].result];
  assert.equal(results[0].message_id,results[1].message_id);
  assert.equal(results[0].sequence,1);assert.equal(results[1].sequence,1);
  assert.equal(results[0].client_request_id,request);assert.equal(results[0].body,body);
  assert.equal((await admin.query('select count(*)::int n from public.conversation_messages_v162 where conversation_id=$1',[conversation])).rows[0].n,1);
  assert.equal((await admin.query('select next_sequence from public.message_conversations_v162 where id=$1',[conversation])).rows[0].next_sequence,'1');
  const distinct=await Promise.all([randomUUID(),randomUUID()].map((id,i)=>
    [first,second][i].query(sql,[conversation,participant,'support',actorKey,id,`message ${i}`])));
  assert.deepEqual(distinct.map(x=>Number(x.rows[0].result.sequence)).sort((x,y)=>x-y),[2,3]);
  const prepareRequest=randomUUID();
  const prepareSql='select public.prepare_minuta_message_action_v162($1,$2,$3) result';
  const [preparedA,preparedB]=await Promise.all([first.query(prepareSql,[sessionToken,action,prepareRequest]),
    second.query(prepareSql,[sessionToken,action,prepareRequest])]);
  assert.equal(preparedA.rows[0].result.confirmation_token,preparedB.rows[0].result.confirmation_token);
  assert.equal(preparedA.rows[0].result.expires_at,preparedB.rows[0].result.expires_at);
  assert.equal((await admin.query('select count(*)::int n from public.message_action_confirmations_v162 where action_id=$1',[action])).rows[0].n,1);
  console.log('PASS: v162 concurrent send serializes lost-ACK replay and allocates unique sequences');
} finally {
  for(const c of clients){try{await c.query('rollback');await c.query('reset role');}catch{}}
  if(fixture?.actor){
    await admin.query('begin');
    await admin.query('set local session_replication_role=replica');
    await admin.query(`truncate table
      public.message_action_confirmations_v162,public.message_read_receipts_v162,public.message_attachments_v162,
      public.conversation_message_actions_v162,public.conversation_system_events_v162,public.conversation_messages_v162,
      public.message_participants_v162,public.message_support_requests_v162,public.message_idempotency_receipts_v162,
      public.message_audit_events_v162,public.message_conversations_v162,public.message_support_agents_v162,
      public.message_center_settings_v162 restart identity cascade`);
    await admin.query('delete from public.client_identity_sessions_v155 where token_hash=$1',[sha256(fixture.sessionToken)]);
    await admin.query("select set_config('v162.cleanup_actor',$1,true),set_config('v162.cleanup_org',$2,true)",[fixture.actor,fixture.org]);
    await admin.query(`do $$ declare item record;v_actor uuid:=current_setting('v162.cleanup_actor')::uuid;
      v_org uuid:=current_setting('v162.cleanup_org')::uuid;begin
      for item in select c.table_name,c.column_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name)
        where c.table_schema='public' and t.table_type='BASE TABLE' and c.column_name in('organization_id','performer_id')
          and c.table_name not like '%\_v162' escape '\' order by c.table_name loop
        begin execute format('delete from public.%I where %I=$1',item.table_name,item.column_name) using case when item.column_name='organization_id' then v_org else v_actor end;
        exception when foreign_key_violation then null;end;
      end loop;
      delete from public.organizations where id=v_org;delete from public.performer_profiles where id=v_actor;delete from auth.users where id=v_actor;
    end $$`);
    await admin.query('delete from public.client_accounts where id=$1',[fixture.account]);
    await admin.query('commit');
  }
  for(const c of clients)await c.end();
}
