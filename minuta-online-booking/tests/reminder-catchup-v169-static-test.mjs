import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const forward = read('supabase-migration-v169.sql');
const rollback = read('supabase-migration-v169-rollback.sql');
const original = read('supabase-migration-v88.sql');
const currentOutbox = read('supabase-migration-v126.sql');
const claimGuard = read('supabase-migration-v128.sql');
const definition = sql => sql.match(/create or replace function public\.enqueue_due_minuta_booking_reminders\([\s\S]*?\n\$\$;/)?.[0];

assert.ok(definition(forward), 'forward scheduler definition');
assert.equal(definition(rollback)?.replaceAll('\r\n', '\n'), definition(original)?.replaceAll('\r\n', '\n'), 'rollback restores the exact v88 scheduler');
assert.match(forward, /coalesce\(auth\.role\(\),''\)\s*<>\s*'service_role'/);
assert.match(forward, /booking\.status='confirmed'/);
assert.match(forward, /booking\.booking_date\+booking\.booking_time>\(now\(\) at time zone 'Europe\/Samara'\)/);
assert.match(forward, /make_interval\(mins=>settings\.reminder_minutes_before\+30\)/);
assert.match(forward, /clock_timestamp\(\) at time zone 'Europe\/Samara'/);
assert.match(forward, /for update of booking skip locked/);
assert.match(forward, /channel\.enabled[\s\S]*?not exists\([\s\S]*?queue\.event_key=/);
assert.match(currentOutbox, /when p_kind in\('booking_rescheduled','booking_reminder','booking_confirmation_request'\)/);
assert.match(currentOutbox, /on conflict\(event_key\) do nothing/);
assert.match(claimGuard, /queue\.kind='booking_reminder' and\([\s\S]*?booking\.status<>'confirmed'[\s\S]*?booking\.booking_date\+booking\.booking_time<=now\(\) at time zone 'Europe\/Samara'/);

const eligible = ({ start, now, leadMinutes, status = 'confirmed', alreadyQueued = false }) =>
  status === 'confirmed' && !alreadyQueued && start > now && start <= now + (leadMinutes + 30) * 60_000;
const now = Date.UTC(2026, 8, 22, 8);
const minutesFromNow = minutes => now + minutes * 60_000;
assert.equal(eligible({ start: minutesFromNow(91), now, leadMinutes: 60 }), false, 'no earlier than the old 30-minute tolerance');
assert.equal(eligible({ start: minutesFromNow(90), now, leadMinutes: 60 }), true, 'old early boundary retained');
assert.equal(eligible({ start: minutesFromNow(30), now, leadMinutes: 1440 }), true, 'late reminder catches up before visit');
assert.equal(eligible({ start: now, now, leadMinutes: 1440 }), false, 'never enqueue at visit start');
assert.equal(eligible({ start: minutesFromNow(-1), now, leadMinutes: 1440 }), false, 'never enqueue after visit start');
assert.equal(eligible({ start: minutesFromNow(30), now, leadMinutes: 1440, status: 'cancelled' }), false);
assert.equal(eligible({ start: minutesFromNow(30), now, leadMinutes: 1440, alreadyQueued: true }), false);

console.log('PrimeTime Pro reminder catch-up v169 static checks: PASS');
