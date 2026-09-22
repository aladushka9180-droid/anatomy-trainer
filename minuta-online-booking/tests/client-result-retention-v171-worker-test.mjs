import assert from 'node:assert/strict';
import { runClientResultRetention } from '../scripts/client-result-retention-v171.mjs';

const environment = {
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key',
  MINUTA_PRODUCTION_PROJECT_REF: 'fixture'
};

const response = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });

{
  const calls = [];
  const result = await runClientResultRetention({ environment, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.match(url, /claim_minuta_client_result_retention_v171$/);
    assert.equal(JSON.parse(options.body).p_execute, false);
    return response(200, JSON.stringify([{ id: 'one' }, { id: 'two' }]));
  } });
  assert.deepEqual(result, { mode: 'dry-run', eligible: 2, deleted: 0 });
  assert.equal(calls.length, 1, 'dry run performs no Storage request');
}

await assert.rejects(() => runClientResultRetention({
  environment: { ...environment, MINUTA_CLIENT_RESULT_RETENTION_MODE: 'execute' },
  fetchImpl: async () => response(500)
}), /retention_execute_confirmation_required/);

{
  const id = '00000000-0171-4000-8000-000000000001';
  const token = '00000000-0171-4000-8000-000000000002';
  const calls = [];
  const result = await runClientResultRetention({
    environment: {
      ...environment,
      MINUTA_CLIENT_RESULT_RETENTION_MODE: 'execute',
      MINUTA_CLIENT_RESULT_RETENTION_CONFIRMATION: 'DELETE_ELIGIBLE_CLIENT_RESULT_PHOTOS'
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body });
      if (url.endsWith('/claim_minuta_client_result_retention_v171')) return response(200, JSON.stringify([{ id, claim_token: token }]));
      if (url.endsWith('/authorize_minuta_client_result_retention_delete_v171')) return response(200, JSON.stringify({ id, claim_token: token, bucket: 'minuta-client-records', object_path: 'org/private photo.webp' }));
      if (url.endsWith('/finish_minuta_client_result_retention_v171')) return response(200, 'true');
      if (options.method === 'DELETE') return response(200, '{}');
      if (options.method === 'HEAD') return response(404);
      throw new Error(`unexpected request ${options.method} ${url}`);
    }
  });
  assert.deepEqual(result, { mode: 'execute', eligible: 1, deleted: 1 });
  assert.deepEqual(calls.map(call => call.method), ['POST', 'POST', 'DELETE', 'HEAD', 'POST']);
  assert.match(calls[2].url, /private%20photo\.webp$/);
  assert.ok(!JSON.stringify(result).includes('private photo'), 'operator output contains no object path');
}

console.log('Client result retention v171 worker: PASS');
