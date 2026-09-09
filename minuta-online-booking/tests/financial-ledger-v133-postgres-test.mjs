// Real PostgreSQL only. Never run against production.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const { execFileSync: run } = await import('node:child_process');
run(process.execPath, [fileURLToPath(new URL('scripts/migration-config-guard.mjs', root))], { stdio: 'inherit' });
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
assert.equal(typeof Client, 'function');

const read = name => readFileSync(new URL(name, root), 'utf8').replace(/^\\set[^\r\n]*(?:\r?\n|$)/gm, '');
const migration = read('supabase-migration-v133.sql');
const rollback = read('supabase-migration-v133-rollback.sql');
const clients = [];
const tls = process.env.MINUTA_TEST_PG_TLS_NO_VERIFY === 'MIGRATION_TEST_ONLY' ? { rejectUnauthorized: false } : undefined;
const connect = async applicationName => {
  const client = new Client({ connectionString: process.env.MINUTA_TEST_DATABASE_URL,
    application_name: applicationName, ...(tls ? { ssl: tls } : {}) });
  await client.connect();
  clients.push(client);
  await client.query("set statement_timeout='30s'; set lock_timeout='10s'");
  return client;
};
const admin = await connect('minuta-d06-v133-isolated-test');
const ids = {
  owner: randomUUID(), specialist: randomUUID(), outsider: randomUUID(),
  org: randomUUID(), foreignOrg: randomUUID(), location: randomUUID(), service: randomUUID(),
  client: randomUUID(), booking: randomUUID(), settleRequest: randomUUID(), reverseRequest: randomUUID(),
  visitRequest: randomUUID(), visitReverseRequest: randomUUID(), cashRequest: randomUUID(), bankRequest: randomUUID(),
  supplierRequest: randomUUID(), expenseRequest: randomUUID()
};
const referenceHash = createHash('sha256').update(`v133-${ids.settleRequest}`).digest('hex');
const phone = `79${BigInt(`0x${ids.client.replaceAll('-', '').slice(0, 14)}`) % 1000000000n}`.padEnd(11, '0').slice(0, 11);
let fixtureCreated = false;

const asActor = async (client, actor) => {
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await client.query('set role authenticated');
};
const resultOf = response => response.rows[0].result;
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const expectError = async (promise, pattern, code) => {
  const result = await outcome(promise);
  assert(result.error, `expected error matching ${pattern}`);
  if (code) assert.equal(result.error.code, code);
  assert.match(result.error.message, pattern);
};
const assertBalanced = async transactionId => {
  const row = (await admin.query(`select count(*)::integer count,
    coalesce(sum(amount_minor) filter(where side='debit'),0)::bigint debit,
    coalesce(sum(amount_minor) filter(where side='credit'),0)::bigint credit
    from public.financial_postings where transaction_id=$1`, [transactionId])).rows[0];
  assert(row.count >= 2);
  assert.equal(BigInt(row.debit), BigInt(row.credit));
};

async function cleanupKnownStaleFixtures() {
  const stale = (await admin.query(`select organization.id from public.organizations organization
    where organization.name in('D06 v133 debt test','D06 v133 foreign test')
      and not exists(select 1 from public.organization_memberships membership
        join auth.users user_row on user_row.id=membership.user_id
        where membership.organization_id=organization.id and user_row.email not like '%@example.invalid')`)).rows.map(row => row.id);
  if (!stale.length) return;
  const actors = (await admin.query(`select distinct membership.user_id id
    from public.organization_memberships membership join auth.users user_row on user_row.id=membership.user_id
    where membership.organization_id=any($1::uuid[]) and user_row.email like '%@example.invalid'`, [stale])).rows.map(row => row.id);
  const staleClients = (await admin.query(`select distinct booking.client_account_id id
    from public.bookings booking where booking.organization_id=any($1::uuid[])
      and booking.client_account_id is not null`, [stale])).rows.map(row => row.id);
  await admin.query('begin');
  try {
    await admin.query("set local session_replication_role='replica'");
    if ((await admin.query("select to_regclass('public.financial_debt_settlement_sources') is not null present")).rows[0].present)
      await admin.query('delete from public.financial_debt_settlement_sources where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.financial_expense_sources where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.financial_postings where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.financial_transactions where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.financial_suppliers where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.financial_accounts where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.organization_finance_settings where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.booking_outcomes where booking_id in(select id from public.bookings where organization_id=any($1::uuid[]))', [stale]);
    await admin.query('delete from public.bookings where organization_id=any($1::uuid[])', [stale]);
    if (staleClients.length) {
      await admin.query(`delete from public.client_accounts account where account.id=any($1::uuid[])
        and not exists(select 1 from public.bookings booking where booking.client_account_id=account.id)`, [staleClients]);
    }
    await admin.query('delete from public.locations where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.organization_memberships where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.organizations where id=any($1::uuid[])', [stale]);
    for (const actor of actors) {
      await admin.query('delete from public.services where performer_id=$1', [actor]);
      await admin.query('delete from public.performer_profiles where id=$1 and not exists(select 1 from public.organization_memberships where user_id=$1)', [actor]);
      await admin.query("delete from auth.users where id=$1 and email like '%@example.invalid' and not exists(select 1 from public.organization_memberships where user_id=$1)", [actor]);
    }
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

try {
  const prerequisites = (await admin.query(`select
    to_regclass('public.financial_suppliers') is not null suppliers,
    to_regprocedure('public.set_minuta_finance_enabled_v132(uuid,boolean)') is not null enable_v132`)).rows[0];
  assert.deepEqual(prerequisites, { suppliers: true, enable_v132: true });
  await cleanupKnownStaleFixtures();

  if ((await admin.query("select to_regclass('public.financial_debt_settlement_sources') is not null present")).rows[0].present) {
    assert.equal(Number((await admin.query('select count(*)::bigint count from public.financial_debt_settlement_sources')).rows[0].count), 0,
      'v133 test refuses to remove non-fixture debt settlement evidence');
    assert.equal(Number((await admin.query('select count(*)::bigint count from public.organization_finance_settings where enabled')).rows[0].count), 0,
      'v133 test refuses rollback while finance is enabled');
    await admin.query(rollback);
  }
  await admin.query(migration);
  await admin.query(migration);
  await admin.query(rollback);
  assert.equal((await admin.query("select to_regclass('public.financial_debt_settlement_sources') is null removed")).rows[0].removed, true);
  assert.equal((await admin.query("select to_regprocedure('public.set_minuta_finance_enabled_v132(uuid,boolean)') is not null preserved")).rows[0].preserved, true);
  assert.equal((await admin.query(`select count(*)::integer count from pg_constraint
    where conname in('financial_accounts_account_type_v132_check','financial_accounts_system_key_v132_check',
      'financial_accounts_system_mapping_v132_check','financial_accounts_system_request_v132_check',
      'financial_transactions_operation_v132_check','financial_transactions_source_v132_check',
      'financial_transactions_shape_v132_check')`)).rows[0].count, 7);
  assert.equal((await admin.query(`select has_function_privilege('authenticated',
    'public.reverse_minuta_financial_transaction_v129(uuid,uuid,uuid,text)','EXECUTE') allowed`)).rows[0].allowed, true);
  await admin.query(migration);
  await admin.query(migration);

  await admin.query('begin');
  await admin.query("set local session_replication_role='replica'");
  await admin.query(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,now(),'{}','{}',now(),now()),
      ($2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$5,now(),'{}','{}',now(),now()),
      ($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$6,now(),'{}','{}',now(),now())`,
    [ids.owner, ids.specialist, ids.outsider, `${ids.owner}@example.invalid`, `${ids.specialist}@example.invalid`, `${ids.outsider}@example.invalid`]);
  await admin.query("insert into public.performer_profiles(id,display_name) values($1,'D06 v133 owner'),($2,'D06 v133 specialist'),($3,'D06 v133 outsider')",
    [ids.owner, ids.specialist, ids.outsider]);
  await admin.query(`insert into public.organizations(id,name,public_slug,created_by,status)
    values($1,'D06 v133 debt test',$2,$3,'active'),($4,'D06 v133 foreign test',$5,$3,'active')`,
    [ids.org, `d06-v133-${ids.org.replaceAll('-', '')}`, ids.owner, ids.foreignOrg, `d06-v133-${ids.foreignOrg.replaceAll('-', '')}`]);
  await admin.query(`insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
    values($1,$2,'owner',false,true),($1,$3,'specialist',true,true),($4,$5,'owner',false,true)`,
    [ids.org, ids.owner, ids.specialist, ids.foreignOrg, ids.outsider]);
  await admin.query("insert into public.locations(id,organization_id,name,timezone,is_primary) values($1,$2,'D06 v133 location','Europe/Moscow',true)",
    [ids.location, ids.org]);
  await admin.query("insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values($1,$2,'D06 v133 service',60,1000,true)",
    [ids.service, ids.owner]);
  await admin.query("insert into public.client_accounts(id,normalized_phone,access_code_hash) values($1,$2,repeat('a',64))", [ids.client, phone]);
  await admin.query(`insert into public.bookings(
    id,booking_code,manage_token,request_id,request_fingerprint,performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,payment_status,payment_url,
    organization_id,location_id,booking_scope_source,client_account_id,booking_source)
    values($1,$2,gen_random_uuid(),$1,repeat('c',64),$3,$4,'D06 synthetic client',$5,
      current_date+30,'10:00',60,1000,1000,'confirmed',0,'not_required','',$6,$7,'team',$8,'client_online')`,
    [ids.booking, `D06133-${ids.booking.replaceAll('-', '').slice(0, 12)}`, ids.owner, ids.service, phone, ids.org, ids.location, ids.client]);
  await admin.query(`insert into public.booking_outcomes(
    booking_id,performer_id,visit_status,payment_method,amount_rub,calculated_amount_rub,completion_source,updated_at)
    values($1,$2,'completed','transfer',600,1000,'manual',$3)`,
    [ids.booking, ids.owner, new Date('2026-09-09T04:00:00.000Z')]);
  await admin.query("set local session_replication_role='origin'");
  await admin.query('commit');
  fixtureCreated = true;

  const owner = await connect('minuta-d06-v133-owner');
  const specialist = await connect('minuta-d06-v133-specialist');
  const outsider = await connect('minuta-d06-v133-outsider');
  await asActor(owner, ids.owner);
  await asActor(specialist, ids.specialist);
  await asActor(outsider, ids.outsider);

  const enabled = resultOf(await owner.query('select public.set_minuta_finance_enabled_v133($1,true) result', [ids.org]));
  assert(enabled.payment_channel_commission_account_id);
  const cash = resultOf(await owner.query('select public.create_minuta_financial_account_v129($1,$2,$3,$4) result',
    [ids.org, ids.cashRequest, 'D06 v133 cash', 'cash']));
  const bank = resultOf(await owner.query('select public.create_minuta_financial_account_v129($1,$2,$3,$4) result',
    [ids.org, ids.bankRequest, 'D06 v133 bank', 'bank']));
  const supplier = resultOf(await owner.query('select public.create_minuta_financial_supplier_v132($1,$2,$3) result',
    [ids.org, ids.supplierRequest, 'D06 v133 supplier']));
  const expenseAccount = (await admin.query("select id from public.financial_accounts where organization_id=$1 and system_key='operating_expense'", [ids.org])).rows[0].id;
  await owner.query('select public.accrue_minuta_supplier_expense_v132($1,$2,$3,$4,$5,$6)',
    [ids.org, supplier.id, expenseAccount, 10000, new Date('2026-09-09T04:30:00.000Z'), ids.expenseRequest]);
  const beforePost = resultOf(await owner.query('select public.get_minuta_financial_reconciliation_v133($1,100) result', [ids.org]));
  assert.equal(Number(beforePost.unposted_count), 1);
  assert.equal(beforePost.unposted_visits[0].booking_id, ids.booking);
  assert.equal(beforePost.ledger_state, 'drift');
  const visit = resultOf(await owner.query('select public.post_minuta_visit_finance_v129($1,$2,$3,$4) result',
    [ids.org, ids.booking, bank.id, ids.visitRequest]));
  await assertBalanced(visit.id);

  const settleSql = 'select public.settle_minuta_customer_debt_v133($1,$2,$3,$4,$5,$6,$7,$8) result';
  const occurredAt = new Date('2026-09-09T04:01:00.000Z');
  await owner.query('select public.set_minuta_finance_enabled_v133($1,false)', [ids.org]);
  await expectError(owner.query(settleSql, [ids.org, visit.id, bank.id, 'bank_transfer', referenceHash, 1200,
    occurredAt, ids.settleRequest]), /finance_disabled/i, '55000');
  await owner.query('select public.set_minuta_finance_enabled_v133($1,true)', [ids.org]);
  await expectError(specialist.query(settleSql, [ids.org, visit.id, bank.id, 'bank_transfer', referenceHash, 1200,
    occurredAt, randomUUID()]), /financial_manager_role_required/i, '42501');
  await expectError(outsider.query(settleSql, [ids.org, visit.id, bank.id, 'bank_transfer', referenceHash, 1200,
    occurredAt, randomUUID()]), /financial_manager_role_required/i, '42501');
  await expectError(owner.query(settleSql, [ids.org, visit.id, cash.id, 'cash', null, 1,
    occurredAt, randomUUID()]), /invalid_customer_debt_settlement/i, '22023');

  const replayOwner = await connect('minuta-d06-v133-concurrent-replay');
  await asActor(replayOwner, ids.owner);
  await owner.query('begin');
  const settlement = resultOf(await owner.query(settleSql,
    [ids.org, visit.id, bank.id, 'bank_transfer', referenceHash, 1200, occurredAt, ids.settleRequest]));
  await replayOwner.query('begin');
  const replayPromise = outcome(replayOwner.query(settleSql,
    [ids.org, visit.id, bank.id, 'bank_transfer', referenceHash, 1200, occurredAt, ids.settleRequest]));
  const settledEarly = await Promise.race([
    replayPromise.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 500))
  ]);
  if (settledEarly) {
    await owner.query('rollback');
    await replayOwner.query('rollback');
  }
  assert.equal(settledEarly, false, 'concurrent settlement bypassed the ledger lock');
  await owner.query('commit');
  const replayOutcome = await replayPromise;
  assert.equal(replayOutcome.error, undefined);
  const replay = resultOf(replayOutcome.value);
  await replayOwner.query('commit');
  assert.equal(replay.id, settlement.id);
  assert.equal(replay.transaction_id, settlement.transaction_id);
  assert.equal(replay.replayed, true);
  assert.equal(Number(settlement.gross_minor), 40000);
  assert.equal(Number(settlement.commission_minor), 1200);
  assert.equal(Number(settlement.net_minor), 38800);
  await expectError(owner.query(settleSql,
    [ids.org, visit.id, bank.id, 'bank_transfer', referenceHash, 1300, occurredAt, ids.settleRequest]),
    /idempotency_conflict/i, '23505');
  await expectError(owner.query(settleSql,
    [ids.org, visit.id, bank.id, 'bank_transfer', createHash('sha256').update('second').digest('hex'), 0, occurredAt, randomUUID()]),
    /already_settled/i, '23505');
  await assertBalanced(settlement.transaction_id);

  const accounts = (await admin.query(`select system_key,id from public.financial_accounts
    where organization_id=$1 and system_key in('receivable','payment_channel_commission')`, [ids.org])).rows;
  const receivable = accounts.find(row => row.system_key === 'receivable').id;
  const commission = accounts.find(row => row.system_key === 'payment_channel_commission').id;
  const postings = (await admin.query(`select account_id,side,amount_minor::bigint amount_minor
    from public.financial_postings where transaction_id=$1 order by account_id,side`, [settlement.transaction_id])).rows;
  assert.deepEqual(postings.map(row => [row.account_id, row.side, BigInt(row.amount_minor)]).sort(),
    [[bank.id, 'debit', 38800n], [commission, 'debit', 1200n], [receivable, 'credit', 40000n]].sort());
  const explanation = (await admin.query('select explanation from public.financial_transactions where id=$1', [settlement.transaction_id])).rows[0].explanation;
  assert.equal(explanation.booking_id, ids.booking);
  assert.equal(explanation.evidence_reference_hash, referenceHash);
  assert.equal(Object.keys(explanation).some(key => /name|phone|email/i.test(key)), false);

  const reconciliation = resultOf(await owner.query('select public.get_minuta_financial_reconciliation_v133($1,100) result', [ids.org]));
  assert.equal(reconciliation.ledger_state, 'matched');
  assert.equal(Number(reconciliation.unresolved_count), 0);
  const debt = reconciliation.debts.find(row => row.visit_transaction_id === visit.id);
  assert.equal(debt.source_state, 'matched');
  assert.equal(Number(debt.original_minor), 40000);
  assert.equal(Number(debt.settled_minor), 40000);
  assert.equal(Number(debt.outstanding_minor), 0);
  const expenseState = reconciliation.transactions.filter(row => row.source_type === 'financial_expense_source');
  assert.equal(expenseState.length, 1);
  assert(expenseState.every(row => row.source_state !== 'source_missing'));
  const serializedReconciliation = JSON.stringify(reconciliation);
  assert.equal(serializedReconciliation.includes('D06 synthetic client'), false);
  assert.equal(serializedReconciliation.includes(phone), false);
  assert.equal(serializedReconciliation.includes(`${ids.owner}@example.invalid`), false);
  assert.equal((await outsider.query('select count(*)::integer count from public.financial_debt_settlement_sources where organization_id=$1', [ids.org])).rows[0].count, 0);
  await expectError(specialist.query('select public.get_minuta_financial_reconciliation_v133($1,100)', [ids.org]), /financial_manager_role_required/i, '42501');

  await admin.query('begin');
  await admin.query("set local session_replication_role='replica'");
  await admin.query('delete from public.financial_postings where id=(select min(id) from public.financial_postings where transaction_id=$1)', [settlement.transaction_id]);
  await admin.query("set local session_replication_role='origin'");
  await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [ids.owner]);
  await admin.query('set local role authenticated');
  const drifted = resultOf(await admin.query('select public.get_minuta_financial_reconciliation_v133($1,100) result', [ids.org]));
  assert.equal(drifted.ledger_state, 'drift');
  assert.equal(drifted.transactions.find(row => row.id === settlement.transaction_id).posting_state, 'drift');
  await admin.query('rollback');

  await admin.query('begin');
  await admin.query("set local session_replication_role='replica'");
  await admin.query('delete from public.financial_postings where transaction_id=$1', [settlement.transaction_id]);
  await admin.query("set local session_replication_role='origin'");
  await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [ids.owner]);
  await admin.query('set local role authenticated');
  const missingPostings = resultOf(await admin.query('select public.get_minuta_financial_reconciliation_v133($1,100) result', [ids.org]));
  assert.equal(missingPostings.transactions.find(row => row.id === settlement.transaction_id).posting_state, 'missing');
  await admin.query('rollback');

  await admin.query('begin');
  await admin.query("set local session_replication_role='replica'");
  await admin.query('delete from public.financial_debt_settlement_sources where id=$1', [settlement.id]);
  await admin.query("set local session_replication_role='origin'");
  await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [ids.owner]);
  await admin.query('set local role authenticated');
  const missingSource = resultOf(await admin.query('select public.get_minuta_financial_reconciliation_v133($1,100) result', [ids.org]));
  assert.equal(missingSource.ledger_state, 'drift');
  assert.equal(missingSource.transactions.find(row => row.id === settlement.transaction_id).source_state, 'source_missing');
  await admin.query('rollback');

  await admin.query('begin');
  await admin.query("set local session_replication_role='replica'");
  await admin.query("update public.financial_debt_settlement_sources set source_fingerprint=repeat('0',64) where id=$1", [settlement.id]);
  await admin.query("set local session_replication_role='origin'");
  await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [ids.owner]);
  await admin.query('set local role authenticated');
  const driftedSource = resultOf(await admin.query('select public.get_minuta_financial_reconciliation_v133($1,100) result', [ids.org]));
  assert.equal(driftedSource.ledger_state, 'drift');
  assert.equal(driftedSource.transactions.find(row => row.id === settlement.transaction_id).source_state, 'drift');
  assert.equal(driftedSource.debts.find(row => row.visit_transaction_id === visit.id).source_state, 'matched');
  await admin.query('rollback');

  await expectError(owner.query('select public.reverse_minuta_visit_finance_v133($1,$2,$3,$4)',
    [ids.org, visit.id, ids.visitReverseRequest, 'source_corrected']), /must_be_reversed_first/i, '55000');
  await expectError(owner.query('select public.reverse_minuta_financial_transaction_v129($1,$2,$3,$4)',
    [ids.org, visit.id, randomUUID(), 'source_corrected']), /must_be_reversed_first/i, '55000');
  const reversed = resultOf(await owner.query('select public.reverse_minuta_customer_debt_settlement_v133($1,$2,$3,$4) result',
    [ids.org, settlement.transaction_id, ids.reverseRequest, 'payment_corrected']));
  const reversedReplay = resultOf(await owner.query('select public.reverse_minuta_customer_debt_settlement_v133($1,$2,$3,$4) result',
    [ids.org, settlement.transaction_id, ids.reverseRequest, 'payment_corrected']));
  assert.equal(reversed.id, reversedReplay.id);
  assert.equal(reversedReplay.replayed, true);
  await assertBalanced(reversed.id);
  const settlementNet = (await admin.query(`select posting.account_id,
      sum(case posting.side when 'debit' then posting.amount_minor else -posting.amount_minor end)::bigint net
    from public.financial_postings posting
    where posting.transaction_id in($1,$2) group by posting.account_id order by posting.account_id`,
    [settlement.transaction_id, reversed.id])).rows;
  assert(settlementNet.every(row => BigInt(row.net) === 0n));
  const replayAfterReverse = resultOf(await owner.query(settleSql,
    [ids.org, visit.id, bank.id, 'bank_transfer', referenceHash, 1200, occurredAt, ids.settleRequest]));
  assert.equal(replayAfterReverse.replayed, true);
  assert.equal(replayAfterReverse.reversed, true);
  await expectError(owner.query(settleSql,
    [ids.org, visit.id, bank.id, 'bank_transfer', referenceHash, 0, new Date('2026-09-09T04:02:00.000Z'), randomUUID()]),
    /reference_conflict/i, '23505');

  const raceOwnerA = await connect('minuta-d06-v133-concurrent-a');
  const raceOwnerB = await connect('minuta-d06-v133-concurrent-b');
  await asActor(raceOwnerA, ids.owner);
  await asActor(raceOwnerB, ids.owner);
  const raceResults = await Promise.all([
    outcome(raceOwnerA.query(settleSql, [ids.org, visit.id, bank.id, 'bank_transfer',
      createHash('sha256').update('race-a').digest('hex'), 0, new Date('2026-09-09T04:02:00.000Z'), randomUUID()])),
    outcome(raceOwnerB.query(settleSql, [ids.org, visit.id, bank.id, 'bank_transfer',
      createHash('sha256').update('race-b').digest('hex'), 0, new Date('2026-09-09T04:02:00.000Z'), randomUUID()]))
  ]);
  const raceSuccess = raceResults.filter(result => result.value);
  const raceFailure = raceResults.filter(result => result.error);
  assert.equal(raceSuccess.length, 1);
  assert.equal(raceFailure.length, 1);
  assert.equal(raceFailure[0].error.code, '23505');
  assert.match(raceFailure[0].error.message, /already_settled/i);
  const raceSettlement = resultOf(raceSuccess[0].value);
  const raceReversal = resultOf(await owner.query(
    'select public.reverse_minuta_customer_debt_settlement_v133($1,$2,$3,$4) result',
    [ids.org, raceSettlement.transaction_id, randomUUID(), 'payment_corrected']));
  await assertBalanced(raceReversal.id);
  const visitReversal = resultOf(await owner.query('select public.reverse_minuta_visit_finance_v133($1,$2,$3,$4) result',
    [ids.org, visit.id, ids.visitReverseRequest, 'source_corrected']));
  await assertBalanced(visitReversal.id);
  const afterVisitReversal = resultOf(await owner.query('select public.get_minuta_financial_reconciliation_v133($1,100) result', [ids.org]));
  const reversedDebt = afterVisitReversal.debts.find(row => row.visit_transaction_id === visit.id);
  assert.equal(reversedDebt.reversed, true);
  assert.equal(Number(reversedDebt.outstanding_minor), 0);
  assert.equal(Number(afterVisitReversal.unposted_count), 1);

  await expectError(admin.query('update public.financial_debt_settlement_sources set occurred_at=occurred_at where id=$1', [settlement.id]),
    /financial_debt_settlement_source_is_immutable/i, '55000');
  await owner.query('select public.set_minuta_finance_enabled_v133($1,false)', [ids.org]);
  await expectError(owner.query(settleSql,
    [ids.org, visit.id, bank.id, 'bank_transfer', createHash('sha256').update('disabled').digest('hex'), 0, occurredAt, randomUUID()]),
    /finance_disabled|financial_visit_transaction_reversed/i, '55000');
  await expectError(admin.query(rollback), /v133_rollback_preserves_debt_settlement_evidence/i, '55000');
  await admin.query('rollback');
  console.log('financial ledger v133 PostgreSQL: debt, commission, reconciliation, reversal, RLS and rollback gate OK');
} finally {
  try {
    await admin.query('reset role');
    if (fixtureCreated) {
      await admin.query('begin');
      await admin.query("set local session_replication_role='replica'");
      await admin.query('delete from public.financial_debt_settlement_sources where organization_id=$1', [ids.org]);
      await admin.query('delete from public.financial_expense_sources where organization_id=$1', [ids.org]);
      await admin.query('delete from public.financial_postings where organization_id=$1', [ids.org]);
      await admin.query('delete from public.financial_transactions where organization_id=$1', [ids.org]);
      await admin.query('delete from public.financial_suppliers where organization_id=$1', [ids.org]);
      await admin.query('delete from public.financial_accounts where organization_id=$1', [ids.org]);
      await admin.query('delete from public.organization_finance_settings where organization_id=$1', [ids.org]);
      await admin.query('delete from public.booking_outcomes where booking_id=$1', [ids.booking]);
      await admin.query('delete from public.bookings where id=$1', [ids.booking]);
      await admin.query('delete from public.locations where id=$1', [ids.location]);
      await admin.query('delete from public.organization_memberships where organization_id in($1,$2)', [ids.org, ids.foreignOrg]);
      await admin.query('delete from public.organizations where id in($1,$2)', [ids.org, ids.foreignOrg]);
      await admin.query('delete from public.services where id=$1', [ids.service]);
      await admin.query('delete from public.client_accounts where id=$1', [ids.client]);
      await admin.query('delete from public.performer_profiles where id in($1,$2,$3)', [ids.owner, ids.specialist, ids.outsider]);
      await admin.query('delete from auth.users where id in($1,$2,$3)', [ids.owner, ids.specialist, ids.outsider]);
      await admin.query('commit');
    }
  } catch (cleanupError) {
    try { await admin.query('rollback'); } catch {}
    console.error(`v133 cleanup failed: ${cleanupError.message}`);
    process.exitCode = 1;
  }
  await Promise.allSettled(clients.map(client => client.end()));
}
