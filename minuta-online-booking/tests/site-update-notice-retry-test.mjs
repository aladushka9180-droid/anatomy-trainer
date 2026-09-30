import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

// Pure synthetic source regression: no HTTP, browser profile, or service worker registration.
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../site-update.js', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const build = Number(source.match(/sw\.js\?v=(\d+)/)?.[1]);
assert.ok(Number.isSafeInteger(build) && build > 0);

function makeHarness() {
  let clock = 0;
  let nextTimer = 1;
  const timers = new Map();
  const listeners = new Map();
  const windowListeners = new Map();
  const nodes = new Map();
  const document = {
    currentScript: { src:`http://127.0.0.1/site-update.js?v=${build}` },
    documentElement: { dataset:{} },
    body: { append(node) { nodes.set(node.id, node); } },
    addEventListener() {},
    getElementById(id) { return nodes.get(id) || null; },
    createElement() {
      const button = { style:{}, addEventListener() {} };
      return {
        id:null, style:{}, innerHTML:'',
        setAttribute() {},
        querySelector(selector) { return selector === 'button' ? button : null; },
        remove() { nodes.delete(this.id); }
      };
    }
  };
  const registration = { installing:null, waiting:null, async update() {} };
  const serviceWorker = {
    controller:null,
    addEventListener(type, callback) { listeners.set(type, callback); },
    async register() { return registration; }
  };
  const navigator = { serviceWorker, onLine:true };
  const window = { addEventListener(type, callback) { windowListeners.set(type, callback); }, setInterval() {} };
  const setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { at:clock + delay, callback });
    return id;
  };
  const clearTimeout = id => timers.delete(id);
  class MessageChannel {
    constructor() {
      const port1 = { onmessage:null, closed:false, close() { this.closed = true; } };
      const port2 = { reply(value) { queueMicrotask(() => { if (!port1.closed) port1.onmessage?.({ data:value }); }); } };
      this.port1 = port1;
      this.port2 = port2;
    }
  }
  runInNewContext(source, {
    document, navigator, window, MessageChannel, setTimeout, clearTimeout,
    location:{ href:'http://127.0.0.1/provider.html', search:'' }, URL, URLSearchParams
  }, { filename:sourcePath });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function next() {
    const [id, task] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || [];
    assert.ok(task, 'Expected a bounded notice timer');
    timers.delete(id);
    clock = task.at;
    task.callback();
    await settle();
  }
  function controller(plan) {
    let messages = 0;
    return {
      scriptURL:`http://127.0.0.1/sw.js?v=${build}`,
      get messages() { return messages; },
      postMessage(message, [port]) {
        assert.equal(message.type, 'site-update-version');
        plan(++messages, port);
      }
    };
  }
  async function change(nextController) {
    serviceWorker.controller = nextController;
    listeners.get('controllerchange')();
    await settle();
  }
  return {
    controller, change, next, settle, registration,
    async load(initialController) {
      serviceWorker.controller = initialController;
      windowListeners.get('load')();
      await settle();
    },
    get noticeCount() { return nodes.has('siteUpdateNotice') ? 1 : 0; },
    get timerCount() { return timers.size; },
    get ready() { return document.documentElement.dataset.siteUpdateReady; }
  };
}

// One missing MessageChannel reply must recover without another registration.update().
{
  const app = makeHarness();
  const worker = app.controller((message, port) => {
    if (message > 1) port.reply({ version:build+1, ready:true });
  });
  await app.change(worker);
  assert.equal(app.noticeCount, 0);
  await app.next(); // Existing 1200 ms workerVersion timeout.
  await app.next(); // Notice-only retry, if present.
  assert.equal(worker.messages, 2);
  assert.equal(app.noticeCount, 1);
  assert.equal(app.ready, 'true');
  assert.equal(app.timerCount, 0, 'Successful notice does not keep polling');
}

// Permanent loss and a worker reporting ready:false must terminate after three retries.
for (const kind of ['no-reply', 'not-ready']) {
  const app = makeHarness();
  const worker = app.controller((_message, port) => {
    if (kind === 'not-ready') port.reply({ version:build+1, ready:false });
  });
  await app.change(worker);
  for (let i = 0; i < 8 && app.timerCount; i++) await app.next();
  assert.equal(worker.messages, 4, `${kind}: first probe plus three retries`);
  assert.equal(app.timerCount, 0, `${kind}: no unbounded loop`);
  assert.equal(app.noticeCount, 0);
}

// Same-build replies must not offer a false update or start a retry loop.
{
  const app = makeHarness();
  const sameBuild = app.controller((_message, port) => port.reply({ version:build, ready:true }));
  await app.change(sameBuild);
  assert.equal(app.noticeCount, 0);
  assert.equal(app.timerCount, 0);
  assert.equal(sameBuild.messages, 1);
}

// A late reply from a replaced controller must be ignored; a later real build still works.
{
  const app = makeHarness();
  let staleReply;
  const stale = app.controller((_message, port) => { staleReply = value => port.reply(value); });
  const current = app.controller((_message, port) => port.reply({ version:build, ready:true }));
  await app.change(stale);
  await app.change(current);
  staleReply({ version:build+2, ready:true });
  await app.settle();
  assert.equal(app.noticeCount, 0, 'Stale controller reply is ignored by identity');
  assert.equal(app.timerCount, 0);
  const later = app.controller((_message, port) => port.reply({ version:build+1, ready:true }));
  await app.change(later);
  assert.equal(app.noticeCount, 1, 'A later real build is still offered');
  assert.equal(app.timerCount, 0);
}

// Probing a retiring worker can restart it during replacement. The updater
// waits for controllerchange, then still offers the genuinely newer release.
for (const stage of ['installing', 'waiting']) {
  const app = makeHarness();
  const retiring = app.controller((_message, port) => port.reply({version:build, ready:true}));
  app.registration[stage] = {};
  await app.load(retiring);
  assert.equal(retiring.messages, 0, `${stage}: do not wake the retiring controller`);
  assert.equal(app.noticeCount, 0);
  app.registration[stage] = null;
  const replacement = app.controller((_message, port) => port.reply({version:build+1, ready:true}));
  await app.change(replacement);
  assert.equal(app.noticeCount, 1, `${stage}: offer the replacement after activation`);
  assert.equal(app.timerCount, 0);
}

console.log('PASS: bounded notice retry, same-build/stale-controller guards, replacement without waking the retiring worker');
