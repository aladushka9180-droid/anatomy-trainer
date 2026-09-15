import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./finance-center.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('./finance-center.css', import.meta.url), 'utf8');
const sandbox = { console, Intl, Number, String, Math, Date, Set, Map, Object, Array, Boolean, RegExp, globalThis:null };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename:'finance-center.js' });
const api = sandbox.MinutaFinanceCenter;

assert.equal(typeof api?.init, 'function');
assert.equal(typeof api?.destroy, 'function');
assert.equal(api.formatRubles(1284500), '12\u00a0845\u00a0₽');
assert.equal(api.formatRubles(-1275), '−12,75\u00a0₽');
assert.equal(api.parseRubles('12 845,70'), 1284570);
assert.equal(api.parseRubles('12.345'), 0);

const normalized = api.normalizeDashboard({
  available:true, financeEnabled:true, resultReliable:true,
  summary:{ receivedMinor:150000, expenseMinor:23000, serviceMinor:200000, debtMinor:50000, totalVisits:43, paymentKnownVisits:11, netMinor:999999 },
  movement:[{ key:'1', label:'1 сен', receivedMinor:150000, expenseMinor:23000 }],
  expenseCategories:[{ id:'rent', name:'Аренда', amountMinor:23000 }],
  operations:[
    { id:'income', type:'income', label:'Оплата визита', amountMinor:150000 },
    { id:'ignored', type:'unknown', label:'Неизвестно', amountMinor:100 }
  ],
  expenseDirectory:[{ id:'rent', name:'Аренда' }],
  paymentAccounts:[{ id:'cash', name:'Основная касса' }],
  permissions:{ canAddExpense:true }
});
assert.equal(normalized.summary.netMinor, 127000, 'итог вычисляется только как получено минус расходы');
assert.equal(normalized.summary.serviceMinor, 200000, 'оказанные услуги остаются отдельной метрикой');
assert.equal(normalized.summary.debtMinor, 50000, 'долг остаётся отдельной метрикой');
assert.equal(normalized.operations.length, 1, 'неизвестный тип операции не показывается как деньги');
assert.equal(normalized.completeness.partial, true);
const disabled = api.normalizeDashboard({ available:true, financeEnabled:false, resultReliable:false, summary:{ receivedMinor:3660000, totalVisits:43, paymentKnownVisits:11 } });
assert.equal(disabled.available, true);
assert.equal(disabled.financeEnabled, false);
assert.equal(disabled.resultReliable, false);
assert.equal(api.normalizeDashboard({ summary:{} }).available, false, 'missing readiness must fail closed');

assert.doesNotMatch(source, /localStorage|sessionStorage/);
assert.doesNotMatch(source, /Math\.random/);
assert.doesNotMatch(source, /get_minuta_|\.rpc\s*\(/, 'UI не связывается с конкретным RPC');
assert.match(source, /readDashboard/);
assert.match(source, /createExpense/);
assert.match(source, /prepareExpense/);
assert.match(source, /findExpenseByRequestId/);
assert.match(source, /paymentAccountId/);
assert.match(source, /requestId/);
assert.match(source, /raw\.available === true/);
assert.match(source, /raw\.financeEnabled === true/);
assert.match(source, /raw\.resultReliable === true/);
assert.match(source, /Итог за период не рассчитан/);
assert.match(source, /aria-live="polite"/);
assert.match(source, /ArrowLeft/);
assert.match(source, /Оплата указана в \$\{known\} из \$\{total\} визитов/);
assert.match(source, /стоимость состоявшихся визитов/);
assert.match(source, /фактическая отмеченная оплата/);
assert.match(source, /подтверждённая неоплата/);
assert.match(source, /Исправление выполняется корректировкой/);
assert.doesNotMatch(source, /Материалы|Аренда|Зарплата|Реклама|Налоги|Оборудование/, 'справочник категорий не зашит в интерфейс');

for (const marker of ['@media(max-width:760px)', '@media(max-width:520px)', 'env(safe-area-inset-bottom)', 'min-height:44px', 'white-space:nowrap', 'prefers-reduced-motion']) {
  assert.match(css, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(css, /\.finance-center__bar\.is-expense\{[^}]*border:1px dashed/);
assert.match(css, /width:min\(100%,1120px\)/);

console.log('Finance center UI static contract passed.');
