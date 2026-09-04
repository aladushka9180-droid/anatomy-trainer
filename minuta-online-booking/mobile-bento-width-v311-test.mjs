import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(
  styles,
  /@media \(max-width:760px\)[\s\S]*data-provider-layout="bento"\] \.provider-app \{ padding-right:4px; padding-left:4px; \}/,
  'Bento оставляет слишком большие внешние поля на телефоне',
);
assert.match(
  styles,
  /data-provider-layout="bento"\] \.timeline-view \{ padding-right:4px; padding-left:4px; \}/,
  'Внутренние поля временной шкалы всё ещё сужают записи',
);
assert.match(
  styles,
  /data-provider-layout="bento"\] \.day-timeline \{ grid-template-columns:44px minmax\(0,1fr\); \}/,
  'Колонка часов на телефоне должна быть компактной, но читаемой',
);
assert.match(
  styles,
  /data-provider-layout="bento"\] \.timeline-booking \{ right:4px; left:5px; \}/,
  'Карточки записей не используют доступную ширину временной шкалы',
);
assert.match(
  styles,
  /data-provider-layout="bento"\] \.timeline-day-expand \{ width:calc\(100% - 44px\); \}/,
  'Кнопка продолжения дня не выровнена по расширенной колонке записей',
);

console.log('Mobile Bento width v311 checks passed.');
