import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Normal repository entry: tests/this-file.mjs -> ../provider.js.
// Qualification only: node this-file.mjs --source /public/provider.js [--sha rawSHA256].
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  assert.ok(['--source', '--sha'].includes(name) && process.argv[i + 1] && !options.has(name), 'unsupported test option');
  options.set(name, process.argv[i + 1]);
}
const sourcePath = options.has('--source') ? resolve(options.get('--source')) : fileURLToPath(new URL('../provider.js', import.meta.url));
const raw = readFileSync(sourcePath);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (options.has('--sha')) assert.equal(sha256(raw), options.get('--sha'), 'qualification Source pin');
const source = raw.toString('utf8').replaceAll('\r\n', '\n');
const marker = 'function initializeProviderUx() {';
const start = source.indexOf(marker);
assert.ok(start >= 0 && start === source.lastIndexOf(marker), 'one actual initializeProviderUx declaration');
const end = source.indexOf('\ninitializeProviderUx();', start);
assert.ok(end > start, 'bounded initializeProviderUx call anchor');
const initialize = source.slice(start, end).trimEnd();
const script = new vm.Script(`(${initialize})();`, { filename: 'actual-initializeProviderUx.js' });
console.log(JSON.stringify({ sourceSha256: sha256(raw), initializeLfSha256: sha256(initialize), qualificationPinRequired: options.has('--sha') }));

// Purpose-limited DOM ports. No key-specific behavior lives here: the actual
// provider function must install the listener that closes/focuses the menu.
class Element {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.id = '';
    this.className = '';
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.readOnly = false;
    this.value = '';
    this.checked = false;
    this.textContent = '';
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
      this.children.push(node);
      node.parentElement = this;
    }
  }
  before(node) {
    const parent = this.parentElement;
    assert.ok(parent, 'fixture node has a parent');
    if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
    parent.children.splice(parent.children.indexOf(this), 0, node);
    node.parentElement = parent;
  }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  set innerHTML(html) {
    assert.equal(html, '<summary>Ещё</summary><div aria-label="Импорт и поля клиента"></div>', 'existing disclosure markup');
    assert.equal(this.children.length, 0, 'new disclosure only');
    const summary = this.ownerDocument.createElement('summary');
    summary.textContent = 'Ещё';
    const body = this.ownerDocument.createElement('div');
    body.setAttribute('aria-label', 'Импорт и поля клиента');
    this.append(summary, body);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'open' || name === 'hidden') this[name] = true;
    if (name === 'id') this.id = String(value);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'open' || name === 'hidden') this[name] = false;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  closest(selector) {
    assert.ok(['label', 'details'].includes(selector), 'supported fixture closest selector');
    for (let node = this; node; node = node.parentElement) if (node.tagName === selector.toUpperCase()) return node;
    return null;
  }
  querySelector(selector) {
    assert.equal(selector, 'summary', 'supported disclosure selector');
    const visit = node => {
      for (const child of node.children) {
        if (child.tagName === 'SUMMARY') return child;
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this);
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  focus() {
    this.ownerDocument.activeElement = this;
    this.ownerDocument.focusCalls.push(this);
  }
  dispatchEvent(event) {
    event.target = this;
    for (let node = this; node; node = event.bubbles ? node.parentElement : null) {
      event.currentTarget = node;
      const propertyHandler = node[`on${event.type}`];
      if (typeof propertyHandler === 'function') propertyHandler.call(node, event);
      for (const listener of node.listeners.get(event.type) || []) listener.call(node, event);
      if (event.propagationStopped) break;
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }
}

function fixture({ importHidden = false, fieldsHidden = false } = {}) {
  const created = [];
  const document = {
    activeElement: null, focusCalls: [],
    createElement(tag) { const node = new Element(document, tag); created.push(node); return node; }
  };
  const ids = new Map();
  const node = (tag, id) => {
    const result = document.createElement(tag);
    if (id) { result.id = id; ids.set(id, result); }
    return result;
  };
  const root = node('main');
  const importPanel = node('details', 'clientImportPanel');
  const importForm = node('form', 'clientImportForm');
  const importControl = node('button', 'clientImportSubmit');
  importControl.disabled = true; // Synthetic permission/display state, no real role.
  importControl.hidden = true;
  importForm.append(importControl);
  importPanel.append(importForm);
  importPanel.hidden = importHidden;
  const fieldsPanel = node('details', 'clientFieldsSettings');
  const fieldsForm = node('form', 'clientFieldDefinitionForm');
  const field = node('input', 'clientFieldLabel');
  field.value = 'SYNTHETIC FIELD';
  const readonlyField = node('input', 'clientFieldKey');
  readonlyField.value = 'synthetic_key'; readonlyField.readOnly = true;
  const required = node('input', 'clientFieldRequired');
  required.checked = true;
  fieldsForm.append(field, readonlyField, required);
  fieldsForm.hidden = false; // Existing field form after the user opens it.
  fieldsPanel.append(fieldsForm);
  fieldsPanel.hidden = fieldsHidden;
  const layout = node('div', 'clientsLayout');
  const directory = node('section');
  const search = node('label');
  const searchInput = node('input', 'clientSearch');
  searchInput.value = 'SYNTHETIC SEARCH';
  search.append(searchInput);
  const filters = node('div', 'clientDirectoryFilters');
  const list = node('div', 'clientsList');
  directory.append(search, filters, list); layout.append(directory);
  const commandCenter = node('section', 'reportCommandCenter');
  const examples = node('div'); examples.className = 'voice-assistant-examples';
  root.append(importPanel, fieldsPanel, layout, commandCenter, examples);
  const originalNodes = [...created];
  created.length = 0;
  const observers = [];
  const inventoryCalls = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { observers.push({ target, options, callback: this.callback }); }
  }
  const forbidden = () => { throw new Error('forbidden non-DOM port'); };
  const context = vm.createContext({
    document, MutationObserver,
    $: selector => {
      if (selector === '.voice-assistant-examples') return examples;
      assert.match(selector, /^#[A-Za-z][A-Za-z0-9]*$/);
      return ids.get(selector.slice(1)) || null;
    },
    $$: selector => { assert.equal(selector, '#voiceAssistantStarters>button:nth-child(n+5)'); return []; },
    setInventorySection: section => inventoryCalls.push(section),
    fetch: forbidden, XMLHttpRequest: forbidden, WebSocket: forbidden,
    setTimeout: forbidden, setInterval: forbidden
  }, { codeGeneration: { strings: false, wasm: false } });
  script.runInContext(context, { timeout: 1000 });
  const tools = created.find(n => n.id === 'clientDirectoryTools');
  const summary = tools.querySelector('summary');
  const key = (target, value, { defaultPrevented = false } = {}) => {
    const event = { type: 'keydown', key: value, bubbles: true, defaultPrevented, propagationStopped: false, preventDefaultCalls: 0,
      preventDefault() { this.defaultPrevented = true; this.preventDefaultCalls++; }, stopPropagation() { this.propagationStopped = true; } };
    target.dispatchEvent(event);
    return event;
  };
  const flush = target => observers.filter(o => o.target === target).forEach(o => o.callback([]));
  return { document, root, tools, summary, field, readonlyField, required, importControl, importPanel, fieldsPanel,
    importForm, fieldsForm, layout, directory, search, searchInput, filters, list, commandCenter, examples,
    originalNodes, created, observers, inventoryCalls, key, flush };
}

test('Escape from the actual tools summary closes and restores focus', () => {
  const f = fixture(); f.tools.open = true; f.summary.focus();
  const focusCount = f.document.focusCalls.length;
  const event = f.key(f.summary, 'Escape');
  assert.equal(f.tools.open, false, 'Escape must close #clientDirectoryTools');
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.document.activeElement, f.summary);
  assert.equal(f.document.focusCalls.length, focusCount + 1);
});

test('Escape bubbles from a child field and restores the actual summary focus', () => {
  const f = fixture(); f.tools.open = true; f.field.focus();
  const event = f.key(f.field, 'Escape');
  assert.equal(f.tools.open, false, 'child Escape must close #clientDirectoryTools');
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.document.activeElement, f.summary);
});

test('Other keys are not intercepted and do not move focus', () => {
  const f = fixture(); f.tools.open = true; f.field.focus();
  const count = f.document.focusCalls.length;
  for (const key of ['Enter', 'Tab', 'ArrowDown']) {
    const event = f.key(f.field, key);
    assert.equal(f.tools.open, true); assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false); assert.equal(f.document.activeElement, f.field);
  }
  assert.equal(f.document.focusCalls.length, count);
});

test('Closed tools do not intercept Escape or move focus', () => {
  const f = fixture(); f.field.focus(); const count = f.document.focusCalls.length;
  for (const target of [f.summary, f.field]) {
    const event = f.key(target, 'Escape');
    assert.equal(f.tools.open, false); assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false); assert.equal(f.document.activeElement, f.field);
  }
  assert.equal(f.document.focusCalls.length, count);
});

test('An already consumed child Escape remains owned by the child control', () => {
  const f = fixture(); f.tools.open = true; f.field.focus();
  const count = f.document.focusCalls.length;
  const event = f.key(f.field, 'Escape', { defaultPrevented: true });
  assert.equal(f.tools.open, true); assert.equal(event.defaultPrevented, true);
  assert.equal(event.preventDefaultCalls, 0); assert.equal(event.propagationStopped, false);
  assert.equal(f.document.activeElement, f.field); assert.equal(f.document.focusCalls.length, count);
});

test('Original form nodes, entered data and permission flags survive initialization and Escape', () => {
  const f = fixture(); f.tools.open = true; f.key(f.field, 'Escape');
  assert.equal(f.importPanel.parentElement, f.tools.lastElementChild);
  assert.equal(f.fieldsPanel.parentElement, f.tools.lastElementChild);
  assert.equal(f.importForm.children[0], f.importControl);
  assert.equal(f.fieldsForm.children[0], f.field);
  assert.equal(f.field.value, 'SYNTHETIC FIELD'); assert.equal(f.readonlyField.value, 'synthetic_key');
  assert.equal(f.required.checked, true); assert.equal(f.importControl.disabled, true);
  assert.equal(f.importControl.hidden, true);
  assert.equal(f.readonlyField.readOnly, true); assert.equal(f.fieldsForm.hidden, false);
  assert.equal(f.importPanel.hidden, false); assert.equal(f.fieldsPanel.hidden, false);
  assert.equal(f.importPanel.open, false); assert.equal(f.fieldsPanel.open, false);
  assert.equal(f.searchInput.value, 'SYNTHETIC SEARCH');
  for (const original of f.originalNodes) assert.ok(original.parentElement || original === f.root);
});

test('Existing toolbar, inventory initialization and secondary evidence rendering are preserved', () => {
  const f = fixture(); const toolbar = f.tools.parentElement;
  assert.deepEqual(toolbar.children, [f.search, f.filters, f.tools]);
  assert.equal(f.root.children[f.root.children.indexOf(f.layout) - 1], toolbar);
  assert.equal(f.directory.children[0], f.list);
  assert.deepEqual(f.inventoryCalls, ['balances']);
  const evidence = f.created.find(n => n.id === 'reportPaymentEvidence');
  assert.ok(evidence); assert.equal(evidence.hidden, true);
  assert.equal(f.root.children[f.root.children.indexOf(f.commandCenter) - 1], evidence);
  assert.equal(f.created.length, 5, 'no replacement form or unrelated render');
});

test('Existing two panel observers and hidden/open synchronization remain unchanged', () => {
  const f = fixture({ importHidden: true, fieldsHidden: true });
  assert.equal(f.observers.length, 2);
  assert.deepEqual(f.observers.map(o => o.target), [f.importPanel, f.fieldsPanel]);
  for (const observer of f.observers) assert.deepEqual(JSON.parse(JSON.stringify(observer.options)), { attributes: true, attributeFilter: ['hidden', 'open'] });
  assert.equal(f.observers[0].callback, f.observers[1].callback);
  assert.equal(f.tools.hidden, true);
  f.importPanel.hidden = false; f.flush(f.importPanel); assert.equal(f.tools.hidden, false);
  f.importPanel.open = true; f.flush(f.importPanel); assert.equal(f.tools.open, true);
  f.importPanel.hidden = true; f.flush(f.importPanel); assert.equal(f.tools.hidden, true);
  assert.equal(f.importPanel.open, true, 'nested panel open state is not rewritten');
});

test('Escape outside this disclosure does not close it or steal focus', () => {
  const f = fixture(); f.tools.open = true; f.searchInput.focus();
  const count = f.document.focusCalls.length;
  const event = f.key(f.searchInput, 'Escape');
  assert.equal(f.tools.open, true); assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false); assert.equal(f.document.activeElement, f.searchInput);
  assert.equal(f.document.focusCalls.length, count);
});
