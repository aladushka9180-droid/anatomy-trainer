import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const provider = read('./provider.js');
const html = read('./provider.html');
const styles = read('./styles.css');
const migration = read('./supabase-migration-v157.sql');
const rollback = read('./supabase-migration-v157-rollback.sql');
const integration = read('./tests/provider-schedule-move-v157-integration.sql');
const concurrency = read('./tests/provider-schedule-move-v157-postgres-concurrency-test.mjs');
const state = read('./scripts/provider-schedule-move-v157-state.sql');
const contractSource = read('./scripts/provider-schedule-move-v157-contract.mjs');
const workflow = read('../.github/workflows/minuta-v157-provider-schedule-move-release.yml');
const restoreWorkflow = read('../.github/workflows/minuta-supabase-restore-drill.yml');
const browserWorkflow = read('../.github/workflows/minuta-theme-cards.yml');

function actual(name) {
  const start = provider.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is missing`);
  const rest = provider.slice(start + 1);
  const next = rest.search(/^(?:async )?function /m);
  return provider.slice(start, next < 0 ? undefined : start + 1 + next);
}

for (const required of [
  'provider_schedule_moves_v157',
  'force row level security',
  'move_minuta_provider_schedule_booking_v157',
  'get_minuta_provider_schedule_move_v157',
  'undo_minuta_provider_schedule_booking_v157',
  "pg_advisory_xact_lock(hashtextextended(p_request_id::text,15701))",
  "pg_advisory_xact_lock(hashtextextended(p_booking::text,7302))",
  'p_expected_organization',
  'p_expected_location',
  'p_expected_service',
  'p_expected_duration',
  'p_expected_status',
  "operation in ('move','undo')",
  'reverse_of',
  'reversed_by',
  "raise exception using errcode='40001',message='provider_schedule_booking_changed'",
  "raise exception using errcode='23P01',message='provider_schedule_slot_unavailable'",
  'v157_schedule_move_state_not_absent',
  'provider_schedule_target_in_past',
  'on delete set null',
  'minuta_provider_schedule_move_v157:sha256='
]) assert.ok(migration.includes(required), `migration contract missing: ${required}`);

assert.match(migration, /revoke all on table public\.provider_schedule_moves_v157 from public,anon,authenticated,service_role/i);
assert.match(migration, /grant execute on function public\.move_minuta_provider_schedule_booking_v157[\s\S]*to authenticated/i);
assert.match(migration, /insert into public\.provider_schedule_moves_v157[\s\S]*return v_result/i);
assert.match(migration, /perform public\.reschedule_minuta_provider_booking_v143[\s\S]*insert into public\.provider_schedule_moves_v157/i,
  'move must be validated by the existing server availability contract before the receipt is saved');
assert.match(migration, /public\.minuta_provider_schedule_snapshot_v157\(v_booking\) is distinct from v_original\.to_snapshot/i,
  'undo must compare the complete current snapshot');
assert.match(rollback, /exists\(select 1 from public\.provider_schedule_moves_v157\)[\s\S]*v157_rollback_blocked_durable_history_exists/i,
  'rollback must retain durable history once a move exists');
for (const token of ["'absent'", "'exact'", "'partial-or-newer'", "'tableDataRead',false", 'source_hash', 'schema_hash', 'structural_exact']) {
  assert.ok(state.includes(token), `state probe missing ${token}`);
}
assert.match(rollback, /v157_rollback_blocked_schema_drift[\s\S]*v157_rollback_blocked_durable_history_exists/);
assert.match(contractSource, /sourceHash[\s\S]*tableMarkerPrefix[\s\S]*restoreWorkflowSha256/);

for (const required of [
  "db.rpc('move_minuta_provider_schedule_booking_v157'",
  "db.rpc('get_minuta_provider_schedule_move_v157'",
  "db.rpc('undo_minuta_provider_schedule_booking_v157'",
  'timelineMagneticTarget(state.item, state.stage, pointerMinute, state.date)',
  "title:'Перенести запись?'",
  'showTimelineBookingUndo(previous, current)',
  "data-timeline-movable aria-describedby=\"timelineMoveInstruction\"",
  "aria-keyshortcuts=\"Shift+ArrowUp Shift+ArrowDown\"",
  'TIMELINE_DRAG_THRESHOLD_PX = 8',
  'TIMELINE_UNDO_WINDOW_MS = 10000',
  'writeTimelineMoveAttempt',
  'recoverPendingTimelineBookingMove',
  'timelineBookingMoveSnapshot',
  'timelineBookingMatchesMoveSnapshot',
  'timelineMoveOutcomeUnknown',
  "operation:'undo'",
  "operation:'move'",
  'provider_schedule_target_in_past'
]) assert.ok(provider.includes(required), `provider contract missing: ${required}`);

assert.doesNotMatch(actual('persistTimelineBookingMove'), /notifyTelegramClient/, 'timeline move must not duplicate the database outbox notification');
assert.match(actual('beginTimelineBookingDrag'), /!card\.hasAttribute\('data-timeline-movable'\)/);
assert.match(html, /id="timelineMoveInstruction"[\s\S]*Shift[\s\S]*id="timelineBookingUndo"/);
for (const selector of ['timeline-drag-preview','is-magnetic-invalid','is-current-booking']) {
  assert.ok(styles.includes(selector), `timeline style missing: ${selector}`);
}
assert.match(styles, /timeline-booking\[data-timeline-movable\][\s\S]*width:44px;[\s\S]*height:44px;/);
assert.match(styles, /prefers-reduced-motion:reduce[\s\S]*timeline-now-marker/);

const restrictionBox = vm.createContext({
  isScheduleBlock:item => Boolean(item.block),
  bookingIsCompleted:item => Boolean(item.completed),
  bookingMoveTimeIsPast:(_date, time) => time === '09:00'
});
vm.runInContext(actual('timelineMoveRestriction'), restrictionBox);
assert.match(restrictionBox.timelineMoveRestriction({ block:true }), /Перерыв/);
assert.match(restrictionBox.timelineMoveRestriction({ series_id:'series' }), /серии/i);
assert.match(restrictionBox.timelineMoveRestriction({ status:'cancelled' }), /Отменённую/);
assert.match(restrictionBox.timelineMoveRestriction({ status:'confirmed',booking_date:'2099-01-01',booking_time:'09:00:00' }), /прошедшую/);
assert.equal(restrictionBox.timelineMoveRestriction({ status:'confirmed' }), '');

const magneticBox = vm.createContext({
  selectedDate:'2099-01-01',
  TIMELINE_MAGNET_RADIUS_MINUTES:30,
  scheduleStepForDate:() => 15,
  minutesFromTime:value => Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5)),
  bookingPlacementIssue:(_item, _date, minute) => minute === 615 ? '' : 'В 10:00 уже есть запись'
});
vm.runInContext(actual('timelineMagneticTarget'), magneticBox);
assert.deepEqual(
  JSON.parse(JSON.stringify(magneticBox.timelineMagneticTarget({ duration_minutes:60 }, { dataset:{ timelineStart:'540',timelineEnd:'1080' } }, 600))),
  { minute:615,issue:'',magnetized:true,pointerMinute:600,rejectedIssue:'В 10:00 уже есть запись' }
);
magneticBox.bookingPlacementIssue = (_item, _date, minute) => minute === 555 || minute === 600 ? '' : 'Время занято';
assert.equal(magneticBox.timelineMagneticTarget({ booking_date:'2099-01-01',booking_time:'10:00:00',duration_minutes:60 }, { dataset:{ timelineStart:'540',timelineEnd:'1080' } }, 585).minute, 555,
  'magnet search should not snap a requested move back to its original slot');

const rpcCalls = [];
const rpcBox = vm.createContext({
  currentUser:{ id:'owner' },
  db:{ rpc:async (name, params) => {
    rpcCalls.push({ name, params });
    return { data:{ action:'moved',request_id:'request',move_id:'move',booking_id:'booking',performer_id:'owner',booking_date:'2099-01-02',booking_time:'12:00:00',notifications_suppressed:false },error:null };
  } }
});
vm.runInContext(actual('moveTimelineBookingAtExpectedState'), rpcBox);
const rpcResult = await rpcBox.moveTimelineBookingAtExpectedState({
  id:'booking',organization_id:'org',location_id:'location',service_id:'service',
  booking_date:'2099-01-01',booking_time:'10:00:00',duration_minutes:60,status:'confirmed'
}, '2099-01-02', '12:00', 'request');
assert.equal(rpcResult.error, null);
assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls[0])), {
  name:'move_minuta_provider_schedule_booking_v157',
  params:{
    p_request_id:'request',p_booking:'booking',p_date:'2099-01-02',p_time:'12:00:00',
    p_expected_organization:'org',p_expected_location:'location',p_expected_service:'service',
    p_expected_date:'2099-01-01',p_expected_time:'10:00:00',p_expected_duration:60,p_expected_status:'confirmed'
  }
});

const persistItem = {
  id:'booking',organization_id:'org',location_id:'location',service_id:'service',
  booking_date:'2099-01-01',booking_time:'10:00:00',duration_minutes:60,status:'confirmed'
};
const makePersistBox = error => {
  const events = [];
  const box = vm.createContext({
    bookingUsesDemoData:() => false,
    renderBookings:() => events.push('render'),
    allBookings:[{ ...persistItem }],
    timelineMovePending:false,
    timeFromMinutes:minute => minute === 720 ? '12:00' : '10:00',
    timelineMoveRestriction:() => '',bookingPlacementIssue:() => '',requireWrites:() => true,
    notify:message => events.push(`notify:${message}`),currentUser:{ id:'owner' },sessionGeneration:1,
    getProviderAvailableSlots:async () => ({ data:[{ booking_time:'12:00:00' }],error:null }),
    sessionIsCurrent:() => true,createOfflineBookingId:() => 'request',
    writeTimelineMoveAttempt:() => { events.push('write'); return true; },
    clearTimelineMoveAttempt:() => events.push('clear'),
    moveTimelineBookingAtExpectedState:async () => ({ data:null,error }),
    timelineMoveRpcMissing:() => false,
    providerScheduleMoveErrorMessage:() => '',loadBookings:async () => events.push('load'),
    refreshAfterWrite:async () => events.push('refresh'),showTimelineBookingUndo:() => events.push('undo')
  });
  vm.runInContext(actual('timelineBookingMatchesMoveSnapshot'), box);
  vm.runInContext(actual('timelineMoveOutcomeUnknown'), box);
  vm.runInContext(actual('persistTimelineBookingMove'), box);
  return { box,events };
};
const domainFailure = makePersistBox({ code:'23P01',message:'provider_schedule_slot_unavailable' });
await domainFailure.box.persistTimelineBookingMove({ item:{ ...persistItem },bookingId:'booking',date:'2099-01-02',targetMinute:720,duration:60 });
assert.deepEqual(domainFailure.events.filter(event => event === 'write' || event === 'clear'), ['write','clear'], 'a rejected move must never remain queued for replay');
const unknownFailure = makePersistBox(new TypeError('Failed to fetch'));
await unknownFailure.box.persistTimelineBookingMove({ item:{ ...persistItem },bookingId:'booking',date:'2099-01-02',targetMinute:720,duration:60 });
assert.deepEqual(unknownFailure.events.filter(event => event === 'write' || event === 'clear'), ['write'], 'an ambiguous transport result must retain the exact request for receipt lookup');
const staleFailure = makePersistBox(null);
staleFailure.box.allBookings[0].booking_time = '10:30:00';
await staleFailure.box.persistTimelineBookingMove({ item:{ ...persistItem },bookingId:'booking',date:'2099-01-02',targetMinute:720,duration:60 });
assert.ok(staleFailure.events.includes('clear'), 'a stale immutable snapshot must be rejected before RPC');
assert.equal(staleFailure.events.includes('write'), false, 'a stale immutable snapshot must not create a move request');

for (const required of [
  'idempotent_move_replay','reused_request_accepted','stale_snapshot_accepted',
  'linked_undo_and_history_saved','idempotent_undo_replay','foreign_actor_accepted','direct_ledger_read_accepted',
  'past_target_accepted','no_op_move_accepted','direct_ledger_insert_accepted','direct_ledger_update_accepted','direct_ledger_delete_accepted'
]) assert.ok(integration.includes(required), `integration coverage missing: ${required}`);
for (const required of ['pg_blocking_pids','provider_schedule_booking_changed','provider_schedule_move_already_undone','duplicate history']) {
  assert.ok(concurrency.includes(required), `concurrency coverage missing: ${required}`);
}

for (const phase of ['test-v157','validate-production-v157','apply-production-v157','observe-production-v157']) {
  assert.ok(workflow.includes(phase), `release workflow missing ${phase}`);
}
assert.match(workflow, /BACKUP_VERIFIED[\s\S]*backup_run_id[\s\S]*restore_run_id/i);
assert.match(workflow, /supabase-migration-v157\.sql[\s\S]*provider-schedule-move-v157-integration\.sql[\s\S]*supabase-migration-v157-rollback\.sql[\s\S]*supabase-migration-v157\.sql/i);
assert.match(workflow, /default_transaction_read_only=on[\s\S]*provider-schedule-move-v157-state\.sql/);
assert.match(workflow, /observation_minutes[\s\S]*options: \["30", "60"\][\s\S]*sleep "\$\(\(MINUTES\*60\)\)"/);
assert.match(workflow, /test_epoch[\s\S]*validation_epoch[\s\S]*backup_epoch[\s\S]*restore_epoch/);
assert.match(workflow, /provider-schedule-move-v157-contract\.mjs[\s\S]*provider-schedule-move-v157-postgres-concurrency-test\.mjs/);
assert.match(restoreWorkflow, /backup_run_id[\s\S]*commit_sha[\s\S]*REQUESTED_BACKUP_RUN_ID[\s\S]*EXPECTED_SHA/);
assert.match(browserWorkflow, /provider-magnetic-schedule-browser-test\.mjs/);

console.log('PrimeTime Pro magnetic schedule v157 static checks: PASS');
