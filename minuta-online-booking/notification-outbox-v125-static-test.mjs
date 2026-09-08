import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, rollback, release] = await Promise.all([
  readFile(new URL('supabase-migration-v125.sql', import.meta.url), 'utf8'),
  readFile(new URL('supabase-migration-v125-rollback.sql', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/minuta-v125-safe-release.yml', import.meta.url), 'utf8'),
]);

for (const sql of [migration, rollback]) {
  assert.match(sql, /perform public\.enqueue_minuta_booking_notification\(new\.id,'booking_created'\)/i);
  assert.doesNotMatch(sql, /insert into public\.notification_outbox/i);
  assert.match(sql, /a509808937e4eaed2cdd8e7d74995ca9/i);
}
assert.match(migration, /1f1a45095b0926a19d56a6129c04edac/i);
assert.match(migration, /organization_id[\s\S]*is_nullable='NO'/i);
assert.match(migration, /bookings_enqueue_created_notification[\s\S]*tgenabled='O'/i);
assert.match(migration, /v125_enqueue_baseline_drift/i);
assert.match(rollback, /cannot be restored after v88/i);

assert.match(release, /test "\$GITHUB_REF" = refs\/heads\/main/);
assert.match(release, /test "\$GITHUB_SHA" = "\$SHA"/);
assert.match(release, /git\/ref\/heads\/main/);
assert.match(release, /test "\$CONFIRMATION" = BACKUP_VERIFIED/);
assert.match(release, /minuta-supabase-backup\.yml/);
assert.match(release, /minuta-booking-integration\.yml/);
assert.match(release, /test "\$age" -ge 0 && test "\$age" -le 7200/);
assert.match(release, /default_transaction_read_only=on/g);
assert.match(release, /audit-production-v125/);
assert.match(release, /apply-production-v125/);
assert.match(release, /a509808937e4eaed2cdd8e7d74995ca9/g);
assert.match(release, /1f1a45095b0926a19d56a6129c04edac/g);
assert.match(release, /psql "\$db"[^\n]+supabase-migration-v125\.sql/);
assert.doesNotMatch(release, /pull_request|push:/);

console.log('Notification outbox v125 repair static checks passed.');
