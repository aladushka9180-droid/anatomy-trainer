import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(directory, 'supabase-migration-v70.sql'), 'utf8');
const provider = await readFile(join(directory, 'provider.js'), 'utf8');
const html = await readFile(join(directory, 'provider.html'), 'utf8');
const styles = await readFile(join(directory, 'styles.css'), 'utf8');
const workflow = await readFile(join(directory, '..', '.github', 'workflows', 'minuta-safe-release.yml'), 'utf8');

assert.match(migration, /v70_requires_performer_profiles/i, 'v70 must fail closed without the performer foundation');
assert.match(migration, /create table if not exists public\.client_avatars/i, 'client avatars must use an additive table');
assert.match(migration, /primary key \(performer_id, client_phone\)/i, 'one avatar must be stored per provider client');
assert.match(migration, /client_avatars_storage_path_scope_check[\s\S]*performer_id::text[\s\S]*client_phone[\s\S]*avatar\.webp/i, 'avatar metadata must be bound to the owner and client folder');
assert.match(migration, /alter table public\.client_avatars enable row level security/i, 'client avatars must use RLS');
assert.match(migration, /client_avatars_owner_all[\s\S]*performer_id = auth\.uid\(\)/i, 'avatar metadata must be owner-only');
assert.match(migration, /revoke all on table public\.client_avatars from anon/i, 'anonymous users must not read client avatars');
assert.match(migration, /'client-avatars'[\s\S]*false,[\s\S]*2097152[\s\S]*image\/webp/i, 'avatar bucket must be private and bounded to WebP');
for (const action of ['select', 'insert', 'update', 'delete']) {
  assert.match(migration, new RegExp(`client_avatar_objects_owner_${action}[\\s\\S]*bucket_id = 'client-avatars'[\\s\\S]*storage\\.foldername\\(name\\)\\)\\[1\\] = auth\\.uid\\(\\)::text`, 'i'), `${action} policy must isolate provider folders`);
}

assert.match(provider, /data-repeat-booking[\s\S]*Повторить запись/i, 'booking sheet must expose the repeat action');
assert.match(provider, /openRepeatBookingFromSheet[\s\S]*clientName:[\s\S]*clientPhone:[\s\S]*serviceId:/i, 'repeat action must prefill the client and service');
assert.match(provider, /openRepeatBookingFromSheet[\s\S]*ownServices\.some\([\s\S]*service\.active[\s\S]*Эта услуга сейчас отключена/i, 'repeat action must not silently substitute an inactive service');
assert.match(provider, /CLIENT_AVATAR_BUCKET = 'client-avatars'/i, 'provider must use the private avatar bucket');
assert.match(provider, /prepareClientAvatar[\s\S]*Math\.min\(sourceWidth, sourceHeight\)[\s\S]*image\/webp/i, 'avatars must be square-cropped and converted before upload');
assert.match(provider, /from\('client_avatars'\)\.upsert[\s\S]*onConflict:'performer_id,client_phone'/i, 'avatar metadata must replace only the current provider client');
assert.match(provider, /\$\{userId\}\/\$\{phone\}\/avatar\.webp[\s\S]*upsert:true/i, 'parallel avatar replacements must share one deterministic object path');
assert.match(provider, /createSignedUrl\(path, 3600\)/i, 'private avatar images must use expiring signed URLs');
assert.match(provider, /data-remove-client-avatar/i, 'provider must allow avatar removal');
assert.match(html, /id="clientAvatarInput"[\s\S]*data-client-avatar-input/i, 'client profile must expose photo upload');
assert.match(styles, /client-list-avatar img[\s\S]*object-fit:cover/i, 'avatar photos must stay neatly cropped in every list');

const testMigrationRelease = workflow.split('test-migration:')[1]?.split('production-migration:')[0] || '';
const productionRelease = workflow.split('production-migration:')[1] || '';
assert.match(testMigrationRelease, /supabase-migration-v70\.sql[\s\S]*client_avatars[\s\S]*client-avatars/i, 'test release must apply and verify v70');
assert.match(productionRelease, /v70_layer_state[\s\S]*(?:complete|partial)[\s\S]*supabase-migration-v70\.sql/i, 'production release must detect partial v70 state');
assert.match(workflow, /test "\$MINUTA_BACKUP_CONFIRM" = "BACKUP_VERIFIED"[\s\S]*supabase-migration-v70\.sql/i, 'production v70 must remain behind the verified backup gate');
assert.match(workflow, /client-avatars-v70[\s\S]*Production migration intentionally stopped after v70/i, 'v70 must be independently releasable without unrelated later migrations');

console.log('multi-tenant v70 static test: OK');
