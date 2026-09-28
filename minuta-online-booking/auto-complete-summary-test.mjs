import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { summarizeAutoCompletion } from './auto-complete-summary.mjs';

const first = '11111111-2222-3333-4444-555555555555';
const second = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const warning = id => `WARNING: auto_completion_inventory_shortfall booking_id=${id}`;
const input = [warning(first), warning(first), warning(second), 'private detail: test client +79991234567'].join('\n');
assert.deepEqual(summarizeAutoCompletion(''), { status:'ok', uniqueSkippedVisits:0, warningCount:0, unclassifiedWarnings:0 });
assert.deepEqual(summarizeAutoCompletion(input), { status:'degraded', uniqueSkippedVisits:2, warningCount:3, unclassifiedWarnings:0 });
assert.equal(summarizeAutoCompletion(input, true).status, 'failure');
assert.deepEqual(summarizeAutoCompletion(warning('malformed')), { status:'degraded', uniqueSkippedVisits:0, warningCount:1, unclassifiedWarnings:1 });
for (const args of [[], ['--failed']]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./auto-complete-summary.mjs', import.meta.url)), ...args], { input, encoding:'utf8', env:{} });
  assert.equal(result.status, 0, result.stderr);
  for (const secret of [first, second, 'test client', '+79991234567']) assert.equal(result.stdout.includes(secret), false);
  assert.equal(JSON.parse(result.stdout.split('\n')[0]).status, args.length ? 'failure' : 'degraded');
}
const workflow = readFileSync(new URL('../.github/workflows/minuta-unpaid-booking-expiry.yml', import.meta.url), 'utf8');
assert.ok(workflow.includes('auto-complete-summary.mjs --failed'));
assert.match(workflow, /auto-complete-summary\.mjs --failed\s+exit 1/u, 'SQL failure must remain fatal after reporting');
assert.equal(workflow.includes('cat "$warning_file" >&2'), false);
assert.match(workflow, /if: failure\(\)/u, 'real notification policy is not expanded');
console.log('auto-complete summary: PASS (ok, partial, failure, deduplication, privacy)');
