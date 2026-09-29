import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forward = readFileSync(resolve(root, 'supabase-migration-v190.sql'), 'utf8');
const rollback = readFileSync(resolve(root, 'recovery/rollback-shift-substitution-v190.sql'), 'utf8');

function definitions(sql, name) {
  const pattern = new RegExp(`create or replace function public\\.${name}\\([^]*?\\n\\$\\$;`, 'gi');
  return [...sql.matchAll(pattern)].map(match => match[0]);
}

const forwardWrite = definitions(forward, 'substitute_minuta_booking');
const forwardRead = definitions(forward, 'get_minuta_shift_workspace');
const rollbackWrite = definitions(rollback, 'substitute_minuta_booking');
assert.equal(forwardWrite.length, 1);
assert.equal(forwardRead.length, 1);
assert.equal(rollbackWrite.length, 1);
assert.equal(definitions(rollback, 'get_minuta_shift_workspace').length, 0,
  'operational rollback must retain the safe workspace read contract');

const guard = forwardWrite[0].indexOf("v_booking.booking_policy_snapshot @> '{\"schedule_block\":true}'::jsonb");
assert.ok(guard > forwardWrite[0].indexOf('if v_booking.id is null'), 'guard follows the locked booking lookup');
for (const write of [
  'update public.booking_session_items',
  'insert into public.booking_session_revisions',
  'delete from public.notification_marks',
  'update public.notification_outbox',
  'update public.bookings',
  'perform public.write_minuta_schedule_audit'
]) {
  assert.ok(forwardWrite[0].indexOf(write) > guard, `${write} must follow the schedule-block refusal`);
}
assert.match(forwardWrite[0], /raise exception using errcode='55000', message='schedule_block_substitution_denied'/);
assert.match(forwardRead[0], /'is_schedule_block',coalesce\(booking\.booking_policy_snapshot @> '\{"schedule_block":true\}'::jsonb,false\)/);
assert.match(forwardRead[0], /booking\.status<>'cancelled' and not coalesce\(booking\.booking_policy_snapshot @> '\{"schedule_block":true\}'::jsonb,false\)/);

assert.match(rollbackWrite[0], /raise exception using errcode='55000', message='booking_substitution_temporarily_unavailable'/);
assert.doesNotMatch(rollbackWrite[0], /\b(?:update|delete|insert|truncate|drop)\b/i,
  'rollback function must not mutate or delete records');
assert.doesNotMatch(rollback, /\b(?:drop\s+(?:table|function)|truncate\s+|delete\s+from|update\s+public\.|insert\s+into)\b/i);
assert.match(rollback, /grant execute on function public\.substitute_minuta_booking\(uuid,uuid,uuid\) to authenticated/);

const afterRollback = definitions(forward + '\n' + rollback, 'substitute_minuta_booking').at(-1);
const afterReapply = definitions(forward + '\n' + rollback + '\n' + forward, 'substitute_minuta_booking').at(-1);
assert.equal(afterRollback, rollbackWrite[0], 'rollback leaves an always-deny write function');
assert.equal(afterReapply, forwardWrite[0], 'reapplying v190 restores the guarded write function');
assert.equal(definitions(forward + '\n' + rollback + '\n' + forward, 'get_minuta_shift_workspace').at(-1), forwardRead[0],
  'reapplying v190 retains the canonical read contract');
console.log('A04 v190 SQL ordering, operational rollback and static reapply contract passed');
