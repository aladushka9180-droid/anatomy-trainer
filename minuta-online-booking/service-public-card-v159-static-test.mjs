#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('./supabase-migration-v159.sql');
const rollback = read('./supabase-migration-v159-rollback.sql');

assert.match(migration,/create table public\.service_public_details_v159/i);
assert.match(migration,/force row level security/i);
assert.match(migration,/values\('service-images','service-images',false,2097152,array\['image\/webp'\]\)/i);
assert.match(migration,/o\.visit_status='completed'/i);
assert.match(migration,/r\.published and b\.status<>'cancelled'/i);
assert.match(migration,/grant execute on function public\.get_public_service_cards_v159\(uuid\[\]\) to anon,authenticated/i);
assert.match(migration,/grant execute on function public\.get_public_service_reviews_v159\(uuid\) to anon,authenticated/i);
assert.doesNotMatch(migration,/returns table\([^)]*(client_phone|client_account_id|booking_id|performer_id)/i);
assert.match(rollback,/v159_rollback_blocked_service_content_exists/i);
console.log('service public card v159 static test passed');
