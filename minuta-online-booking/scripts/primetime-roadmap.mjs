#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PLAN = resolve(APP_DIR, 'roadmap', 'plan.json');
const DEFAULT_STATUS = resolve(APP_DIR, 'roadmap', 'status.json');
const EVIDENCE_KEYS = ['releaseSha', 'releaseVersion', 'ciRuns', 'productionHealthRunId', 'verifiedAt', 'liveChecks', 'checks'];
const LIVE_WIDTHS = ['390', '760', '1440'];
const BLOCKER_TYPES = ['secret', 'account', 'provider', 'device', 'human_decision', 'human_confirmation', 'production_access', 'legal'];
const STAGE_GATE_OVERRIDE_ITEMS = ['D06', 'D07', 'D09', 'D10', 'D11', 'D12', 'D13'];
const STAGE_GATE_OVERRIDE_CONTRACTS = {
  D06: { dependsOn: [], externalActions: [] },
  D07: { dependsOn: ['D06'], externalActions: [] },
  D09: { dependsOn: [], externalActions: [] },
  D10: { dependsOn: [], externalActions: [] },
  D11: { dependsOn: ['D10'], externalActions: ['maps_provider_account'] },
  D12: { dependsOn: ['D11'], externalActions: ['calendar_provider_credentials'] },
  D13: { dependsOn: ['D12'], externalActions: ['customer_export_file'] }
};
const STAGE_GATE_OVERRIDE_TYPE = 'allow_early_stage_work';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(object(value), `${label}: expected object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert.deepEqual(actual, expected, `${label}: unexpected or missing fields`);
}

function nonEmptyString(value, label) {
  assert.equal(typeof value, 'string', `${label}: expected string`);
  assert(value.trim().length > 0, `${label}: must not be empty`);
}

function stringList(value, label, { allowEmpty = true } = {}) {
  assert(Array.isArray(value), `${label}: expected array`);
  if (!allowEmpty) assert(value.length > 0, `${label}: must not be empty`);
  const seen = new Set();
  for (const entry of value) {
    nonEmptyString(entry, `${label}[]`);
    assert(!seen.has(entry), `${label}: duplicate ${entry}`);
    seen.add(entry);
  }
}

function isoTimestamp(value, label) {
  nonEmptyString(value, label);
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), `${label}: expected UTC ISO timestamp`);
  assert(Number.isFinite(Date.parse(value)), `${label}: invalid timestamp`);
}

function validateStageGateOverride(plan, status) {
  if (status.schemaVersion === 1) return new Set();
  const override = status.stageGateOverride;
  if (override === null) return new Set();
  exactKeys(override, ['type', 'approvedBy', 'approvedAt', 'reason', 'allowedItems'], 'status.stageGateOverride');
  assert.equal(override.type, STAGE_GATE_OVERRIDE_TYPE, 'status.stageGateOverride.type: unsupported type');
  assert.equal(override.approvedBy, 'user', 'status.stageGateOverride.approvedBy: explicit user approval is required');
  isoTimestamp(override.approvedAt, 'status.stageGateOverride.approvedAt');
  assert(Date.parse(override.approvedAt) <= Date.parse(status.updatedAt), 'status.stageGateOverride.approvedAt: cannot be later than status.updatedAt');
  nonEmptyString(override.reason, 'status.stageGateOverride.reason');
  stringList(override.allowedItems, 'status.stageGateOverride.allowedItems', { allowEmpty: false });
  const unsupported = override.allowedItems.filter(id => !STAGE_GATE_OVERRIDE_ITEMS.includes(id));
  assert.equal(unsupported.length, 0, `status.stageGateOverride.allowedItems: unsupported early-work items ${unsupported.join(', ')}`);

  const itemById = new Map(plan.items.map(item => [item.id, item]));
  const allowed = new Set(override.allowedItems);
  for (const id of override.allowedItems) {
    const item = itemById.get(id);
    assert(item, `status.stageGateOverride.allowedItems: unknown item ${id}`);
    const contract = STAGE_GATE_OVERRIDE_CONTRACTS[id];
    assert.deepEqual(item.dependsOn, contract.dependsOn, `status.stageGateOverride ${id}: dependency contract changed`);
    assert.deepEqual(item.externalActions, contract.externalActions, `status.stageGateOverride ${id}: external-action contract changed`);
    for (const dependency of item.dependsOn) {
      assert(status.items[dependency].status === 'done' || allowed.has(dependency), `status.stageGateOverride ${id}: dependency ${dependency} is neither done nor included`);
    }
  }
  return new Set(override.allowedItems);
}

export function readJson(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: invalid JSON (${error.message})`);
  }
  assert(object(parsed), `${path}: root must be an object`);
  return parsed;
}

export function validatePlan(plan) {
  exactKeys(plan, ['schemaVersion', 'product', 'version', 'statusValues', 'stages', 'items'], 'plan');
  assert.equal(plan.schemaVersion, 1, 'plan.schemaVersion: unsupported version');
  nonEmptyString(plan.product, 'plan.product');
  nonEmptyString(plan.version, 'plan.version');
  stringList(plan.statusValues, 'plan.statusValues', { allowEmpty: false });
  assert.deepEqual(plan.statusValues, ['not_started', 'implementing', 'awaiting_external', 'awaiting_human', 'verifying', 'done', 'failed'], 'plan.statusValues: contract changed');
  assert(Array.isArray(plan.stages) && plan.stages.length > 0, 'plan.stages: expected non-empty array');
  assert(Array.isArray(plan.items) && plan.items.length > 0, 'plan.items: expected non-empty array');

  const stageIds = new Set();
  const stageOrders = new Set();
  for (const stage of plan.stages) {
    exactKeys(stage, ['id', 'order', 'title', 'requiresAll', 'advanceOnlyWhenComplete'], `stage ${stage?.id ?? '?'}`);
    nonEmptyString(stage.id, 'stage.id');
    nonEmptyString(stage.title, `stage ${stage.id}.title`);
    assert(Number.isInteger(stage.order) && stage.order >= 0, `stage ${stage.id}.order: expected non-negative integer`);
    assert.equal(stage.requiresAll, true, `stage ${stage.id}: requiresAll must be true`);
    assert.equal(stage.advanceOnlyWhenComplete, true, `stage ${stage.id}: advanceOnlyWhenComplete must be true`);
    assert(!stageIds.has(stage.id), `duplicate stage ${stage.id}`);
    assert(!stageOrders.has(stage.order), `duplicate stage order ${stage.order}`);
    stageIds.add(stage.id);
    stageOrders.add(stage.order);
  }
  const orders = [...stageOrders].sort((a, b) => a - b);
  assert.deepEqual(orders, orders.map((_, index) => index), 'stage orders must be contiguous from zero');

  const itemIds = new Set();
  const priorities = new Set();
  for (const item of plan.items) {
    exactKeys(item, ['id', 'stageId', 'priority', 'title', 'dependsOn', 'parallelizable', 'externalActions', 'completion'], `item ${item?.id ?? '?'}`);
    nonEmptyString(item.id, 'item.id');
    assert(/^D\d{2}$/.test(item.id), `item ${item.id}: expected DNN id`);
    assert(!itemIds.has(item.id), `duplicate item ${item.id}`);
    itemIds.add(item.id);
    assert(stageIds.has(item.stageId), `item ${item.id}: unknown stage ${item.stageId}`);
    assert(Number.isInteger(item.priority) && item.priority > 0, `item ${item.id}.priority: expected positive integer`);
    const priorityKey = `${item.stageId}:${item.priority}`;
    assert(!priorities.has(priorityKey), `duplicate priority ${priorityKey}`);
    priorities.add(priorityKey);
    nonEmptyString(item.title, `item ${item.id}.title`);
    stringList(item.dependsOn, `item ${item.id}.dependsOn`);
    stringList(item.externalActions, `item ${item.id}.externalActions`);
    assert.equal(typeof item.parallelizable, 'boolean', `item ${item.id}.parallelizable: expected boolean`);
    exactKeys(item.completion, ['requiredCi', 'requiredChecks'], `item ${item.id}.completion`);
    stringList(item.completion.requiredCi, `item ${item.id}.completion.requiredCi`, { allowEmpty: false });
    stringList(item.completion.requiredChecks, `item ${item.id}.completion.requiredChecks`, { allowEmpty: false });
  }

  const itemById = new Map(plan.items.map(item => [item.id, item]));
  const stageById = new Map(plan.stages.map(stage => [stage.id, stage]));
  for (const item of plan.items) {
    for (const dependency of item.dependsOn) {
      assert(itemById.has(dependency), `item ${item.id}: unknown dependency ${dependency}`);
      assert.notEqual(dependency, item.id, `item ${item.id}: self dependency`);
      const dependencyStage = stageById.get(itemById.get(dependency).stageId);
      const itemStage = stageById.get(item.stageId);
      assert(dependencyStage.order <= itemStage.order, `item ${item.id}: dependency ${dependency} belongs to a later stage`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    assert(!visiting.has(id), `dependency cycle at ${id}`);
    visiting.add(id);
    for (const dependency of itemById.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of itemIds) visit(id);
  return plan;
}

function validateEvidence(item, evidence, complete) {
  assert(object(evidence), `status ${item.id}.evidence: expected object`);
  const unknown = Object.keys(evidence).filter(key => !EVIDENCE_KEYS.includes(key));
  assert.equal(unknown.length, 0, `status ${item.id}.evidence: unknown fields ${unknown.join(', ')}`);

  if ('releaseSha' in evidence) assert(/^[0-9a-f]{40}$/.test(evidence.releaseSha), `status ${item.id}.evidence.releaseSha: expected lowercase SHA-1`);
  if ('releaseVersion' in evidence) nonEmptyString(evidence.releaseVersion, `status ${item.id}.evidence.releaseVersion`);
  if ('productionHealthRunId' in evidence) assert(Number.isSafeInteger(evidence.productionHealthRunId) && evidence.productionHealthRunId > 0, `status ${item.id}.evidence.productionHealthRunId: expected positive integer`);
  if ('verifiedAt' in evidence) isoTimestamp(evidence.verifiedAt, `status ${item.id}.evidence.verifiedAt`);

  if ('ciRuns' in evidence) {
    assert(object(evidence.ciRuns), `status ${item.id}.evidence.ciRuns: expected object`);
    const allowed = new Set(item.completion.requiredCi);
    for (const [name, runId] of Object.entries(evidence.ciRuns)) {
      assert(allowed.has(name), `status ${item.id}.evidence.ciRuns: undeclared workflow ${name}`);
      assert(Number.isSafeInteger(runId) && runId > 0, `status ${item.id}.evidence.ciRuns.${name}: expected positive integer`);
    }
  }
  if ('liveChecks' in evidence) {
    assert(object(evidence.liveChecks), `status ${item.id}.evidence.liveChecks: expected object`);
    const unknownWidths = Object.keys(evidence.liveChecks).filter(width => !LIVE_WIDTHS.includes(width));
    assert.equal(unknownWidths.length, 0, `status ${item.id}.evidence.liveChecks: unknown widths ${unknownWidths.join(', ')}`);
    for (const [width, result] of Object.entries(evidence.liveChecks)) assert.equal(typeof result, 'boolean', `status ${item.id}.evidence.liveChecks.${width}: expected boolean`);
  }
  if ('checks' in evidence) {
    assert(object(evidence.checks), `status ${item.id}.evidence.checks: expected object`);
    const allowed = new Set(item.completion.requiredChecks);
    for (const [name, result] of Object.entries(evidence.checks)) {
      assert(allowed.has(name), `status ${item.id}.evidence.checks: undeclared check ${name}`);
      assert.equal(typeof result, 'boolean', `status ${item.id}.evidence.checks.${name}: expected boolean`);
    }
  }

  if (!complete) return;
  assert(/^[0-9a-f]{40}$/.test(evidence.releaseSha ?? ''), `status ${item.id}: completion requires releaseSha`);
  nonEmptyString(evidence.releaseVersion, `status ${item.id}: completion requires releaseVersion`);
  assert(Number.isSafeInteger(evidence.productionHealthRunId) && evidence.productionHealthRunId > 0, `status ${item.id}: completion requires productionHealthRunId`);
  isoTimestamp(evidence.verifiedAt, `status ${item.id}: completion requires verifiedAt`);
  assert(object(evidence.ciRuns), `status ${item.id}: completion requires ciRuns`);
  for (const name of item.completion.requiredCi) assert(Number.isSafeInteger(evidence.ciRuns[name]) && evidence.ciRuns[name] > 0, `status ${item.id}: missing successful CI evidence ${name}`);
  assert(object(evidence.liveChecks), `status ${item.id}: completion requires liveChecks`);
  for (const width of LIVE_WIDTHS) assert.equal(evidence.liveChecks[width], true, `status ${item.id}: live check ${width}px is not proven`);
  assert(object(evidence.checks), `status ${item.id}: completion requires checks`);
  for (const name of item.completion.requiredChecks) assert.equal(evidence.checks[name], true, `status ${item.id}: check ${name} is not proven`);
}

export function validateStatus(plan, status) {
  validatePlan(plan);
  assert([1, 2].includes(status.schemaVersion), 'status.schemaVersion: unsupported version');
  exactKeys(status, status.schemaVersion === 1
    ? ['schemaVersion', 'planVersion', 'updatedAt', 'items']
    : ['schemaVersion', 'planVersion', 'updatedAt', 'items', 'stageGateOverride'], 'status');
  assert.equal(status.planVersion, plan.version, 'status.planVersion: does not match plan');
  isoTimestamp(status.updatedAt, 'status.updatedAt');
  assert(object(status.items), 'status.items: expected object');

  const planIds = plan.items.map(item => item.id).sort();
  assert.deepEqual(Object.keys(status.items).sort(), planIds, 'status.items: must contain every plan item exactly once');
  const statusValues = new Set(plan.statusValues);
  const itemById = new Map(plan.items.map(item => [item.id, item]));
  const stageById = new Map(plan.stages.map(stage => [stage.id, stage]));
  const overrideItems = validateStageGateOverride(plan, status);

  for (const item of plan.items) {
    const record = status.items[item.id];
    exactKeys(record, ['status', 'evidence', 'blocker'], `status ${item.id}`);
    assert(statusValues.has(record.status), `status ${item.id}: unsupported status ${record.status}`);
    if (record.status === 'awaiting_external' || record.status === 'awaiting_human' || record.status === 'failed') {
      if (record.status === 'awaiting_external') assert(item.externalActions.length > 0, `status ${item.id}: external blocker is not declared by plan`);
      exactKeys(record.blocker, ['type', 'reason', 'requiredAction'], `status ${item.id}.blocker`);
      nonEmptyString(record.blocker.type, `status ${item.id}.blocker.type`);
      assert(BLOCKER_TYPES.includes(record.blocker.type), `status ${item.id}.blocker.type: unsupported type ${record.blocker.type}`);
      nonEmptyString(record.blocker.reason, `status ${item.id}.blocker.reason`);
      nonEmptyString(record.blocker.requiredAction, `status ${item.id}.blocker.requiredAction`);
    } else {
      assert.equal(record.blocker, null, `status ${item.id}: blocker must be null unless work is blocked`);
    }
    validateEvidence(item, record.evidence, record.status === 'verifying' || record.status === 'done');

    if (record.status === 'verifying' || record.status === 'done') {
      for (const dependency of item.dependsOn) assert.equal(status.items[dependency].status, 'done', `status ${item.id}: dependency ${dependency} is not done`);
      if (!overrideItems.has(item.id)) {
        const itemStageOrder = stageById.get(item.stageId).order;
        for (const earlier of plan.items) {
          if (stageById.get(earlier.stageId).order < itemStageOrder) assert.equal(status.items[earlier.id].status, 'done', `status ${item.id}: earlier stage item ${earlier.id} is not done`);
        }
      }
    }
  }
  return status;
}

export function validateRoadmap(plan, status) {
  validateStatus(plan, status);
  return {
    valid: true,
    planVersion: plan.version,
    updatedAt: status.updatedAt,
    stages: plan.stages.length,
    items: plan.items.length
  };
}

export function selectNext(plan, status) {
  validateStatus(plan, status);
  const stageByOrder = [...plan.stages].sort((a, b) => a.order - b.order);
  const stageById = new Map(plan.stages.map(stage => [stage.id, stage]));
  const stageComplete = stage => plan.items.filter(item => item.stageId === stage.id).every(item => status.items[item.id].status === 'done');
  const stage = stageByOrder.find(candidate => !stageComplete(candidate));
  if (!stage) return { decision: 'complete', planVersion: plan.version, stage: null, primary: null, parallelCandidates: [], blockers: [] };

  for (const earlier of stageByOrder.filter(candidate => candidate.order < stage.order)) assert(stageComplete(earlier), `cannot enter ${stage.id}: ${earlier.id} is incomplete`);
  const stageItems = plan.items.filter(item => item.stageId === stage.id);
  const dependenciesDone = item => item.dependsOn.every(id => status.items[id].status === 'done');
  const stateRank = { verifying: 0, implementing: 1, not_started: 2 };
  const actionable = stageItems
    .filter(item => Object.hasOwn(stateRank, status.items[item.id].status) && dependenciesDone(item))
    .sort((a, b) => stateRank[status.items[a.id].status] - stateRank[status.items[b.id].status] || a.priority - b.priority || a.id.localeCompare(b.id));
  const blockers = stageItems
    .filter(item => ['awaiting_external', 'awaiting_human', 'failed'].includes(status.items[item.id].status))
    .sort((a, b) => a.priority - b.priority)
    .map(item => ({ id: item.id, title: item.title, ...status.items[item.id].blocker }));

  let selectedStage = stage;
  let selected = actionable;
  let override = null;
  if (!selected.length && status.schemaVersion === 2 && status.stageGateOverride) {
    const allowed = new Set(status.stageGateOverride.allowedItems);
    const overrideCandidates = plan.items
      .filter(item => stageById.get(item.stageId).order > stage.order
        && allowed.has(item.id)
        && Object.hasOwn(stateRank, status.items[item.id].status)
        && dependenciesDone(item))
      .sort((a, b) => stageById.get(a.stageId).order - stageById.get(b.stageId).order
        || stateRank[status.items[a.id].status] - stateRank[status.items[b.id].status]
        || a.priority - b.priority
        || a.id.localeCompare(b.id));
    if (overrideCandidates.length) {
      selectedStage = stageById.get(overrideCandidates[0].stageId);
      selected = overrideCandidates.filter(item => item.stageId === selectedStage.id);
      override = {
        type: status.stageGateOverride.type,
        approvedAt: status.stageGateOverride.approvedAt,
        allowedItems: [...status.stageGateOverride.allowedItems]
      };
    }
  }

  if (!selected.length) {
    return { decision: 'blocked', planVersion: plan.version, stage: { id: stage.id, title: stage.title }, primary: null, parallelCandidates: [], blockers };
  }
  const primary = selected[0];
  const parallelCandidates = selected
    .slice(1)
    .filter(item => item.parallelizable)
    .map(item => ({ id: item.id, title: item.title, status: status.items[item.id].status }));
  const result = {
    decision: 'work',
    planVersion: plan.version,
    stage: { id: selectedStage.id, title: selectedStage.title },
    primary: { id: primary.id, title: primary.title, status: status.items[primary.id].status, externalActions: primary.externalActions },
    parallelCandidates,
    blockers
  };
  if (override) {
    result.blockedStage = { id: stage.id, title: stage.title };
    result.override = override;
  }
  return result;
}

const TRANSITIONS = {
  not_started: new Set(['not_started', 'implementing', 'awaiting_external', 'awaiting_human', 'failed']),
  implementing: new Set(['implementing', 'verifying', 'awaiting_external', 'awaiting_human', 'failed']),
  awaiting_external: new Set(['awaiting_external', 'implementing', 'awaiting_human', 'verifying', 'failed']),
  awaiting_human: new Set(['awaiting_human', 'implementing', 'awaiting_external', 'verifying', 'failed']),
  verifying: new Set(['verifying', 'done', 'implementing', 'awaiting_external', 'awaiting_human', 'failed']),
  done: new Set(['done']),
  failed: new Set(['failed', 'implementing', 'awaiting_external', 'awaiting_human'])
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function verifyTransition(plan, before, after) {
  validateStatus(plan, before);
  validateStatus(plan, after);
  assert(Date.parse(after.updatedAt) > Date.parse(before.updatedAt), 'transition: updatedAt must increase');
  const changed = plan.items.filter(item => canonical(before.items[item.id]) !== canonical(after.items[item.id]));
  const beforeOverride = before.schemaVersion === 2 ? before.stageGateOverride : null;
  const afterOverride = after.schemaVersion === 2 ? after.stageGateOverride : null;
  const overrideChanged = canonical(beforeOverride) !== canonical(afterOverride);
  assert(after.schemaVersion >= before.schemaVersion, 'transition: status schema cannot move backwards');
  assert.equal(changed.length + Number(overrideChanged), 1, 'transition: exactly one roadmap item or stage-gate override must change');
  if (overrideChanged) {
    assert.equal(changed.length, 0, 'transition: stage-gate override and roadmap item cannot change together');
    if (beforeOverride && afterOverride) {
      const nextAllowed = new Set(afterOverride.allowedItems);
      assert(beforeOverride.allowedItems.every(id => nextAllowed.has(id)), 'transition: active stage-gate override can only expand monotonically');
    }
    if (afterOverride) assert.equal(afterOverride.approvedAt, after.updatedAt, 'transition: activation approval must match updatedAt');
    return {
      valid: true,
      change: 'stage_gate_override',
      from: beforeOverride ? 'active' : 'inactive',
      to: afterOverride ? 'active' : 'inactive',
      allowedItems: afterOverride?.allowedItems ?? [],
      planVersion: plan.version
    };
  }
  assert.equal(after.schemaVersion, before.schemaVersion, 'transition: schema change requires a stage-gate override change');
  const item = changed[0];
  const previous = before.items[item.id];
  const next = after.items[item.id];
  assert(TRANSITIONS[previous.status].has(next.status), `transition ${item.id}: ${previous.status} -> ${next.status} is forbidden`);
  assert.notEqual(previous.status, 'done', `transition ${item.id}: completed evidence is immutable`);
  if (next.status === 'verifying' && item.externalActions.length > 0) {
    assert(['awaiting_external', 'awaiting_human'].includes(previous.status), `transition ${item.id}: external actions require a recorded stop-gate before verifying`);
  }
  if (next.status === 'done') assert.equal(previous.status, 'verifying', `transition ${item.id}: done requires verifying`);
  return {
    valid: true,
    itemId: item.id,
    from: previous.status,
    to: next.status,
    evidenceOnly: previous.status === next.status,
    planVersion: plan.version
  };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/primetime-roadmap.mjs validate [plan.json] [status.json]',
    '  node scripts/primetime-roadmap.mjs next [plan.json] [status.json]',
    '  node scripts/primetime-roadmap.mjs verify-transition [plan.json] BEFORE_STATUS AFTER_STATUS'
  ].join('\n');
}

function runCli(argv) {
  const [command, ...args] = argv;
  assert(['validate', 'next', 'verify-transition'].includes(command), usage());
  if (command === 'verify-transition') {
    assert(args.length === 2 || args.length === 3, usage());
    const [planPath, beforePath, afterPath] = args.length === 3 ? args : [DEFAULT_PLAN, ...args];
    return verifyTransition(readJson(resolve(planPath)), readJson(resolve(beforePath)), readJson(resolve(afterPath)));
  }
  assert(args.length <= 2, usage());
  const [planPath = DEFAULT_PLAN, statusPath = DEFAULT_STATUS] = args;
  const plan = readJson(resolve(planPath));
  const status = readJson(resolve(statusPath));
  return command === 'validate' ? validateRoadmap(plan, status) : selectNext(plan, status);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(runCli(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(`Roadmap guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
