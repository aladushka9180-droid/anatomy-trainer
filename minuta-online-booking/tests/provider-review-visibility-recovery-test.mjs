import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const start = source.indexOf('  if (reviewVisibility) {');
const end = source.indexOf('  if (toggle) {', start);
assert.ok(start > 0 && end > start);
const handler = source.slice(start, end);
function fixture(mode = 'success') {
  const calls = [], notices = [];
  let finish;
  const context = vm.createContext({
    notify: message => notices.push(message),
    loadProviderReviews: async () => calls.push('reload'),
    db: { rpc: async (name, args) => {
      calls.push({ name, args });
      if (mode === 'throw') throw Error('offline');
      if (mode === 'error') return { error:{ message:'rejected' } };
      if (mode === 'pending') return new Promise(resolve => { finish = resolve; });
      return { error:null };
    } }
  });
  vm.runInContext(`async function handle(reviewVisibility) { ${handler} }`, context);
  return { calls, notices, run:context.handle, finish:() => finish({ error:null }) };
}
for (const mode of ['throw', 'error']) await test(`${mode}: button and visibility survive failure and retry succeeds`, async () => {
  const button = { disabled:false, dataset:{ reviewVisibility:'review-1', reviewPublished:'false' } };
  const before = JSON.stringify(button.dataset);
  const failed = fixture(mode);
  await failed.run(button);
  assert.equal(button.disabled, false);
  assert.equal(JSON.stringify(button.dataset), before);
  assert.match(failed.notices.at(-1), /Не удалось изменить видимость/);
  assert.equal(failed.calls.includes('reload'), false);
  const retry = fixture();
  await retry.run(button);
  assert.equal(button.disabled, false);
  assert.equal(retry.calls[0].name, 'set_booking_review_published');
  assert.equal(retry.calls[0].args.p_review, 'review-1');
  assert.equal(retry.calls[0].args.p_published, true);
  assert.equal(retry.calls.at(-1), 'reload');
});
await test('pending duplicate click does not start a second write', async () => {
  const f = fixture('pending');
  const button = { disabled:false, dataset:{ reviewVisibility:'review-1', reviewPublished:'true' } };
  const pending = f.run(button);
  assert.equal(button.disabled, true);
  await f.run(button);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args.p_published, false);
  f.finish();
  await pending;
  assert.equal(button.disabled, false);
});
