import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, 'styles.css'), 'utf8');
const marker = '/* Warm Beige: единая тёплая типографика во всех разделах кабинета. */';
const start = css.lastIndexOf(marker);
assert.ok(start > css.indexOf('.dashboard-top small,.panel-head small'), 'Финальный слой Warm Beige должен перекрывать старые зелёные стили');
const warm = css.slice(start);
assert.ok(warm.includes('.provider-view small'), 'Warm Beige должен нормализовать вторичный текст во всех вкладках кабинета');
assert.match(
  warm,
  /\.date-strip button\.active > :is\(span,strong,small\)\s*\{\s*color:inherit!important;/,
  'Подписи выбранной даты Warm Beige должны наследовать белый цвет активной кнопки'
);
assert.match(css, /data-provider-theme="warm"\] \.timeline-hour \{ color:#332923; \}/, 'Целые часы Warm Beige должны быть тёмно-коричневыми');
assert.match(css, /data-provider-theme="warm"\] \.timeline-hour\.timeline-half-hour \{ color:#78695f; \}/, 'Получасовые отметки Warm Beige должны оставаться в коричневой гамме');
assert.match(css, /data-provider-theme="warm"\][^{]*\.timeline-booking\.color-auto[^{]*\.timeline-booking-time[^{]*\{ color:#332923; \}/, 'Время записи Warm Beige не должно быть чёрным');

for (const selector of [
  '.view-title>div:first-child>span:not(.panel-count)',
  '.panel-head>div>small',
  '.card-heading>small',
  '.settings-heading>small',
  '.client-profile-head>div>small',
  '.notification-toolbar>div>small',
  '.notification-card-head>span',
  '.resource-subhead>div>small',
  '.group-events-panel-head small',
  '.booking-outcome-heading small',
  '.booking-sheet-kicker',
  '.provider-nav-group-label'
]) {
  assert.ok(warm.includes(selector), `Warm Beige не перекрашивает ${selector}`);
}
assert.match(warm, /color:var\(--theme-accent\)!important;/, 'Служебные заголовки Warm Beige не используют терракотовый акцент');
assert.match(warm, /provider-mobile-nav button:not\(\.active\)[\s\S]*?color:var\(--theme-muted\)!important;/, 'Мобильная навигация сохраняет зелёный оттенок');

console.log('warm theme color test: ok');
