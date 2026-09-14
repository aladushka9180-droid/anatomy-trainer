import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../provider.html');
const provider = read('../provider.js');
const controller = read('../finance-center.js');
const styles = read('../finance-center.css');
const migration = read('../supabase-migration-v163.sql');
const rollback = read('../supabase-migration-v163-rollback.sql');
const worker = read('../sw.js');
const integration = read('./finance-center-v163-integration.sql');
const workflow = read('../../.github/workflows/minuta-v163-safe-release.yml');

for (const id of [
  'financeCenter', 'financeNet', 'reportRevenue', 'reportCompletedValue', 'reportDebt',
  'financeExpenses', 'financeCoverageText', 'financeFlowChart', 'financeOperationList',
  'financeAddExpense', 'financeExpenseDialog', 'financeExpenseForm'
]) assert.match(html, new RegExp(`id="${id}"`));

assert.match(html, /data-report-section="money"[\s\S]*Итог за период[\s\S]*Получено[\s\S]*Оказано услуг[\s\S]*Долг[\s\S]*Расходы/);
assert.match(html, /finance-center\.css\?v=796/);
assert.match(html, /finance-center\.js\?v=796/);
assert.doesNotMatch(html, /id="money(?:Income|Expenses|Profit)"/);

for (const key of ['materials', 'rent', 'salary', 'advertising', 'taxes', 'equipment', 'other']) {
  assert.match(controller, new RegExp(`\\['${key}',`));
  assert.match(migration, new RegExp(`'${key}'`));
}
assert.match(controller, /CATEGORY_VERSION = 1/);
assert.match(controller, /minuta-finance-v163:/);
assert.match(controller, /get_minuta_finance_expenses_v163/);
assert.match(controller, /record_minuta_expense_v163/);
assert.match(controller, /reverse_minuta_expense_v163/);
assert.match(controller, /snapshot\.receivedRub[\s\S]*expenseRub/);
assert.match(controller, /Оплата отмечена у \$\{number\(snapshot\.knownPaymentCount\)\} из \$\{number\(snapshot\.completedCount\)\} визитов/);
assert.match(controller, /Повторите отправку: новый дубль не появится/);
assert.doesNotMatch(controller, /cardnumber|\bpan\b|cvv|cvc/i);
assert.match(provider, /financeController\?\.updateSnapshot/);
assert.match(provider, /paymentUnknown\(item, outcome\)\) return/);
assert.match(provider, /item\.payment_status === 'refunded'[\s\S]*Math\.min\(recorded,[\s\S]*deposit_amount_rub/);
assert.match(provider, /financeDebt \+= Math\.max\(0, reportServiceValue\(item\) - received\)/);
assert.match(provider, /description:'Возврат предоплаты'[\s\S]*amountRub:-refundedPrepayment/);
assert.doesNotMatch(provider, /const received = refunded \? 0 : recorded/);
assert.match(provider, /reportCompletedItems/);

assert.match(migration, /create table if not exists public\.financial_expense_metadata/);
assert.match(migration, /category_version smallint not null default 1 check\(category_version=1\)/);
assert.match(migration, /unique\(organization_id,request_id\)/);
assert.match(migration, /financial_expense_metadata_immutable_v163/);
assert.match(migration, /enable row level security/);
assert.match(migration, /array\['owner','admin'\]/);
assert.match(migration, /pg_timezone_names/);
assert.match(migration, /at time zone v_timezone/);
assert.match(migration, /finance_expense_idempotency_conflict/);
assert.match(migration, /accrue_minuta_supplier_expense_v132[\s\S]*pay_minuta_supplier_expense_v132/);
assert.match(migration, /reverse_minuta_supplier_expense_payment_v132[\s\S]*reverse_minuta_supplier_expense_accrual_v132/);
assert.match(rollback, /v163_rollback_blocked_finance_expense_data_exists/);
assert.match(integration, /begin;[\s\S]*rollback;/);
for (const scenario of ['add_replay', 'v163_add_conflict_accepted', 'v163_specialist_write_accepted', 'v163_outsider_read_accepted', 'reversal_replay', 'v163_metadata_update_accepted']) {
  assert.match(integration, new RegExp(scenario));
}
for (const phase of ['test-v163', 'validate-production-v163', 'apply-production-v163', 'observe-production-v163']) {
  assert.match(workflow, new RegExp(`\\b${phase}:`));
}
assert.match(workflow, /test "\$CONFIRMATION" = BACKUP_VERIFIED/);
assert.match(workflow, /finance-center-v163-integration\.sql/);
assert.match(workflow, /supabase-migration-v163-rollback\.sql/);
assert.match(workflow, /sourceBackupRunId==\$backup/);
assert.match(workflow, /ephemeralContainerDestroyed/);

assert.match(styles, /@media\(max-width:760px\)/);
assert.match(styles, /@media\(max-width:430px\)/);
assert.match(worker, /finance-center\.css\?v=796/);
assert.match(worker, /finance-center\.js\?v=796/);
assert.match(worker, /CACHE_PREFIX}v796/);

console.log('PrimeTime Pro finance center v163 static checks passed');
