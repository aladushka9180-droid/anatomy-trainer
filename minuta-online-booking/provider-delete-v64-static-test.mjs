import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(directory, 'supabase-migration-v64.sql'), 'utf8');

assert.match(
  migration,
  /create or replace function public\.provider_delete_booking\(p_booking uuid\)/i,
  'v64 must canonically replace provider_delete_booking(uuid)',
);
assert.match(migration, /security definer[\s\S]*set search_path to ''/i, 'RPC must use an empty search_path');
assert.match(migration, /v_actor uuid := auth\.uid\(\)/i, 'RPC must resolve the authenticated actor');
assert.match(migration, /if v_actor is null then[\s\S]*authentication_required/i, 'anonymous calls must be rejected');
assert.match(
  migration,
  /from public\.bookings booking[\s\S]*where booking\.id = p_booking[\s\S]*for update/i,
  'booking ownership must be checked on a locked row',
);
assert.match(migration, /if not found then\s*return 'not_found'/i, 'a missing booking must return not_found');
assert.match(
  migration,
  /if v_performer is distinct from v_actor then[\s\S]*booking_access_denied/i,
  'a provider must not delete another provider booking',
);
assert.match(
  migration,
  /to_regclass\('public\.booking_reviews'\)[\s\S]*review\.booking_id = \$1[\s\S]*if v_has_review then\s*return 'review_protected'/i,
  'a reviewed booking must be protected',
);
assert.match(migration, /to_regclass\('public\.payments'\) is not null/i, 'payments must be optional');
assert.match(migration, /to_regclass\('public\.payment_events'\) is not null/i, 'payment_events must be optional');

const deleteEventsAt = migration.indexOf('delete from public.payment_events');
const deletePaymentsAt = migration.indexOf('delete from public.payments');
const deleteBookingAt = migration.indexOf('delete from public.bookings');
assert.ok(deleteEventsAt >= 0, 'linked payment events must be deleted');
assert.ok(deletePaymentsAt > deleteEventsAt, 'payments must be deleted after their events');
assert.ok(deleteBookingAt > deletePaymentsAt, 'the booking must be deleted after payment records');
assert.match(
  migration,
  /delete from public\.bookings booking[\s\S]*booking\.id = p_booking[\s\S]*booking\.performer_id = v_actor/i,
  'the final delete must repeat the ownership boundary',
);
assert.match(migration, /if not found then\s*raise exception[\s\S]*booking_delete_failed/i, 'a failed final delete must roll back');

assert.match(
  migration,
  /revoke all on function public\.provider_delete_booking\(uuid\) from public, anon, authenticated, service_role;/i,
  'all inherited and previous RPC grants must be cleared',
);
assert.match(
  migration,
  /grant execute on function public\.provider_delete_booking\(uuid\) to authenticated;/i,
  'only authenticated providers may execute the RPC',
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.provider_delete_booking\(uuid\) to (?:anon|public|service_role)/i,
  'RPC execute must not be granted to anon, public, or service_role',
);
assert.doesNotMatch(migration, /\b(?:create|alter|drop)\s+table\b/i, 'v64 must not change table definitions');

console.log('provider delete v64 static test: OK');
