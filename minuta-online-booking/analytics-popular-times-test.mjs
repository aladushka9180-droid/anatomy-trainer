import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const provider = readFileSync(join(root, 'provider.js'), 'utf8');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');

assert.match(provider, /const popularStarts = [\s\S]*new Map\(\)/, 'Тепловая карта не собирает точное время начала записей');
assert.match(provider, /popularStarts\[startBandIndex\]\[weekday\]\.set\(time,[\s\S]*\+ 1\)/, 'Частота времени начала не подсчитывается');
assert.match(provider, /class="report-heatmap-popular-time"/, 'Частое точное время не показано в ячейке');
assert.match(provider, /peakPopular[\s\S]*` · чаще \$\{popularTimesText\(peakPopular\)\}`/, 'Частые точные времена не показаны в итоговой подсказке');
assert.match(styles, /\.report-heatmap-popular-time \{[^}]*white-space:nowrap;/, 'Подпись частого времени не оформлена компактно');

console.log('analytics popular exact times checks passed');
