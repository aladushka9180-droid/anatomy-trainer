import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const providerHtml = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

function sourceFunction(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`\nfunction ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} должна присутствовать в provider.js`);
  return source.slice(start, end);
}

const timelineMinuteFromPointer = new Function(
  'scheduleStepForDate',
  'selectedDate',
  `${sourceFunction('timelineMinuteFromPointer', 'bookingPlacementIssue')}; return timelineMinuteFromPointer;`
)(() => 5, '2026-09-02');

const stage = {
  dataset:{ timelineStart:'600', timelineEnd:'1200' },
  getBoundingClientRect:() => ({ top:100, height:600 })
};
assert.equal(timelineMinuteFromPointer(stage, 367, 12, 60), 855, 'время должно округляться к шагу 5 минут');
assert.equal(timelineMinuteFromPointer(stage, 50, 12, 60), 600, 'перетаскивание ограничено началом дня');
assert.equal(timelineMinuteFromPointer(stage, 900, 12, 90), 1110, 'перетаскивание ограничено концом дня с учётом длительности');

assert.match(source, /document\.addEventListener\('pointerdown',[\s\S]*beginTimelineBookingDrag/);
assert.match(source, /document\.addEventListener\('pointermove',[\s\S]*updateTimelineBookingDrag/);
assert.match(source, /document\.addEventListener\('touchmove',[\s\S]*passive:false/);
assert.match(source, /document\.addEventListener\('contextmenu',[\s\S]*event\.preventDefault\(\)/);
assert.match(source, /state\.card\.closest\('#providerBookings'\)[\s\S]*scheduleDaySwipe = swipeState/, 'свайп дня должен начинаться и поверх карточки на телефоне');
const beginScheduleDaySwipe = sourceFunction('beginScheduleDaySwipe', 'openTimelineBooking');
assert.doesNotMatch(beginScheduleDaySwipe, /setPointerCapture/, 'обычный клик по дате нельзя перехватывать до начала свайпа');
assert.match(beginScheduleDaySwipe, /event\.pointerType !== 'touch' && event\.pointerType !== 'pen'/, 'свайп дня не должен перехватывать мышь на компьютере');
const daySwipeRuntime = new Function(`let currentFilter = 'day'; let timelineBookingDrag = null; let timelineMovePending = false; let scheduleDaySwipe = null; ${beginScheduleDaySwipe}; const surface = {}; return { run(event) { scheduleDaySwipe = null; beginScheduleDaySwipe(event, surface); return scheduleDaySwipe; } };`)();
const clearSwipeTarget = { closest:() => null };
assert.equal(daySwipeRuntime.run({ pointerType:'mouse', button:0, pointerId:1, clientX:120, clientY:40, target:clearSwipeTarget }), null, 'обычный клик мышью не должен запускать распознавание свайпа');
assert.equal(daySwipeRuntime.run({ pointerType:'touch', button:0, pointerId:2, clientX:120, clientY:40, target:clearSwipeTarget })?.pointerId, 2, 'свайп пальцем должен сохраниться');
assert.match(providerHtml, /provider\.js\?v=148/, 'кабинет должен загрузить исправленный обработчик, а не старый кэш');
assert.match(serviceWorker, /provider\.js\?v=148/, 'исправленный обработчик должен быть доступен офлайн');
assert.match(source, /dateStrip\.querySelectorAll\('\[data-booking-date\]'\)\.forEach\(button => \{[\s\S]*selectScheduleDate\(button\.dataset\.bookingDate\)/, 'каждая дата должна выбирать собственное значение сразу после отрисовки');
assert.match(source, /button\.addEventListener\('mousedown',[\s\S]*button\.addEventListener\('click'/, 'каждая дата должна получить собственные обработчики мыши и клика');
assert.match(source, /if \(Date\.now\(\) < gestureClickSuppressedUntil\) return;[\s\S]*selectScheduleDate\(button\.dataset\.bookingDate\)/, 'клик после свайпа не должен возвращать прежнюю дату');
assert.doesNotMatch(source.match(/document\.addEventListener\('click',[\s\S]*?\n\}\);/)?.[0] || '', /const date = event\.target\.closest\('\[data-booking-date\]'\)/, 'общий обработчик страницы не должен повторно обрабатывать дату');
assert.match(source, /state\.active = true;\s*state\.surface\.setPointerCapture/, 'захват указателя допустим только после распознавания свайпа');
assert.match(source, /shiftScheduleDate\(deltaX < 0 \? 1 : -1\)/);
assert.match(source, /bookingPlacementIssue\(item, state\.date, state\.targetMinute\)/);
assert.match(source, /p_ignore_booking: item\.id/);
assert.match(source, /data-booking-duration="\$\{duration\}"/);
assert.match(styles, /\.timeline-booking\[data-open-booking\]\.is-dragging/);
assert.match(styles, /#providerBookings\.is-day-swiping/);
assert.match(styles, /\.date-strip \{ position:relative; isolation:isolate;/, 'полоса дат должна создавать отдельный интерактивный слой');
assert.match(styles, /\.date-strip button \{ position:relative; z-index:1;[\s\S]*pointer-events:auto;/, 'кнопки дат должны находиться выше декоративного фона');
assert.match(styles, /\.date-strip button>\* \{ pointer-events:none; \}/, 'внутренние подписи не должны перехватывать нажатие кнопки');

console.log('Provider gestures tests passed');
