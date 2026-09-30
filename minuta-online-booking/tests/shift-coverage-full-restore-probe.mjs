// Called with one privileged pg Client already inside an attested, isolated PG17 restore transaction.
// The caller supplies fresh synthetic organization, location, and membership rows.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const O08_SOURCE_SHA256 = Object.freeze({
  apply: '5088032dd2411eeec50e84d21235fdca843d95aa37d737ad11986c78ddaf3d87',
  rollback: 'a19ab8d388a129b0bcb54ed1de619c79e6cb8207a69ec8fb1e732f124da77b45',
});

const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalized = value => value.replace(/\r\n/g, '\n');

export function exactTransactionBody(source, expectedSha256) {
  const text = normalized(source);
  if (sha256(text) !== expectedSha256) throw new Error('O08 SQL source hash mismatch');
  const wrapped = /^begin;\n([\s\S]*?)\ncommit;\n?$/i.exec(text);
  if (!wrapped) throw new Error('O08 SQL transaction framing changed');
  return wrapped[1];
}

const applySql = exactTransactionBody(
  readFileSync(new URL('../supabase-candidate-shift-coverage.sql', import.meta.url), 'utf8'),
  O08_SOURCE_SHA256.apply,
);
const rollbackSql = exactTransactionBody(
  readFileSync(new URL('../supabase-candidate-shift-coverage-rollback.sql', import.meta.url), 'utf8'),
  O08_SOURCE_SHA256.rollback,
);

const signatures = [
  'public.set_minuta_branch_shifts_enabled(uuid,boolean)',
  'public.set_minuta_branch_shifts_enabled_v71_core(uuid,boolean)',
  'public.preview_minuta_shift_coverage(uuid)',
  'public.set_minuta_branch_shifts_enabled_v2(uuid,boolean,boolean,text)',
];
const value = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const same = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
};
const sqlDate = (start, offset) => {
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function functionSnapshot(db) {
  const { rows } = await db.query(`
    select requested.signature, p.oid::text as oid, pg_get_functiondef(p.oid) as body,
      p.proacl::text as acl, p.proowner::text as owner, p.proconfig::text as config
    from unnest($1::text[]) with ordinality as requested(signature, position)
    left join pg_proc p on p.oid=to_regprocedure(requested.signature)
    order by requested.position`, [signatures]);
  return rows.map(({ body, ...entry }) => ({
    ...entry,
    body_sha256: body === null ? null : sha256(body),
  }));
}

async function asActor(db, actor, work) {
  await db.query('savepoint o08_probe_actor');
  try {
    await db.query('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    const result = await work();
    await db.query('reset role');
    await db.query('release savepoint o08_probe_actor');
    return result;
  } catch (error) {
    await db.query('rollback to savepoint o08_probe_actor');
    await db.query('release savepoint o08_probe_actor');
    throw error;
  }
}

async function expectSqlState(work, code, message) {
  let error;
  try { await work(); } catch (caught) { error = caught; }
  if (error?.code !== code || (message && error.message !== message)) {
    throw new Error(`O08 expected SQLSTATE ${code}${message ? ` (${message})` : ''}`);
  }
}

async function requireSyntheticScope(db, { org, actor, location, adminActor, specialistActor }) {
  const identity = await value(db, `select current_setting('server_version_num')::integer as version,
    current_user=session_user as session_role`);
  assert.ok(identity.version >= 170000 && identity.version < 180000, 'O08 full restore probe requires PG17');
  assert.equal(identity.session_role, true, 'O08 probe requires a privileged session role');
  const scope = await value(db, `select
    exists(select 1 from public.organizations where id=$1 and status='active') as organization_ok,
    exists(select 1 from public.locations where id=$2 and organization_id=$1 and active) as location_ok,
    exists(select 1 from public.organization_memberships where organization_id=$1 and user_id=$3
      and role='owner' and active) as owner_ok,
    exists(select 1 from public.organization_memberships where organization_id=$1 and user_id=$4
      and role='admin' and active) as admin_ok,
    exists(select 1 from public.organization_memberships where organization_id=$1 and user_id=$5
      and role='specialist' and active and is_bookable) as specialist_ok,
    exists(select 1 from public.performer_profiles where id=$5) as performer_ok,
    exists(select 1 from public.staff_location_shifts where organization_id=$1) as has_shifts,
    exists(select 1 from public.staff_absences where organization_id=$1) as has_absences,
    exists(select 1 from public.bookings where organization_id=$1) as has_bookings,
    exists(select 1 from public.organization_shift_settings where organization_id=$1) as has_settings,
    exists(select 1 from public.organization_shift_settings where organization_id<>$1 and enabled)
      as foreign_strict_enabled`, [org, location, actor, adminActor, specialistActor]);
  for (const field of [
    'organization_ok', 'location_ok', 'owner_ok', 'admin_ok', 'specialist_ok', 'performer_ok',
  ]) {
    assert.equal(scope[field], true, `O08 synthetic fixture lacks ${field}`);
  }
  for (const field of ['has_shifts', 'has_absences', 'has_bookings', 'has_settings']) {
    assert.equal(scope[field], false, `O08 synthetic fixture is not empty: ${field}`);
  }
  return scope.foreign_strict_enabled;
}

async function requireCandidateAcl(db) {
  const { rows } = await db.query(`select requested.signature,
    has_function_privilege('authenticated',requested.signature,'execute') as authenticated,
    has_function_privilege('anon',requested.signature,'execute') as anon,
    has_function_privilege('service_role',requested.signature,'execute') as service_role
    from unnest($1::text[]) as requested(signature)`, [signatures]);
  assert.equal(rows.length, signatures.length, 'O08 ACL snapshot incomplete');
  for (const row of rows) {
    assert.equal(row.authenticated, !row.signature.includes('_v71_core'), 'O08 authenticated ACL mismatch');
    assert.equal(row.anon, false, 'O08 anon ACL mismatch');
    assert.equal(row.service_role, false, 'O08 service_role ACL mismatch');
  }
}

export async function probe(db, { org, actor, location, adminActor, specialistActor }) {
  assert.equal(typeof db?.query, 'function', 'O08 probe requires a single pg Client');
  for (const [name, id] of Object.entries({ org, actor, location, adminActor, specialistActor })) {
    assert.ok(uuid.test(id), `O08 probe requires a UUID for ${name}`);
  }
  assert.equal(new Set([actor, adminActor, specialistActor].map(id => id.toLowerCase())).size, 3,
    'O08 probe actors must be distinct');

  // SAVEPOINT itself rejects a connection outside the caller's transaction.
  const savepoint = `o08_full_restore_${randomUUID().replaceAll('-', '')}`;
  await db.query(`savepoint ${savepoint}`);
  let original;
  let result;
  try {
    original = await functionSnapshot(db);
    assert.ok(original[0].oid, 'O08 prerequisite v71 function missing');
    assert.ok(original.slice(1).every(entry => entry.oid === null), 'O08 candidate already present');
    const foreignStrictEnabled = await requireSyntheticScope(db,
      { org, actor, location, adminActor, specialistActor });
    const clock = await value(db, "select timezone('Europe/Samara',now())::time::text as local_time");
    assert.ok(clock.local_time > '00:00:02',
      'O08 probe needs a new outer transaction after the first two Samara seconds');

    await db.query(applySql);
    const applied = await functionSnapshot(db);
    assert.ok(applied.every(entry => entry.oid !== null), 'O08 apply left a function missing');
    await requireCandidateAcl(db);

    const preview = () => asActor(db, actor, async () =>
      (await value(db, 'select public.preview_minuta_shift_coverage($1) as result', [org])).result);
    const enable = (who, flag, confirm = false, token = null) => asActor(db, who, async () =>
      (await value(db, `select public.set_minuta_branch_shifts_enabled_v2(
        $1,$2,$3,$4) as result`, [org, flag, confirm, token])).result);
    const legacy = (flag) => asActor(db, actor, async () =>
      (await value(db, 'select public.set_minuta_branch_shifts_enabled($1,$2) as result',
        [org, flag])).result);
    const shift = (id, date, start, end, breakStart = null, breakEnd = null) => asActor(db, actor, async () =>
      (await value(db, `select public.upsert_minuta_staff_shift(
        $1,$2,$3,$4,$5::date,$6::time,$7::time,$8::time,$9::time,'O08 isolated probe') as id`,
      [org, id, location, specialistActor, date, start, end, breakStart, breakEnd])).id);

    const zero = await preview();
    same([zero.status, zero.covered_days, zero.horizon_days], ['zero', 0, 14], 'O08 zero coverage mismatch');
    await expectSqlState(() => legacy(true), '55000', 'shift_coverage_zero');
    await expectSqlState(() => enable(actor, true), '55000', 'shift_coverage_zero');
    for (const who of [adminActor, specialistActor]) {
      await expectSqlState(() => asActor(db, who, async () =>
        value(db, 'select public.preview_minuta_shift_coverage($1)', [org])), '42501', 'owner_required');
      await expectSqlState(() => enable(who, true), '42501', 'owner_required');
    }

    const today = zero.horizon_start;
    let todayShift = await shift(null, today, '00:00:00', '00:00:01');
    const elapsed = await preview();
    same([elapsed.status, elapsed.covered_days], ['zero', 0],
      'O08 elapsed today shift counted');
    todayShift = await shift(todayShift, today, '00:00:00', '24:00:00', '00:00:01', '24:00:00');
    assert.equal((await preview()).status, 'zero', 'O08 full remaining break counted');
    await shift(todayShift, today, '00:00:00', '24:00:00', '00:00:01', '12:00:00');
    const partial = await preview();
    same([partial.status, partial.covered_days, partial.missing_dates.includes(today)],
      ['partial', 1, false], 'O08 today remaining coverage mismatch');
    await expectSqlState(() => legacy(true), '55000', 'shift_coverage_confirmation_required');

    await shift(null, sqlDate(today, 1), '09:00:00', '18:00:00');
    await expectSqlState(() => enable(actor, true, true, partial.token), '55000',
      'shift_coverage_preview_stale');
    const refreshed = await preview();
    same([refreshed.status, refreshed.covered_days], ['partial', 2], 'O08 partial coverage mismatch');
    assert.equal(await enable(actor, true, true, refreshed.token), true);
    assert.equal(await enable(actor, false), false);
    for (let offset = 2; offset < 14; offset += 1) {
      await shift(null, sqlDate(today, offset), '09:00:00', '18:00:00');
    }
    const full = await preview();
    same([full.status, full.covered_days, full.missing_dates.length],
      ['full', 14, 0], 'O08 full coverage mismatch');
    assert.equal(await legacy(true), true, 'O08 legacy full activation failed');
    assert.equal(await legacy(false), false, 'O08 final disable failed');
    const disabled = await value(db, `select enabled from public.organization_shift_settings
      where organization_id=$1`, [org]);
    assert.equal(disabled?.enabled, false, 'O08 synthetic organization must be disabled before rollback');
    const foreignAfter = await value(db, `select exists(select 1 from public.organization_shift_settings
      where organization_id<>$1 and enabled) as enabled`, [org]);
    assert.equal(foreignAfter.enabled, foreignStrictEnabled,
      'O08 probe changed another organization strict state');

    await db.query('savepoint o08_rollback_check');
    if (foreignStrictEnabled) {
      let error;
      try { await db.query(rollbackSql); } catch (caught) { error = caught; }
      await db.query('rollback to savepoint o08_rollback_check');
      await db.query('release savepoint o08_rollback_check');
      if (error?.code !== '55000' || error.message !== 'disable_branch_shifts_before_coverage_rollback') {
        throw new Error('O08 rollback must refuse while another organization is strict enabled');
      }
      same(await functionSnapshot(db), applied, 'O08 failed rollback changed candidate functions');
    } else {
      await db.query(rollbackSql);
      await db.query('release savepoint o08_rollback_check');
      same(await functionSnapshot(db), original, 'O08 operational rollback changed original bodies or ACL');
    }
    result = {
      zero: true, elapsedToday: true, fullBreak: true, remainingToday: true,
      partial: true, staleToken: true, full: true, roles: true, legacy: true,
      disabledBeforeRollback: true,
      operationalRollback: foreignStrictEnabled ? 'guard_refused_55000' : 'restored',
    };
  } finally {
    await db.query(`rollback to savepoint ${savepoint}`);
    await db.query(`release savepoint ${savepoint}`);
    if (original) same(await functionSnapshot(db), original,
      'O08 savepoint did not restore original function bodies or ACL');
  }
  return { ...result, savepointRestored: true };
}

export default probe;
