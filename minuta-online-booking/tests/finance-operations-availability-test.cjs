'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
assert.equal(process.argv.length, 2, 'This regression accepts no arguments.');
const source = fs.readFileSync(path.join(__dirname, '..', 'finance-center-provider.js'), 'utf8').replace(/\r\n/g, '\n');
const ui = fs.readFileSync(path.join(__dirname, '..', 'finance-center.js'), 'utf8').replace(/\r\n/g, '\n');
const start = ui.indexOf('    async function loadMore() {');
assert.ok(start >= 0 && ui.indexOf('    async function loadMore() {', start + 1) === -1);
const end = ui.indexOf('\n    }\n', start) + '\n    }'.length;
assert.ok(end > start);
const loadMore = ui.slice(start, end);
const textStart = ui.indexOf("  function text(value, fallback = '') {");
const textEnd = ui.indexOf('\n  }\n', textStart) + '\n  }'.length;
assert.ok(textStart >= 0 && textEnd > textStart);
const actualText = ui.slice(textStart, textEnd);
assert.ok(ui.includes("listen(elements.more, 'click', () => void loadMore())"));
const bounds = { start:'2026-10-01', end:'2026-10-17', period:'custom' };
const cursor = JSON.stringify({ occurred_at:'2026-10-16T00:00:00Z', event_key:'synthetic-cursor' });
const rawPage = () => ({
  schema:'minuta-finance-screen-v1', ledger_version:163, organization_id:'SYNTHETIC_ORG_A',
  currency:'RUB', timezone:'Europe/Samara', finance_enabled:true,
  period:{ start:bounds.start, end:bounds.end }, selected_performer_id:'',
  summary:{ received_minor:0, expense_minor:0, services_minor:0, debt_minor:0 },
  operations:[], has_more:false, next_cursor:null
});
async function fixture(response) {
  let adapter;
  const calls = [], notices = [], nodes = new Map();
  let adapterOutcome = null;
  const forbidden = () => { throw Error('FORBIDDEN_REAL_PORT'); };
  const analytics = { classList:{ add() {}, remove() {} }, dataset:{} };
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden:false, closest:() => analytics });
    return nodes.get(selector);
  };
  const centerPort = {
    init(options) { adapter = options.adapter; return { ready:Promise.resolve() }; },
    destroy() { throw Error('UNEXPECTED_DESTROY'); }
  };
  const box = vm.createContext({
    MinutaFinanceCenter:centerPort,
    fetch:forbidden, WebSocket:forbidden, XMLHttpRequest:forbidden,
    // These are synthetic RPC ports; no SDK or database client exists.
    testDb:{ rpc:async (name, args) => {
      calls.push({ name, organization:args.p_organization });
      assert.equal(name, 'get_minuta_finance_screen_v163');
      if (response === 'transport') throw Error('SYNTHETIC_TRANSPORT_REJECTION');
      return { data:response(), error:null };
    } },
    testNode:node
  });
  // Evaluate only the whole public provider module, not the app/bootstrap.
  vm.runInContext(source, box, { filename:'actual-main-finance-provider.js', timeout:1000 });
  const controller = box.MinutaFinanceProvider.createController({
    db:box.testDb, $:node, notify:value => notices.push(value), requireWrites:forbidden
  });
  controller.setOrganization({ id:'SYNTHETIC_ORG_A', current_role:'owner' });
  await controller.load(bounds, { masterId:'', contextToken:'SYNTHETIC_CONTEXT' });
  assert.ok(adapter && typeof adapter.readOperations === 'function');
  // The selected actual UI continuation is entered with a synthetic existing
  // page. DOM rendering itself is a recording port and receives no live data.
  box.adapter = { readOperations:async args => {
    try { const result = await adapter.readOperations(args); adapterOutcome = {status:'fulfilled',empty:result.operations.length === 0,ended:result.nextCursor === ''}; return result; }
    catch (error) { adapterOutcome = {status:'rejected'}; throw error; }
  } };
  box.onNotice = value => notices.push(value);
  box.renderOperations = () => {};
  box.normalizeOperation = forbidden; // Every addressed page is deliberately empty.
  vm.runInContext(actualText + '\nconst state = { operations:[{id:"synthetic-existing"}], visibleOperations:1, period:"custom", master:"", nextCursor:' + JSON.stringify(cursor) + ' };\n' +
    'const elements = { more:{ disabled:false, textContent:"Показать ещё" } };\n' + loadMore + '\n' +
    'globalThis.runMore=loadMore; globalThis.observe=()=>({ cursor:state.nextCursor, count:state.operations.length, disabled:elements.more.disabled });',
    box, { filename:'actual-finance-ui-load-more-continuation.js', timeout:1000 });
  await box.runMore();
  return { state:box.observe(), notices, calls, adapterOutcome };
}
(async () => {
const results = [];
for (const [id, response, expectation] of [
  ['UNQUALIFIED_PAGE_MUST_NOT_BECOME_EOF', () => ({ ...rawPage(), schema:'SYNTHETIC_UNQUALIFIED' }), 'refusal'],
  ['CONFIRMED_EMPTY_PAGE_IS_ORDINARY_EOF', rawPage, 'empty'],
  ['CURRENT_TRANSPORT_REFUSAL_PRESERVES_CURSOR', 'transport', 'refusal']
]) {
  const observed = await fixture(response);
  const pass = observed.state.count === 1 && observed.state.disabled === false && observed.calls.length === 1 &&
    (expectation === 'empty' ? observed.state.cursor === '' && observed.notices.length === 0
      : observed.state.cursor === cursor && observed.notices.length === 1);
  results.push({ id, pass, observed:{ cursorRetained:observed.state.cursor === cursor,
    notices:observed.notices.length, adapterOutcome:observed.adapterOutcome, existingRows:observed.state.count,
    moreDisabled:observed.state.disabled, syntheticReadCalls:observed.calls.length } });
}
const result = {
  format:'FINANCE_PROVIDER_PAGE_AVAILABILITY_REGRESSION',
  results, pass:results.filter(r => r.pass).length, fail:results.filter(r => !r.pass).length,
  limits:{ actualProviderFactoryAndAdapter:true, actualSelectedUiContinuation:true,
    fullFinanceUiController:false, fakeCenterDomAndRpc:true, productOrNetworkOrSqlOrPrivate:0,
    workingAcceptance:false }
};
console.log(JSON.stringify(result));
process.exitCode = result.fail ? 1 : 0;
})().catch(() => { console.error('HARNESS_SETUP_FAILURE'); process.exitCode = 2; });
