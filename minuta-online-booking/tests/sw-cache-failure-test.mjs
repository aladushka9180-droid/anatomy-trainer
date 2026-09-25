import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../sw.js'), 'utf8');
const request = new Request('https://example.test/minuta-online-booking/provider.html?date=2026-09-24');
const asset = new Request('https://example.test/minuta-online-booking/provider.js?v=937');

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
