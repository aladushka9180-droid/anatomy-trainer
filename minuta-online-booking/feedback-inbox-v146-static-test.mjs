import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('.', import.meta.url);
const migration = readFileSync(new URL('supabase-migration-v146.sql', root), 'utf8');
const rollback = readFileSync(new URL('supabase-migration-v146-rollback.sql', root), 'utf8');
const moduleSource = readFileSync(new URL('provider-feedback-inbox.js', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const html = readFileSync(new URL('provider.html', root), 'utf8');
const styles = readFileSync(new URL('styles.css', root), 'utf8');
const worker = readFileSync(new URL('sw.js', root), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/minuta-v146-safe-release.yml', root), 'utf8');

assert.match(migration, /create or replace function public\.get_minuta_feedback_inbox_v146\(p_organization uuid\)/i);
assert.match(migration, /v_role in \('owner','admin'\) or item\.reporter_user_id=v_actor/i);
assert.match(migration, /limit 100/i);
assert.doesNotMatch(migration, /'reporter_user_id'/i);
assert.match(migration, /create or replace function public\.set_minuta_feedback_status_v146/i);
assert.match(migration, /membership\.role in \('owner','admin'\)/i);
assert.match(migration, /revoke all on function public\.get_minuta_feedback_inbox_v146\(uuid\) from public,anon,authenticated,service_role/i);
assert.match(migration, /grant execute on function public\.get_minuta_feedback_inbox_v146\(uuid\) to authenticated/i);
assert.doesNotMatch(rollback, /delete from|truncate|drop table|drop column/i);

assert.match(html, /data-provider-panel="feedback-inbox"/);
assert.match(html, /data-feedback-inbox-filter="active"/);
assert.match(html, /provider-feedback-inbox\.js\?v=710/);
assert.match(provider, /view === 'feedback-inbox'\) void feedbackInboxController\.load\(\)/);
assert.match(provider, /feedbackInboxController\.setOrganization\(organization\)/);
assert.match(moduleSource, /get_minuta_feedback_inbox_v146/);
assert.match(moduleSource, /set_minuta_feedback_status_v146/);
assert.match(moduleSource, /replace\(\/\[&<>"'\]\/g/);
assert.doesNotMatch(moduleSource, /innerHTML\s*=\s*item\.(message|expected_result)/);
assert.match(styles, /\.feedback-inbox-card/);
assert.match(worker, /const CACHE = `\$\{CACHE_PREFIX\}v710`/);
assert.match(worker, /'\.\/provider-feedback-inbox\.js\?v=710'/);

for (const token of ['test-v146','validate-production-v146','apply-production-v146','observe-production-v146','feedback-inbox-v146-integration.sql']) {
  assert.ok(workflow.includes(token), `v146 workflow must include ${token}`);
}

console.log('Feedback inbox v146 static checks passed.');
