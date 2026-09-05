import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');
const migration = read('supabase-migration-v109.sql');
const rollback = read('supabase-migration-v109-rollback.sql');
const page = read('provider.html');
const feedback = read('provider-feedback.js');
const worker = read('sw.js');
const workflow = read('../.github/workflows/minuta-safe-release.yml');

assert.match(migration, /create table if not exists public\.product_feedback/i);
assert.match(migration, /alter table public\.product_feedback enable row level security/i);
assert.match(migration, /revoke all on table public\.product_feedback from public,anon,authenticated/i);
assert.match(migration, /values\('product-feedback','product-feedback',false,4194304,array\['image\/webp'\]\)/i);
assert.match(migration, /create or replace function public\.get_minuta_feedback_capability\(\)/i);
assert.match(migration, /create or replace function public\.create_minuta_feedback\(/i);
assert.match(migration, /grant execute on function public\.create_minuta_feedback\([^;]+\) to authenticated,service_role/i);
assert.match(migration, /v_screenshot not like v_actor::text\|\|'\/%'/i);
assert.match(migration, /object\.bucket_id='product-feedback' and object\.name=v_screenshot/i);

assert.match(rollback, /v109_rollback_blocked_feedback_exists/i);
assert.match(rollback, /v109_rollback_blocked_screenshots_exist/i);
assert.doesNotMatch(rollback, /delete from storage\.buckets/i);
assert.match(rollback, /drop table if exists public\.product_feedback/i);

assert.match(page, /data-open-product-feedback/);
assert.match(page, /id="productFeedbackDialog"/);
assert.match(page, /value="problem"/);
assert.match(page, /value="suggestion"/);
assert.match(page, /provider-feedback\.js\?v=405/);
assert.match(page, /Номер обращения/);

assert.match(feedback, /document\.createElement\('canvas'\)/);
assert.match(feedback, /canvas\.toBlob\(resolve, 'image\/webp'/);
assert.match(feedback, /p_page_path:location\.pathname/);
assert.match(feedback, /db\.storage\.from\(BUCKET\)\.remove\(\[screenshotPath\]\)/);
assert.doesNotMatch(feedback, /navigator\.userAgent\b/);
assert.doesNotMatch(feedback, /location\.(search|hash)/);

assert.match(worker, /CACHE = `\$\{CACHE_PREFIX\}v405`/);
assert.match(worker, /'\.\/provider-feedback\.js\?v=405'/);

for (const command of [
  'supabase-migration-v109.sql',
  'supabase-migration-v109-rollback.sql',
  'product-feedback-v109-static-test.mjs'
]) assert.ok(workflow.includes(command), `Release workflow must include ${command}`);

const testMigrationRelease = workflow.split('test-migration:')[1]?.split('production-migration:')[0] || '';
const initialV65Rollback = testMigrationRelease.indexOf('rollback-multi-tenant-v65.sql');
assert.ok(initialV65Rollback > 0, 'Test migration must reset the v65 baseline');
for (const rollbackCommand of [
  'supabase-migration-v109-rollback.sql',
  'supabase-migration-v108-rollback.sql',
  'supabase-migration-v107-rollback.sql',
  'supabase-migration-v106-rollback.sql',
  'supabase-migration-v105-rollback.sql',
  'supabase-migration-v104-rollback.sql',
  'supabase-migration-v103-rollback.sql',
  'rollback-team-calendar-dispatcher-v102.sql'
]) {
  const rollbackIndex = testMigrationRelease.indexOf(rollbackCommand);
  assert.ok(rollbackIndex > 0 && rollbackIndex < initialV65Rollback, `${rollbackCommand} must run before the initial v65 rollback`);
}

console.log('product-feedback-v109-static-test: OK');
