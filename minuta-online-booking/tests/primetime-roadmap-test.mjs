import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readJson,
  selectNext,
  validatePlan,
  validateRoadmap,
  verifyTransition
} from '../scripts/primetime-roadmap.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAN_PATH = resolve(APP_DIR, 'roadmap', 'plan.json');
const STATUS_PATH = resolve(APP_DIR, 'roadmap', 'status.json');
const CLI_PATH = resolve(APP_DIR, 'scripts', 'primetime-roadmap.mjs');
const clone = value => structuredClone(value);
const resetItems = (status, ids) => {
  for (const id of ids) status.items[id] = { status:'not_started', evidence:{}, blocker:null };
  return status;
};
const completeEvidence = (item, marker = 'a') => ({
  releaseSha: marker.repeat(40),
  releaseVersion: `test-${item.id.toLowerCase()}`,
  ciRuns: Object.fromEntries(item.completion.requiredCi.map((name, index) => [name, 1000 + index])),
  productionHealthRunId: 2000,
  verifiedAt: '2026-09-08T22:05:59Z',
  liveChecks: { '390':true, '760':true, '1440':true },
  checks: Object.fromEntries(item.completion.requiredChecks.map(name => [name, true]))
});

test('current override exposes its approved subset while stage-0 remains blocked', () => {
  const plan = readJson(PLAN_PATH);
  const status = readJson(STATUS_PATH);
  resetItems(status, ['D06', 'D07', 'D09', 'D10', 'D11', 'D12', 'D13']);
  const result = validateRoadmap(plan, status);
  assert.equal(result.valid, true);
  assert.equal(result.items, 22);
  assert.equal(status.items.D01.status, 'awaiting_external');

  const next = selectNext(plan, status);
  assert.equal(next.decision, 'work');
  assert.equal(next.stage.id, 'stage-1');
  assert.equal(next.blockedStage.id, 'stage-0');
  assert.equal(next.primary.id, 'D06');
  assert.deepEqual(next.parallelCandidates.map(item => item.id), ['D09']);
  assert.deepEqual(next.override.allowedItems, status.stageGateOverride.allowedItems);
  assert.deepEqual(next.blockers.map(item => item.id), ['D01', 'D02', 'D03', 'D04', 'D05']);
  assert(![next.primary.id, ...next.parallelCandidates.map(item => item.id)].some(id => ['D08', 'D14'].includes(id)));
});

test('validator fails closed on undeclared evidence and dependency cycles', () => {
  const plan = readJson(PLAN_PATH);
  const status = readJson(STATUS_PATH);
  status.items.D02.evidence.secretToken = 'must-not-be-recorded';
  assert.throws(() => validateRoadmap(plan, status), /unknown fields secretToken/);

  const cyclic = clone(plan);
  cyclic.items.find(item => item.id === 'D01').dependsOn = ['D02'];
  cyclic.items.find(item => item.id === 'D02').dependsOn = ['D01'];
  assert.throws(() => validatePlan(cyclic), /dependency cycle/);
});

test('transition accepts one monotonic item update and rejects multiple updates', () => {
  const plan = readJson(PLAN_PATH);
  const before = readJson(STATUS_PATH);
  before.items.D09 = { status:'not_started', evidence:{}, blocker:null };
  const after = clone(before);
  after.updatedAt = new Date(Date.parse(before.updatedAt) + 1000).toISOString();
  after.items.D09.status = 'implementing';
  const result = verifyTransition(plan, before, after);
  assert.deepEqual(result, {
    valid: true,
    itemId: 'D09',
    from: 'not_started',
    to: 'implementing',
    evidenceOnly: false,
    planVersion: plan.version
  });

  after.items.D06.evidence.verifiedAt = new Date(Date.parse(after.items.D06.evidence.verifiedAt) + 1000).toISOString();
  assert.throws(() => verifyTransition(plan, before, after), /exactly one roadmap item or stage-gate override must change/);
});

test('override activation is an isolated transition and requires explicit user approval', () => {
  const plan = readJson(PLAN_PATH);
  const published = readJson(STATUS_PATH);
  resetItems(published, ['D06', 'D07', 'D09', 'D10', 'D11', 'D12', 'D13']);
  const after = clone(published);
  after.updatedAt = after.stageGateOverride.approvedAt;
  const before = clone(after);
  before.schemaVersion = 1;
  before.updatedAt = new Date(Date.parse(after.updatedAt) - 1000).toISOString();
  delete before.stageGateOverride;
  assert.deepEqual(verifyTransition(plan, before, after), {
    valid: true,
    change: 'stage_gate_override',
    from: 'inactive',
    to: 'active',
    allowedItems: after.stageGateOverride.allowedItems,
    planVersion: plan.version
  });

  const combined = clone(published);
  combined.updatedAt = new Date(Date.parse(published.updatedAt) + 1000).toISOString();
  combined.items.D09.status = 'implementing';
  combined.stageGateOverride = null;
  assert.throws(() => verifyTransition(plan, published, combined), /exactly one roadmap item or stage-gate override must change/);

  const replaced = clone(published);
  replaced.updatedAt = new Date(Date.parse(published.updatedAt) + 1000).toISOString();
  replaced.stageGateOverride.approvedAt = replaced.updatedAt;
  replaced.stageGateOverride.allowedItems = ['D06', 'D07', 'D09', 'D10', 'D11', 'D12', 'D13'];
  assert.deepEqual(verifyTransition(plan, published, replaced), {
    valid: true,
    change: 'stage_gate_override',
    from: 'active',
    to: 'active',
    allowedItems: replaced.stageGateOverride.allowedItems,
    planVersion: plan.version
  });

  const narrowed = clone(replaced);
  narrowed.updatedAt = new Date(Date.parse(replaced.updatedAt) + 1000).toISOString();
  narrowed.stageGateOverride.approvedAt = narrowed.updatedAt;
  narrowed.stageGateOverride.allowedItems = ['D06', 'D07', 'D10', 'D11', 'D12', 'D13'];
  assert.throws(() => verifyTransition(plan, replaced, narrowed), /only expand monotonically/);

  const forged = clone(published);
  forged.stageGateOverride.approvedBy = 'automation';
  assert.throws(() => validateRoadmap(plan, forged), /explicit user approval is required/);
});

test('override scope expands only within the approved stage-1 chain and preserves contracts', () => {
  const plan = readJson(PLAN_PATH);
  const status = readJson(STATUS_PATH);
  const expanded = resetItems(clone(status), ['D07', 'D10', 'D11', 'D12', 'D13']);
  expanded.stageGateOverride.allowedItems = ['D06', 'D07', 'D09', 'D10', 'D11', 'D12', 'D13'];
  assert.equal(validateRoadmap(plan, expanded).valid, true);
  const next = selectNext(plan, expanded);
  assert.equal(next.primary.id, 'D07');
  assert.deepEqual(next.parallelCandidates, []);
  assert.deepEqual(next.override.allowedItems, expanded.stageGateOverride.allowedItems);

  for (const allowedItems of [['D06', 'D08'], ['D06', 'D14'], ['D06', 'D15'], ['D06', 'UNKNOWN']]) {
    const expanded = clone(status);
    expanded.stageGateOverride.allowedItems = allowedItems;
    assert.throws(() => validateRoadmap(plan, expanded), /unsupported early-work items/);
  }

  const dependencyDrift = clone(plan);
  dependencyDrift.items.find(item => item.id === 'D09').dependsOn = ['D01'];
  assert.throws(() => validateRoadmap(dependencyDrift, status), /dependency contract changed/);

  const externalDrift = clone(plan);
  externalDrift.items.find(item => item.id === 'D09').externalActions = ['real_financial_transaction'];
  assert.throws(() => validateRoadmap(externalDrift, status), /external-action contract changed/);

  const missingDependency = clone(expanded);
  missingDependency.items.D06.status = 'implementing';
  missingDependency.stageGateOverride.allowedItems = ['D07'];
  assert.throws(() => validateRoadmap(plan, missingDependency), /dependency D06 is neither done nor included/);

  const chain = clone(expanded);
  const d07 = plan.items.find(item => item.id === 'D07');
  chain.items.D07 = { status:'done', evidence:completeEvidence(d07, 'd'), blocker:null };
  assert.equal(selectNext(plan, chain).primary.id, 'D10');
  const d10 = plan.items.find(item => item.id === 'D10');
  assert.deepEqual(d10.externalActions, ['real_external_site']);
  chain.items.D10 = { status:'done', evidence:completeEvidence(d10, 'e'), blocker:null };
  const d11Next = selectNext(plan, chain);
  assert.equal(d11Next.primary.id, 'D11');
  assert.deepEqual(d11Next.primary.externalActions, ['maps_provider_account']);

  const d11 = plan.items.find(item => item.id === 'D11');
  const unsafeBefore = clone(chain);
  unsafeBefore.items.D11 = { status:'implementing', evidence:{}, blocker:null };
  const unsafeAfter = clone(unsafeBefore);
  unsafeAfter.updatedAt = new Date(Date.parse(unsafeBefore.updatedAt) + 1000).toISOString();
  unsafeAfter.items.D11 = { status:'verifying', evidence:completeEvidence(d11, 'f'), blocker:null };
  assert.throws(() => verifyTransition(plan, unsafeBefore, unsafeAfter), /recorded stop-gate/);

  const gatedBefore = clone(unsafeBefore);
  gatedBefore.items.D11 = {
    status:'awaiting_external',
    evidence:{},
    blocker:{ type:'account', reason:'Test external gate', requiredAction:'Test approved provider action' }
  };
  const gatedAfter = clone(unsafeAfter);
  assert.equal(verifyTransition(plan, gatedBefore, gatedAfter).to, 'verifying');
});

test('ordinary work in the blocked stage keeps priority over the override', () => {
  const plan = readJson(PLAN_PATH);
  const status = readJson(STATUS_PATH);
  status.items.D05.status = 'not_started';
  status.items.D05.blocker = null;
  const next = selectNext(plan, status);
  assert.equal(next.decision, 'work');
  assert.equal(next.stage.id, 'stage-0');
  assert.equal(next.primary.id, 'D05');
  assert.equal(next.override, undefined);
  assert.equal(next.blockedStage, undefined);
});

test('transition cannot mark an item ready without complete production evidence', () => {
  const plan = readJson(PLAN_PATH);
  const before = readJson(STATUS_PATH);
  const after = clone(before);
  after.updatedAt = new Date(Date.parse(before.updatedAt) + 1000).toISOString();
  after.items.D02.status = 'verifying';
  after.items.D02.evidence = {};
  after.items.D02.blocker = null;
  assert.throws(() => verifyTransition(plan, before, after), /completion requires releaseSha/);

  const early = clone(before);
  early.updatedAt = new Date(Date.parse(before.updatedAt) + 1000).toISOString();
  early.items.D06.status = 'verifying';
  early.items.D06.evidence = {};
  assert.throws(() => verifyTransition(plan, before, early), /completion requires releaseSha/);
});

test('override permits fully evidenced D06 and D09 only, then returns to stage-0', () => {
  const plan = readJson(PLAN_PATH);
  const status = readJson(STATUS_PATH);
  resetItems(status, ['D07', 'D10', 'D11', 'D12', 'D13']);
  status.stageGateOverride.allowedItems = ['D06', 'D09'];
  for (const [index, id] of ['D06', 'D09'].entries()) {
    const item = plan.items.find(candidate => candidate.id === id);
    status.items[id].status = 'done';
    status.items[id].evidence = completeEvidence(item, index ? 'b' : 'a');
  }
  const next = selectNext(plan, status);
  assert.equal(next.decision, 'blocked');
  assert.equal(next.stage.id, 'stage-0');
  assert.equal(next.primary, null);
  assert.deepEqual(next.parallelCandidates, []);
  assert.deepEqual(next.blockers.map(item => item.id), ['D01', 'D02', 'D03', 'D04', 'D05']);

  for (const id of ['D08', 'D14']) {
    const attempted = clone(status);
    const item = plan.items.find(candidate => candidate.id === id);
    attempted.items[id].status = 'verifying';
    attempted.items[id].evidence = completeEvidence(item, id === 'D08' ? 'c' : 'd');
    assert.throws(() => validateRoadmap(plan, attempted), new RegExp(`status ${id}: dependency D01 is not done`));
  }
});

test('CLI validate and next are read-only and return JSON', () => {
  for (const command of ['validate', 'next']) {
    const run = spawnSync(process.execPath, [CLI_PATH, command, PLAN_PATH, STATUS_PATH], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotThrow(() => JSON.parse(run.stdout));
  }
});
