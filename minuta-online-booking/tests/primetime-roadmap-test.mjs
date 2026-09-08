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

test('published roadmap contract is valid and selects safe work inside stage 0', () => {
  const plan = readJson(PLAN_PATH);
  const status = readJson(STATUS_PATH);
  const result = validateRoadmap(plan, status);
  assert.equal(result.valid, true);
  assert.equal(result.items, 22);

  const next = selectNext(plan, status);
  assert.equal(next.decision, 'work');
  assert.equal(next.stage.id, 'stage-0');
  assert.equal(next.primary.id, 'D02');
  assert.deepEqual(next.parallelCandidates.map(item => item.id), ['D03', 'D05']);
  assert.deepEqual(next.blockers.map(item => item.id), ['D01', 'D04']);
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
  const after = clone(before);
  after.updatedAt = '2026-09-08T00:01:00Z';
  after.items.D06.status = 'implementing';
  const result = verifyTransition(plan, before, after);
  assert.deepEqual(result, {
    valid: true,
    itemId: 'D06',
    from: 'not_started',
    to: 'implementing',
    evidenceOnly: false,
    planVersion: plan.version
  });

  after.items.D09.status = 'implementing';
  assert.throws(() => verifyTransition(plan, before, after), /exactly one roadmap item must change/);
});

test('transition cannot mark an item ready without complete production evidence', () => {
  const plan = readJson(PLAN_PATH);
  const before = readJson(STATUS_PATH);
  const after = clone(before);
  after.updatedAt = '2026-09-08T00:01:00Z';
  after.items.D02.status = 'verifying';
  assert.throws(() => verifyTransition(plan, before, after), /completion requires releaseSha/);
});

test('CLI validate and next are read-only and return JSON', () => {
  for (const command of ['validate', 'next']) {
    const run = spawnSync(process.execPath, [CLI_PATH, command, PLAN_PATH, STATUS_PATH], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotThrow(() => JSON.parse(run.stdout));
  }
});
