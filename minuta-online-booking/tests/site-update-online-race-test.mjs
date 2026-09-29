import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Synthetic worker registration: connectivity returns while a request started
// before reconnection is still pending. The online event must not be lost.
const source = readFileSync(new URL('../site-update.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function scenario({ reconnect, failFirst = false }) {
  const events = new Map(), documentEvents = new Map(), pending = [];
  let calls = 0, active = 0, maxActive = 0;
  const registration = { update() {
    calls++; active++; maxActive = Math.max(maxActive, active);
    return new Promise((resolve, reject) => pending.push(fail => {
      active--; if (fail) reject(new Error('Previous connection failed')); else resolve();
    }));
  } };
  vm.runInNewContext(source, {
    URL, URLSearchParams, setTimeout, clearTimeout,
    location:{ search:'', href:'http://127.0.0.1/provider.html' },
    document:{ currentScript:{ src:'http://127.0.0.1/site-update.js?v=1037' }, hidden:false,
      addEventListener:(name,fn) => documentEvents.set(name,fn),
      documentElement:{ dataset:{} }, getElementById:() => null },
    navigator:{ serviceWorker:{ controller:null, register:async () => registration, addEventListener() {} } },
    window:{ addEventListener:(name,fn) => events.set(name,fn), setInterval() {} }
  });
  events.get('load')();
  await flush();
  assert.equal(calls, 1);
  if (reconnect) for (let n=0;n<3;n++) events.get('online')();
  else documentEvents.get('visibilitychange')();
  assert.equal(calls, 1, 'An in-flight update remains the only active request');
  pending.shift()(failFirst);
  await flush();
  assert.equal(calls, reconnect ? 2 : 1, 'Reconnect requires one fresh check after the old request settles');
  assert.equal(maxActive, 1, 'Reconnection checks must remain sequential');
  if (pending.length) { pending.shift()(false); await flush(); }
  assert.equal(calls, reconnect ? 2 : 1, 'A burst of online events must not create an update loop');
}
await scenario({ reconnect:true });
await scenario({ reconnect:true, failFirst:true });
await scenario({ reconnect:false });
console.log('PASS: online recovery survives an in-flight update; checks coalesce and remain sequential');
