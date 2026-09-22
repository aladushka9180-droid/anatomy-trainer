import { pathToFileURL } from 'node:url';

const BUCKET = 'minuta-client-records';
const EXECUTE_CONFIRMATION = 'DELETE_ELIGIBLE_CLIENT_RESULT_PHOTOS';

const required = (environment, name) => {
  const value = String(environment[name] || '').trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
};

const objectUrl = (base, path) => `${base}/storage/v1/object/${BUCKET}/${String(path).split('/').map(encodeURIComponent).join('/')}`;

export async function runClientResultRetention({ environment = process.env, fetchImpl = fetch } = {}) {
  const mode = String(environment.MINUTA_CLIENT_RESULT_RETENTION_MODE || 'dry-run').trim();
  if (!['dry-run', 'execute'].includes(mode)) throw new Error('invalid_retention_mode');
  const base = required(environment, 'SUPABASE_URL').replace(/\/+$/, '');
  const key = required(environment, 'SUPABASE_SERVICE_ROLE_KEY');
  const projectRef = String(environment.MINUTA_PRODUCTION_PROJECT_REF || '').trim();
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:' || (projectRef && !parsed.hostname.startsWith(`${projectRef}.`))) {
    throw new Error('invalid_supabase_target');
  }
  if (mode === 'execute' && environment.MINUTA_CLIENT_RESULT_RETENTION_CONFIRMATION !== EXECUTE_CONFIRMATION) {
    throw new Error('retention_execute_confirmation_required');
  }
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const rpc = async (name, payload) => {
    const response = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(payload)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`rpc_${name}_${response.status}:${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : null;
  };

  const candidates = await rpc('claim_minuta_client_result_retention_v171', {
    p_limit: 100,
    p_execute: mode === 'execute'
  });
  if (mode === 'dry-run') return { mode, eligible: Array.isArray(candidates) ? candidates.length : 0, deleted: 0 };

  let deleted = 0;
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const authorized = await rpc('authorize_minuta_client_result_retention_delete_v171', {
      p_id: candidate.id,
      p_claim: candidate.claim_token
    });
    if (authorized?.bucket !== BUCKET || !authorized?.object_path) throw new Error('invalid_retention_authorization');
    const target = objectUrl(base, authorized.object_path);
    const deletion = await fetchImpl(target, { method: 'DELETE', headers });
    if (!deletion.ok && deletion.status !== 404) throw new Error(`storage_delete_${deletion.status}`);
    const absence = await fetchImpl(target, { method: 'HEAD', headers });
    if (absence.status !== 404) throw new Error(`storage_absence_not_verified_${absence.status}`);
    const finished = await rpc('finish_minuta_client_result_retention_v171', {
      p_id: candidate.id,
      p_claim: candidate.claim_token
    });
    if (finished !== true) throw new Error('retention_finish_rejected');
    deleted += 1;
  }
  return { mode, eligible: Array.isArray(candidates) ? candidates.length : 0, deleted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runClientResultRetention();
  console.log(JSON.stringify(result));
}

export { BUCKET, EXECUTE_CONFIRMATION };
