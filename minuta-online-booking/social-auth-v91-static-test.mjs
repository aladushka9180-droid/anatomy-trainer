import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('./', import.meta.url);
const migration = fs.readFileSync(new URL('supabase-migration-v91.sql', root), 'utf8');
const rollback = fs.readFileSync(new URL('recovery/rollback-social-auth-v91.sql', root), 'utf8');
const helperSource = fs.readFileSync(new URL('social-auth.js', root), 'utf8');
const config = fs.readFileSync(new URL('config.js', root), 'utf8');
const provider = fs.readFileSync(new URL('provider.js', root), 'utf8');
const client = fs.readFileSync(new URL('my-bookings.js', root), 'utf8');
const providerHtml = fs.readFileSync(new URL('provider.html', root), 'utf8');
const clientHtml = fs.readFileSync(new URL('my-bookings.html', root), 'utf8');

assert.match(migration, /v91_requires_v54_and_v90/i);
assert.match(migration, /auth\.uid\(\)/i);
assert.match(migration, /pg_advisory_xact_lock[\s\S]*client-auth:/i);
assert.match(migration, /login_client_access\(p_phone,p_access_code,p_device_name\)/i);
assert.match(migration, /client_identity_not_linked/i);
assert.match(migration, /client_identity_conflict/i);
assert.match(migration, /grant execute on function public\.bootstrap_client_identity_session\(text,text,text\) to authenticated/i);
assert.match(migration, /revoke all on function public\.bootstrap_client_identity_session\(text,text,text\) from public, anon, authenticated, service_role/i);
assert.match(rollback, /drop function if exists public\.bootstrap_client_identity_session\(text,text,text\)/i);
assert.match(providerHtml, /data-social-auth-provider="telegram"/i);
assert.match(providerHtml, /data-social-auth-provider="vk"/i);
assert.match(providerHtml, /data-social-auth-provider="yandex"/i);
assert.match(clientHtml, /id="clientSocialLinkForm"/i);
assert.match(provider, /auth\.isLinked\(currentUser/i);
assert.match(client, /bootstrap_client_identity_session/i);
assert.match(config, /telegram:false, vk:false, yandex:false/i);

const storage = new Map();
const sandbox = {
  window:{ MINUTA_CONFIG:{ socialAuthProviders:{ telegram:true, vk:false, yandex:false } } },
  navigator:{ onLine:true },
  location:{ href:'https://example.test/minuta/provider.html' },
  sessionStorage:{
    getItem:key => storage.get(key) || null,
    setItem:(key,value) => storage.set(key,value),
    removeItem:key => storage.delete(key)
  },
  document:{ querySelectorAll:() => [] },
  URL
};
vm.createContext(sandbox);
vm.runInContext(helperSource, sandbox);
const auth = sandbox.window.MinutaSocialAuth;
assert.equal(auth.enabled('telegram'), true);
assert.equal(auth.enabled('vk'), false);
assert.equal(auth.isLinked({ identities:[{ provider:'custom:telegram' }] }, 'telegram'), true);

const calls = [];
const db = { auth:{
  signInWithOAuth:async payload => { calls.push(['login',payload]); return { data:{},error:null }; },
  linkIdentity:async payload => { calls.push(['link',payload]); return { data:{},error:null }; }
} };
await auth.start(db,'telegram','client-login','my-bookings.html');
assert.equal(calls[0][1].provider,'custom:telegram');
assert.equal(auth.flow().mode,'client-login');
await auth.start(db,'telegram','provider-link','provider.html');
assert.equal(calls[1][0],'link');
assert.equal(auth.flow().mode,'provider-link');
await assert.rejects(() => auth.start(db,'vk','client-login','my-bookings.html'), /social_provider_disabled/);

console.log('v91 social auth static and helper checks passed');
