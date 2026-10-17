import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Execute actual install handlers and the early capture helper through fake browser ports.
// A prompt choice is not installation evidence; no native API or network is used.
const sourcePath = fileURLToPath(new URL('../provider.js', import.meta.url));
const helperPath = fileURLToPath(new URL('../pwa-install.js', import.meta.url));
const mode = 'actual-repository-source';
const sha = value => createHash('sha256').update(value).digest('hex');
const raw = readFileSync(sourcePath), helperRaw = readFileSync(helperPath);
const original = raw.toString('utf8').replace(/\r\n/g, '\n');
const source = original;
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a && source.indexOf(start, a + start.length) < 0);
  return source.slice(a, b);
}
const stateLine = source.split('\n').find(x => x.startsWith('let deferredInstallPrompt = '));
assert.ok(stateLine);
const observedState = source.split('\n').find(x => x.startsWith('let providerAppInstallObserved = '));
const observedStateLine = observedState ? '\n' + observedState : '';
const bodies = between('function providerAppIsInstalled()', 'function displayPreferencesFromForm()');
const registrations = between("window.addEventListener('beforeinstallprompt', event => {", "window.addEventListener('scroll', scheduleSectionNavigationUpdate");
function fixture({ standalone = false } = {}) {
  const nodes = new Map(), listeners = new Map(), mediaListeners = new Map(), notices = [], navigation = [], scrolls = [];
  const node = selector => {
    if (!nodes.has(selector)) {
      const span = { textContent:'' };
      nodes.set(selector, { hidden:false, disabled:false, textContent:'', attrs:{},
        querySelector:selector => { assert.equal(selector, 'span'); return span; },
        setAttribute(name, value) { this.attrs[name] = value; },
        scrollIntoView() { scrolls.push(selector); } });
    }
    return nodes.get(selector);
  };
  const add = (map, type, callback) => { if (!map.has(type)) map.set(type, []); map.get(type).push(callback); };
  const emit = (map, event) => { for (const callback of map.get(event.type) || []) callback(event); };
  const media = { matches:standalone, addEventListener:(type, callback) => add(mediaListeners, type, callback) };
  const navigator = { userAgent:'Synthetic Desktop', platform:'SyntheticPC', maxTouchPoints:0, standalone:false };
  const forbidden = () => { throw Error('NO_REAL_BROWSER_OR_NETWORK'); };
  const window = { navigator, isSecureContext:true, matchMedia:query => { assert.equal(query, '(display-mode: standalone)'); return media; },
    addEventListener:(type, callback) => add(listeners, type, callback), dispatchEvent:event => emit(listeners, event) };
  const document = { fullscreenElement:null, webkitFullscreenElement:null,
    documentElement:{ requestFullscreen:forbidden }, exitFullscreen:forbidden,
    addEventListener:(type, callback) => add(listeners, type, callback) };
  const box = { window, document, navigator, location:{ hostname:'synthetic.invalid' },
    CustomEvent:class { constructor(type) { this.type = type; } }, $:node,
    notify:value => notices.push(value), setProviderView:view => navigation.push(view),
    requestAnimationFrame:callback => callback(), scrollToProviderSection:button => scrolls.push('section'),
    fetch:forbidden, WebSocket:forbidden, XMLHttpRequest:forbidden };
  vm.createContext(box);
  vm.runInContext(helperRaw.toString('utf8'), box, { filename:'actual-pwa-install-helper.js', timeout:1000 });
  vm.runInContext(stateLine + observedStateLine + '\n' + bodies + '\n' + registrations, box,
    { filename:'actual-install-fullscreen-functions-and-event-listeners.js', timeout:1000 });
  box.refreshInstallAppCard();
  const view = () => ({ installed:box.providerAppIsInstalled(), installDisabled:node('#installAppButton').disabled,
    topbarHidden:node('#desktopAppInstallButton').hidden, label:node('#installAppButton').querySelector('span').textContent,
    status:node('#installAppStatus').textContent, notices:[...notices] });
  const prompt = outcome => {
    let calls = 0;
    window.dispatchEvent({ type:'beforeinstallprompt', preventDefault() {},
      prompt:async () => { calls++; if (outcome === 'throw') throw Error('SYNTHETIC_PROMPT_REJECTION'); },
      userChoice:Promise.resolve({ outcome }) });
    return () => calls;
  };
  return { box, node, window, notices, navigation, view, prompt, emit: type => window.dispatchEvent({ type }) };
}
const cases = [];
async function test(name, action) {
  const record = { name, status:'PASS', observed:null };
  try { await action(value => { record.observed = value; }); }
  catch { record.status = 'FAIL'; record.failure = 'OWN_EXPECTATION_NOT_MET'; }
  cases.push(record);
}
await test('ordinary browser without installation evidence stays installable', async observe => {
  const f = fixture(); observe(f.view()); assert.equal(f.view().installed, false); assert.equal(f.view().installDisabled, false); assert.equal(f.view().topbarHidden, false);
});
await test('standalone display remains the existing installed control', async observe => {
  const f = fixture({ standalone:true }); observe(f.view()); assert.equal(f.view().installed, true); assert.equal(f.view().installDisabled, true); assert.equal(f.view().topbarHidden, true);
});
for (const outcome of ['accepted', 'dismissed', 'throw']) await test('prompt ' + outcome + ' alone is not completed installation', async observe => {
  const f = fixture(), calls = f.prompt(outcome); await f.box.installProviderApp(); observe({ ...f.view(), calls:calls() });
  assert.equal(calls(), 1); assert.equal(f.view().installed, false); assert.equal(f.view().installDisabled, false);
  if (outcome === 'accepted') assert.equal(f.notices.at(-1), 'Установка приложения началась');
  else if (outcome === 'dismissed') assert.equal(f.notices.at(-1), 'Установка отменена');
  else { assert.match(f.view().status, /не открылось/); assert.equal(f.node('#desktopInstallGuide').hidden, false); assert.deepEqual(f.navigation, ['settings']); }
});
await test('own appinstalled evidence survives ordinary-tab and fullscreen refresh', async observe => {
  const f = fixture(); f.emit('appinstalled'); const afterInstall = f.view(); f.emit('fullscreenchange'); const afterRefresh = f.view();
  observe({ afterInstall, afterRefresh, displayModeStandalone:false });
  assert.equal(afterInstall.notices.at(-1), 'Приложение установлено');
  for (const state of [afterInstall, afterRefresh]) { assert.equal(state.installed, true); assert.equal(state.installDisabled, true); assert.equal(state.topbarHidden, true); }
});
const passed = cases.filter(x => x.status === 'PASS').length;
const result = { format:'PRO_INSTALL_APPINSTALLED_STATE_NOIO_R1', variant:mode,
  status:passed === cases.length ? 'PASS_SYNTHETIC_SOURCE_ONLY' : 'CONFIRMED_EXPECTATION_GAP',
  counts:{ total:cases.length, passed, failed:cases.length-passed },
  sources:{ sourcePath, rawBytes:raw.length, lfSha256:sha(original), helperPath, helperLfSha256:sha(helperRaw.toString('utf8').replace(/\r\n/g, '\n')),
    bodiesSha256:sha(bodies), registrationsSha256:sha(registrations) }, cases,
  limits:{ actualHandlersAndEarlyHelper:true, syntheticWindowDomPromptNavigation:true, browserInstallOrFullscreenCalls:0, actualAuth:0, storage:0, network:0, sql:0, privateReads:0, productWrites:0, workingAcceptance:false } };
console.log(JSON.stringify({ status:result.status, counts:result.counts }));
process.exitCode = result.counts.failed ? 1 : 0;
