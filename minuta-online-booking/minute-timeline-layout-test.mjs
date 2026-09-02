import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const provider = readFileSync(join(root, 'provider.js'), 'utf8');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');
const start = provider.indexOf('function stackMinuteTimelineItems');
const end = provider.indexOf('function renderTimeline', start);
assert.ok(start >= 0 && end > start, 'Не найден алгоритм раскладки минутных записей');

const context = {};
vm.createContext(context);
vm.runInContext(provider.slice(start, end), context);
const entries = [
  { index: 0, top: 100, visualTop: 100, height: 36, minuteOnly: true },
  { index: 1, top: 101.2, visualTop: 101.2, height: 36, minuteOnly: true },
  { index: 2, top: 102.4, visualTop: 102.4, height: 36, minuteOnly: true }
];
context.stackMinuteTimelineItems(entries);
assert.deepEqual(entries.map(entry => entry.visualTop), [100, 142, 184], 'Минутные записи продолжают накладываться друг на друга');
assert.match(provider, /const height = minuteOnly \? 36 :/, 'Высота минутной записи меньше её фактической карточки');
assert.match(styles, /timeline-booking\.minute-only \{[\s\S]*?min-height:36px!important;/, 'CSS снова увеличивает минутную карточку без учёта раскладки');

console.log('minute timeline layout test: ok');
