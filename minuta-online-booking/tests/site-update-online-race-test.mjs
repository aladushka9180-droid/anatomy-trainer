import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Synthetic worker registration: connectivity returns while a request started
// before reconnection is still pending. The online event must not be lost.
const source = readFileSync(new URL('../site-update.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function scenario({ reconnect, failFirst = false, offlineBoot = false }) {
  const events = new Map(), documentEvents = new Map(), pending = [];
  let calls = 0, registrations = 0, active = 0, maxActive = 0;
  const registration = { update() {
    calls++; active++; maxActive = Math.max(maxActive, active);
    return new Promise((resolve, reject) => pending.push(fail => {
      active--; if (fail) reject(new Error('Previous connection failed')); else resolve();
    }));
  } };
  const navigator = { onLine:!offlineBoot, serviceWorker:{ controller:null, register:async () => { registrations++; return registration; }, addEventListener() {} } };
  vm.runInNewContext(source, {
    URL, URLSearchParams, setTimeout, clearTimeout,
    location:{ search:'', href:'http://127.0.0.1/provider.html' },
    document:{ currentScript:{ src:'http://127.0.0.1/site-update.js?v=1038' }, hidden:false,
      addEventListener:(name,fn) => documentEvents.set(name,fn),
      documentElement:{ dataset:{} }, getElementById:() => null },
    navigator,
    window:{ addEventListener:(name,fn) => events.set(name,fn), setInterval() {} }
  });
  events.get('load')();
  await flush();
  if (offlineBoot) {
    assert.equal(calls, 0, 'Offline reload must not leave an update request hanging before reconnect');
    navigator.onLine = true;
    events.get('online')();
    await flush();
    assert.equal(calls, 1, 'The online edge must start the first update after an offline reload');
    pending.shift()(false);
    await flush();
    assert.equal(registrations, 1);
    return;
  }
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
  // A stale tab can change the shared registration's script URL. The fresh
  // page re-registers its own URL on the reconnect edge before update().
  assert.equal(registrations, reconnect ? 2 : 1, 'Reconnect must restore this page’s worker URL after a stale tab changes it');
}
await scenario({ reconnect:true });
await scenario({ reconnect:true, failFirst:true });
await scenario({ reconnect:false });
await scenario({ offlineBoot:true });
console.log('PASS: online recovery survives an in-flight update; checks coalesce and remain sequential');
