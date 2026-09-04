import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, 'styles.css'), 'utf8');
const provider = readFileSync(join(root, 'provider.js'), 'utf8');

const mobileTimeline = css.match(/\/\* Мобильная лента:[\s\S]*?@media \(max-width:760px\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(mobileTimeline, 'Не найден мобильный блок ленты записей');
assert.match(mobileTimeline, /timeline-booking-copy>strong[\s\S]*?overflow-wrap:anywhere[\s\S]*?white-space:normal[\s\S]*?-webkit-line-clamp:2/, 'Длинное название записи не переносится на две строки');
assert.match(mobileTimeline, /timeline-booking\.compact:not\(\.minute-only\)[\s\S]*?timeline-booking-client-row[\s\S]*?display:none!important/, 'В короткой записи второстепенная строка продолжает вытеснять название');

assert.match(css, /timeline-booking-copy,[\s\S]*?top:50%;[\s\S]*?justify-content:center;[\s\S]*?max-height:calc\(100% - 12px\);[\s\S]*?transform:translateY\(-50%\);/, 'Содержимое обычной записи снова прижато к верхнему краю');
assert.match(css, /timeline-booking:not\(\.compact\) \.timeline-booking-copy>strong \{[^}]*display:-webkit-box;[^}]*white-space:normal;[^}]*-webkit-line-clamp:2;/, 'Название часовой записи не ограничено безопасными двумя строками');
assert.match(css, /timeline-booking:not\(\.compact\) \.timeline-booking-client \{[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;/, 'Данные клиента снова могут занять несколько пересекающихся строк');
assert.ok(mobileTimeline.includes('.timeline-booking:not(.compact) :is(.timeline-client-visit-wrap,.timeline-client-duration) { display:none!important; }'), 'Базовая компактная раскладка должна уметь скрывать вторичные данные');
assert.match(css, /Мобильная функциональная чётность:[\s\S]*?timeline-booking:not\(\.compact\):not\(\.minute-only\) \.timeline-client-duration\s*\{[^}]*display:none!important/, 'Итоговая мобильная раскладка снова показывает дублирующую длительность записи');
assert.match(css, /Мобильная функциональная чётность:[\s\S]*?timeline-booking:not\(\.compact\):not\(\.minute-only\) \.timeline-booking-status\s*\{[^}]*display:inline-flex!important/, 'Итоговая мобильная раскладка не показывает статус записи');
assert.match(css, /timeline-booking:not\(:has\(\.client-badges\)\) \.timeline-booking-copy \{[^}]*padding-right:12px!important;/, 'Карточка без метки клиента теряет полезную ширину под пустой отступ');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\] \.timeline-client-visit \{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;/, 'Подпись «Новый клиент» снова переносится на лишнюю строку');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\] \.client-badges,[\s\S]*?position:absolute!important;[\s\S]*?top:9px;[\s\S]*?right:9px;/, 'VIP и другие метки снова уходят под текст записи');
assert.match(css, /timeline-booking \.timeline-booking-status-icon \{ display:none!important; \}/, 'Галочка завершённого визита снова занимает пустое место в карточке');
assert.match(provider, /const serviceTitleMarkup = block \? serviceMarkup : `\$\{serviceMarkup\}<span class="timeline-service-duration"> · \$\{duration\} мин<\/span>`;/, 'Длительность записи должна стоять сразу после названия услуги');
assert.doesNotMatch(provider, /clientDetailsMarkup[\s\S]{0,700}timeline-client-duration/, 'Длительность записи снова попала в строку данных клиента');
assert.match(css, /\.provider-body \.timeline-service-duration \{[^}]*font-size:\.78em;[^}]*white-space:nowrap;/, 'Длительность рядом с услугой не защищена от отрыва на новую строку');

assert.match(css, /data-provider-theme="luxury"\]\[data-provider-layout="linear"\] \.timeline-booking\.compact:not\(\.minute-only\) \.timeline-booking-copy>strong \{[^}]*white-space:normal;[^}]*-webkit-line-clamp:2;/, 'В теме «Люкс / Премиум» короткие названия по-прежнему обрезаются в одну строку');
assert.match(css, /data-provider-theme="luxury"\]\[data-provider-layout="linear"\] \.timeline-service-core,[\s\S]*?timeline-service-variant \{ position:static; display:inline; transform:none; \}/, 'Части названия услуги могут смещаться относительно карточки');

assert.doesNotMatch(provider, /fitMobileTimelineCards|card\.style\.height = 'auto'|card\.scrollHeight/, 'Мобильная карточка не должна увеличиваться под текст и занимать чужое время');
assert.match(provider, /const tightMobile = mobileTimeline && !minuteOnly && duration <= 60;/, 'Короткие мобильные записи не получают компактный режим содержимого');
assert.match(css, /В мобильной ленте высота записи всегда равна её реальной длительности[\s\S]*?timeline-booking\[data-mobile-timeline-top\] \.timeline-booking-note \{\s*display:none!important;/, 'Полная заметка снова может растянуть карточку по высоте');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\]\.timeline-tight\.compact:not\(\.minute-only\) \.timeline-booking-client-row \{\s*display:none!important;/, 'В записи до часа вторичный текст снова вытесняет временную шкалу');
assert.match(provider, /const renderedNote = !mobileTimeline && visibleNote/, 'Текст заметки всё ещё попадает в мобильную карточку и обрезает название');
assert.match(provider, /const timelineClientRow = compactMobile\s*\? ''/, 'В короткой мобильной записи остаётся лишняя строка под названием');
assert.match(provider, /const renderedStatus = tightMobile \? '' : timelineStatus;/, 'Статус короткой записи всё ещё может вытеснить название');
assert.match(provider, /padding:5px 9px!important;overflow:hidden!important/, 'Критические размеры короткой карточки зависят от старого CSS в кэше');

console.log('mobile timeline layout test: ok');
