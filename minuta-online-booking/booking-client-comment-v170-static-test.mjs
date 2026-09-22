import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./supabase-migration-v170.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('./supabase-migration-v170-rollback.sql', import.meta.url), 'utf8');

assert.match(migration, /^(?:--[^\n]*\n)+begin;[\s\S]*commit;\s*$/iu);
assert.match(migration, /v170_comment_prerequisites_missing/u);
assert.match(migration, /create or replace function public\.book_minuta_appointment_v3/u);
assert.match(migration, /char_length\(v_comment\)>500/u);
assert.match(migration, /pg_advisory_xact_lock/u);
assert.match(migration, /not v_existing[\s\S]*set provider_note=v_comment/u);
assert.match(migration, /grant execute[\s\S]*to anon,authenticated/u);
assert.doesNotMatch(migration, /drop\s+(?:table|column)|truncate|delete\s+from/iu);
assert.match(rollback, /^begin;[\s\S]*drop function if exists public\.book_minuta_appointment_v3[\s\S]*commit;\s*$/iu);
assert.doesNotMatch(rollback, /drop\s+(?:table|column)|truncate|delete\s+from/iu);

console.log('booking client comment v170 static: PASS');
