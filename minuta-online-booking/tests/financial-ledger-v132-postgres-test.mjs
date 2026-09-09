// Real PostgreSQL only. Never run against production.
// Requires the standard MINUTA_TEST_* guard variables and the `pg` module.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const { execFileSync: run } = await import('node:child_process');
run(process.execPath, [fileURLToPath(new URL('scripts/migration-config-guard.mjs', root))], { stdio: 'inherit' });
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
assert.equal(typeof Client, 'function', 'PostgreSQL Client constructor unavailable');

const read = name => readFileSync(new URL(name, root), 'utf8');
const executableSql = sql => sql.replace(/^\\set[^\r\n]*(?:\r?\n|$)/gm, '');
const migration = executableSql(read('supabase-migration-v132.sql'));
const rollback = executableSql(read('supabase-migration-v132-rollback.sql'));
const clients = [];
const tls = process.env.MINUTA_TEST_PG_TLS_NO_VERIFY === 'MIGRATION_TEST_ONLY' ? { rejectUnauthorized: false } : undefined;
const connect = async applicationName => {
  const client = new Client({
    connectionString: process.env.MINUTA_TEST_DATABASE_URL,
    application_name: applicationName,
    ...(tls ? { ssl: tls } : {})
  });
  await client.connect();
  clients.push(client);
  await client.query("set statement_timeout='30s'; set lock_timeout='10s'");
  return client;
};
const admin = await connect('minuta-d06-v132-isolated-test');
const owner = randomUUID();
const specialist = randomUUID();
const outsider = randomUUID();
const organization = randomUUID();
const foreignOrganization = randomUUID();
const supplierRequest = randomUUID();
const accrualRequest = randomUUID();
const paymentRequest = randomUUID();
const paymentReversalRequest = randomUUID();
const accrualReversalRequest = randomUUID();
let fixtureCreated = false;

const rpc = {
  enable: 'select public.set_minuta_finance_enabled_v132($1,$2) result',
  supplier: 'select public.create_minuta_financial_supplier_v132($1,$2,$3) result',
  accrue: 'select public.accrue_minuta_supplier_expense_v132($1,$2,$3,$4,$5,$6) result',
  pay: 'select public.pay_minuta_supplier_expense_v132($1,$2,$3,$4) result',
  reversePayment: 'select public.reverse_minuta_supplier_expense_payment_v132($1,$2,$3,$4) result',
  reverseAccrual: 'select public.reverse_minuta_supplier_expense_accrual_v132($1,$2,$3,$4) result'
};
const asActor = async (client, actor) => {
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await client.query('set role authenticated');
};
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const expectError = async (promise, pattern, code) => {
  const result = await outcome(promise);
  assert(result.error, `expected error matching ${pattern}`);
  if (code) assert.equal(result.error.code, code);
  assert.match(result.error.message, pattern);
};
const resultOf = response => response.rows[0].result;
const transactionFor = async (operationType, sourceId) => {
  const response = await admin.query(`select id from public.financial_transactions
    where organization_id=$1 and operation_type=$2 and source_id=$3 and reversal_of is null
    order by occurred_at desc, id desc limit 1`, [organization, operationType, sourceId]);
  assert.equal(response.rowCount, 1, `missing ${operationType} transaction`);
  return response.rows[0].id;
};
const assertBalanced = async (transactionId, expectedAmount = 100000n) => {
  const row = (await admin.query(`select
      coalesce(sum(amount_minor) filter(where side='debit'),0)::bigint debit,
      coalesce(sum(amount_minor) filter(where side='credit'),0)::bigint credit,
      count(*)::integer postings
    from public.financial_postings where transaction_id=$1`, [transactionId])).rows[0];
  assert.equal(BigInt(row.debit), BigInt(row.credit));
  assert.equal(BigInt(row.debit), expectedAmount);
  assert.equal(row.postings, 2);
};

async function cleanupKnownStaleFixtures() {
  const stale = (await admin.query(`select organization.id
    from public.organizations organization
    where organization.name in('D06 v132 expense test','D06 v132 foreign test')
      and not exists(
        select 1 from public.organization_memberships membership
        join auth.users user_row on user_row.id=membership.user_id
        where membership.organization_id=organization.id
          and user_row.email not like '%@example.invalid'
      )`)).rows.map(row => row.id);
  if (!stale.length) return;
  const actors = (await admin.query(`select distinct membership.user_id id
    from public.organization_memberships membership
    join auth.users user_row on user_row.id=membership.user_id
    where membership.organization_id=any($1::uuid[])
      and user_row.email like '%@example.invalid'`, [stale])).rows.map(row => row.id);
  await admin.query('begin');
  try {
    await admin.query("set local session_replication_role='replica'");
    if ((await admin.query("select to_regclass('public.financial_expense_sources') is not null present")).rows[0].present)
      await admin.query('delete from public.financial_expense_sources where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.financial_postings where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.financial_transactions where organization_id=any($1::uuid[])', [stale]);
    if ((await admin.query("select to_regclass('public.financial_suppliers') is not null present")).rows[0].present)
      await admin.query('delete from public.financial_suppliers where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.financial_accounts where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.organization_finance_settings where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.organization_memberships where organization_id=any($1::uuid[])', [stale]);
    await admin.query('delete from public.organizations where id=any($1::uuid[])', [stale]);
    if (actors.length) {
      await admin.query(`delete from public.performer_profiles profile where profile.id=any($1::uuid[])
        and not exists(select 1 from public.organization_memberships membership where membership.user_id=profile.id)`, [actors]);
      await admin.query(`delete from auth.users user_row where user_row.id=any($1::uuid[])
        and user_row.email like '%@example.invalid'
        and not exists(select 1 from public.organization_memberships membership where membership.user_id=user_row.id)`, [actors]);
    }
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

try {
  const prerequisites = (await admin.query(`select
    to_regclass('public.financial_transactions') is not null transactions,
    to_regclass('public.financial_postings') is not null postings,
    to_regprocedure('public.set_minuta_finance_enabled_v129(uuid,boolean)') is not null enable_v129`)).rows[0];
  assert.deepEqual(prerequisites, { transactions: true, postings: true, enable_v129: true });

  await cleanupKnownStaleFixtures();

  const existing = (await admin.query(`select
    to_regclass('public.financial_suppliers') is not null suppliers,
    to_regclass('public.financial_expense_sources') is not null sources`)).rows[0];
  if (existing.suppliers || existing.sources) {
    const supplierRows = existing.suppliers
      ? Number((await admin.query('select count(*)::bigint count from public.financial_suppliers')).rows[0].count)
      : 0;
    const sourceRows = existing.sources
      ? Number((await admin.query('select count(*)::bigint count from public.financial_expense_sources')).rows[0].count)
      : 0;
    assert.equal(supplierRows + sourceRows, 0, 'v132 test refuses to remove pre-existing expense data');
    await admin.query(rollback);
  }

  await admin.query(migration);
  await admin.query(migration);
  for (const signature of [
    'set_minuta_finance_enabled_v132(uuid,boolean)',
    'create_minuta_financial_supplier_v132(uuid,uuid,text)',
    'accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamp with time zone,uuid)',
    'pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)',
    'reverse_minuta_supplier_expense_payment_v132(uuid,uuid,uuid,text)',
    'reverse_minuta_supplier_expense_accrual_v132(uuid,uuid,uuid,text)'
  ]) {
    assert.equal((await admin.query('select to_regprocedure($1) is not null present', [`public.${signature}`])).rows[0].present, true);
  }
  await admin.query(rollback);
  assert.equal((await admin.query("select to_regclass('public.financial_suppliers') is null removed")).rows[0].removed, true);
  assert.equal((await admin.query("select to_regclass('public.financial_expense_sources') is null removed")).rows[0].removed, true);
  assert.equal((await admin.query("select to_regprocedure('public.set_minuta_finance_enabled_v132(uuid,boolean)') is null removed")).rows[0].removed, true);
  assert.equal((await admin.query("select to_regprocedure('public.set_minuta_finance_enabled_v129(uuid,boolean)') is not null preserved")).rows[0].preserved, true);
  await admin.query(migration);
  await admin.query(migration);

  await admin.query('begin');
  await admin.query("set local session_replication_role='replica'");
  await admin.query(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,now(),'{}','{}',now(),now()),
      ($2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$5,now(),'{}','{}',now(),now()),
      ($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$6,now(),'{}','{}',now(),now())`,
    [owner, specialist, outsider, `${owner}@example.invalid`, `${specialist}@example.invalid`, `${outsider}@example.invalid`]);
  await admin.query("set local session_replication_role='origin'");
  await admin.query("insert into public.performer_profiles(id,display_name) values($1,'D06 v132 owner'),($2,'D06 v132 specialist'),($3,'D06 v132 outsider')", [owner, specialist, outsider]);
  await admin.query(`insert into public.organizations(id,name,created_by,status)
    values($1,'D06 v132 expense test',$3,'active'),($2,'D06 v132 foreign test',$3,'active')`,
    [organization, foreignOrganization, owner]);
  await admin.query(`insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
    values($1,$2,'owner',false,true),($1,$3,'specialist',true,true),($4,$5,'owner',false,true)`,
    [organization, owner, specialist, foreignOrganization, outsider]);
  await admin.query('commit');
  fixtureCreated = true;

  const ownerClient = await connect('minuta-d06-v132-owner');
  const specialistClient = await connect('minuta-d06-v132-specialist');
  const outsiderClient = await connect('minuta-d06-v132-outsider');
  await asActor(ownerClient, owner);
  await asActor(specialistClient, specialist);
  await asActor(outsiderClient, outsider);

  await expectError(ownerClient.query(rpc.supplier, [organization, supplierRequest, 'Test supplier']), /finance_disabled/i, '55000');
  const enabled = resultOf(await ownerClient.query(rpc.enable, [organization, true]));
  assert.equal(enabled.enabled, true);
  const systemAccounts = (await admin.query(`select system_key,account_class,account_type,active from public.financial_accounts
    where organization_id=$1 and system_key in('receivable','service_revenue','operating_expense','supplier_payable')`, [organization])).rows;
  assert.deepEqual(systemAccounts.map(row => row.system_key).sort(), ['operating_expense', 'receivable', 'service_revenue', 'supplier_payable']);
  assert(systemAccounts.every(row => row.active));
  assert.equal(systemAccounts.find(row => row.system_key === 'operating_expense').account_class, 'expense');
  assert.equal(systemAccounts.find(row => row.system_key === 'supplier_payable').account_class, 'liability');
  const expenseAccount = systemAccounts.find(row => row.system_key === 'operating_expense');
  const expenseAccountId = (await admin.query("select id from public.financial_accounts where organization_id=$1 and system_key='operating_expense'", [organization])).rows[0].id;
  const payableAccountId = (await admin.query("select id from public.financial_accounts where organization_id=$1 and system_key='supplier_payable'", [organization])).rows[0].id;
  assert(expenseAccount);

  const cash = resultOf(await ownerClient.query(
    'select public.create_minuta_financial_account_v129($1,$2,$3,$4) result',
    [organization, randomUUID(), 'D06 v132 cash', 'cash']
  ));
  const bank = resultOf(await ownerClient.query(
    'select public.create_minuta_financial_account_v129($1,$2,$3,$4) result',
    [organization, randomUUID(), 'D06 v132 bank', 'bank']
  ));

  const supplier = resultOf(await ownerClient.query(rpc.supplier, [organization, supplierRequest, 'Test supplier']));
  const supplierReplay = resultOf(await ownerClient.query(rpc.supplier, [organization, supplierRequest, 'Test supplier']));
  assert.equal(supplier.id, supplierReplay.id);
  assert.equal(supplierReplay.replayed, true);
  await expectError(ownerClient.query(rpc.supplier, [organization, supplierRequest, 'Changed supplier']), /supplier.*idempotency_conflict/i, '23505');

  const occurredAt = new Date('2026-09-09T00:00:00.000Z');
  const accrual = resultOf(await ownerClient.query(rpc.accrue,
    [organization, supplier.id, expenseAccountId, 100000, occurredAt, accrualRequest]));
  const accrualReplay = resultOf(await ownerClient.query(rpc.accrue,
    [organization, supplier.id, expenseAccountId, 100000, occurredAt, accrualRequest]));
  assert.equal(accrual.id, accrualReplay.id);
  assert.equal(accrualReplay.replayed, true);
  await expectError(ownerClient.query(rpc.accrue,
    [organization, supplier.id, expenseAccountId, 100001, occurredAt, accrualRequest]), /accrual.*idempotency_conflict/i, '23505');
  const accrualTransaction = await transactionFor('supplier_expense_accrual', accrual.id);
  await assertBalanced(accrualTransaction);
  const accrualExplanation = (await admin.query(
    'select explanation from public.financial_transactions where id=$1', [accrualTransaction]
  )).rows[0].explanation;
  assert.equal(accrualExplanation.supplier_id, supplier.id);
  assert.equal(Number(accrualExplanation.amount_minor), 100000);
  assert.equal(Object.keys(accrualExplanation).some(key => /name|email|phone/i.test(key)), false);
  const accrualPostings = (await admin.query(`select account_id,side,amount_minor::bigint amount_minor
    from public.financial_postings where transaction_id=$1 order by side`, [accrualTransaction])).rows;
  assert.deepEqual(accrualPostings.map(row => [row.account_id, row.side, BigInt(row.amount_minor)]).sort(),
    [[expenseAccountId, 'debit', 100000n], [payableAccountId, 'credit', 100000n]].sort());

  const payment = resultOf(await ownerClient.query(rpc.pay, [organization, accrual.id, cash.id, paymentRequest]));
  const paymentReplay = resultOf(await ownerClient.query(rpc.pay, [organization, accrual.id, cash.id, paymentRequest]));
  assert.equal(payment.id, paymentReplay.id);
  assert.equal(paymentReplay.replayed, true);
  await expectError(ownerClient.query(rpc.pay, [organization, accrual.id, bank.id, paymentRequest]), /payment.*idempotency_conflict/i, '23505');
  await expectError(ownerClient.query(rpc.pay, [organization, accrual.id, bank.id, randomUUID()]), /expense.*already_paid/i, '23505');
  const paymentTransaction = await transactionFor('supplier_expense_payment', accrual.id);
  await assertBalanced(paymentTransaction);
  const paymentExplanation = (await admin.query(
    'select explanation from public.financial_transactions where id=$1', [paymentTransaction]
  )).rows[0].explanation;
  assert.equal(paymentExplanation.supplier_id, supplier.id);
  assert.equal(Number(paymentExplanation.amount_minor), 100000);
  assert.equal(paymentExplanation.destination_account_id, cash.id);
  const paymentPostings = (await admin.query(`select account_id,side,amount_minor::bigint amount_minor
    from public.financial_postings where transaction_id=$1 order by side`, [paymentTransaction])).rows;
  assert.deepEqual(paymentPostings.map(row => [row.account_id, row.side, BigInt(row.amount_minor)]).sort(),
    [[payableAccountId, 'debit', 100000n], [cash.id, 'credit', 100000n]].sort());

  await expectError(ownerClient.query(rpc.reverseAccrual,
    [organization, accrualTransaction, accrualReversalRequest, 'source_corrected']), /payment_must_be_reversed_first/i, '55000');
  const paymentReversal = resultOf(await ownerClient.query(rpc.reversePayment,
    [organization, paymentTransaction, paymentReversalRequest, 'payment_corrected']));
  const paymentReversalReplay = resultOf(await ownerClient.query(rpc.reversePayment,
    [organization, paymentTransaction, paymentReversalRequest, 'payment_corrected']));
  assert.equal(paymentReversal.id, paymentReversalReplay.id);
  assert.equal(paymentReversalReplay.replayed, true);
  await expectError(ownerClient.query(rpc.reversePayment,
    [organization, paymentTransaction, paymentReversalRequest, 'changed_reason']), /reversal.*idempotency_conflict/i, '23505');
  const accrualReversal = resultOf(await ownerClient.query(rpc.reverseAccrual,
    [organization, accrualTransaction, accrualReversalRequest, 'source_corrected']));
  const accrualReversalReplay = resultOf(await ownerClient.query(rpc.reverseAccrual,
    [organization, accrualTransaction, accrualReversalRequest, 'source_corrected']));
  assert.equal(accrualReversal.id, accrualReversalReplay.id);
  assert.equal(accrualReversalReplay.replayed, true);
  await expectError(ownerClient.query(rpc.reverseAccrual,
    [organization, accrualTransaction, accrualReversalRequest, 'changed_reason']), /reversal.*idempotency_conflict/i, '23505');
  const net = (await admin.query(`select coalesce(sum(case posting.side when 'debit' then posting.amount_minor else -posting.amount_minor end),0)::bigint net
    from public.financial_postings posting join public.financial_transactions transaction_row on transaction_row.id=posting.transaction_id
    where transaction_row.id in($1,$2) or transaction_row.reversal_of in($1,$2)`, [accrualTransaction, paymentTransaction])).rows[0].net;
  assert.equal(BigInt(net), 0n);

  const bankAccrualRequest = randomUUID();
  const bankAccrual = resultOf(await ownerClient.query(rpc.accrue,
    [organization, supplier.id, expenseAccountId, 50000, new Date('2026-09-09T00:01:00.000Z'), bankAccrualRequest]));
  const bankAccrualTransaction = await transactionFor('supplier_expense_accrual', bankAccrual.id);
  await assertBalanced(bankAccrualTransaction, 50000n);
  await expectError(ownerClient.query(rpc.pay,
    [organization, bankAccrual.id, expenseAccountId, randomUUID()]), /cash_or_bank_account_required/i, '22023');
  await admin.query('update public.financial_accounts set active=false where id=$1', [bank.id]);
  await expectError(ownerClient.query(rpc.pay,
    [organization, bankAccrual.id, bank.id, randomUUID()]), /payment_account_inactive/i, '55000');
  await admin.query('update public.financial_accounts set active=true where id=$1', [bank.id]);
  const bankPayment = resultOf(await ownerClient.query(rpc.pay,
    [organization, bankAccrual.id, bank.id, randomUUID()]));
  const bankPaymentTransaction = await transactionFor('supplier_expense_payment', bankAccrual.id);
  assert(bankPayment.id);
  await assertBalanced(bankPaymentTransaction, 50000n);
  const bankPaymentPostings = (await admin.query(`select account_id,side,amount_minor::bigint amount_minor
    from public.financial_postings where transaction_id=$1 order by side`, [bankPaymentTransaction])).rows;
  assert.deepEqual(bankPaymentPostings.map(row => [row.account_id, row.side, BigInt(row.amount_minor)]).sort(),
    [[payableAccountId, 'debit', 50000n], [bank.id, 'credit', 50000n]].sort());
  await ownerClient.query(rpc.reversePayment,
    [organization, bankPaymentTransaction, randomUUID(), 'payment_corrected']);
  await ownerClient.query(rpc.reverseAccrual,
    [organization, bankAccrualTransaction, randomUUID(), 'source_corrected']);

  await expectError(admin.query('update public.financial_expense_sources set occurred_at=occurred_at where id=$1', [accrual.id]), /financial_expense_source_is_immutable/i, '55000');
  await expectError(admin.query('update public.financial_transactions set occurred_at=occurred_at where id=$1', [accrualTransaction]), /financial_ledger_is_append_only/i, '55000');
  assert.equal((await outsiderClient.query('select count(*)::integer count from public.financial_suppliers where organization_id=$1', [organization])).rows[0].count, 0);
  assert.equal((await specialistClient.query('select count(*)::integer count from public.financial_expense_sources where organization_id=$1', [organization])).rows[0].count, 0);
  await expectError(outsiderClient.query(rpc.supplier, [organization, randomUUID(), 'Cross tenant']), /financial_manager_role_required/i, '42501');
  await expectError(specialistClient.query(rpc.supplier, [organization, randomUUID(), 'Role denied']), /financial_manager_role_required/i, '42501');
  await expectError(specialistClient.query(rpc.enable, [organization, true]), /financial_manager_role_required/i, '42501');

  await ownerClient.query(rpc.enable, [organization, false]);
  await expectError(ownerClient.query(rpc.supplier, [organization, randomUUID(), 'Disabled']), /finance_disabled/i, '55000');
  console.log('financial ledger v132 PostgreSQL: suppliers, accrual, payment, reversal order, RLS, rollback/reapply OK');
} finally {
  try {
    await admin.query('reset role');
    if (fixtureCreated) {
      await admin.query('begin');
      await admin.query("set local session_replication_role='replica'");
      await admin.query('delete from public.financial_expense_sources where organization_id=$1', [organization]);
      await admin.query('delete from public.financial_postings where organization_id=$1', [organization]);
      await admin.query('delete from public.financial_transactions where organization_id=$1', [organization]);
      await admin.query('delete from public.financial_suppliers where organization_id=$1', [organization]);
      await admin.query('delete from public.financial_accounts where organization_id=$1', [organization]);
      await admin.query('delete from public.organization_finance_settings where organization_id=$1', [organization]);
      await admin.query('delete from public.organization_memberships where organization_id in($1,$2)', [organization, foreignOrganization]);
      await admin.query('delete from public.organizations where id in($1,$2)', [organization, foreignOrganization]);
      await admin.query('delete from public.performer_profiles where id in($1,$2,$3)', [owner, specialist, outsider]);
      await admin.query('delete from auth.users where id in($1,$2,$3)', [owner, specialist, outsider]);
      await admin.query('commit');
    }
  } catch (cleanupError) {
    try { await admin.query('rollback'); } catch {}
    console.error(`v132 cleanup failed: ${cleanupError.message}`);
  }
  await Promise.allSettled(clients.map(client => client.end()));
}
