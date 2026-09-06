import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const scheduleStyles = fs.readFileSync(new URL('./provider-schedule-minimal.css', import.meta.url), 'utf8');

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
assert.match(source, /event\.target\.closest\('#providerBookings'\)/, 'свайп расписания должен оставаться на ленте записей');
assert.doesNotMatch(source, /event\.target\.closest\('#providerBookings,#dateStrip'\)/, 'лента дат должна использовать нативную прокрутку без JS-перехвата');
assert.match(source, /classList\.toggle\('is-today', isToday\)/, 'сегодняшняя дата должна подсвечиваться независимо от выбранной');
assert.match(source, /rangeStart\.setDate\(rangeStart\.getDate\(\) - 28\)[\s\S]*rangeEnd\.setDate\(rangeEnd\.getDate\(\) \+ 62\)/, 'лента должна показывать даты дальше одной недели');
assert.match(source, /dateStrip\.addEventListener\('wheel',[\s\S]*requestAnimationFrame\(animateWheel\)[\s\S]*passive:false/, 'колесо мыши должно плавно прокручивать даты по горизонтали');
const pointerDownBlock = source.slice(
  source.indexOf("dateStrip.addEventListener('pointerdown'"),
  source.indexOf("dateStrip.addEventListener('pointermove'")
);
const pointerMoveBlock = source.slice(
  source.indexOf("dateStrip.addEventListener('pointermove'"),
  source.indexOf('const finishDrag')
);
assert.match(pointerDownBlock, /event\.pointerType !== 'mouse'/, 'мышью должно быть можно захватить ленту дат');
assert.doesNotMatch(pointerDownBlock, /setPointerCapture/, 'обычный клик по дате не должен перенаправляться на ленту');
assert.match(pointerMoveBlock, /Math\.abs\(delta\) < 4[\s\S]*setPointerCapture/, 'захват указателя должен включаться только после начала перетаскивания');
assert.match(pointerMoveBlock, /dragStartScrollLeft - delta/, 'перетаскивание мышью должно прокручивать ленту');
assert.match(source, /suppressClick = hasDragged[\s\S]*stopImmediatePropagation/, 'перетаскивание не должно случайно выбирать дату');
assert.match(scheduleStyles, /scroll-behavior:smooth/, 'программная прокрутка дат должна быть плавной');
assert.match(scheduleStyles, /cursor:grab[\s\S]*\.is-dragging[\s\S]*cursor:grabbing/, 'курсор должен подсказывать захват ленты мышью');
assert.match(source, /shiftScheduleDate\(deltaX < 0 \? 1 : -1\)/);
assert.match(source, /bookingPlacementIssue\(item, state\.date, state\.targetMinute\)/);
assert.match(source, /p_ignore_booking: item\.id/);
assert.match(source, /data-booking-duration="\$\{duration\}"/);
assert.match(styles, /\.timeline-booking\[data-open-booking\]\.is-dragging/);
assert.match(styles, /#providerBookings\.is-day-swiping/);

console.log('Provider gestures tests passed');
