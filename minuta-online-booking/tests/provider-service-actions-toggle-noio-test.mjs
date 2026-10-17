import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the complete controller in a closed DOM host. No browser, API or storage.
class Element {
  constructor(kind = 'div') {
    this.kind = kind; this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = new Map(); this.listeners = new Map();
    this.classes = new Set(); this.properties = new Map(); this.focused = false;
    this.classList = { add: (...xs) => xs.forEach(x => this.classes.add(x)), remove: (...xs) => xs.forEach(x => this.classes.delete(x)), contains: x => this.classes.has(x) };
    this.style = { setProperty: (k, v) => this.properties.set(k, v), removeProperty: k => this.properties.delete(k) };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get isConnected() { return this.kind === 'body' || Boolean(this.parentElement?.isConnected); }
  append(...nodes) { for (const n of nodes) { n.remove(); n.parentElement = this; this.children.push(n); } }
  insertBefore(node, before) { node.remove(); node.parentElement = this; this.children.splice(this.children.indexOf(before), 0, node); }
  remove() { if (this.parentElement) { const a = this.parentElement.children; a.splice(a.indexOf(this), 1); this.parentElement = null; } }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  removeAttribute(k) { this.attributes.delete(k); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  addEventListener(k, fn) { this.listeners.set(k, fn); }
  getClientRects() { return [{}]; }
  getBoundingClientRect() { return { top: 100, left: 100, right: 300, bottom: 140, width: 200, height: 40 }; }
  focus() { this.focused = true; }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  querySelector(selector) {
    if (selector === ':scope > summary') return this.children.find(n => n.kind === 'summary') || null;
    if (selector === ':scope > .service-actions-menu, :scope > div') return this.children.find(n => n.classes.has('service-actions-menu') || n.kind === 'div') || null;
    if (selector === ':scope > .service-actions-backdrop') return this.children.find(n => n.classes.has('service-actions-backdrop')) || null;
    if (selector === '[data-delete-service]') return this.children.find(n => n.dataset.deleteService) || null;
    if (selector === '[data-close-service-actions]') return this.children.find(n => Object.hasOwn(n.dataset, 'closeServiceActions')) || null;
    throw new Error(`Unexpected host query: ${selector}`);
  }
  querySelectorAll(selector) {
    if (selector === '.managed-service .service-more') return this.children.filter(n => n instanceof Details);
    if (selector === ':scope > .service-actions-menu') return this.children.filter(n => n.classes.has('service-actions-menu'));
    if (selector === ':scope > .service-actions-backdrop') return this.children.filter(n => n.classes.has('service-actions-backdrop'));
    if (selector === 'button:not([hidden]), a:not([hidden])') return this.children.filter(n => n.kind === 'button' || n.kind === 'a');
    throw new Error(`Unexpected host queryAll: ${selector}`);
  }
}
class Details extends Element {
  constructor() { super('details'); this.open = false; }
  matches(selector) { assert.equal(selector, '.managed-service .service-more'); return true; }
}
const body = new Element('body'), list = new Element('list'), details = new Details();
const summary = new Element('summary'), menu = new Element('div'), action = new Element('button');
action.dataset.deleteService = 'synthetic-service'; menu.append(action); details.append(summary, menu); list.append(details); body.append(list);
const document = {
  readyState: 'complete', body, createElement: kind => new Element(kind), listeners: new Map(),
  addEventListener(k, fn) { this.listeners.set(k, fn); },
  querySelector(selector) {
    if (selector === '[data-provider-panel="services"] #serviceManageList') return list;
    if (selector === '.provider-mobile-nav, .provider-bottom-nav') return null;
    throw new Error(`Unexpected document query: ${selector}`);
  },
  querySelectorAll(selector) {
    const layer = body.children.find(n => n.classes.has('service-actions-layer'));
    if (selector === '.service-actions-layer > .service-actions-menu') return layer?.children.filter(n => n.classes.has('service-actions-menu')) || [];
    if (selector === '.service-actions-layer > .service-actions-backdrop') return layer?.children.filter(n => n.classes.has('service-actions-backdrop')) || [];
    throw new Error(`Unexpected document queryAll: ${selector}`);
  }
};
const window = { innerWidth: 1440, innerHeight: 900, addEventListener() {} };
const script = readFileSync(process.argv[2] || new URL('../provider-service-actions.js', import.meta.url), 'utf8');
vm.runInNewContext(script, { window, document, HTMLDetailsElement: Details, MutationObserver: class { observe() {} }, requestAnimationFrame: fn => fn() }, { timeout: 1000 });
const controller = window.MinutaServiceActions;
function assertClosed(message) {
  assert.equal(details.open, false, `${message}: details closed`);
  assert.equal(menu.parentElement === details, true, `${message}: portalled menu restored`);
  assert.equal(menu.classList.contains('is-open'), false, `${message}: visible class removed`);
  assert.equal(document.querySelectorAll('.service-actions-layer > .service-actions-backdrop').length, 0, `${message}: backdrop removed from layer`);
  assert.equal(summary.getAttribute('aria-expanded'), 'false', `${message}: truthful accessibility state`);
}
controller.open(details, { focus: false });
assert.equal(menu.parentElement !== details, true, 'Opening actually portals the menu');
assert.equal(menu.classList.contains('is-open'), true);
// A native summary toggle closes <details>; the capturing listener must clean its portal.
details.open = false; list.listeners.get('toggle')({ target: details });
assertClosed('Native close');
details.open = true; list.listeners.get('toggle')({ target: details });
assert.equal(menu.classList.contains('is-open'), true, 'Native reopen still works');
let prevented = false;
document.listeners.get('keydown')({ key: 'Escape', preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
assert.equal(prevented, true); assertClosed('Escape after native reopen');
controller.open(details, { focus: false }); controller.close(details);
assertClosed('Explicit close');
list.listeners.get('toggle')({ target: details }); assertClosed('Delayed native toggle after explicit close');
console.log('Service action native-toggle, reopen, Escape and explicit-close NoIO regression: PASS (4 cases).');
