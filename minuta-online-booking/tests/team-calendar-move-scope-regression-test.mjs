import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

const sourcePath = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL('../team-calendar.js', import.meta.url));
assert.equal(basename(sourcePath), 'team-calendar.js');
const bytes = readFileSync(sourcePath);
assert.ok(bytes.length > 0 && bytes.length < 200_000);
const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const matches = [...source.matchAll(/^    async function moveBooking\([^]*?^    \}/gm)];
assert.equal(matches.length, 1, 'extract the actual moveBooking function');
console.log(`team-calendar Source SHA256 ${createHash('sha256').update(bytes).digest('hex')}`);

async function checkMove({ change = 'none', missing = false, rejected = false, thrown = false, requireAtomic = false } = {}) {
  let releaseRpc, rpcEntered, releaseReload, reloadEntered;
  const entered = new Promise(resolve => { rpcEntered = resolve; });
  const rpc = new Promise(resolve => { releaseRpc = resolve; });
  const reloadStarted = new Promise(resolve => { reloadEntered = resolve; });
  const reload = new Promise(resolve => { releaseReload = resolve; });
  let actor = 'SYNTHETIC_ACTOR_A', generation = 1;
  const calls = [];
  const effects = { close: 0, load: 0, callback: 0, undo: 0, notify: 0 };
  const item = { id: 'SYNTHETIC_BOOKING_A', performer_id: 'SYNTHETIC_PERFORMER_A',
    service_id: 'SYNTHETIC_SERVICE_A', location_id: 'SYNTHETIC_LOCATION_A',
    booking_date: '2026-10-20', booking_time: '12:00' };
  const context = vm.createContext({
    getCurrentUser: () => ({ id: actor }), getSessionGeneration: () => generation,
    sessionIsCurrent: (userId, session) => userId === actor && session === generation,
    requireWrites: () => true,
    moveUnavailableReason: () => '',
    matchingService: () => ({ id: 'SYNTHETIC_SERVICE_A' }),
    timeFromMinutes: () => '13:00',
    isMissingRpc: error => error?.code === 'PGRST202',
    actionError: () => 'SYNTHETIC_CONTROLLED_REJECTION',
    db: { rpc(name, parameters) {
      calls.push({ name, parameters });
      if (name === 'move_minuta_team_booking_v104') {
        assert.deepEqual(JSON.parse(JSON.stringify(parameters)), {
          p_organization: 'SYNTHETIC_ORG_A', p_booking: item.id,
          p_expected_performer: item.performer_id, p_expected_location: item.location_id,
          p_expected_service: item.service_id, p_expected_date: item.booking_date,
          p_expected_time: '12:00:00', p_location: item.location_id,
          p_service: item.service_id, p_date: item.booking_date, p_time: '13:00:00'
        });
        rpcEntered();
        return rpc.then(value => {
          if (thrown) throw Object.freeze({ code: 'SYNTHETIC_TRANSPORT_REJECTION' });
          return value;
        });
      }
      assert.equal(name, 'move_minuta_team_booking_v102');
      assert.deepEqual(JSON.parse(JSON.stringify(parameters)), {
        p_organization: 'SYNTHETIC_ORG_A', p_booking: item.id,
        p_location: item.location_id, p_service: item.service_id,
        p_date: item.booking_date, p_time: '13:00:00'
      });
      return Promise.resolve({ data: true, error: null });
    } },
    closeSheet() { effects.close += 1; },
    load: async () => {
      effects.load += 1;
      if (change === 'reload-organization') { reloadEntered(); await reload; }
    },
    onDataChange() { effects.callback += 1; },
    showUndo() { effects.undo += 1; },
    notify() { effects.notify += 1; },
    memberById: () => ({ display_name: 'SYNTHETIC_PERFORMER_A' }),
    locationById: () => ({ name: 'SYNTHETIC_LOCATION_A' }),
    shortDate: value => value,
    item, options: { requireAtomic }
  }, { codeGeneration: { strings: false, wasm: false } });
  const run = script => new vm.Script(script).runInContext(context, { timeout: 500 });
  run(`let organization={id:'SYNTHETIC_ORG_A'},dispatcherActions=true,actionPending=false,rows=[],services=[];
    ${matches[0][0]}`);
  const pending = run("moveBooking(item,item.performer_id,'2026-10-20',780,item.location_id,options);");
  await entered;
  if (change === 'organization') run("organization={id:'SYNTHETIC_ORG_B'};");
  if (change === 'actor') { actor = 'SYNTHETIC_ACTOR_B'; generation = 2; }
  if (change === 'ownership') run("actionPending={SYNTHETIC_NEW_OWNER:true};");
  releaseRpc({ data: rejected ? null : true,
    error: missing ? { code: 'PGRST202' } : rejected ? { code: '42501' } : null });
  if (change === 'reload-organization') {
    await reloadStarted;
    run("organization={id:'SYNTHETIC_ORG_B'};");
    releaseReload();
  }
  const result = await pending;
  const deniedBeforeEffects = ['organization', 'actor', 'ownership'].includes(change);
  const ordinaryFailure = rejected || thrown || (missing && requireAtomic);
  assert.equal(result, !(deniedBeforeEffects || ordinaryFailure || change === 'reload-organization'));
  assert.equal(calls.length, missing && !requireAtomic && !deniedBeforeEffects ? 2 : 1);
  const expected = deniedBeforeEffects ? { close: 0, load: 0, callback: 0, undo: 0, notify: 0 }
    : change === 'reload-organization' ? { close: 1, load: 1, callback: 0, undo: 0, notify: 0 }
      : ordinaryFailure ? { close: 0, load: 1, callback: 0, undo: 0, notify: 1 }
        : { close: 1, load: 1, callback: 1, undo: missing ? 0 : 1, notify: missing ? 1 : 0 };
  assert.deepEqual(effects, expected);
  if (change === 'ownership') assert.equal(run('actionPending.SYNTHETIC_NEW_OWNER'), true, 'old completion must not release another operation');
  else assert.equal(run('actionPending'), false, 'the owned operation always releases its pending state');
}

test('move scope keeps an ordinary v104 success', () => checkMove());
test('move scope keeps a definite server refusal', () => checkMove({ rejected: true }));
test('move scope keeps the existing v102 fallback tuple', () => checkMove({ missing: true }));
test('move scope keeps atomic undo refusal when v104 is missing', () => checkMove({ missing: true, requireAtomic: true }));
test('move scope handles a rejected transport through its ordinary failure path', () => checkMove({ thrown: true }));
test('move scope rejects an old organization completion', () => checkMove({ change: 'organization' }));
test('move scope rejects an old actor/session completion', () => checkMove({ change: 'actor' }));
test('move scope does not fallback into a new organization', () => checkMove({ change: 'organization', missing: true }));
test('move scope checks the organization again after reload', () => checkMove({ change: 'reload-organization' }));
test('move scope cannot release a replacement operation owner', () => checkMove({ change: 'ownership' }));
