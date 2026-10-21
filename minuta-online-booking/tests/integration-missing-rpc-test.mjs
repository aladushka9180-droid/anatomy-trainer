import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Copy into minuta-online-booking/tests for a default actual-Source regression.
assert([2, 4].includes(process.argv.length));
if (process.argv.length === 4) assert.equal(process.argv[2], '--source');
const filename = process.argv[3] || path.join(fileURLToPath(new URL('../', import.meta.url)), 'integration-management.js');
const source = fs.readFileSync(filename, 'utf8');
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const cases = [];
const test = async (name, run) => { try { await run(); cases.push({ name, status: 'PASS' }); } catch { cases.push({ name, status: 'FAIL' }); } };

async function fixture(result) {
  const elements = new Map();
  const controls = [{ disabled: false }];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', querySelectorAll(selector) { assert.equal(selector, 'button,input'); return controls; } });
    return elements.get(id);
  };
  const calls = [];
  const window = {};
  const context = vm.createContext({ window, document: { querySelector() { return null; } } });
  new vm.Script(source, { filename: 'actual-integration-management.js' }).runInContext(context);
  const controller = window.MinutaIntegrations.createController({
    $, db: { rpc(name, params) {
      assert.equal(name, 'get_minuta_provider_connector_read_model_v144');
      assert.equal(params.p_organization, 'SYNTHETIC_ORG'); assert.equal(params.p_count, 24);
      calls.push(name); return Promise.resolve(result);
    } },
    escapeHtml: value => String(value), notify() { assert.fail('no save/payment/action ports'); }, requireWrites() { assert.fail('read-only fixture'); }
  });
  await controller.setOrganization({ id: 'SYNTHETIC_ORG', current_role: 'owner' });
  assert.equal(calls.length, 1);
  return { $, controls };
}

await test('read model success stays available', async () => {
  const f = await fixture({ data: { organizationId: 'SYNTHETIC_ORG', currentRole: 'owner', connections: [], recentEvents: [] }, error: null });
  assert.equal(f.$('#providerIntegrationsWorkspace').hidden, false);
  assert.equal(f.$('#providerIntegrationsUnavailable').hidden, true);
  assert.equal(f.$('#providerIntegrationsState').textContent, 'Тестовых настроек: 0 из 2');
});
await test('documented missing routine code retains update guidance', async () => {
  const f = await fixture({ data: null, error: { code: 'PGRST202', message: 'SYNTHETIC_MISSING_ROUTINE' } });
  assert.equal(f.$('#providerIntegrationsWorkspace').hidden, true);
  assert.equal(f.$('#providerIntegrationsUnavailableText').textContent, 'Настройки появятся после обновления системы. Оплата и записи продолжают работать.');
});
await test('ordinary transport error retains unknown status guidance', async () => {
  const f = await fixture({ data: null, error: { message: 'SYNTHETIC_TRANSPORT_FAILURE' } });
  assert.equal(f.$('#providerIntegrationsWorkspace').hidden, true);
  assert.equal(f.$('#providerIntegrationsUnavailableText').textContent, 'Не удалось получить статусы. Оплата и записи продолжают работать.');
});
await test('access error mentioning exact routine is not missing-function proof', async () => {
  const f = await fixture({ data: null, error: { code: '42501', message: 'permission denied for function get_minuta_provider_connector_read_model_v144' } });
  assert.equal(f.$('#providerIntegrationsWorkspace').hidden, true);
  assert.equal(f.$('#providerIntegrationsUnavailableText').textContent, 'Не удалось получить статусы. Оплата и записи продолжают работать.');
});

const report = { format: 'INTEGRATION_MISSING_RPC_ACTUAL_SOURCE_REGRESSION_R1', status: cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL', source: { path: filename, bytes: Buffer.byteLength(source), sha256: sourceSha256 }, counts: { total: cases.length, passed: cases.filter(item => item.status === 'PASS').length, failed: cases.filter(item => item.status === 'FAIL').length }, cases, limits: { identitiesAndWorkspacesSynthetic: true, realRpc: 0, realSdk: 0, payments: 0, refunds: 0, externalProviders: 0, network: 0, sql: 0, accountData: 0, browser: 0, applicationWrites: 0, authorizationOrDeploymentDiagnosis: false } };
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.counts.failed ? 1 : 0;
