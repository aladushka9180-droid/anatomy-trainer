import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateSnapshot, PROPOSED_SLO, renderMarkdown } from '../scripts/observability-snapshot.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixedNow = '2026-09-08T16:00:00.000Z';
const insufficient = JSON.parse(await readFile(new URL('./fixtures/observability-insufficient.json', import.meta.url), 'utf8'));
const breach = JSON.parse(await readFile(new URL('./fixtures/observability-breach.json', import.meta.url), 'utf8'));

const insufficientReport = evaluateSnapshot(insufficient, { now: fixedNow });
assert.equal(insufficientReport.policy.approvalStatus, 'proposed_pending_approval');
assert.equal(insufficientReport.coverage.status, 'insufficient_data');
assert.equal(insufficientReport.slos.find(item => item.id === 'availability').status, 'insufficient_data');
assert.equal(insufficientReport.slos.find(item => item.id === 'booking_latency').status, 'insufficient_data');
assert.equal(insufficientReport.slos.find(item => item.id === 'notification_final_status').status, 'insufficient_data');
assert.equal(insufficientReport.slos.find(item => item.id === 'payment_webhooks').status, 'insufficient_data');
assert.equal(insufficientReport.slos.find(item => item.id === 'backup_freshness').status, 'pass');
assert.equal(insufficientReport.slos.find(item => item.id === 'restore_drill_freshness').status, 'pass');
assert.equal(insufficientReport.alertPreview.wouldFire, false);
assert.equal(insufficientReport.alertPreview.externalDeliveryAttempted, false);

const breachReport = evaluateSnapshot(breach, { now: fixedNow });
assert.equal(breachReport.coverage.status, 'complete');
assert.ok(breachReport.slos.every(item => item.status === 'fail'));
assert.equal(breachReport.alertPreview.wouldFire, true, 'breach fixture must produce an alert preview');
assert.equal(breachReport.alertPreview.externalDeliveryAttempted, false, 'synthetic alert must never send externally');
assert.ok(breachReport.alertPreview.reasons.length >= 6);
assert.match(renderMarkdown(breachReport), /сработала бы/i);
assert.match(renderMarkdown(breachReport), /Внешняя отправка не выполнялась/);

const boundary = structuredClone(breach);
boundary.availability = { scheduledRuns: 1000, successfulRuns: 999, failedRuns: 1, truncated: false };
boundary.bookingLatency = { samplesMs: Array(20).fill(PROPOSED_SLO.bookingLatencyP95Ms), windowDays: 30 };
boundary.notifications = { available: true, eligible: 100, finalWithinTarget: 99, nonFinalOlderTarget: 0 };
boundary.payments = { available: true, eligible: 1000, processedWithinTarget: 999, unreconciledOlderTarget: 0 };
boundary.backup.lastSuccessAt = new Date(Date.parse(fixedNow) - PROPOSED_SLO.backupMaxHours * 60 * 60 * 1000).toISOString();
boundary.restore.lastSuccessAt = new Date(Date.parse(fixedNow) - PROPOSED_SLO.restoreMaxDays * 24 * 60 * 60 * 1000).toISOString();
const boundaryReport = evaluateSnapshot(boundary, { now: fixedNow });
assert.ok(boundaryReport.slos.every(item => item.status === 'pass'), 'exact thresholds must pass');
assert.equal(boundaryReport.alertPreview.wouldFire, false);

const temp = await mkdtemp(join(tmpdir(), 'primetime-observability-'));
try {
  const jsonOut = join(temp, 'report.json');
  const markdownOut = join(temp, 'report.md');
  const summaryOut = join(temp, 'summary.md');
  await writeFile(summaryOut, '', 'utf8');
  const cli = spawnSync(process.execPath, [
    join(root, 'scripts', 'observability-snapshot.mjs'),
    '--input', join(root, 'tests', 'fixtures', 'observability-breach.json'),
    '--now', fixedNow,
    '--json-out', jsonOut,
    '--markdown-out', markdownOut
  ], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summaryOut }, windowsHide: true });
  assert.equal(cli.status, 0, cli.stderr);
  const cliReport = JSON.parse(await readFile(jsonOut, 'utf8'));
  assert.equal(cliReport.alertPreview.wouldFire, true);
  assert.equal(cliReport.alertPreview.externalDeliveryAttempted, false);
  assert.match(await readFile(markdownOut, 'utf8'), /observability snapshot/);
  assert.match(await readFile(summaryOut, 'utf8'), /предложены, ожидают подтверждения/);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('PrimeTime Pro observability snapshot tests: PASS');
