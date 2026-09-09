#!/usr/bin/env node

const expectedRef = 'cawexmmrqjvothcbgjxr';
const ref = String(process.env.MINUTA_PRODUCTION_PROJECT_REF || '').trim().toLowerCase();
const raw = String(process.env.SUPABASE_DB_URL || '').trim();

function fail(message) {
  throw new Error(message);
}

try {
  if (ref !== expectedRef) fail('unexpected production project ref');
  let url;
  try { url = new URL(raw); } catch { fail('invalid production database URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('production database URL must use PostgreSQL');
  if (url.hash) fail('production database URL must not contain a fragment');
  if (decodeURIComponent(url.pathname) !== '/postgres') fail('production database name must be postgres');
  if (!url.password) fail('production database URL has no password');

  const host = url.hostname.toLowerCase();
  const user = decodeURIComponent(url.username).toLowerCase();
  const direct = host === `db.${ref}.supabase.co` && user === 'postgres' && (!url.port || url.port === '5432');
  const pooled = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)
    && user === `postgres.${ref}` && (!url.port || ['5432', '6543'].includes(url.port));
  if (!direct && !pooled) fail('production database host or user does not match the exact Supabase project');

  for (const key of url.searchParams.keys()) {
    if (!['sslmode'].includes(key)) fail(`unexpected production database URL parameter: ${key}`);
  }
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode && sslmode !== 'require') fail('production database sslmode must be require');
  if (process.argv[2] === '--session-url') {
    url.port = '5432';
    process.stdout.write(url.toString());
  } else {
    console.log('production database URL target: OK');
  }
} catch (error) {
  console.error(`production database URL target: FAIL - ${error.message}`);
  process.exit(1);
}
