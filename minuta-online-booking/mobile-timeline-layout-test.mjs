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
assert.match(css, /timeline-booking\[data-mobile-timeline-top\]:not\(\.compact\):not\(\.minute-only\) \.timeline-booking-status \{\s*display:none!important;/, 'Служебный статус снова занимает отдельную строку мобильной записи');
assert.match(css, /timeline-booking:not\(:has\(\.client-badges\)\) \.timeline-booking-copy \{[^}]*padding-right:12px!important;/, 'Карточка без метки клиента теряет полезную ширину под пустой отступ');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\] \.timeline-client-visit \{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;/, 'Подпись «Новый клиент» снова переносится на лишнюю строку');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\] \.client-badges,[\s\S]*?position:static!important;[\s\S]*?float:right;[\s\S]*?max-width:72px;/, 'Компактная метка не обтекается названием записи');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\]:not\(:has\(\.client-badges\)\) \.timeline-booking-copy>strong \{[^}]*width:100%!important;[^}]*padding-right:0!important;/, 'Запись без меток не использует всю доступную ширину');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\]:has\(\.client-badges\) \.timeline-booking-copy>strong \{ padding-right:0!important; \}/, 'Метка снова отнимает ширину у всех строк названия');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\] \.timeline-booking-client-row,[\s\S]*?clear:both;/, 'Время и имя клиента не возвращаются на полную ширину под меткой');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\] \.timeline-client-phone \{\s*display:none!important;/, 'Телефон снова перегружает мобильную ленту');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\] \.timeline-client-visit-wrap \{\s*display:none!important;/, 'Тип клиента снова торчит обрезанной плашкой снизу');
assert.match(css, /timeline-booking \.timeline-booking-status-icon \{ display:none!important; \}/, 'Галочка завершённого визита снова занимает пустое место в карточке');
assert.match(provider, /const serviceTitleMarkup = block \? `\$\{serviceMarkup\}\$\{automaticBreakSourceMarkup\}` : `<span class="timeline-service-title">\$\{serviceMarkup\}<\/span>`;/, 'Название услуги потеряло устойчивую адаптивную зону');
assert.doesNotMatch(provider, /serviceTitleMarkup[^;]*timeline-service-duration/, 'Длительность не должна дублировать уже видимый полный диапазон времени');
assert.doesNotMatch(provider, /serviceMarkup\}<wbr><span class="timeline-service-duration"/, 'Принудительная точка переноса преждевременно отправляет длительность на новую строку');
assert.match(provider, /timeline-service-variant"> —&nbsp;\$\{escapeHtml\(parts\[1\]\)\}/, 'Тире варианта услуги снова остаётся в конце первой строки');
assert.match(css, /@media \(max-width:760px\)[\s\S]*?timeline-booking\[data-mobile-timeline-top\]\[data-open-booking\]:not\(\.status-block\):not\(\.compact\):not\(\.minute-only\):has\(\.timeline-drag-handle\) \.timeline-booking-copy \{[^}]*width:100%!important;[^}]*padding-right:clamp\(35px,9vw,44px\)!important;/, 'Обычная мобильная запись не использует фактическую безопасную ширину до 44px ручки');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\]\[data-open-booking\][^}]*timeline-booking-copy \{[^}]*display:grid!important;[^}]*grid-template-columns:minmax\(0,1fr\) auto!important;[^}]*grid-template-rows:auto auto!important;/, 'Обычная мобильная запись не делит заголовок и мета-строку');
assert.match(css, /timeline-service-title \{[^}]*grid-column:1 \/ -1;[^}]*grid-row:1;[^}]*overflow:hidden;[^}]*overflow-wrap:normal;[^}]*white-space:nowrap;/, 'Название услуги не использует всю безопасную однострочную область');
assert.match(css, /timeline-booking-client-row \{[^}]*grid-column:1 \/ -1;[^}]*grid-row:2;/, 'Время и клиент не занимают отдельную вторую строку');
assert.match(css, /@media \(max-width:340px\)[\s\S]*timeline-booking-copy \{[^}]*padding-right:0!important;[\s\S]*timeline-booking-client-row \{[^}]*padding-right:35px!important;[\s\S]*timeline-drag-handle \{[^}]*bottom:0!important;[^}]*height:32px!important;/, '320px fallback не освобождает верхнюю строку без скрытия данных');
assert.match(css, /@media \(max-width:760px\)[\s\S]*?timeline-booking\[data-mobile-timeline-top\]:not\(\.status-block\):not\(\.compact\):not\(\.minute-only\) \.timeline-booking-copy>strong \{[^}]*font-size:clamp\(10\.5px,2\.7vw,12px\);[^}]*letter-spacing:-\.025em;/, 'Длинное название услуги не использует адаптивное мобильное уплотнение без изменения перерывов и коротких записей');
assert.doesNotMatch(css, /@media \(max-width:374px\)\s*\{\s*\.provider-body\[data-provider-theme\] \.timeline-booking\[data-mobile-timeline-top\]:not\(\.status-block\):not\(\.compact\):not\(\.minute-only\) \.timeline-booking-copy>strong \{[^}]*font-size:10px;/, 'Заголовок мобильной записи нельзя уменьшать до трудночитаемых 10 пикселей');
assert.doesNotMatch(provider, /clientDetailsMarkup[\s\S]{0,700}timeline-client-duration/, 'Длительность записи снова попала в строку данных клиента');
assert.match(css, /\.provider-body \.timeline-service-duration \{[^}]*font-size:\.78em;[^}]*white-space:nowrap;/, 'Длительность рядом с услугой не защищена от отрыва на новую строку');

assert.match(css, /data-provider-theme="luxury"\]\[data-provider-layout="linear"\] \.timeline-booking\.compact:not\(\.minute-only\) \.timeline-booking-copy>strong \{[^}]*white-space:normal;[^}]*-webkit-line-clamp:2;/, 'В теме «Люкс / Премиум» короткие названия по-прежнему обрезаются в одну строку');
assert.match(css, /data-provider-theme="luxury"\]\[data-provider-layout="linear"\] \.timeline-service-core,[\s\S]*?timeline-service-variant \{ position:static; display:inline; transform:none; \}/, 'Части названия услуги могут смещаться относительно карточки');

assert.doesNotMatch(provider, /fitMobileTimelineCards|card\.style\.height = 'auto'|card\.scrollHeight/, 'Мобильная карточка не должна увеличиваться под текст и занимать чужое время');
assert.match(provider, /const tightMobile = mobileTimeline && !minuteOnly && duration <= 60;/, 'Короткие мобильные записи не получают компактный режим содержимого');
assert.match(css, /В мобильной ленте высота записи всегда равна её реальной длительности[\s\S]*?timeline-booking\[data-mobile-timeline-top\] \.timeline-booking-note \{\s*display:none!important;/, 'Полная заметка снова может растянуть карточку по высоте');
assert.match(css, /timeline-booking\[data-mobile-timeline-top\]\.timeline-tight\.compact:not\(\.minute-only\) \.timeline-booking-client-row \{\s*display:none!important;/, 'В записи до часа вторичный текст снова вытесняет временную шкалу');
assert.match(provider, /const renderedNote = mobileTimeline \? '' : bookingNotePresenceMarkup\(note, 'timeline-booking-note-presence'\)/, 'Мобильная лента снова выводит отдельный блок заметки поверх карточки');
assert.match(provider, /bookingNotePresenceMarkup\(note, 'timeline-booking-note-presence'\)/, 'Карточка на ПК не показывает спокойный признак заметки');
assert.match(provider, /const timelineClientRow = compactMobile\s*\? ''/, 'В короткой мобильной записи остаётся лишняя строка под названием');
assert.match(provider, /const renderedStatus = mobileTimeline \? '' : timelineStatus;/, 'Статус мобильной записи всё ещё может вытеснить название');
assert.match(provider, /function timelineEmptyHintOffsetMinutes\(start, end, mobileTimeline\)[\s\S]*?return Math\.min\(mobileTimeline \? 0 : 30, visibleDuration \/ 2\);/, 'Подсказка пустого дня не привязана к первому видимому участку шкалы');
assert.match(provider, /timeline-empty-state" aria-label="День свободен\. Нажмите нужное время, чтобы записать клиента или поставить перерыв"[\s\S]*?<small>Нажмите нужное время, чтобы записать клиента или поставить перерыв<\/small>/, 'Подсказка пустого дня потеряла понятное действие');
assert.doesNotMatch(provider, /timeline-empty-state[^`]*<strong>День свободен<\/strong>/, 'Подсказка пустого дня дублирует заголовок дня');
assert.match(css, /@media \(max-width:760px\) \{[\s\S]*?timeline-empty-state \{[^}]*grid-template-columns:28px minmax\(0,360px\);[^}]*padding:8px 10px;[^}]*text-align:left;/, 'Мобильная подсказка пустого дня не помещается в первый видимый участок');
assert.match(provider, /mobileTimeline \? \{ limit:1, showLabels:true \}/, 'Длинная мобильная запись снова выводит несколько конкурирующих меток');
assert.match(provider, /timeline-booking-copy">\$\{mobileBadgeMarkup\}<strong>/, 'Метка должна стоять перед названием, чтобы текст занял ширину под ней');
assert.match(provider, /padding:5px 9px!important;overflow:hidden!important/, 'Критические размеры короткой карточки зависят от старого CSS в кэше');

console.log('mobile timeline layout test: ok');
