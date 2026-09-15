import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./finance-center-provider.js', import.meta.url), 'utf8');
const sandbox = { console, Intl, Number, String, Math, Date, Map, Object, Array, Boolean, RegExp, Error, JSON, globalThis:null };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename:'finance-center-provider.js' });
const api = sandbox.MinutaFinanceProvider;

assert.equal(typeof api?.createController, 'function');
assert.equal(JSON.stringify(api.periodBounds('current_month', new Date('2026-09-15T08:00:00Z'))), JSON.stringify({ start:'2026-09-01', end:'2026-09-15' }));
assert.equal(JSON.stringify(api.periodBounds('last30', new Date('2026-09-15T08:00:00Z'))), JSON.stringify({ start:'2026-08-17', end:'2026-09-15' }));

const organizationId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const performerId = '44444444-4444-4444-8444-444444444444';
const normalized = api.normalizeFinanceScreen({
  schema:'minuta-finance-screen-v1', ledger_version:163, organization_id:organizationId, currency:'RUB', timezone:'Europe/Samara', finance_enabled:true,
  period:{ start:'2026-09-01', end:'2026-09-15', bucket_grain:'day' }, selected_performer_id:performerId,
  summary:{ received_minor:3660000, expense_minor:120000, net_minor:3540000, services_minor:14070000, debt_minor:500000 },
  confidence:{ completed_visits:43, payment_marked_visits:11, unposted_payment_visits:11, is_complete:false, result_reliable:false },
  expense_readiness:{ has_payment_account:true, can_record:true },
  performers:[{ id:performerId, name:'Александра' }],
  accounts:[{ id:accountId, name:'Основная касса' }],
  categories:[{ id:categoryId, name:'Материалы', active:true }],
  series:[{ bucket_start:'2026-09-15', received_minor:3660000, expense_minor:120000 }],
  expense_structure:[{ category_id:categoryId, name:'Материалы', amount_minor:120000 }],
  operations:[
    { event_key:'income', kind:'income', occurred_at:'2026-09-15T09:00:00Z', amount_minor:3660000, label:'Оплата визита' },
    { event_key:'expense', kind:'expense', occurred_at:'2026-09-15T10:00:00Z', amount_minor:-120000, label:'Материалы', category_name:'Материалы' }
  ],
  has_more:true, next_cursor:{ occurred_at:'2026-09-15T09:00:00Z', event_key:'income' }
}, { organizationId, period:'current_month', bounds:{ start:'2026-09-01', end:'2026-09-15' } });

assert.equal(normalized.available, true);
assert.equal(normalized.summary.receivedMinor, 3660000);
assert.equal(normalized.summary.expenseMinor, 120000);
assert.equal(normalized.summary.serviceMinor, 14070000);
assert.equal(normalized.summary.debtMinor, 500000);
assert.equal(normalized.resultReliable, false, 'server reliability flag is fail-closed');
assert.equal(normalized.permissions.canAddExpense, true);
assert.equal(normalized.operations[1].type, 'expense');
assert.equal(normalized.operations[1].amountMinor, -120000);
assert.match(normalized.completeness.message, /11 из 43/);
assert.match(normalized.nextCursor, /event_key/);

assert.equal(api.normalizeFinanceScreen({ schema:'wrong' }, { organizationId }).available, false);
assert.equal(api.normalizeFinanceScreen({ schema:'minuta-finance-screen-v1', ledger_version:163, organization_id:'wrong', currency:'RUB' }, { organizationId }).available, false);
assert.doesNotMatch(source, /localStorage|sessionStorage/);
assert.match(source, /get_minuta_finance_screen_v163/);
assert.match(source, /record_minuta_manual_expense_v163/);
assert.match(source, /initialize_minuta_finance_screen_v163/);
assert.match(source, /p_request_id:payload\.requestId/);
assert.match(source, /raw\.organization_id !== context\.organizationId/);
assert.match(source, /raw\.currency !== 'RUB'/);
assert.match(source, /classList\.add\('finance-center-mounted'\)/);
assert.match(source, /classList\.remove\('finance-center-mounted'\)/);

console.log('Finance center provider adapter contract passed.');
