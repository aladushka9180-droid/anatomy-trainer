#!/usr/bin/env node
// SQL generator only: no network, credentials, or database execution.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const [phase, output] = process.argv.slice(2);
assert(['test', 'validate', 'apply'].includes(phase) && output, 'Usage: node platform-release.mjs test|validate|apply OUTPUT.sql');
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = text => createHash('sha256').update(text).digest('hex');
const manifest = [];
function source(name, terminator = 'commit') {
  const bytes = readFileSync(resolve(app, name));
  manifest.push({ file: name, sha256: digest(bytes) });
  const sql = bytes.toString('utf8').replaceAll('\r\n', '\n');
  const lines = sql.split('\n');
  const start = lines.findIndex(line => /^begin;$/i.test(line.trim()));
  const ends = lines.map((line, i) => new RegExp(`^${terminator};$`, 'i').test(line.trim()) ? i : -1).filter(i => i >= 0);
  assert(start >= 0 && ends.length === 1, `${name}: exact outer transaction required`);
  assert.equal(lines.filter(line => /^begin;$/i.test(line.trim())).length, 1, `${name}: nested top-level BEGIN forbidden`);
  assert(lines.slice(0, start).every(line => !line.trim() || /^--|^\\set ON_ERROR_STOP on$/.test(line)), `${name}: executable prefix`);
  assert(lines.slice(ends[0] + 1).every(line => !line.trim() || /^--/.test(line)), `${name}: executable suffix`);
  const body = lines.slice(start + 1, ends[0]).join('\n');
  assert(!/^\s*(commit;|rollback;|begin;)/im.test(body), `${name}: unexpected transaction control`);
  return `-- Source: ${name}; SHA256: ${digest(bytes)}\n${body}\n`;
}
const up = [112, 114, 115].map(v => source(`supabase-migration-v${v}.sql`)).join('\n');
let bundle = `begin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\nselect pg_advisory_xact_lock(hashtextextended('minuta-platform-release-v112-v114-v115',0));\n`;
bundle += `do $$ begin if current_user<>'postgres' or current_database()<>'postgres' then raise exception 'platform_database_identity'; end if; end $$;\n`;
if (phase === 'test') {
  bundle += `do $$ begin if (select count(*) from minuta_migration_guard.target where project_ref='umazhvvxutnsyuphbhda' and allow_migrations)<>1 then raise exception 'platform_test_marker_missing'; end if; end $$;\n`;
}
bundle += up;
if (phase === 'test') {
  let fixture = source('client-records-v112-integration.sql', 'rollback');
  // The original test uses psql \gset. Translate only that exact bootstrap to
  // transaction-local settings; all original assertions and fixtures remain.
  const begin = fixture.indexOf('select b.id::text as booking');
  const end = fixture.indexOf('\n\ncreate function pg_temp.assert_true', begin);
  assert(begin >= 0 && end > begin && fixture.slice(begin, end).includes('\\gset cr_'), 'v112 fixture bootstrap changed');
  fixture = fixture.slice(0, begin) + `do $$ declare r record; begin
    select b.id::text as booking,b.organization_id::text as org,m.user_id::text as owner,
      public.normalize_client_phone(b.client_phone) as phone into r
    from public.bookings b
    join public.organizations o on o.id=b.organization_id and o.status='active'
    join public.organization_memberships m on m.organization_id=o.id and m.role='owner' and m.active
    where public.normalize_client_phone(b.client_phone) ~ '^7[0-9]{10}$'
    order by b.id limit 1;
    if not found then raise exception 'platform_v112_fixture_missing'; end if;
    perform set_config('test.cr.org',r.org,true),set_config('test.cr.owner',r.owner,true),
      set_config('test.cr.phone',r.phone,true),set_config('test.cr.booking',r.booking,true);
  end $$;` + fixture.slice(end);
  assert(!/^\s*\\/m.test(fixture) && !fixture.includes(":'cr_"), 'psql command remains');
  bundle += `savepoint platform_fixture;\n${fixture}\nreset role;\nrollback to savepoint platform_fixture;\n`;
}
if (phase !== 'apply') {
  bundle += source('supabase-migration-v115-rollback.sql');
  bundle += source('supabase-migration-v114-rollback.sql');
  bundle += source('recovery/rollback-client-records-v112.sql');
  bundle += up;
}
bundle += phase === 'apply' ? 'commit;\n' : 'rollback;\n';
// wx prevents accidental replacement of an already reviewed SQL artifact.
writeFileSync(resolve(output), bundle, { flag: 'wx', mode: 0o600 });
writeFileSync(resolve(output) + '.manifest.json', JSON.stringify({ phase, migrations: [112, 114, 115], sqlSha256: digest(bundle), sources: manifest }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ phase, output: resolve(output), sqlSha256: digest(bundle), commits: phase === 'apply' }));
