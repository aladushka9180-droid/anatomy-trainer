import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
function actual(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/^(?:async )?function /m);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('a connection failure can use only a fresh, verified same-session snapshot', () => {
  const now = Date.parse('2026-09-27T10:00:00Z');
  const box = vm.createContext({
    currentUser:{ id:'provider-1' }, providerSessionTrust:'verified',
    providerVerifiedSessionExpiresAt:now + 3600000, bookingReadConnectionUnavailable:true,
    offlineBookingAccessReady:true, offlineBookingInputsReady:true,
    bookingsSnapshotSavedAt:new Date(now - 60000).toISOString(),
    ownServices:[{ active:true }], PROVIDER_CACHE_MAX_AGE:7 * 86400000,
    navigator:{ onLine:true }, Date:class extends Date { static now() { return now; } }
  });
  vm.runInContext(['bookingDeferredMode','offlineBookingSnapshotFresh','canQueueOfflineBooking','offlineBookingStatusText'].map(actual).join('\n'), box);
  assert.equal(box.canQueueOfflineBooking(), true);
  assert.match(box.offlineBookingStatusText(), /неподтверждённую запись/);
  box.providerVerifiedSessionExpiresAt = now - 1;
  assert.equal(box.canQueueOfflineBooking(), false, 'expired online session');
  box.providerVerifiedSessionExpiresAt = now + 3600000;
  box.bookingsSnapshotSavedAt = new Date(now - 8 * 86400000).toISOString();
  assert.equal(box.canQueueOfflineBooking(), false, 'stale snapshot');
  box.bookingsSnapshotSavedAt = new Date(now).toISOString();
  box.offlineBookingAccessReady = false;
  assert.equal(box.canQueueOfflineBooking(), false, 'unverified snapshot');
  box.offlineBookingAccessReady = true;
  box.providerSessionTrust = 'cached';
  assert.equal(box.canQueueOfflineBooking(), true, 'cached session may save locally while access is verified');
  assert.equal(box.bookingDeferredMode(), true, 'cached session must use the deferred form path');
  box.providerSessionTrust = 'none';
  assert.equal(box.canQueueOfflineBooking(), false, 'rejected session cannot queue');
  box.providerSessionTrust = 'verified';
  box.bookingReadConnectionUnavailable = false;
  assert.equal(box.canQueueOfflineBooking(), false, 'ordinary online creation still needs live readiness');
});

test('authorization or other read failures never turn into a network fallback', () => {
  const box = vm.createContext({ window:{ MinutaProviderReadFetch:{ isConnectionError:error => /^MINUTA_READ_/.test(error?.code || '') } } });
  vm.runInContext([actual('providerCoreReadFailure'),actual('providerCoreReadOutage')].join('\n'), box);
  assert.equal(box.providerCoreReadFailure({ status:401,code:'MINUTA_READ_TIMEOUT' }), 'authorization');
  assert.equal(box.providerCoreReadFailure({ status:403 }), 'authorization');
  assert.equal(box.providerCoreReadFailure({ code:'42501' }), 'authorization');
  assert.equal(box.providerCoreReadFailure({ code:'MINUTA_READ_TIMEOUT' }), 'connection');
  assert.equal(box.providerCoreReadOutage([{ ok:true },{ ok:false,failure:'connection' }]), true);
  assert.equal(box.providerCoreReadOutage([{ ok:false,failure:'connection' },{ ok:false,failure:'authorization' }]), false);
  assert.equal(box.providerCoreReadOutage([{ ok:false,failure:'connection' },{ ok:false,failure:'other' }]), false);
  assert.equal(box.providerCoreReadOutage([{ ok:true }]), false);
});

test('failed core synchronization advertises deferred booking only for transport loss', async () => {
  async function runWith(results) {
    const states = [];
    const box = vm.createContext({
      currentUser:{ id:'provider-1' }, sessionGeneration:3, providerSessionTrust:'verified',
      navigator:{ onLine:true }, document:{ hidden:false }, performance:{ now:() => 1 },
      providerPerformance:{ measure() {} }, synchronizationPromise:null, synchronizationGeneration:-1,
      synchronizationQueued:false, writesAllowed:false, bookingCreationReady:false,
      bookingReadConnectionUnavailable:false, offlineBookingAccessReady:false, offlineBookingInputsReady:false,
      reliability:{ savedAtLabel:() => '10:00' },
      sessionIsCurrent:(id, generation) => id === 'provider-1' && generation === 3,
      loadBookings:async () => results[0], loadOwnServices:async () => results[1],
      loadSchedule:async () => results[2], loadDaysOff:async () => results[3],
      hydrateOfflineBookingInputs:async () => { box.offlineBookingAccessReady = true; box.offlineBookingInputsReady = true; },
      setSyncState:(kind, message) => states.push({ kind, message }),
      setBookingCreationReady:value => { box.bookingCreationReady = value; },
      setWritesAllowed:value => { box.writesAllowed = value; },
      scheduleSynchronizationRetry() {}, applyWriteAvailability() {},
      offlineBookingStatusText:() => 'Сервер недоступен · только чтение',
      canQueueOfflineBooking:() => box.bookingReadConnectionUnavailable && box.offlineBookingAccessReady,
      $:() => null, setTimeout, clearTimeout
    });
    vm.runInContext([actual('providerCoreReadOutage'),actual('synchronizeProvider')].join('\n'), box);
    assert.equal(await box.synchronizeProvider(), false);
    return { degraded:box.bookingReadConnectionUnavailable, ready:box.bookingCreationReady, states };
  }
  const transport = { ok:false, cached:true, savedAt:'2026-09-27T10:00:00Z', failure:'connection' };
  const good = { ok:true };
  const degraded = await runWith([transport,good,good,good]);
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.ready, false);
  assert.match(degraded.states.at(-1).message, /неподтверждённую запись/);
  const denied = await runWith([transport,{ ok:false,failure:'authorization' },good,good]);
  assert.equal(denied.degraded, false);
  assert.match(denied.states.at(-1).message, /только чтение/);
});

test('both core read-only RPCs finish on a hung response without replaying writes', async () => {
  const fetches = [];
  const fakeFetch = (input, init) => {
    fetches.push({ input, method:init.method });
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), { once:true }));
  };
  const window = { fetch:fakeFetch, navigator:{ onLine:true } };
  const box = vm.createContext({ window, document:{ hidden:false }, URL, Response, AbortController, DOMException, setTimeout, clearTimeout, Math });
  vm.runInContext(readFileSync(new URL('../provider-read-fetch.js', import.meta.url), 'utf8'), box);
  const readFetch = window.MinutaProviderReadFetch.create({ baseUrl:'https://fixture.invalid', fetcher:fakeFetch, timeoutMs:10, retryDelayMs:1 });
  for (const name of ['get_minuta_service_public_details_v159','get_minuta_provider_automatic_breaks_v158']) {
    const response = await readFetch(`https://fixture.invalid/rest/v1/rpc/${name}`, { method:'POST', body:'{}' });
    assert.equal(response.status, 504, name);
    assert.equal((await response.json()).code, 'MINUTA_READ_TIMEOUT');
  }
  assert.equal(fetches.length, 4, 'only two bounded read attempts per RPC');
});

test('deferred form path stores a request and never enters the live write branch', () => {
  const form = actual('createNewBooking');
  assert.match(form, /if \(bookingDeferredMode\(\)\) \{[\s\S]*queueOfflineBooking\(/);
  assert.match(form, /if \(bookingDeferredMode\(\)\) \{[\s\S]*if \(block \|\| occurrenceCount > 1\)/);
  assert.match(actual('synchronizeProvider'), /if \(bookingReady && offlineBookingQueue\.some[\s\S]*flushOfflineBookings/);
});
