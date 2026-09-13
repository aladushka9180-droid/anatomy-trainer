// Real multi-connection PostgreSQL only; the standard guard rejects production.
// npm install --no-save pg; node tests/client-identity-v155-postgres-concurrency-test.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
execFileSync(process.execPath, [fileURLToPath(new URL('scripts/migration-config-guard.mjs', root))], { stdio:'inherit' });
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
assert.equal(typeof Client, 'function', 'PostgreSQL Client constructor unavailable');

const migration = readFileSync(new URL('supabase-migration-v155.sql', root), 'utf8');
const rollback = readFileSync(new URL('supabase-migration-v155-rollback.sql', root), 'utf8');
assert.match(migration, /hashtextextended\('booking-request:'\|\|p_request_id::text,0\)/);
const functionBody = name => {
  const start = migration.toLowerCase().indexOf(`create or replace function public.${name.toLowerCase()}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = migration.indexOf('as $$', start) + 5;
  const bodyEnd = migration.indexOf('$$;', bodyStart);
  assert.ok(bodyStart >= 5 && bodyEnd > bodyStart, `invalid function body ${name}`);
  return migration.slice(bodyStart, bodyEnd);
};
const initialClaimLookup = body => {
  const start = body.indexOf('select grant_row.*');
  const end = body.indexOf(';', start);
  assert.ok(start >= 0 && end > start, 'sale claim token lookup missing');
  return body.slice(start, end);
};
const inspectSaleClaim = functionBody('inspect_client_identity_sale_claim_v155');
const consumeSaleClaim = functionBody('consume_client_identity_sale_claim_v155');
const issueBookingClaim = functionBody('issue_client_identity_claim_grant_v155');
const issueSaleClaim = functionBody('issue_client_identity_sale_claim_v155');
assert.equal(issueSaleClaim.match(/v_token:=upper\(substr\(encode\(extensions\.digest\(/g)?.length, 3,
  'sale claim initial, replay and reissue paths must generate uppercase tokens');
for (const lookup of [initialClaimLookup(inspectSaleClaim), initialClaimLookup(consumeSaleClaim)]) {
  assert.match(lookup, /token_hash/);
  assert.doesNotMatch(lookup, /request_id\s*=\s*p_request_id/);
}
for (const [label, claimBody] of [
  ['inspect', inspectSaleClaim],
  ['consume', consumeSaleClaim]
]) {
  assert.match(claimBody,
    /v_claim_normalized text:=replace\(upper\(btrim\(coalesce\(p_claim_token,''\)\)\),'-',''\)/,
  `${label} must hash the uppercase no-dash normalized token`);
  assert.match(claimBody,
    /if btrim\(coalesce\(p_claim_token,''\)\)!~'\^PTS1-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}\$'/,
  `${label} must reject lowercase before normalized hashing`);
  assert.doesNotMatch(claimBody, /if upper\(btrim\(coalesce\(p_claim_token,''\)\)\)!~/);
}
assert.match(consumeSaleClaim, /v_grant\.consume_request_id is distinct from p_request_id/);
assert.match(consumeSaleClaim, /consume_request_id=p_request_id/);
const bookingAccountLock = issueBookingClaim.indexOf(
  "pg_advisory_xact_lock(pg_catalog.hashtextextended('client-account:'||v_phone,0))"
);
const bookingSubjectLock = issueBookingClaim.indexOf(
  "pg_advisory_xact_lock(pg_catalog.hashtextextended(\n    'client-identity-booking:'||p_organization::text||':'||p_booking::text,0))"
);
const bookingRowLock = issueBookingClaim.indexOf('select booking.* into v_booking');
assert.ok(bookingAccountLock >= 0, 'booking enrollment account advisory lock missing');
assert.ok(bookingSubjectLock > bookingAccountLock, 'booking subject advisory must follow account advisory');
assert.ok(bookingRowLock > bookingSubjectLock, 'booking row lock must follow account and subject advisories');
const assertSaleSubjectLockOrder = (body, label) => {
  const accountAdvisory = body.indexOf("'client-account:'||v_phone");
  const bookingAdvisory = body.indexOf("'client-identity-booking:'");
  const saleAdvisory = body.indexOf("'client-identity-sale:'");
  const saleRowLock = body.indexOf('select sale.* into v_sale', saleAdvisory);
  const saleForUpdate = body.indexOf('for update;', saleRowLock);
  const grantRowLock = body.indexOf('select grant_row.*', saleForUpdate);
  const grantForUpdate = body.indexOf('for update;', grantRowLock);
  assert.ok(accountAdvisory >= 0 && bookingAdvisory > accountAdvisory
    && saleAdvisory > bookingAdvisory && saleRowLock > saleAdvisory
    && saleForUpdate > saleRowLock && grantRowLock > saleForUpdate
    && grantForUpdate > grantRowLock,
  `${label} must lock account, booking, sale row, then claim grant in canonical order`);
};
const issueRequestAdvisory = issueSaleClaim.indexOf("'client-identity-issue:'||p_request_id::text");
assert.ok(issueRequestAdvisory >= 0
  && issueRequestAdvisory < issueSaleClaim.indexOf("'client-account:'||v_phone"),
  'sale issuance request advisory must precede canonical subject locks');
assertSaleSubjectLockOrder(issueSaleClaim, 'sale issue');
assertSaleSubjectLockOrder(inspectSaleClaim, 'sale inspect');
assertSaleSubjectLockOrder(consumeSaleClaim, 'sale consume');

const clients = [];
const tls = process.env.MINUTA_TEST_PG_TLS_NO_VERIFY === 'MIGRATION_TEST_ONLY'
  ? { rejectUnauthorized:false }
  : undefined;
const connect = async () => {
  const client = new Client({
    connectionString:process.env.MINUTA_TEST_DATABASE_URL,
    application_name:'minuta-v155-client-identity-concurrency-test',
    ...(tls ? { ssl:tls } : {})
  });
  await client.connect();
  clients.push(client);
  await client.query("set statement_timeout='30s'; set lock_timeout='15s'");
  return client;
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const awaitBlocked = async (client, pid) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { rows } = await client.query(
      "select wait_event_type='Lock' as blocked from pg_stat_activity where pid=$1",
      [pid]
    );
    if (rows[0]?.blocked) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('v155_second_booking_rpc_did_not_wait_for_canonical_lock');
};
const smoke = async client => {
  const { rows:[state] } = await client.query(`select
    to_regclass('public.client_identity_sessions_v155') is not null as sessions,
    to_regclass('public.client_identity_booking_requests_v155') is not null as requests,
    to_regprocedure('public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)') is not null as issue_booking_claim,
    to_regprocedure('public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)') is not null as issue_sale_claim,
    to_regprocedure('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)') is not null as rpc,
    to_regprocedure('public.inspect_client_identity_sale_claim_v155(text,uuid)') is not null as inspect_sale_claim,
    to_regprocedure('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer)') is null as legacy_rpc_absent,
    exists(select 1 from pg_attribute attribute_row
      where attribute_row.attrelid='public.client_identity_booking_requests_v155'::regclass
        and attribute_row.attname='benefit_version' and attribute_row.atttypid='integer'::regtype
        and attribute_row.attnotnull and attribute_row.attnum>0 and not attribute_row.attisdropped) as request_benefit_version,
    has_function_privilege('service_role','public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','execute') as service_execute,
    has_function_privilege('anon','public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','execute') as anon_execute,
    has_function_privilege('authenticated','public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','execute') as authenticated_execute,
    has_function_privilege('service_role','public.inspect_client_identity_sale_claim_v155(text,uuid)','execute') as inspect_service_execute,
    has_function_privilege('anon','public.inspect_client_identity_sale_claim_v155(text,uuid)','execute') as inspect_anon_execute,
    has_function_privilege('authenticated','public.inspect_client_identity_sale_claim_v155(text,uuid)','execute') as inspect_authenticated_execute,
    has_function_privilege('authenticated','public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)','execute') as issue_booking_authenticated_execute,
    has_function_privilege('service_role','public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)','execute') as issue_booking_service_execute,
    has_function_privilege('anon','public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)','execute') as issue_booking_anon_execute,
    has_function_privilege('authenticated','public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)','execute') as issue_sale_authenticated_execute,
    has_function_privilege('service_role','public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)','execute') as issue_sale_service_execute,
    has_function_privilege('anon','public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)','execute') as issue_sale_anon_execute,
    position('hashtextextended(''booking-request:''||p_request_id::text,0)' in replace(
      (select procedure_row.prosrc from pg_proc procedure_row
       where procedure_row.oid=to_regprocedure('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)')),
      E'\\r',''))>0 as canonical_lock`);
  assert.deepEqual(state, {
    sessions:true,
    requests:true,
    issue_booking_claim:true,
    issue_sale_claim:true,
    rpc:true,
    inspect_sale_claim:true,
    legacy_rpc_absent:true,
    request_benefit_version:true,
    service_execute:true,
    anon_execute:false,
    authenticated_execute:false,
    inspect_service_execute:true,
    inspect_anon_execute:false,
    inspect_authenticated_execute:false,
    issue_booking_authenticated_execute:true,
    issue_booking_service_execute:true,
    issue_booking_anon_execute:false,
    issue_sale_authenticated_execute:true,
    issue_sale_service_execute:true,
    issue_sale_anon_execute:false,
    canonical_lock:true
  });
};

const ids = {
  actor:randomUUID(),
  org:randomUUID(),
  location:randomUUID(),
  service:randomUUID(),
  account:randomUUID(),
  paymentAccount:randomUUID(),
  visitSale:randomUUID(),
  saleIssueA:randomUUID(),
  saleIssueB:randomUUID(),
  saleConsumer:randomUUID(),
  product:randomUUID(),
  instrument:randomUUID(),
  seedRequest:randomUUID(),
  raceRequest:randomUUID(),
  staleRequest:randomUUID()
};
const slug = `v155-race-${ids.org.replaceAll('-', '')}`;
const normalizedPhone = `7999${randomInt(0, 10_000_000).toString().padStart(7, '0')}`;
const clientPhone = `+${normalizedPhone}`;
const sessionTokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
const sessionHashes = sessionTokens.map(sha256);
const benefitRef = `ptbf_${sha256(`v155-benefit:${ids.instrument}`)}`;
const publicCode = `V155${randomBytes(8).toString('hex')}`.toUpperCase();
const requestRef = sha256(`v155-request:${ids.raceRequest}`);
let saleSessionHash;

let admin;
let fixtureCommitted = false;
let migrationOwned = false;
let hadV155 = false;

const cleanupFixture = async () => {
  await admin.query('begin');
  try {
    await admin.query('set local session_replication_role=replica');
    await admin.query('delete from public.client_identity_audit_v155 where client_account_id=$1', [ids.account]);
    await admin.query('delete from public.client_identity_booking_requests_v155 where request_id=any($1::uuid[])', [[ids.raceRequest, ids.staleRequest]]);
    await admin.query(`delete from public.benefit_audit_log
      where organization_id=$1 and (subject_id in (
        select id from public.benefit_redemptions where instrument_id=$2
      ) or details->>'instrument_id'=$2::text)`, [ids.org, ids.instrument]);
    await admin.query('delete from public.benefit_ledger where instrument_id=$1', [ids.instrument]);
    await admin.query('delete from public.benefit_redemptions where instrument_id=$1', [ids.instrument]);
    await admin.query('delete from public.client_identity_claim_grants_v155 where commercial_sale_id=$1', [ids.visitSale]);
    await admin.query('delete from public.commercial_audit_log where organization_id=$1 and subject_id=$2', [ids.org, ids.visitSale]);
    await admin.query('delete from public.commercial_sales where id=$1', [ids.visitSale]);
    await admin.query('delete from public.financial_accounts where id=$1', [ids.paymentAccount]);
    await admin.query('delete from public.bookings where request_id=any($1::uuid[])', [[ids.seedRequest, ids.raceRequest, ids.staleRequest]]);
    await admin.query('delete from public.client_identity_sessions_v155 where token_hash=any($1::text[])', [
      saleSessionHash ? [...sessionHashes, saleSessionHash] : sessionHashes
    ]);
    await admin.query('delete from public.client_benefit_instruments where id=$1', [ids.instrument]);
    await admin.query('delete from public.benefit_products where id=$1', [ids.product]);
    await admin.query('delete from public.organization_benefit_settings where organization_id=$1', [ids.org]);
    await admin.query('delete from public.provider_schedule where performer_id=$1', [ids.actor]);
    await admin.query('delete from public.services where id=$1', [ids.service]);
    await admin.query('delete from public.organization_memberships where organization_id=$1 and user_id=$2', [ids.org, ids.actor]);
    await admin.query('delete from public.locations where id=$1', [ids.location]);
    await admin.query('delete from public.client_accounts where id=$1', [ids.account]);
    await admin.query('delete from public.organizations where id=$1', [ids.org]);
    await admin.query('delete from public.performer_profiles where id=$1', [ids.actor]);
    await admin.query('delete from auth.users where id=$1', [ids.actor]);
    const { rows:[cleanup] } = await admin.query(`select
      (select count(*) from public.client_identity_audit_v155 where client_account_id=$1)
      +(select count(*) from public.client_identity_booking_requests_v155 where request_id=any($2::uuid[]))
      +(select count(*) from public.benefit_audit_log where organization_id=$3)
      +(select count(*) from public.benefit_ledger where instrument_id=$4)
      +(select count(*) from public.benefit_redemptions where instrument_id=$4)
      +(select count(*) from public.client_identity_claim_grants_v155 where commercial_sale_id=$11)
      +(select count(*) from public.commercial_audit_log where organization_id=$3 and subject_id=$11)
      +(select count(*) from public.commercial_sales where id=$11)
      +(select count(*) from public.financial_accounts where id=$12)
      +(select count(*) from public.bookings where request_id=any($5::uuid[]))
      +(select count(*) from public.client_identity_sessions_v155 where token_hash=any($6::text[]))
      +(select count(*) from public.client_benefit_instruments where id=$4)
      +(select count(*) from public.benefit_products where id=$7)
      +(select count(*) from public.organization_benefit_settings where organization_id=$3)
      +(select count(*) from public.provider_schedule where performer_id=$10)
      +(select count(*) from public.services where id=$8)
      +(select count(*) from public.organization_memberships where organization_id=$3)
      +(select count(*) from public.locations where id=$9)
      +(select count(*) from public.client_accounts where id=$1)
      +(select count(*) from public.organizations where id=$3)
      +(select count(*) from public.performer_profiles where id=$10)
      +(select count(*) from auth.users where id=$10) as remaining`, [
      ids.account, [ids.raceRequest, ids.staleRequest], ids.org, ids.instrument,
      [ids.seedRequest, ids.raceRequest, ids.staleRequest],
      saleSessionHash ? [...sessionHashes, saleSessionHash] : sessionHashes,
      ids.product, ids.service, ids.location, ids.actor, ids.visitSale, ids.paymentAccount
    ]);
    assert.equal(Number(cleanup.remaining), 0, 'v155_exact_fixture_cleanup_incomplete');
    await admin.query('commit');
    fixtureCommitted = false;
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
};

const createFixture = async () => {
  await admin.query('begin');
  try {
    await admin.query('set local session_replication_role=replica');
    await admin.query(`insert into auth.users(
      id,instance_id,aud,role,email,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at
    ) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      $2,now(),'{}','{}',now(),now())`, [ids.actor, `${ids.actor}@example.invalid`]);
    await admin.query('set local session_replication_role=origin');
    await admin.query("insert into public.performer_profiles(id,display_name) values($1,'V155 isolated race performer')", [ids.actor]);
    const duration = 60;

    await admin.query(`insert into public.organizations(
      id,name,public_slug,status,public_booking_enabled,created_by
    ) values($1,'V155 isolated race organization',$2,'active',true,$3)`, [ids.org, slug, ids.actor]);
    await admin.query(`insert into public.locations(
      id,organization_id,name,address,timezone,active,is_primary
    ) values($1,$2,'V155 isolated race location','V155 race address','Europe/Samara',true,true)`, [ids.location, ids.org]);
    await admin.query(`insert into public.organization_memberships(
      organization_id,user_id,role,is_bookable,active,created_by
    ) values($1,$2,'owner',true,true,$2)`, [ids.org, ids.actor]);
    await admin.query(`insert into public.services(
      id,performer_id,name,duration_minutes,price_rub,active
    ) values($1,$2,'V155 identity race service',$3,1550,true)`, [ids.service, ids.actor, duration]);
    await admin.query(`insert into public.provider_schedule(
      performer_id,weekday,enabled,start_time,end_time,break_start,break_end,slot_interval_minutes
    ) select $1,day,true,'09:00','18:00',null,null,30 from generate_series(1,7) day`, [ids.actor]);

    const { rows:[seedSlot] } = await admin.query(`select available.booking_date,available.booking_time
      from public.get_available_slots($1,current_date+7,current_date+21) available
      order by available.booking_date,available.booking_time limit 1`, [ids.service]);
    assert.ok(seedSlot?.booking_date, 'v155_test_requires_seed_slot');
    const { rows:[raceSlot] } = await admin.query(`select available.booking_date,available.booking_time
      from public.get_available_slots($1,current_date+7,current_date+21) available
      where available.booking_date+available.booking_time
        >=$2::date+$3::time+make_interval(mins=>$4)
      order by available.booking_date,available.booking_time limit 1`, [
      ids.service, seedSlot.booking_date, seedSlot.booking_time, duration
    ]);
    assert.ok(raceSlot?.booking_date, 'v155_test_requires_second_non_overlapping_slot');
    const { rows:[staleSlot] } = await admin.query(`select available.booking_date,available.booking_time
      from public.get_available_slots($1,current_date+7,current_date+21) available
      where available.booking_date+available.booking_time
        >=$2::date+$3::time+make_interval(mins=>$4)
      order by available.booking_date,available.booking_time limit 1`, [
      ids.service, raceSlot.booking_date, raceSlot.booking_time, duration
    ]);
    assert.ok(staleSlot?.booking_date, 'v155_test_requires_third_non_overlapping_slot');

    const { rows:[seed] } = await admin.query(`select * from public.book_minuta_appointment_v2(
      $1,$2,$3,$4,$5::date,$6::time,$7,$8,1550,$9
    )`, [
      ids.seedRequest, slug, ids.location, ids.service,
      seedSlot.booking_date, seedSlot.booking_time, 'V155 Race Client', clientPhone, duration
    ]);
    assert.equal(seed?.result_code, 'ok');
    await admin.query(`insert into public.client_accounts(id,normalized_phone,access_code_hash)
      values($1,$2,$3)`, [ids.account, normalizedPhone, sha256(randomBytes(32))]);
    const bound = await admin.query(`update public.bookings set client_account_id=$1
      where request_id=$2 and client_account_id is null`, [ids.account, ids.seedRequest]);
    assert.equal(bound.rowCount, 1, 'v155_seed_booking_was_not_bound_to_account');
    const { rows:[seedBooking] } = await admin.query(
      'select id from public.bookings where request_id=$1', [ids.seedRequest]
    );
    assert.ok(seedBooking?.id, 'v155_seed_booking_missing');
    await admin.query(`insert into public.financial_accounts(
      id,organization_id,name,account_class,account_type,creation_request_id,request_fingerprint,created_by
    ) values($1,$2,'V155 race cash','asset','cash',$3,$4,$5)`, [
      ids.paymentAccount, ids.org, randomUUID(), sha256(randomBytes(32)), ids.actor
    ]);
    await admin.query(`insert into public.commercial_sales(
      id,organization_id,booking_id,client_account_id,seller_id,status,payment_method,payment_account_id,
      subtotal_minor,discount_minor,total_minor,refunded_minor,request_id,request_fingerprint
    ) values($1,$2,$3,$4,$5,'paid','cash',$6,155000,0,155000,0,$7,$8)`, [
      ids.visitSale, ids.org, seedBooking.id, ids.account, ids.actor, ids.paymentAccount,
      randomUUID(), sha256(randomBytes(32))
    ]);
    await admin.query("select set_config('request.jwt.claim.role','service_role',true)");
    await admin.query('set local role service_role');
    const { rows:[saleClaim] } = await admin.query(`select *
      from public.issue_client_identity_sale_claim_v155($1,$2,$3,10,$4)`, [
      ids.org, ids.visitSale, ids.saleIssueA, ids.actor
    ]);
    assert.match(saleClaim?.claim_token || '', /^PTS1-[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/);
    const exactInspect = await admin.query(`select *
      from public.inspect_client_identity_sale_claim_v155($1,$2)`, [
      saleClaim.claim_token, ids.saleConsumer
    ]);
    const lowercaseInspect = await admin.query(`select *
      from public.inspect_client_identity_sale_claim_v155($1,$2)`, [
      saleClaim.claim_token.toLowerCase(), ids.saleConsumer
    ]);
    assert.equal(exactInspect.rows.length, 1, 'uppercase sale claim must inspect successfully');
    assert.equal(exactInspect.rows[0].claim_scope, 'purchase');
    assert.equal(lowercaseInspect.rows.length, 0, 'lowercase sale claim must not inspect');
    await admin.query('reset role');
    await admin.query('set local role anon');
    const lowercaseConsume = await admin.query(`select *
      from public.consume_client_identity_sale_claim_v155($1,'v155-lowercase-probe',$2)`, [
      saleClaim.claim_token.toLowerCase(), ids.saleConsumer
    ]);
    assert.equal(lowercaseConsume.rows.length, 0, 'lowercase sale claim must not consume');
    await admin.query('reset role');
    const expectedClaimHash = sha256(saleClaim.claim_token.replaceAll('-', ''));
    const { rows:[storedClaim] } = await admin.query(`select token_hash,failed_attempts,consumed_at
      from public.client_identity_claim_grants_v155 where request_id=$1`, [ids.saleIssueA]);
    assert.deepEqual(storedClaim, {
      token_hash:expectedClaimHash,
      failed_attempts:0,
      consumed_at:null
    });
    saleSessionHash = sha256(sha256(
      `v155-sale-session:${saleClaim.claim_token.replaceAll('-', '')}:${ids.saleConsumer}`
    ));

    await admin.query(`insert into public.organization_benefit_settings(
      organization_id,enabled,enabled_at,enabled_by
    ) values($1,true,now(),$2)`, [ids.org, ids.actor]);
    await admin.query(`insert into public.benefit_products(
      id,organization_id,name,kind,sale_price_rub,visits_count,validity_days,created_by
    ) values($1,$2,'V155 one visit race pass','visit_pass',1550,1,30,$3)`, [ids.product, ids.org, ids.actor]);
    await admin.query(`insert into public.client_benefit_instruments(
      id,organization_id,product_id,client_account_id,request_id,public_code,status,
      product_snapshot,remaining_visits,expires_on,issued_by
    ) values($1,$2,$3,$4,$5,$6,'active',$7::jsonb,1,current_date+30,$8)`, [
      ids.instrument, ids.org, ids.product, ids.account, randomUUID(), publicCode,
      JSON.stringify({ name:'V155 one visit race pass', kind:'visit_pass', services:[{ service_id:ids.service }] }),
      ids.actor
    ]);
    await admin.query(`insert into public.client_identity_sessions_v155(
      client_account_id,token_hash,session_scope,session_source,device_name,expires_at
    ) values
      ($1,$2,'account','legacy_upgrade','v155-race-a',now()+interval '30 days'),
      ($1,$3,'account','legacy_upgrade','v155-race-b',now()+interval '30 days')`,
    [ids.account, sessionHashes[0], sessionHashes[1]]);
    await admin.query('commit');
    fixtureCommitted = true;
    return { duration, raceSlot, staleSlot, saleClaim, seedBooking };
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
};

const runRace = async label => {
  const { duration, raceSlot, staleSlot, saleClaim, seedBooking } = await createFixture();
  let firstTransaction = false;
  let first;
  let replayPromise;
  let saleConsumePromise;
  try {
    const rpcArgs = [
      ids.raceRequest, slug, ids.location, ids.service,
      raceSlot.booking_date, raceSlot.booking_time,
      'V155 Race Client', clientPhone, 1550, duration, benefitRef, 1, null
    ];
    const rpcSql = `select * from public.book_client_with_benefit_v155(
      $1,$2,$3,$4,$5,$6::date,$7::time,$8,$9,$10,$11,$12,$13,$14
    )`;
    first = await connect();
    const second = await connect();
    await first.query('set role service_role');
    await second.query('set role service_role');
    const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;

    await first.query('begin');
    firstTransaction = true;
    const created = (await first.query(rpcSql, [sessionTokens[0], ...rpcArgs])).rows[0];
    replayPromise = outcome(second.query(rpcSql, [sessionTokens[1], ...rpcArgs]));
    await awaitBlocked(admin, secondPid);
    await first.query('commit');
    firstTransaction = false;
    const replayOutcome = await replayPromise;
    assert.equal(replayOutcome.error, undefined);
    const replayed = replayOutcome.value.rows[0];

    assert.equal(created.result_code, 'ok');
    assert.equal(created.replayed, false);
    assert.equal(created.benefit_ref, benefitRef);
    assert.equal(created.benefit_version, 2);
    assert.equal(created.benefit_status, 'reserved');
    assert.equal(replayed.result_code, 'ok');
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.benefit_ref, benefitRef);
    assert.equal(replayed.benefit_version, 2);
    assert.equal(replayed.booking_code, created.booking_code);
    assert.equal(replayed.manage_token, created.manage_token);

    const staleArgs = [
      sessionTokens[1], ids.staleRequest, slug, ids.location, ids.service,
      staleSlot.booking_date, staleSlot.booking_time,
      'V155 Race Client', clientPhone, 1550, duration, benefitRef, 1, null
    ];
    const stale = await outcome(second.query(rpcSql, staleArgs));
    assert.equal(stale.error?.code, 'P0001');
    assert.equal(stale.error?.message, 'benefit_version_conflict');

    const { rows:[counts] } = await admin.query(`select
      (select count(*)::integer from public.bookings booking
        where booking.request_id=$1) as bookings,
      (select count(*)::integer from public.client_identity_booking_requests_v155 request_row
        where request_row.request_id=$1 and request_row.benefit_version=2) as requests,
      (select count(*)::integer from public.bookings booking
        where booking.request_id=$6) as stale_bookings,
      (select count(*)::integer from public.client_identity_booking_requests_v155 request_row
        where request_row.request_id=$6) as stale_requests,
      (select count(*)::integer from public.benefit_redemptions redemption
        where redemption.instrument_id=$2 and redemption.status='reserved') as redemptions,
      (select count(*)::integer from public.benefit_ledger ledger
        where ledger.instrument_id=$2 and ledger.event_type='reserved') as ledgers,
      (select count(*)::integer from public.client_identity_audit_v155 audit
        where audit.client_account_id=$3 and audit.action='client_benefit_booking_created'
          and audit.details->>'request_ref'=$4) as identity_audits,
      (select count(*)::integer from public.benefit_audit_log audit
        where audit.organization_id=$5 and audit.action='benefit_reserved_client_v155'
          and audit.details->>'instrument_id'=$2::text) as benefit_audits`,
    [ids.raceRequest, ids.instrument, ids.account, requestRef, ids.org, ids.staleRequest]);
    assert.deepEqual(counts, {
      bookings:1,
      requests:1,
      stale_bookings:0,
      stale_requests:0,
      redemptions:1,
      ledgers:1,
      identity_audits:1,
      benefit_audits:1
    });
    const { rows:[instrument] } = await admin.query(`select remaining_visits,status
      from public.client_benefit_instruments where id=$1`, [ids.instrument]);
    assert.deepEqual(instrument, { remaining_visits:0, status:'exhausted' });

    await first.query("select set_config('request.jwt.claim.role','service_role',false)");
    await first.query("select set_config('request.jwt.claim.sub','',false)");
    await second.query('reset role');
    await second.query('set role anon');
    await first.query('begin');
    firstTransaction = true;
    const { rows:[replacementClaim] } = await first.query(`select *
      from public.issue_client_identity_sale_claim_v155($1,$2,$3,10,$4)`, [
      ids.org, ids.visitSale, ids.saleIssueB, ids.actor
    ]);
    assert.match(replacementClaim?.claim_token || '', /^PTS1-[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/);
    assert.notEqual(replacementClaim.claim_token, saleClaim.claim_token);
    const originalClaimHash = sha256(saleClaim.claim_token.replaceAll('-', ''));
    const replacementClaimHash = sha256(replacementClaim.claim_token.replaceAll('-', ''));
    saleConsumePromise = outcome(second.query(`select *
      from public.consume_client_identity_sale_claim_v155($1,'v155-sale-race',$2)`, [
      saleClaim.claim_token, ids.saleConsumer
    ]));
    await awaitBlocked(admin, secondPid);
    await first.query('commit');
    firstTransaction = false;
    const consumeOutcome = await saleConsumePromise;
    assert.equal(consumeOutcome.error, undefined);
    assert.equal(consumeOutcome.value.rows.length, 0,
      'superseded sale claim must not be consumed after concurrent reissue wins');
    const { rows:[saleRace] } = await admin.query(`select
      (select count(*)::integer from public.client_identity_claim_grants_v155 grant_row
       where grant_row.commercial_sale_id=$1 and grant_row.request_id=$2
         and grant_row.superseded_at is not null and grant_row.consumed_at is null
         and grant_row.failed_attempts=1 and grant_row.token_hash=$8) as old_grant,
      (select count(*)::integer from public.client_identity_claim_grants_v155 grant_row
       where grant_row.commercial_sale_id=$1 and grant_row.request_id=$3
         and grant_row.superseded_at is null and grant_row.consumed_at is null
         and grant_row.failed_attempts=0 and grant_row.token_hash=$9
         and grant_row.token_hash<>$8) as replacement_grant,
      (select count(*)::integer from public.client_identity_claim_grants_v155 grant_row
       where grant_row.commercial_sale_id=$1
         and grant_row.superseded_at is null and grant_row.consumed_at is null) as active_grants,
      (select count(*)::integer from public.client_identity_sessions_v155 session_row
       where session_row.token_hash=$4) as consumer_sessions,
      (select count(*)::integer from public.client_identity_audit_v155 audit
       where audit.client_account_id=$5 and audit.action='client_sale_claim_consumed') as consume_audits,
      (select count(*)::integer from public.commercial_sales sale
       where sale.id=$1 and sale.organization_id=$6 and sale.booking_id=$7
         and sale.client_account_id=$5) as exact_visit_sale`, [
      ids.visitSale, ids.saleIssueA, ids.saleIssueB, saleSessionHash,
      ids.account, ids.org, seedBooking.id, originalClaimHash, replacementClaimHash
    ]);
    assert.deepEqual(saleRace, {
      old_grant:1,
      replacement_grant:1,
      active_grants:1,
      consumer_sessions:0,
      consume_audits:0,
      exact_visit_sale:1
    });
    console.log(`PASS: ${label} booking race and booking-linked sale issue/consume race serialize exactly once`);
  } finally {
    if (firstTransaction) {
      try { await first?.query('rollback'); } catch {}
    }
    if (replayPromise) await replayPromise;
    if (saleConsumePromise) await saleConsumePromise;
  }
  await cleanupFixture();
};

const assertAbsent = async () => {
  const { rows:[absent] } = await admin.query(`select
    to_regclass('public.client_identity_sessions_v155') is null as sessions,
    to_regprocedure('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)') is null as rpc,
    to_regprocedure('public.inspect_client_identity_sale_claim_v155(text,uuid)') is null as inspect_sale_claim`);
  assert.deepEqual(absent, { sessions:true, rpc:true, inspect_sale_claim:true });
};

try {
  admin = await connect();
  const { rows:[initial] } = await admin.query(`select
    to_regclass('public.client_identity_sessions_v155') is not null as sessions,
    to_regprocedure('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)') is not null as rpc`);
  assert.equal(initial.sessions, initial.rpc, 'v155_partial_preinstalled_state');
  hadV155 = initial.sessions && initial.rpc;

  await admin.query(migration);
  migrationOwned = !hadV155;
  await admin.query(migration);
  await smoke(admin);
  await runRace('initial apply');

  if (migrationOwned) {
    await admin.query(rollback);
    migrationOwned = false;
    await assertAbsent();

    await admin.query(migration);
    migrationOwned = true;
    await admin.query(migration);
    await smoke(admin);
    await runRace('rollback and reapply');
    console.log('PASS: rollback followed by clean apply and idempotent reapply passes smoke and functional race');
    await admin.query(rollback);
    migrationOwned = false;
    await assertAbsent();
  } else {
    console.log('SKIP: destructive rollback/reapply lifecycle is forbidden because v155 was preinstalled; double apply, smoke and functional race passed without altering the owned baseline');
  }
} finally {
  let cleanupError;
  for (const client of clients) {
    try { await client.query('rollback'); } catch {}
  }
  if (admin && fixtureCommitted) {
    try { await cleanupFixture(); } catch (error) { cleanupError = error; }
  }
  if (admin && migrationOwned && !hadV155) {
    try {
      await admin.query('rollback');
      await admin.query(rollback);
      migrationOwned = false;
    } catch (error) {
      cleanupError ||= error;
    }
  }
  for (const client of clients) {
    try { await client.end(); } catch (error) { cleanupError ||= error; }
  }
  if (cleanupError) throw cleanupError;
}
