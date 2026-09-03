import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('./', import.meta.url);
const migration = fs.readFileSync(new URL('supabase-migration-v90.sql', root), 'utf8');
const rollback = fs.readFileSync(new URL('recovery/rollback-phone-auth-v90.sql', root), 'utf8');
const helperSource = fs.readFileSync(new URL('phone-auth.js', root), 'utf8');
const provider = fs.readFileSync(new URL('provider.js', root), 'utf8');
const client = fs.readFileSync(new URL('my-bookings.js', root), 'utf8');
const providerHtml = fs.readFileSync(new URL('provider.html', root), 'utf8');
const clientHtml = fs.readFileSync(new URL('my-bookings.html', root), 'utf8');

assert.match(migration, /add column if not exists auth_user_id uuid references auth\.users\(id\) on delete set null/i);
assert.match(migration, /phone_confirmed_at is not null/i);
assert.match(migration, /auth\.uid\(\)/i);
assert.match(migration, /pg_advisory_xact_lock[\s\S]*client-account:/i);
assert.match(migration, /grant execute on function public\.bootstrap_client_sms_session\(text\) to authenticated/i);
assert.match(migration, /grant execute on function public\.get_minuta_phone_auth_capability\(\) to anon, authenticated/i);
assert.match(migration, /revoke all on function public\.bootstrap_client_sms_session\(text\) from public, anon, authenticated, service_role/i);
assert.doesNotMatch(migration, /provider_delete_booking/i);
assert.match(migration, /account_type[\s\S]*IS DISTINCT FROM ''client''/i);
assert.match(rollback, /v90_rollback_blocked_client_auth_links_exist/i);
assert.match(provider, /shouldCreateUser:false/);
assert.match(client, /shouldCreateUser:true[\s\S]*account_type:'client'/);
assert.match(provider, /has_minuta_provider_access/);
assert.match(providerHtml, /id="providerPhoneLinkForm"/);
assert.match(clientHtml, /id="clientSmsLoginForm"/);
assert.match(clientHtml, /id="legacyClientLogin"/);

const sandbox = {
  window:{ MINUTA_CONFIG:{ supabaseUrl:'https://example.supabase.co', supabaseKey:'public-key' } },
  navigator:{ onLine:true },
  fetch:async url => url.includes('/auth/v1/settings')
    ? ({ ok:true, json:async () => ({ external:{ phone:true } }) })
    : ({ ok:true, json:async () => true })
};
vm.createContext(sandbox);
vm.runInContext(helperSource, sandbox);
const auth = sandbox.window.MinutaPhoneAuth;
assert.equal(auth.toE164('8 950 177-31-31'), '+79501773131');
assert.equal(auth.formatPhone('+79501773131'), '+7 (950) 177-31-31');
assert.equal(auth.formatCode('12a34-5678'), '123456');
assert.equal((await auth.capability()).enabled, true);

const calls = [];
const fakeDb = { auth:{
  signInWithOtp:async payload => { calls.push(payload); return { error:null }; },
  verifyOtp:async payload => { calls.push(payload); return { data:{ user:{ id:'u1' } }, error:null }; }
} };
await auth.request(fakeDb, '+7 950 177-31-31', { shouldCreateUser:false });
await auth.verify(fakeDb, '+7 950 177-31-31', '123456', 'sms');
assert.equal(calls[0].options.shouldCreateUser, false);
assert.equal(calls[1].type, 'sms');

console.log('v90 phone auth static and helper checks passed');
