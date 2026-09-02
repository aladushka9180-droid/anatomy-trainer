import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, 'styles.css'), 'utf8');

const mobileTimeline = css.match(/\/\* Мобильная лента:[\s\S]*?@media \(max-width:760px\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(mobileTimeline, 'Не найден мобильный блок ленты записей');
assert.match(mobileTimeline, /timeline-booking-copy>strong[\s\S]*?overflow-wrap:anywhere[\s\S]*?white-space:normal[\s\S]*?-webkit-line-clamp:2/, 'Длинное название записи не переносится на две строки');
assert.match(mobileTimeline, /timeline-booking\.compact:not\(\.minute-only\)[\s\S]*?timeline-booking-client-row[\s\S]*?display:none!important/, 'В короткой записи второстепенная строка продолжает вытеснять название');

assert.match(css, /data-provider-theme="luxury"\]\[data-provider-layout="linear"\] \.timeline-booking\.compact:not\(\.minute-only\) \.timeline-booking-copy>strong \{[^}]*white-space:normal;[^}]*-webkit-line-clamp:2;/, 'В теме «Люкс / Премиум» короткие названия по-прежнему обрезаются в одну строку');
assert.match(css, /data-provider-theme="luxury"\]\[data-provider-layout="linear"\] \.timeline-service-core,[\s\S]*?timeline-service-variant \{ position:static; display:inline; transform:none; \}/, 'Части названия услуги могут смещаться относительно карточки');

console.log('mobile timeline layout test: ok');
