import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const [migration, rollback, v80Rollback] = await Promise.all([
  readFile(new URL('supabase-migration-v86.sql', root), 'utf8'),
  readFile(new URL('supabase-migration-v86-rollback.sql', root), 'utf8'),
  readFile(new URL('recovery/rollback-group-bookings-v80.sql', root), 'utf8')
]);

assert.match(migration, /to_regprocedure\('public\.scope_minuta_booking\(\)'\)/i);
assert.match(migration, /tgname = 'bookings_scope_minuta_tenant'[\s\S]*tgenabled <> 'D'/i);
assert.match(migration, /drop trigger if exists bookings_group_event_overlap on public\.bookings/i);
assert.match(migration, /create trigger zz_bookings_group_event_overlap_v86[\s\S]*before insert or update of[\s\S]*execute function public\.prevent_minuta_group_event_booking_overlap\(\)/i);
assert.ok(
  migration.indexOf('create trigger zz_bookings_group_event_overlap_v86')
    < migration.indexOf('commit;'),
  'Переименование триггера должно быть атомарным'
);
assert.match(rollback, /drop trigger if exists zz_bookings_group_event_overlap_v86/i);
assert.match(rollback, /create trigger bookings_group_event_overlap[\s\S]*prevent_minuta_group_event_booking_overlap\(\)/i);
assert.match(v80Rollback, /drop trigger if exists zz_bookings_group_event_overlap_v86/i);

console.log('v86 group overlap trigger order static contract: ok');
