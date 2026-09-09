import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, rollback, script, provider, worker, release, integration] = await Promise.all([
  readFile(new URL('supabase-migration-v127.sql', import.meta.url), 'utf8'),
  readFile(new URL('supabase-migration-v127-rollback.sql', import.meta.url), 'utf8'),
  readFile(new URL('primetime-handoff.js', import.meta.url), 'utf8'),
  readFile(new URL('provider.html', import.meta.url), 'utf8'),
  readFile(new URL('sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/minuta-v127-safe-release.yml', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/minuta-booking-integration.yml', import.meta.url), 'utf8'),
]);

assert.match(migration, /create table public\.primetime_handoffs/i);
assert.match(migration, /alter table public\.primetime_handoffs enable row level security/i);
assert.match(migration, /grant execute on function public\.create_primetime_handoff\(text\) to authenticated/i);
assert.match(migration, /grant execute on function public\.consume_primetime_handoff\(text,text\) to anon/i);
assert.match(migration, /extensions\.gen_random_bytes\(32\)/i);
assert.match(migration, /extensions\.digest\(v_ticket,'sha256'\)/i);
assert.match(migration, /delete from public\.primetime_handoffs[\s\S]*returning \* into v_row/i);
assert.match(migration, /interval '2 minutes'/i);
assert.match(migration, /state_hash text not null/i);
assert.match(migration, /user_id uuid not null unique/i);
assert.match(migration, /on conflict\(user_id\) do update/i);
assert.match(migration, /public_booking_enabled[\s\S]*limit 20/i);
assert.match(migration, /is_bookable[\s\S]*limit 100/i);
assert.match(migration, /octet_length\(v_workspace::text\) > 65536/i);
assert.doesNotMatch(migration, /'email'|invitations|organization_audit_log/i);
assert.match(rollback, /drop function if exists public\.consume_primetime_handoff\(text,text\)/i);
assert.match(rollback, /drop table if exists public\.primetime_handoffs/i);

assert.match(provider, /id="openPrimeTime"/);
assert.match(provider, /primetime-handoff\.js\?v=661/);
assert.doesNotMatch(worker, /primetime-handoff\.js/, 'handoff script must stay runtime-cached');
assert.match(worker, /CACHE_PREFIX}v661/);
assert.equal((provider.match(/\?v=630/g) || []).length, 0);

assert.match(script, /db\.rpc\('create_primetime_handoff', \{ p_state: state \}\)/);
assert.match(script, /returning = \/\^\[0-9a-f\]\{64\}\$\//);
assert.match(script, /const START = `\$\{TARGET\}\/start`/);
assert.match(script, /#handoff=\$\{ticket\}/);
assert.match(script, /https:\/\/primetime-booking\.aladushka9180\.chatgpt\.site\/for-masters/);
assert.doesNotMatch(script, /access_token|refresh_token|localStorage|sessionStorage|postMessage/i);

assert.match(release, /test "\$GITHUB_REF" = refs\/heads\/main/);
assert.match(release, /test "\$CONFIRMATION" = BACKUP_VERIFIED/);
assert.match(release, /minuta-supabase-backup\.yml/);
assert.match(release, /minuta-booking-integration\.yml/);
assert.match(release, /default_transaction_read_only=on/g);
assert.match(release, /supabase-migration-v127\.sql/);
assert.match(release, /\.state\.workspaceFunction and \.state\.pgcrypto/);
assert.doesNotMatch(release, /pull_request|push:/);

assert.match(integration, /Race PrimeTime handoffs and verify latest-wins TTL/);
assert.doesNotMatch(integration, /-c "[^"]*:'actor'/);

console.log('PrimeTime handoff v127 static checks passed.');
