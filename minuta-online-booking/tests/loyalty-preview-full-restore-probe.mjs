// One privileged pg Client, one caller-owned transaction, one attested isolated PG17 restore.
// The caller's seedSyntheticFixture callback inserts only new synthetic keys inside our savepoint.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const O19_SOURCE_SHA256 = Object.freeze({
  apply: '10603064773020247c1e5e98141a49b9024085e8048329bbcff31f8e2c836daa',
  rollback: 'f8979d7e2e4ca7524113d332e28697645fe5997ca1133b904ccb730dfc394cac',
});
export const SYNTHETIC_ORGANIZATION_NAME = 'O19 full restore synthetic';
export const SYNTHETIC_CLIENT_NAME = 'O19 synthetic client';
export const FRESH_SCOPE_FIELDS = Object.freeze([
  'organization_exists', 'actor_exists', 'membership_exists', 'profile_exists',
  'client_exists', 'booking_exists', 'settings_exist', 'rules_exist',
  'accounts_exist', 'visits_exist', 'rewards_exist', 'history_exists',
]);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalizeLf = value => value.replace(/\r\n/g, '\n');
export function exactTransactionBody(source, expectedSha256) {
  const text = normalizeLf(source);
  if (sha256(text) !== expectedSha256) throw new Error('O19 SQL source hash mismatch');
  const wrapped = /^begin;\n([\s\S]*?)\ncommit;\n?$/i.exec(text);
  if (!wrapped) throw new Error('O19 SQL transaction framing changed');
  return wrapped[1];
}

const applySql = exactTransactionBody(
  readFileSync(new URL('../supabase-candidate-loyalty-adjustment-preview.sql', import.meta.url), 'utf8'),
  O19_SOURCE_SHA256.apply,
);
const rollbackSql = exactTransactionBody(
  readFileSync(new URL('../supabase-candidate-loyalty-adjustment-preview-rollback.sql', import.meta.url), 'utf8'),
  O19_SOURCE_SHA256.rollback,
);
const signatures = [
  'public.get_minuta_loyalty_program_role_v166(uuid)',
  'public.set_minuta_loyalty_program_v166(uuid,boolean,integer,text,integer,text,text,integer,uuid)',
  'public.adjust_minuta_loyalty_progress_v166(uuid,uuid,integer,text,uuid)',
  'public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)',
  'public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid)',
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const same = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
};
const loopback = new Set(['127.0.0.1', '::1', 'localhost']);

export function assertAttestedTarget(db, { attested, expectedDatabase, expectedPort }) {
  if (attested !== true) throw new Error('O19 full restore attestation required');
  if (typeof expectedDatabase !== 'string' ||
      !/^[a-z][a-z0-9_-]{2,62}$/i.test(expectedDatabase) ||
      ['postgres', 'template0', 'template1'].includes(expectedDatabase.toLowerCase())) {
    throw new Error('O19 named restore database required');
  }
  if (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535) {
    throw new Error('O19 expected restore port required');
  }
  const connection = db?.connectionParameters;
  if (!loopback.has(connection?.host) || connection.database !== expectedDatabase ||
      Number(connection.port) !== expectedPort) {
    throw new Error('O19 pg Client target does not match attested loopback restore');
  }
}

export function assertServerIdentity(identity, { expectedDatabase, expectedPort }) {
  assert.ok(identity?.version >= 170000 && identity.version < 180000, 'O19 probe requires PG17');
  assert.equal(identity.database, expectedDatabase, 'O19 database identity mismatch');
  assert.equal(identity.port, expectedPort, 'O19 server port mismatch');
  assert.ok(loopback.has(identity.server_addr) && loopback.has(identity.client_addr),
    'O19 server connection must be loopback TCP');
  assert.equal(identity.session_role, true, 'O19 probe requires a privileged session role');
  assert.equal(identity.superuser, true, 'O19 probe requires rolsuper');
  assert.equal(identity.recovery, false, 'O19 probe requires a writable isolated restore');
}

async function functionSnapshot(db) {
  const { rows } = await db.query(`select requested.signature, p.oid::text as oid,
    pg_get_functiondef(p.oid) as body, p.proacl::text as acl,
    p.proowner::text as owner, p.proconfig::text as config
    from unnest($1::text[]) with ordinality as requested(signature, position)
    left join pg_proc p on p.oid=to_regprocedure(requested.signature)
    order by requested.position`, [signatures]);
  return rows.map(({ body, ...entry }) => ({
    ...entry,
    body_sha256: body === null ? null : sha256(body),
  }));
}

async function freshScope(db, { org, ownerActor, adminActor, specialistActor, clientAccount }) {
  return one(db, `select
    exists(select 1 from public.organizations where id=$1) as organization_exists,
    exists(select 1 from auth.users where id=any($2::uuid[])) as actor_exists,
    exists(select 1 from public.organization_memberships where user_id=any($2::uuid[])
      or organization_id=$1) as membership_exists,
    exists(select 1 from public.performer_profiles where id=any($2::uuid[])) as profile_exists,
    exists(select 1 from public.client_accounts where id=$3) as client_exists,
    exists(select 1 from public.bookings where organization_id=$1 or client_account_id=$3) as booking_exists,
    exists(select 1 from public.loyalty_program_settings_v166 where organization_id=$1) as settings_exist,
    exists(select 1 from public.loyalty_program_rules_v166 where organization_id=$1) as rules_exist,
    exists(select 1 from public.loyalty_program_accounts_v166 where organization_id=$1
      or client_account_id=$3) as accounts_exist,
    exists(select 1 from public.loyalty_program_visits_v166 where organization_id=$1
      or client_account_id=$3) as visits_exist,
    exists(select 1 from public.loyalty_program_rewards_v166 where organization_id=$1
      or client_account_id=$3) as rewards_exist,
    exists(select 1 from public.loyalty_program_history_v166 where organization_id=$1
      or client_account_id=$3) as history_exists`,
  [org, [ownerActor, adminActor, specialistActor], clientAccount]);
}

export function assertFreshScope(scope) {
  for (const field of FRESH_SCOPE_FIELDS) {
    if (scope?.[field] !== false) throw new Error(`O19 synthetic scope is not fresh: ${field}`);
  }
}

async function requireSeededFixture(db, ids) {
  const { org, ownerActor, adminActor, specialistActor, clientAccount } = ids;
  const row = await one(db, `select
    exists(select 1 from public.organizations where id=$1 and name=$6 and status='active'
      and created_by=$2) as organization_ok,
    exists(select 1 from public.organization_memberships where organization_id=$1
      and user_id=$2 and role='owner' and active) as owner_ok,
    exists(select 1 from public.organization_memberships where organization_id=$1
      and user_id=$3 and role='admin' and active) as admin_ok,
    exists(select 1 from public.organization_memberships where organization_id=$1
      and user_id=$4 and role='specialist' and active) as specialist_ok,
    (select count(*)::integer from public.organization_memberships where organization_id=$1)
      as membership_count,
    exists(select 1 from public.client_accounts where id=$5) as client_ok,
    (select count(*)::integer from public.bookings where organization_id=$1) as booking_count,
    (select count(*)::integer from public.bookings where client_account_id=$5) as client_booking_count,
    exists(select 1 from public.bookings booking
      join public.booking_outcomes outcome on outcome.booking_id=booking.id
      where booking.organization_id=$1 and booking.client_account_id=$5
        and booking.client_name=$7 and booking.status<>'cancelled'
        and outcome.visit_status='scheduled') as scheduled_booking_ok,
    exists(select 1 from public.loyalty_program_settings_v166 where organization_id=$1) as has_settings,
    exists(select 1 from public.loyalty_program_rules_v166 where organization_id=$1) as has_rules,
    exists(select 1 from public.loyalty_program_accounts_v166 where organization_id=$1) as has_accounts,
    exists(select 1 from public.loyalty_program_visits_v166 where organization_id=$1) as has_visits,
    exists(select 1 from public.loyalty_program_rewards_v166 where organization_id=$1) as has_rewards,
    exists(select 1 from public.loyalty_program_history_v166 where organization_id=$1) as has_history`,
  [org, ownerActor, adminActor, specialistActor, clientAccount,
    SYNTHETIC_ORGANIZATION_NAME, SYNTHETIC_CLIENT_NAME]);
  for (const field of [
    'organization_ok', 'owner_ok', 'admin_ok', 'specialist_ok', 'client_ok', 'scheduled_booking_ok',
  ]) assert.equal(row[field], true, `O19 synthetic fixture lacks ${field}`);
  same([row.membership_count, row.booking_count, row.client_booking_count], [3, 1, 1],
    'O19 synthetic fixture has extra rows');
  for (const field of [
    'has_settings', 'has_rules', 'has_accounts', 'has_visits', 'has_rewards', 'has_history',
  ]) assert.equal(row[field], false, `O19 synthetic fixture has existing loyalty data: ${field}`);
}

async function scopedDataHash(db, org) {
  const row = await one(db, `select
    (select jsonb_agg(to_jsonb(s) order by s.organization_id)
      from public.loyalty_program_settings_v166 s where s.organization_id=$1) as settings,
    (select jsonb_agg(to_jsonb(r) order by r.id)
      from public.loyalty_program_rules_v166 r where r.organization_id=$1) as rules,
    (select jsonb_agg(to_jsonb(a) order by a.id)
      from public.loyalty_program_accounts_v166 a where a.organization_id=$1) as accounts,
    (select jsonb_agg(to_jsonb(v) order by v.booking_id)
      from public.loyalty_program_visits_v166 v where v.organization_id=$1) as visits,
    (select jsonb_agg(to_jsonb(r) order by r.id)
      from public.loyalty_program_rewards_v166 r where r.organization_id=$1) as rewards,
    (select jsonb_agg(to_jsonb(h) order by h.id)
      from public.loyalty_program_history_v166 h where h.organization_id=$1) as history,
    (select jsonb_agg(to_jsonb(b) order by b.id)
      from public.bookings b where b.organization_id=$1) as bookings`, [org]);
  return sha256(JSON.stringify(row));
}

async function asActor(db, actor, work) {
  await db.query('savepoint o19_probe_actor');
  try {
    await db.query('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    const result = await work();
    await db.query('reset role');
    await db.query('release savepoint o19_probe_actor');
    return result;
  } catch (error) {
    await db.query('rollback to savepoint o19_probe_actor');
    await db.query('release savepoint o19_probe_actor');
    throw error;
  }
}

async function expectSqlState(work, code, message) {
  let caught;
  try { await work(); } catch (error) { caught = error; }
  if (caught?.code !== code || (message && caught.message !== message)) {
    throw new Error(`O19 expected SQLSTATE ${code}${message ? ` (${message})` : ''}`);
  }
}

async function requireCandidateAcl(db) {
  const { rows } = await db.query(`select requested.signature,
    has_function_privilege('authenticated',requested.signature,'execute') as authenticated,
    has_function_privilege('anon',requested.signature,'execute') as anon,
    has_function_privilege('service_role',requested.signature,'execute') as service_role
    from unnest($1::text[]) as requested(signature)`, [signatures.slice(3)]);
  assert.equal(rows.length, 2, 'O19 candidate ACL snapshot incomplete');
  for (const row of rows) {
    same([row.authenticated, row.anon, row.service_role], [true, false, false],
      'O19 candidate ACL mismatch');
  }
}

export async function probe(db, {
  org, ownerActor, adminActor, specialistActor, clientAccount, seedSyntheticFixture,
  attested, expectedDatabase, expectedPort,
}) {
  assert.equal(typeof db?.query, 'function', 'O19 probe requires one pg Client');
  assert.equal(typeof seedSyntheticFixture, 'function', 'O19 probe requires a synthetic fixture callback');
  assertAttestedTarget(db, { attested, expectedDatabase, expectedPort });
  const ids = Object.freeze({ org, ownerActor, adminActor, specialistActor, clientAccount });
  for (const [name, id] of Object.entries(ids)) assert.ok(uuid.test(id), `O19 ${name} must be UUID`);
  assert.equal(new Set(Object.values(ids).map(id => id.toLowerCase())).size, 5,
    'O19 synthetic IDs must be distinct');

  // A SAVEPOINT without BEGIN fails; the probe never opens or commits its own transaction.
  const savepoint = `o19_full_restore_${randomUUID().replaceAll('-', '')}`;
  await db.query(`savepoint ${savepoint}`);
  let original;
  let result;
  try {
    const identity = await one(db, `select current_setting('server_version_num')::integer as version,
      current_database() as database, inet_server_addr()::text as server_addr,
      inet_client_addr()::text as client_addr, inet_server_port()::integer as port,
      current_user=session_user as session_role, pg_is_in_recovery() as recovery,
      (select rolsuper from pg_roles where rolname=current_user) as superuser`);
    assertServerIdentity(identity, { expectedDatabase, expectedPort });
    original = await functionSnapshot(db);
    assert.ok(original.slice(0, 3).every(entry => entry.oid !== null), 'O19 v166 prerequisite missing');
    assert.ok(original.slice(3).every(entry => entry.oid === null), 'O19 candidate already present');
    assertFreshScope(await freshScope(db, ids));

    await seedSyntheticFixture(db, ids);
    await requireSeededFixture(db, ids);
    const replication = await one(db, 'select current_setting(\'session_replication_role\') as role');
    assert.equal(replication.role, 'origin', 'O19 fixture must restore ordinary trigger execution');
    const outsiderClient = randomUUID();
    const outsider = await one(db, `select exists(select 1 from public.client_accounts where id=$1)
      or exists(select 1 from public.bookings where client_account_id=$1) as exists`, [outsiderClient]);
    assert.equal(outsider.exists, false, 'O19 outsider ID is not fresh');

    await db.query(applySql);
    const applied = await functionSnapshot(db);
    same(applied.slice(0, 3), original.slice(0, 3), 'O19 apply changed existing v166 functions');
    assert.ok(applied.slice(3).every(entry => entry.oid !== null), 'O19 apply left a function missing');
    await requireCandidateAcl(db);

    const preview = (who, delta, account = clientAccount) => asActor(db, who, async () =>
      (await one(db, 'select public.preview_minuta_loyalty_adjustment_v166($1,$2,$3) as result',
        [org, account, delta])).result);
    const confirm = (who, delta, requestId, snapshot) => asActor(db, who, async () =>
      (await one(db, `select public.confirm_minuta_loyalty_adjustment_v166(
        $1,$2,$3,'O19 synthetic adjustment',$4,$5,$6,$7) as result`,
      [org, clientAccount, delta, requestId,
        snapshot.before, snapshot.cycle_number, snapshot.rule_id])).result);
    const legacy = (delta, requestId) => asActor(db, ownerActor, async () =>
      (await one(db, `select public.adjust_minuta_loyalty_progress_v166(
        $1,$2,$3,'O19 synthetic legacy adjustment',$4) as result`,
      [org, clientAccount, delta, requestId])).result);
    const program = (enabled, requestId) => asActor(db, ownerActor, async () =>
      (await one(db, `select public.set_minuta_loyalty_program_v166(
        $1,$2,2,'percent',1000,'O19 synthetic reward','Synthetic only',null,$3) as result`,
      [org, enabled, requestId])).result);

    await expectSqlState(() => preview(ownerActor, 1), '55000', 'loyalty_program_disabled');
    await program(true, randomUUID());
    const beforePreview = await scopedDataHash(db, org);
    const first = await preview(ownerActor, 1);
    same([first.before, first.after, first.delta, first.goal_visits, first.allowed,
      first.reaches_goal, first.cycle_number], [0, 1, 1, 2, true, false, 1],
    'O19 first preview mismatch');
    assert.equal(await scopedDataHash(db, org), beforePreview, 'O19 preview changed synthetic data');
    const adminPreview = await preview(adminActor, 1);
    same(adminPreview, first, 'O19 admin preview differs from owner');
    await expectSqlState(() => preview(specialistActor, 1), '42501',
      'loyalty_program_management_denied');
    await expectSqlState(() => preview(ownerActor, 1, outsiderClient), '42501',
      'loyalty_client_not_in_organization');
    await expectSqlState(() => preview(ownerActor, 0), '22023',
      'invalid_loyalty_progress_adjustment');
    await expectSqlState(() => preview(ownerActor, 101), '22023',
      'invalid_loyalty_progress_adjustment');
    const tooHigh = await preview(ownerActor, 3);
    same([tooHigh.after, tooHigh.allowed], [3, false], 'O19 high boundary mismatch');
    const belowZero = await preview(ownerActor, -1);
    same([belowZero.after, belowZero.allowed], [-1, false], 'O19 low boundary mismatch');
    await expectSqlState(() => confirm(ownerActor, -1, randomUUID(), belowZero),
      '22023', 'invalid_loyalty_progress_result');
    await expectSqlState(() => confirm(specialistActor, 1, randomUUID(), first),
      '42501', 'loyalty_program_management_denied');

    const firstRequest = randomUUID();
    const firstResult = await confirm(adminActor, 1, firstRequest, first);
    same([firstResult.progress, firstResult.recovered], [1, false], 'O19 confirmed progress mismatch');
    const retry = await confirm(ownerActor, 1, firstRequest, first);
    assert.equal(retry.recovered, true, 'O19 idempotent retry failed');
    const goalPreview = await preview(ownerActor, 1);
    same([goalPreview.before, goalPreview.after, goalPreview.reaches_goal], [1, 2, true],
      'O19 goal preview mismatch');
    const legacyResult = await legacy(1, randomUUID());
    assert.ok(legacyResult.reward_id, 'O19 legacy writer did not reach goal');
    await expectSqlState(() => confirm(ownerActor, 1, randomUUID(), goalPreview),
      '55000', 'loyalty_adjustment_preview_stale');
    const secondCycle = await preview(ownerActor, -1);
    same([secondCycle.before, secondCycle.cycle_number, secondCycle.allowed], [0, 2, false],
      'O19 post-reward cycle mismatch');

    // A redeemed reward whose source visit is later cancelled leaves -1 manual debt in v166.
    // Reproduce only that persisted state on our own account, then discard the setup and proof.
    const beforeDebt = await scopedDataHash(db, org);
    await db.query('savepoint o19_negative_debt');
    try {
      const redeemed = await db.query(`update public.loyalty_program_rewards_v166
        set status='redeemed',redeemed_at=now(),updated_at=now()
        where id=$1 and organization_id=$2 and client_account_id=$3 and status='pending'
        returning id`, [legacyResult.reward_id, org, clientAccount]);
      assert.equal(redeemed.rowCount, 1, 'O19 synthetic reward not available for debt setup');
      const indebted = await db.query(`update public.loyalty_program_accounts_v166
        set manual_progress=-1,updated_at=now()
        where organization_id=$1 and client_account_id=$2
          and cycle_number=2 and manual_progress=0
        returning id`, [org, clientAccount]);
      assert.equal(indebted.rowCount, 1, 'O19 synthetic account not available for debt setup');
      const debtPreview = await preview(ownerActor, 1);
      same([debtPreview.before, debtPreview.after, debtPreview.allowed, debtPreview.reaches_goal],
        [-1, 0, true, false], 'O19 negative debt compensation preview mismatch');
      const underDebt = await preview(ownerActor, -1);
      same([underDebt.before, underDebt.after, underDebt.allowed], [-1, -2, false],
        'O19 negative result boundary mismatch');
      await expectSqlState(() => confirm(ownerActor, -1, randomUUID(), underDebt),
        '22023', 'invalid_loyalty_progress_result');
      const compensated = await confirm(ownerActor, 1, randomUUID(), debtPreview);
      same([compensated.progress, compensated.recovered], [0, false],
        'O19 negative debt compensation mismatch');
      const compensatedPreview = await preview(ownerActor, 1);
      same([compensatedPreview.before, compensatedPreview.after], [0, 1],
        'O19 compensated debt did not return to zero');
    } finally {
      await db.query('rollback to savepoint o19_negative_debt');
      await db.query('release savepoint o19_negative_debt');
    }
    assert.equal(await scopedDataHash(db, org), beforeDebt,
      'O19 debt proof changed the main synthetic sequence');

    const beforeRollback = await scopedDataHash(db, org);
    await db.query(rollbackSql);
    same(await functionSnapshot(db), original, 'O19 rollback changed original function bodies or ACL');
    assert.equal(await scopedDataHash(db, org), beforeRollback, 'O19 rollback changed synthetic data');
    const legacyAfterRollback = await legacy(1, randomUUID());
    same([legacyAfterRollback.progress, legacyAfterRollback.recovered], [1, false],
      'O19 legacy writer failed after rollback');

    await db.query(applySql);
    same((await functionSnapshot(db)).slice(0, 3), original.slice(0, 3),
      'O19 reapply changed existing v166 functions');
    await requireCandidateAcl(db);
    const reapplied = await preview(adminActor, 1);
    same([reapplied.before, reapplied.after, reapplied.cycle_number, reapplied.reaches_goal],
      [1, 2, 2, true], 'O19 reapply preview mismatch');
    const reappliedResult = await confirm(ownerActor, 1, randomUUID(), reapplied);
    assert.ok(reappliedResult.reward_id, 'O19 reapply did not reach goal');
    const beforeFinalRollback = await scopedDataHash(db, org);
    await db.query(rollbackSql);
    same(await functionSnapshot(db), original, 'O19 second rollback changed original functions');
    assert.equal(await scopedDataHash(db, org), beforeFinalRollback,
      'O19 second rollback changed synthetic data');
    result = {
      previewReadOnly: true, boundaries: true, roles: true, stale: true,
      legacy: true, retry: true, negativeDebt: true, rollback: true, reapply: true,
    };
  } finally {
    await db.query(`rollback to savepoint ${savepoint}`);
    await db.query(`release savepoint ${savepoint}`);
    if (original) same(await functionSnapshot(db), original,
      'O19 savepoint did not restore original function bodies or ACL');
    assertFreshScope(await freshScope(db, ids));
  }
  return { ...result, savepointRestored: true };
}

export default probe;
