import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../commerce-soft-ui.js', import.meta.url), 'utf8');
const context = { window:{}, document:{ readyState:'loading', addEventListener() {} } };
vm.runInNewContext(source, context);
const ui = context.window.MinutaCommerceSoftUI;

test('quantity buttons preserve fractional amounts and clamp only to existing input limits', () => {
  assert.equal(ui.stepQuantity('1,25', 1), 2.25);
  assert.equal(ui.stepQuantity('1.001', -1), .001);
  assert.equal(ui.stepQuantity('1000000', 1), 1000000);
  assert.equal(ui.stepQuantity('', -1), .001);
  assert.equal(ui.stepQuantity('invalid', 1), 2);
});
test('variable insertion replaces only the selection and respects the template limit', () => {
  const next = ui.insertVariable('Здравствуйте, Анна!', 14, 18, '{имя}');
  assert.equal(next.value, 'Здравствуйте, {имя}!');
  assert.equal(next.cursor, 19);
  assert.equal(ui.insertVariable('x'.repeat(997), 997, 997, '{имя}'), null);
  assert.equal(ui.insertVariable('x'.repeat(1000), 0, 10, '{имя}').value.length, 995);
  assert.equal(ui.insertVariable('hello', 0, 0, '<script>'), null);
});
test('preview substitution preserves unfamiliar variables and does not recursively expand data', () => {
  assert.equal(ui.previewText('{имя}\n{организация} · {ссылка} · {неизвестно}', 'Клиника {имя}'), 'Имя клиента\nКлиника {имя} · [ссылка на запись] · {неизвестно}');
});
test('product icons use existing kinds and never interpolate product text into markup', () => {
  assert.equal(ui.iconName({kind:'certificate', name:'Масло'}), 'gift');
  assert.equal(ui.iconName({kind:'visit_pass'}), 'ticket');
  assert.equal(ui.iconName({name:'Массажное масло'}), 'bottle');
  assert.equal(ui.iconName({name:'Перчатки нитриловые'}), 'glove');
  assert.equal(ui.iconName({name:'Одноразовые простыни'}), 'roll');
  assert.equal(ui.iconName({name:'Антисептик'}), 'spray');
  assert.equal(ui.iconName({name:'Позиция без категории'}), 'box');
  assert.doesNotMatch(ui.iconMarkup({name:'<img src=x onerror=alert(1)>'}), /onerror|<img|alert\(/);
  assert.match(ui.iconMarkup({}), /aria-hidden="true"/);
});
test('presentation controls cannot dispatch network or financial writes', () => {
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|localStorage|sessionStorage)\b|\.rpc\(/);
  assert.match(source, /previewBody\.textContent = previewText/);
  assert.match(source, /if \(field\.disabled \|\| field\.readOnly\) return/);
  assert.match(source, /if \(quantity\.disabled\) return/);
  assert.match(source, /itemButton\.disabled !== itemDisabled/);
});
