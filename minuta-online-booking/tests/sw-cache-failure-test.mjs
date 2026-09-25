import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../sw.js'), 'utf8');
const request = new Request('https://example.test/minuta-online-booking/provider.html?date=2026-09-24');
const asset = new Request('https://example.test/minuta-online-booking/provider.js?v=939');

function worker({ match, put, fetch }) {
  const scope = {
    URL, Request, Response,
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
  assert.deepEqual(deleted, ['massage-izhevsk-v939']);
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
