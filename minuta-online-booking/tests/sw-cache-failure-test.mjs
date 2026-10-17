import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../sw.js'), 'utf8');
const cacheVersion = source.match(/const CACHE = `\$\{CACHE_PREFIX\}v(\d+)`;/)?.[1];
assert.ok(cacheVersion, 'Worker cache version is required');
const request = new Request('https://example.test/minuta-online-booking/provider.html?date=2026-09-24');
const asset = new Request('https://example.test/minuta-online-booking/provider.js?v=941');

function worker({ match, put, fetch, setTimeout:schedule = setTimeout, clearTimeout:cancel = clearTimeout }) {
  const scope = {
    URL, Request, Response, AbortController,
    setTimeout:schedule, clearTimeout:cancel,
    self: { addEventListener() {} },
    caches: {
      match,
      open: async () => ({ put }),
    },
    fetch,
  };
  vm.createContext(scope);
  vm.runInContext(source, scope);
  return scope;
}

test('navigation reaches the network when cache reading and writing fail', async () => {
  const scope = worker({
    match: async () => { throw Error('CacheStorage unavailable'); },
    put: async () => { throw Error('Disk full'); },
    fetch: async () => new Response('live provider', { status:200 }),
  });
  const response = await scope.navigationResponse({ request, waitUntil() {} });
  assert.equal(await response.text(), 'live provider');
});

test('asset reaches the network when cache reading and writing fail', async () => {
  const scope = worker({
    match: async () => { throw Error('CacheStorage unavailable'); },
    put: async () => { throw Error('Disk full'); },
    fetch: async () => new Response('live script', { status:200 }),
  });
  const response = await scope.assetResponse(asset);
  assert.equal(await response.text(), 'live script');
});

test('cached navigation remains available when the network fails', async () => {
  let background;
  const scope = worker({
    match: async () => new Response('cached provider'),
    put: async () => {},
    fetch: async () => { throw Error('offline'); },
  });
  const response = await scope.navigationResponse({ request, waitUntil(value) { background = value; } });
  assert.equal(await response.text(), 'cached provider');
  await background;
});

test('offline navigation uses the neutral cached page after a shell read failure', async () => {
  const scope = worker({
    match: async key => {
      if (key === './offline.html') return new Response('Нет соединения');
      throw Error('Shell read failed');
    },
    put: async () => {},
    fetch: async () => { throw Error('offline'); },
  });
  const response = await scope.navigationResponse({ request, waitUntil() {} });
  assert.equal(await response.text(), 'Нет соединения');
});

test('offline navigation remains readable when both network and storage fail', async () => {
  const scope = worker({
    match: async () => { throw Error('CacheStorage unavailable'); },
    put: async () => {},
    fetch: async () => { throw Error('offline'); },
  });
  const response = await scope.navigationResponse({ request, waitUntil() {} });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Нет соединения/);
});

test('failed precache replaces the old worker without deleting its offline cache', async () => {
  const listeners = new Map();
  const deleted = [];
  let skipped = false;
  let claimed = false;
  const RelativeRequest = class extends Request {
    constructor(input, options) { super(new URL(input, 'https://example.test/minuta-online-booking/'), options); }
  };
  const scope = {
    URL, Request:RelativeRequest, Response,
    self: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      skipWaiting:async () => { skipped = true; },
      clients:{ claim:async () => { claimed = true; } },
    },
    caches: {
      open:async () => ({ addAll:async () => { throw Error('Disk full'); } }),
      delete:async name => { deleted.push(name); return true; },
      match:async () => undefined,
      keys:async () => ['massage-izhevsk-v935'],
    },
    fetch:async () => new Response('live page'),
  };
  vm.createContext(scope);
  vm.runInContext(source, scope);
  let install;
  listeners.get('install')({ waitUntil:promise => { install = promise; } });
  await install;
  let activate;
  listeners.get('activate')({ waitUntil:promise => { activate = promise; } });
  await activate;
  assert.equal(skipped, true);
  assert.equal(claimed, true);
  assert.deepEqual(deleted, [`massage-izhevsk-v${cacheVersion}`]);
  for (const path of ['provider.html', 'index.html', 'booking.html']) {
    const response = await scope.navigationResponse({
      request:new Request(`https://example.test/minuta-online-booking/${path}`), waitUntil() {},
    });
    assert.equal(await response.text(), 'live page');
  }
});

test('degraded worker uses the older shell only when the network is offline', async () => {
  let online = true;
  const scope = worker({
    match:async key => key === './provider.html' ? new Response('old provider') : undefined,
    put:async () => { throw Error('Disk full'); },
    fetch:async () => online ? new Response('live provider') : Promise.reject(Error('offline')),
  });
  assert.equal(await (await scope.navigationResponse({ request, waitUntil() {} })).text(), 'live provider');
  online = false;
  assert.equal(await (await scope.navigationResponse({ request, waitUntil() {} })).text(), 'old provider');
});

const helpBase = 'https://example.test/minuta-online-booking/';

function readyHelp(key) {
  if (key === `./.precache-ready-v${cacheVersion}`) return new Response('ready');
  if (key.startsWith('./help/')) return new Response('<title>PrimeTime</title>');
}

for (const path of [
  'help/index.html', 'help/index.html?query=faq', 'help/', 'help/?query=faq',
  'help/category.html', 'help/category.html?id=booking',
  'help/article.html', 'help/article.html?slug=first-steps',
]) {
  test(`help navigation returns fresh HTML in this navigation: ${path}`, async () => {
    const writes = [];
    const navigation = new Request(new URL(path, helpBase));
    const scope = worker({
      match:async key => readyHelp(key),
      put:async (key, response) => { writes.push([key, await response.text()]); },
      fetch:async original => {
        assert.equal(original.url, navigation.url, 'Keep the original help URL and query');
        return new Response('<title>Eldion</title>');
      },
    });
    const response = await scope.navigationResponse({ request:navigation, waitUntil() {} });
    assert.equal(await response.text(), '<title>Eldion</title>');
    assert.deepEqual(writes, [[scope.navigationShell(navigation), '<title>Eldion</title>']]);
  });
}

test('help navigation preserves the cached HTML when offline', async () => {
  let background;
  const scope = worker({
    match:async key => readyHelp(key), put:async () => { assert.fail('Do not cache a failed fetch'); },
    fetch:async () => { throw Error('offline'); },
  });
  const response = await scope.navigationResponse({
    request:new Request(`${helpBase}help/article.html?slug=offline`),
    waitUntil(value) { background = value; },
  });
  assert.equal(await response.text(), '<title>PrimeTime</title>');
  await background;
});

test('help navigation preserves the cached HTML on a non-ok response', async () => {
  let background;
  const scope = worker({
    match:async key => readyHelp(key), put:async () => { assert.fail('Do not cache an HTTP failure'); },
    fetch:async () => new Response('unavailable', { status:503 }),
  });
  const response = await scope.navigationResponse({
    request:new Request(`${helpBase}help/category.html?id=offline`),
    waitUntil(value) { background = value; },
  });
  assert.equal(await response.text(), '<title>PrimeTime</title>');
  await background;
});

test('help navigation uses the existing four-second deadline and aborts the pending fetch', async () => {
  let deadline;
  let delay;
  let cleared;
  let signal;
  let background;
  let fetches = 0;
  let started;
  const fetchStarted = new Promise(resolve => { started = resolve; });
  const scope = worker({
    match:async key => readyHelp(key), put:async () => { assert.fail('Do not cache an aborted fetch'); },
    setTimeout(callback, milliseconds) { deadline = callback; delay = milliseconds; return 1; },
    clearTimeout(handle) { cleared = handle; },
    fetch:(_request, options) => {
      fetches++;
      signal = options.signal;
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Error('aborted')), { once:true });
      });
    },
  });
  const responsePromise = scope.navigationResponse({
    request:new Request(`${helpBase}help/`), waitUntil(value) { background = value; },
  });
  await fetchStarted;
  assert.equal(delay, 4000);
  deadline();
  const response = await responsePromise;
  assert.equal(await response.text(), '<title>PrimeTime</title>');
  assert.equal(signal.aborted, true);
  assert.equal(fetches, 1);
  assert.equal(cleared, 1);
  await background;
});

test('help navigation forwards request cancellation and keeps the cached fallback without retry', async () => {
  const controller = new AbortController();
  let signal;
  let background;
  let fetches = 0;
  let started;
  const fetchStarted = new Promise(resolve => { started = resolve; });
  const scope = worker({
    match:async key => readyHelp(key), put:async () => { assert.fail('Do not cache a cancelled fetch'); },
    fetch:(_request, options) => {
      fetches++;
      signal = options.signal;
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Error('cancelled')), { once:true });
      });
    },
  });
  const responsePromise = scope.navigationResponse({
    request:new Request(`${helpBase}help/index.html`, { signal:controller.signal }),
    waitUntil(value) { background = value; },
  });
  await fetchStarted;
  controller.abort();
  assert.equal(await (await responsePromise).text(), '<title>PrimeTime</title>');
  assert.equal(signal.aborted, true);
  assert.equal(fetches, 1);
  await background;
});

test('help navigation returns fresh HTML even if the cache write fails', async () => {
  const scope = worker({
    match:async key => readyHelp(key), put:async () => { throw Error('Disk full'); },
    fetch:async () => new Response('<title>Eldion</title>'),
  });
  const response = await scope.navigationResponse({
    request:new Request(`${helpBase}help/article.html?slug=cache-write`), waitUntil() {},
  });
  assert.equal(await response.text(), '<title>Eldion</title>');
});

test('non-help default navigation keeps returning its cached shell while updating in the background', async () => {
  for (const path of ['provider.html', 'booking.html', 'my-bookings.html', 'messages.html',
    'waitlist.html', 'privacy.html', 'terms.html', 'index.html', 'help/unknown.html']) {
    let background;
    let written;
    const scope = worker({
      match:async () => new Response('cached shell'),
      put:async (_key, response) => { written = await response.text(); },
      fetch:async () => new Response('fresh shell'),
    });
    const response = await scope.navigationResponse({
      request:new Request(`${helpBase}${path}?source=help`), waitUntil(value) { background = value; },
    });
    assert.equal(await response.text(), 'cached shell', path);
    await background;
    assert.equal(written, 'fresh shell', path);
  }
});

test('non-help explicit reload retains the existing fresh-shell response', async () => {
  for (const cache of ['reload', 'no-cache']) {
    const scope = worker({
      match:async () => new Response('cached provider'), put:async () => {},
      fetch:async () => new Response('fresh provider'),
    });
    const response = await scope.navigationResponse({
      request:new Request(request, { cache }), waitUntil() {},
    });
    assert.equal(await response.text(), 'fresh provider', cache);
  }
});
