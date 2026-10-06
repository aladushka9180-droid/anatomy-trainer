import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const help = { window:{} };
vm.runInNewContext(read('help/help-data.js'), help);
const articles = help.window.MINUTA_HELP_ARTICLES;
const article = slug => articles.find(item => item.slug === slug);
assert.equal(articles.length, 97);
assert.equal(new Set(articles.map(item => item.slug)).size, 97);
assert.equal(help.window.MINUTA_HELP_CATEGORIES.length, 16);
const revised = articles.filter(item => item.updatedAt === '6 октября 2026');
assert.equal(revised.length, 9, 'Only the nine revised instructions get a new editorial date');
assert.ok(articles.every(item => item.reviewedAt === undefined), 'Editorial dates must not imply live acceptance');

const mobileLabel = read('provider.html').match(/data-provider-view="more"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/)?.[1];
assert.ok(mobileLabel);
assert.ok(article('mobile-navigation').outcome.includes(`«${mobileLabel}»`), 'Help must name the actual bottom navigation button');

// Execute the original reconciliation and projection code with synthetic values.
// No controller is created and no network, database or payment operation occurs.
const reconciliation = {};
vm.runInNewContext(read('report-reconciliation.js'), reconciliation);
const amounts = reconciliation.MinutaReportReconciliation.amounts;
const completed = { visit_status:'completed', payment_method:'cash', amount_rub:1000 };
const paid = amounts({ status:'confirmed' }, completed, 1000);
const unpaid = amounts({ status:'confirmed' }, { ...completed, payment_method:'unpaid', amount_rub:0 }, 2000);
assert.equal(paid.serviceValue + unpaid.serviceValue, 3000);
assert.equal(paid.received + unpaid.received, 1000);
assert.equal(paid.debt + unpaid.debt, 2000);
const unknown = amounts({ status:'confirmed', is_imported_history:true }, { ...completed, payment_method:'imported' }, 2000);
assert.equal(unknown.received, 0);
assert.equal(unknown.debt, 0, 'Unknown imported payment is not confirmed client debt');

const finance = {};
vm.runInNewContext(read('finance-center-provider.js'), finance);
const project = finance.MinutaFinanceProvider.projectCashLedger;
const operation = (id, kind, amount, day = '2026-10-06') => ({
  id, operation_type:kind, source_id:id, occurred_at:`${day}T10:00:00Z`,
  booking_date:'2026-10-05',
  financial_postings:[{ side:amount > 0 ? 'debit' : 'credit', amount_minor:Math.abs(amount),
    financial_accounts:{ account_class:'asset', account_type:'cash' } }]
});
const scope = { bounds:{ start:'2026-10-06', end:'2026-10-06' }, timezone:'Europe/Samara' };
const small = project([
  operation('paid', 'visit_service', 100000),
  operation('cost', 'supplier_expense_payment', -30000)
], scope);
assert.equal(small.classified, true);
assert.equal(small.receivedMinor - small.expenseMinor, 70000);
assert.equal(small.receivedMinor, 100000, 'Money uses operation date rather than booking date');
const detailed = project([
  operation('sale', 'commercial_sale', 1000000),
  operation('refund', 'commercial_refund', -200000),
  operation('rent', 'supplier_expense_payment', -100000),
  operation('other', 'supplier_expense_payment', -200000),
  operation('outside', 'commercial_sale', 999999, '2026-10-07')
], { ...scope, expenses:[{ expense_source_id:'rent', category_id:'rent', category_name_snapshot:'Аренда' }] });
assert.equal(detailed.receivedMinor, 800000, 'Refunds reduce receipts once');
assert.equal(detailed.expenseMinor, 300000, 'Rent is included in total expenses');
assert.equal(detailed.categories.find(item => item.id === 'rent')?.amountMinor, 100000);
assert.equal(detailed.receivedMinor - detailed.expenseMinor, 500000);

// Exercise the checkout's actual proportional quantity/discount calculation,
// including cumulative rounding and the last remaining unit.
const commerce = read('commerce-management.js');
const start = commerce.indexOf('function expectedRefundAmount(');
const end = commerce.indexOf('function syncRefundAmount(', start);
assert.ok(start > 0 && end > start);
const number = commerce.match(/const number = [^;]+;/)?.[0];
assert.ok(number);
const refund = {};
vm.runInNewContext(`${number}\n${commerce.slice(start, end)}\nglobalThis.refundAmount = expectedRefundAmount;`, refund);
const sale = (quantity, total, returned = 0, refunded = 0) => ({
  total_minor:total, refunded_minor:refunded, line:{ quantity, refunded_quantity:returned }
});
assert.equal(refund.refundAmount(sale(2, 100000), 1), 50000);
assert.equal(refund.refundAmount(sale(2, 100000, 1, 50000), 1), 50000);
assert.equal(refund.refundAmount(sale(3, 100), 1), 33);
assert.equal(refund.refundAmount(sale(3, 100, 1, 33), 1), 34);
assert.equal(refund.refundAmount(sale(3, 100, 2, 67), 1), 33);
assert.equal(refund.refundAmount(sale(3, 1), 1), 0, 'A partial share that rounds to zero is unavailable');
assert.equal(refund.refundAmount(sale(3, 1), 2), 0, 'A partial share equal to the entire cash remainder is unavailable');
assert.equal(refund.refundAmount(sale(3, 1), 3), 1, 'Full remaining quantity returns the full remaining amount');

const text = slug => [article(slug).intro, article(slug).note, ...article(slug).steps.map(step => step.text)].join(' ');
assert.match(text('statistics-overview'), /не рассчитано/i, 'Current UI does not establish net profit');
assert.match(text('statistics-overview'), /не означает нулевую прибыль/i, 'Unavailable profit must not be interpreted as zero');
assert.match(text('find-booking'), /после успешного входа/i, 'Code rotation is available after authentication');
assert.doesNotMatch(text('find-booking'), /новая запись.*восстановит/i, 'Creating a booking must not be offered as access recovery');
vm.runInNewContext(read('help/help-visuals.js'), help);
for (const [slug, screen, topic] of [
  ['record-visit-result-and-payment', 'booking-policy-settings', /автоматически/i],
  ['record-visit-result-and-payment', 'booking-outcome-form', /вручную/i],
  ['statistics-sections', 'statistics-clients', /клиенты/i],
  ['statistics-sections', 'statistics-team', /команда/i],
  ['statistics-sections', 'statistics-money', /деньги.*поступления/i],
  ['settings-batch-bookings', 'client-batch-form', /клиента/i],
  ['settings-group-sessions', 'group-session-create-form', /создайте событие/i],
  ['find-booking', 'client-login', /запасной вход/i]
]) {
  const guide = article(slug);
  const visual = guide.visuals.find(visual => visual.src.includes(`/${screen}-`));
  assert.ok(visual?.step, `${slug}: screenshot belongs to its instruction step`);
  assert.match(guide.steps[visual.step - 1].title, topic, `${slug}: screenshot matches the action described`);
}
console.log('Help editorial quality: 97 articles, 16 categories; financial examples, refund rounding, labels and access boundaries PASS.');
