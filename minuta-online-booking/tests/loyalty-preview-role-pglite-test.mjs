import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite');
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const apply = process.env.O19_ROLE_APPLY_SQL_PATH
  ? readFileSync(process.env.O19_ROLE_APPLY_SQL_PATH, 'utf8').replace(/\r\n/g, '\n')
  : read('../supabase-candidate-loyalty-adjustment-preview.sql');
const rollback = read('../supabase-candidate-loyalty-adjustment-preview-rollback.sql');
const migration = read('../supabase-migration-v166.sql');
const fixture = read('./loyalty-preview-native-fixture.sql');
const hash = value => createHash('sha256').update(value).digest('hex');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const org = id(10), foreignOrg = id(11), client = id(20), owner = id(1);
const admin = id(2), specialist = id(3), outsider = id(4), revoked = id(5);
const absent = id(6), inactive = id(7);
const db = new PGlite(); // No path/URL: disposable in-memory Source fixture only.
const q = async (sql, parameters = []) => (await db.query(sql, parameters)).rows;
const one = async (sql, parameters = []) => (await q(sql, parameters))[0];
let count = 0;
const done = label => { count++; console.log('PASS ' + label); };

async function api(actor, sql, parameters) {
  await q("select set_config('test.uid',$1,false)", [actor]);
  await db.exec('set role authenticated');
  try { return (await one(sql, parameters)).value; }
  finally { await db.exec('reset role'); }
}
const preview = actor => api(actor,
  'select public.preview_minuta_loyalty_adjustment_v166($1,$2,1) value', [org, client]);
const confirm = (actor, snapshot, request, delta = 1) => api(actor,
  'select public.confirm_minuta_loyalty_adjustment_v166($1,$2,$3,$4,$5,$6,$7,$8) value',
  [org, client, delta, 'O19 synthetic role proof', request,
    snapshot.before, snapshot.cycle_number, snapshot.rule_id]);
async function protectedData() {
  const rows = {};
  for (const name of ['organizations', 'organization_memberships', 'bookings',
    'booking_outcomes', 'loyalty_program_settings_v166', 'loyalty_program_rules_v166',
    'loyalty_program_accounts_v166', 'loyalty_program_visits_v166',
    'loyalty_program_rewards_v166', 'loyalty_program_history_v166']) {
    rows[name] = await q('select to_jsonb(t) value from public.' + name +
      ' t order by to_jsonb(t)::text');
  }
  return hash(JSON.stringify(rows));
}
async function denial(actor, snapshot, request, label) {
  const before = await protectedData();
  for (const [action, run] of [['preview', () => preview(actor)],
    ['confirm', () => confirm(actor, snapshot, request)]]) {
    let denied = false;
    try { await run(); } catch (error) {
      assert.equal(error.code, '42501', label + ' ' + action + ' SQLSTATE');
      assert.equal(error.message, 'loyalty_program_management_denied');
      denied = true;
    }
    assert.equal(denied, true, label + ' ' + action + ' must be denied');
    assert.equal(await protectedData(), before, label + ' ' + action + ' preserves data');
    done(label + ': ' + action + ' denied by actual SQL without writes');
  }
}
async function primitiveDefinitions() {
  return await q("select p.oid, p.proname, pg_get_functiondef(p.oid) body, p.proacl " +
    "from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
    "where n.nspname='public' and p.proname like '%minuta_loyalty%v166' " +
    "and p.proname not in ('preview_minuta_loyalty_adjustment_v166'," +
    "'confirm_minuta_loyalty_adjustment_v166') order by p.oid");
}
try {
  await db.exec(fixture);
  await q('insert into auth.users(id) values($1),($2),($3),($4),($5),($6)',
    [admin, specialist, outsider, revoked, absent, inactive]);
  await q('insert into organizations(id) values($1)', [foreignOrg]);
  for (const [organization, actor, role, active] of [
    [org, admin, 'admin', true], [org, specialist, 'specialist', true],
    [foreignOrg, outsider, 'owner', true], [org, revoked, 'owner', true],
    [org, inactive, 'admin', false]]) {
    await q('insert into organization_memberships values($1,$2,$3,$4)',
      [organization, actor, role, active]);
  }
  await db.exec(migration);
  await api(owner, 'select public.set_minuta_loyalty_program_v166($1,true,2,$2,null,$3,null,null,$4) value',
    [org, 'text', 'O19 synthetic reward', id(100)]);
  await q("insert into bookings(id,organization_id,client_account_id,status,booking_date,booking_time,client_name) " +
    "values($1,$2,$3,'active',current_date,'10:00','O19 synthetic client')", [id(200), org, client]);
  await q("insert into booking_outcomes values($1,'scheduled')", [id(200)]);
  const originals = await primitiveDefinitions();
  await db.exec(apply);
  const first = await preview(owner);
  assert.deepEqual([first.before, first.after, first.allowed], [0, 1, true]);
  assert.deepEqual(await preview(admin), first);
  done('Owner/admin exact preview and unchanged current helper');
  await denial(absent, first, id(110), 'Absent membership');
  await denial(inactive, first, id(111), 'Inactive membership');
  await q('delete from organization_memberships where organization_id=$1 and user_id=$2', [org, revoked]);
  await denial(revoked, first, id(112), 'Revoked membership');
  await denial(outsider, first, id(113), 'Outsider actor with valid organization client');
  await q("update organizations set status='inactive' where id=$1", [org]);
  await denial(owner, first, id(114), 'Inactive organization');
  await q("update organizations set status='active' where id=$1", [org]);
  await denial(specialist, first, id(115), 'Specialist remains unauthorized');

  const retained = await preview(owner);
  await q('update organization_memberships set active=false where organization_id=$1 and user_id=$2', [org, owner]);
  const revokedData = await protectedData();
  await assert.rejects(() => confirm(owner, retained, id(120)), error =>
    error.code === '42501' && error.message === 'loyalty_program_management_denied');
  assert.equal(await protectedData(), revokedData);
  done('Revocation after permitted preview blocks confirmation without writes');
  await q('update organization_memberships set active=true where organization_id=$1 and user_id=$2', [org, owner]);
  const applied = await confirm(owner, retained, id(120));
  assert.equal(applied.progress, 1);
  assert.equal((await confirm(owner, retained, id(120))).recovered, true);
  done('Reactivated owner confirms once; identical request id recovers');
  await q('update organization_memberships set active=false where organization_id=$1 and user_id=$2', [org, owner]);
  const beforeRetry = await protectedData();
  await assert.rejects(() => confirm(owner, retained, id(120)), error =>
    error.code === '42501' && error.message === 'loyalty_program_management_denied');
  assert.equal(await protectedData(), beforeRetry);
  done('Revoked owner cannot use the existing idempotent history branch');
  await q('update organization_memberships set active=true where organization_id=$1 and user_id=$2', [org, owner]);

  await assert.rejects(() => confirm(owner, retained, id(121)), error =>
    error.code === '55000' && error.message === 'loyalty_adjustment_preview_stale');
  done('Exact-before stale rejection retained');
  const goal = await preview(owner);
  assert.deepEqual([goal.before, goal.after, goal.allowed, goal.reaches_goal], [1, 2, true, true]);
  const earned = await confirm(admin, goal, id(122));
  assert.ok(earned.reward_id);
  assert.equal((await confirm(admin, goal, id(122))).recovered, true);
  assert.equal((await one('select count(*)::integer value from loyalty_program_rewards_v166')).value, 1);
  done('Goal boundary creates exactly one reward; retry remains idempotent');

  for (const delta of [0, 101, -101]) await assert.rejects(() =>
    api(owner, 'select public.preview_minuta_loyalty_adjustment_v166($1,$2,$3) value',
      [org, client, delta]), error => error.code === '22023');
  for (const delta of [-1, 3]) {
    const outside = await api(owner, 'select public.preview_minuta_loyalty_adjustment_v166($1,$2,$3) value',
      [org, client, delta]);
    assert.equal(outside.allowed, false);
    await assert.rejects(() => confirm(owner, outside, id(130 + delta), delta),
      error => error.code === '22023' && error.message === 'invalid_loyalty_progress_result');
  }
  done('Original delta and result boundaries retained');
  const acl = await one("select " +
    "has_function_privilege('authenticated','public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)','EXECUTE') authenticated," +
    "has_function_privilege('anon','public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)','EXECUTE') anon," +
    "has_function_privilege('service_role','public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid)','EXECUTE') service_role");
  assert.deepEqual([acl.authenticated, acl.anon, acl.service_role], [true, false, false]);
  done('Candidate endpoint EXECUTE ACL retained');

  const beforeRollback = await protectedData();
  await db.exec(rollback);
  const removed = await one("select " +
    "to_regprocedure('public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)') is null preview," +
    "to_regprocedure('public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid)') is null confirm");
  assert.deepEqual([removed.preview, removed.confirm], [true, true]);
  assert.equal(await protectedData(), beforeRollback);
  assert.deepEqual(await primitiveDefinitions(), originals);
  done('Unchanged rollback removes only new endpoints; data and legacy bodies/ACL/OIDs preserved');
  await db.exec(apply);
  await denial(absent, await preview(owner), id(140), 'Reapplied guard absent membership');
  assert.deepEqual(await primitiveDefinitions(), originals);
  done('Guard reapply compatible with legacy Source definitions');
  console.log(JSON.stringify({passed:count,runtime:'PGlite0.3.14 in-memory',actualSourceDefinitions:true,
    applySha256:hash(apply),rollbackSha256:hash(rollback),legacySha256:hash(migration),
    production:false,network:false,restored:false,nativeConcurrentProof:false}));
} finally {
  await db.close();
}
