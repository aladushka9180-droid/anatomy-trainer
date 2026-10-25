import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTransaction, sources, verifySources } from '../scripts/catalog-v186-v187-release-sql.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
assert.equal(verifySources().length, 4);
assert.equal(verifySources(file => read(file).replace(/\r?\n/g, '\r\n')).length, 4);
for (const source of sources) {
  assert.throws(() => buildTransaction('apply', file => read(file) +
    (file === source.file ? '\n-- unreviewed change\n' : '')), /pinned tested Git blob/);
}
assert.throws(() => buildTransaction('reapply'), /unsupported catalog operation/);
for (const phase of ['apply', 'rollback']) {
  const sql = buildTransaction(phase);
  assert.equal((sql.match(/^begin;$/gm) || []).length, 1);
  assert.equal((sql.match(/^commit;$/gm) || []).length, 1);
  const expected = sources.filter(source => source.phase === phase);
  assert.ok(sql.indexOf(`-- ${expected[0].file} sha256=`) < sql.indexOf(`-- ${expected[1].file} sha256=`));
  for (const source of expected) {
    const body = read(source.file).replace(/\r\n/g, '\n').replace(/^begin;$/m, '').replace(/^commit;$/m, '');
    assert.ok(sql.includes(body), 'migration body and rollback ledger guards must remain exact');
  }
}
console.log('v186/v187 SQL renderer: pinned-source refusal, line endings, order and transaction wrappers passed');
