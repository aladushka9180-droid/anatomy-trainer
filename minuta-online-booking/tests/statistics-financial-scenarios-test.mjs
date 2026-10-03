import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ console, Intl, Date, Number, Map, Set });
for (const name of ['finance-center.js', 'finance-center-provider.js']) vm.runInContext(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'), context);
const { projectCashLedger:project, projectGoodsSales:goods, comparisonBounds:previous } = context.MinutaFinanceProvider;
const rubles = context.MinutaFinanceCenter;
const timezone = 'Europe/Samara';
const cash = amount => ({ side:amount < 0 ? 'credit' : 'debit', amount_minor:Math.abs(amount), financial_accounts:{ account_class:'asset', account_type:'cash' } });
const rows = [
  { id:'prepayment', operation_type:'visit_service', occurred_at:'2026-09-30T19:30:00Z', financial_postings:[cash(300000)] },
  { id:'partial', operation_type:'visit_service', occurred_at:'2026-10-02T09:00:00Z', financial_postings:[cash(200000)] },
  { id:'sale', operation_type:'commercial_sale', occurred_at:'2026-09-20T09:00:00Z', financial_postings:[cash(200000)] },
  { id:'refund', operation_type:'commercial_refund', occurred_at:'2026-10-03T09:00:00Z', financial_postings:[cash(-50000)] },
  { id:'rent', operation_type:'supplier_expense_payment', source_id:'rent-source', occurred_at:'2026-10-01T09:00:00Z', financial_postings:[cash(-1000000)] },
  { id:'materials', operation_type:'supplier_expense_payment', source_id:'materials-source', occurred_at:'2026-10-01T09:00:00Z', financial_postings:[cash(-200000)] }
];
const options = { timezone, bounds:{ start:'2026-10-01', end:'2026-10-31' }, expenses:[
  { expense_source_id:'rent-source', category_id:'rent', category_name_snapshot:'Аренда' },
  { expense_source_id:'materials-source', category_id:'materials', category_name_snapshot:'Материалы' }
] };
const october = project(rows, options);
assert.equal(october.classified, true);
assert.equal(october.receivedMinor, 150000, 'partial receipt less refund belongs to October');
assert.equal(october.expenseMinor, 1200000, 'rent is included once in total expenses');
assert.equal(october.categories.find(row => row.id === 'rent').amountMinor, 1000000);
assert.equal(october.operations.find(row => row.id === 'refund').flow, 'received', 'refund does not become a rent/expense payment');
const september = project(rows, { ...options, bounds:{ start:'2026-09-01', end:'2026-09-30' } });
assert.equal(september.receivedMinor, 500000, 'prepayment is not moved to its later visit');
assert.equal(october.operations.some(row => row.id === 'prepayment'), false);
const empty = project(rows, { ...options, bounds:{ start:'2026-08-01', end:'2026-08-31' } });
assert.equal(empty.receivedMinor, 0);
assert.equal(empty.expenseMinor, 0);
assert.equal(empty.operations.length, 0);
const employee = project(rows.map(row => ({ ...row, scopeResolved:true, performerId:row.id === 'partial' ? 'one' : '' })), { ...options, masterId:'one' });
assert.equal(employee.receivedMinor, 200000);
assert.equal(employee.expenseMinor, 0, 'shared rent cannot silently become an employee expense');
assert.equal(project(rows, { ...options, masterId:'one' }).classified, false, 'unresolved employee scope is not an organization total');
const incomplete = project([{ id:'unknown', operation_type:'unrecognised_cash_flow', occurred_at:'2026-10-04T10:00:00Z', financial_postings:[cash(30000)] }], options);
assert.equal(incomplete.classified, false, 'an unsupported cash flow must prevent a falsely complete aggregate');
const reversed = project([{ id:'reverse', operation_type:'reversal', reversal_of:'old-rent', occurred_at:'2026-10-04T09:00:00Z', financial_postings:[cash(1000000)] }], {
  ...options, originals:[{ id:'old-rent', operation_type:'supplier_expense_payment', source_id:'rent-source' }]
});
assert.equal(reversed.expenseMinor, -1000000, 'expense reversal is not a customer receipt');
const settlement = { id:'debt-payment', operation_type:'customer_debt_settlement', source_id:'debt-source', occurred_at:'2026-10-02T09:00:00Z', financial_postings:[cash(198000)] };
const feeOptions = { ...options, debtSources:[{ id:'debt-source', gross_minor:200000, commission_minor:2000 }] };
const fee = project([settlement], feeOptions);
assert.equal(fee.classified, true);
assert.equal(fee.receivedMinor, 200000, 'client payment is kept before the bank fee');
assert.equal(fee.expenseMinor, 2000, 'fee is an expense once');
assert.equal(fee.receivedMinor - fee.expenseMinor, 198000, 'cash result agrees with actual account movement');
assert.equal(fee.operations.find(row => row.flow === 'expense').categoryId, fee.categories[0].id, 'expense drill-down shares category scope');
const feeReversal = project([{ id:'fee-reversal', operation_type:'reversal', reversal_of:settlement.id, occurred_at:'2026-10-03T09:00:00Z', financial_postings:[cash(-198000)] }], { ...feeOptions, originals:[settlement] });
assert.equal(feeReversal.receivedMinor, -200000);
assert.equal(feeReversal.expenseMinor, -2000);
assert.equal(project([settlement], options).classified, false, 'missing commission evidence is not a zero fee');
const salary = project([{ id:'salary', operation_type:'payroll_payment', occurred_at:'2026-10-03T09:00:00Z', financial_postings:[cash(-100000)] }], options);
assert.equal(salary.operations[0].categoryId, salary.categories[0].id, 'salary details show the same category as the total');
const sales = goods([
  { id:'goods', seller_id:'one', occurred_at:'2026-10-01T09:00:00Z', commercial_sale_lines:[{ item_kind:'inventory_item', item_name:'Товар', quantity:2, total_minor:200000 }] },
  { id:'pass', seller_id:'one', occurred_at:'2026-10-01T09:00:00Z', commercial_sale_lines:[{ item_kind:'benefit_product', quantity:1, total_minor:500000 }] },
  { id:'other', seller_id:'two', occurred_at:'2026-10-01T09:00:00Z', commercial_sale_lines:[{ item_kind:'inventory_item', quantity:4, total_minor:400000 }] }
], { ...options, masterId:'one' });
assert.equal(sales.quantity, 2, 'employee and goods scope excludes subscriptions and other sellers');
assert.equal(sales.amountMinor, 200000);
assert.equal(goods([{ id:'one-to-one', occurred_at:'2026-10-01T09:00:00Z', commercial_sale_lines:{ item_kind:'inventory_item', quantity:0.125, total_minor:500 } }], options).quantity, 0.125, 'PostgREST one-to-one sale-line shape is accepted');
assert.equal(goods([{ id:'missing-line', occurred_at:'2026-10-01T09:00:00Z', commercial_sale_lines:null }], options).known, false);
assert.equal(goods([{ occurred_at:'2026-10-01T09:00:00Z', commercial_sale_lines:[{ item_kind:'inventory_item', quantity:'bad', total_minor:100 }] }], options).known, false);
assert.equal(JSON.stringify(previous({ start:'2026-10-01', end:'2026-10-12' }, 'month')), JSON.stringify({ start:'2026-09-01', end:'2026-09-12' }));
assert.equal(JSON.stringify(previous({ start:'2026-10-01', end:'2026-10-30' }, 'custom')), JSON.stringify({ start:'2026-09-01', end:'2026-09-30' }));
assert.equal(previous({ start:'2026-10-01', end:'2026-10-31' }, 'month'), null, 'do not compare a 31-day month with a 30-day month');
assert.equal(previous({ start:'2026-01-01', end:'2026-10-01' }, 'all'), null);
assert.equal(rubles.changeLabel(200000, 0), '+2\u00a0000\u00a0₽ к прошлому периоду');
assert.doesNotMatch(rubles.changeLabel(200000, 0), /%/);
assert.equal(rubles.changeLabel(200000, 100000), '+1\u00a0000\u00a0₽ к прошлому периоду');
assert.doesNotMatch(rubles.changeLabel(200000, 100000), /%/, 'selected overview compares absolute amounts without percentages');
assert.equal(rubles.changeLabel(200000, null), '', 'missing comparison is not zero');
console.log('Seven financial scenarios, exact operation dates, reversals, goods scope and comparable periods passed.');
