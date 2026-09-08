const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const provider = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

function functionSource(name) {
  const start = provider.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Нет функции ${name}`);
  const next = provider.indexOf('\nfunction ', start + 10);
  return provider.slice(start, next === -1 ? provider.length : next);
}

const loadEditSlots = functionSource('loadBookingEditSlots');
const renderEditPicker = functionSource('renderBookingEditTimePicker');
const quickTimeSlots = functionSource('bookingQuickTimeSlots');
const exactTimeMarkup = functionSource('bookingExactTimeMarkup');
const updateMovePreview = functionSource('updateBookingMovePreview');
const renderTimeline = functionSource('renderTimeline');
const weekTimeline = functionSource('calendarWeekTimelineMarkup');
const nowMarker = functionSource('scheduleNowMarkerMarkup');
const updateMarkers = functionSource('updateScheduleNowMarkers');

assert.match(provider, /let bookingEditSlots = \[\];[\s\S]*let bookingEditHour = '';/,
  'Перенос не хранит отдельно список окон и выбранный час');
assert.match(loadEditSlots, /bookingEditSlots\s*=\s*times;[\s\S]*bookingEditHour\s*=/,
  'Свободные окна не передаются двухэтапному выбору');
assert.match(renderEditPicker, /new Set\(bookingEditSlots\.map\(time => time\.slice\(0, 2\)\)\)/,
  'Часы не группируются из реальных свободных окон');
assert.match(renderEditPicker, /filter\(time => time\.startsWith\(`\$\{bookingEditHour\}:`\)\)/,
  'Точные варианты не ограничены выбранным часом');
assert.match(renderEditPicker, /bookingQuickTimeSlots[\s\S]*1\. Выберите час[\s\S]*data-edit-booking-hour[\s\S]*2\. Выберите время[\s\S]*data-edit-booking-time/,
  'В интерфейсе нет ясного порядка «час → быстрый выбор времени»');
assert.match(quickTimeSlots, /Number\(time\.slice\(3, 5\)\) % 5 === 0/,
  'Минутный список не сокращён до удобного шага 5 минут');
assert.match(exactTimeMarkup, /Указать точную минуту[\s\S]*type="time"[\s\S]*step="60"/,
  'Для редкого точного времени нет компактного раскрываемого выбора');
assert.match(exactTimeMarkup, /if \(!exact\.length\) return ''/,
  'Лишний точный выбор показывается даже когда дополнительных минут нет');
assert.match(provider, /applyEditExactTime[\s\S]*bookingEditSlots\.filter[\s\S]*!input\?\.checkValidity\(\) \|\| !hourSlots\.includes\(value\)[\s\S]*bookingEditTime = value/,
  'Точный выбор переноса не проверяет валидность и доступность минуты выбранного часа');
assert.match(provider, /applyNewExactTime[\s\S]*newBookingSlots\.filter[\s\S]*!input\?\.checkValidity\(\) \|\| !hourSlots\.includes\(value\)[\s\S]*newBookingTime = value/,
  'Точный выбор новой записи не проверяет валидность и доступность минуты выбранного часа');
assert.match(provider, /if \(newTime\)[\s\S]*renderNewBookingTimePicker\(\{ offline:!navigator\.onLine, historical:newBookingHistoricalMode, outsideSchedule:newBookingOutsideSchedule \}\)/,
  'Быстрый выбор времени теряет исторический или внеплановый контекст');
const helperApi = Function(`${quickTimeSlots}\n${exactTimeMarkup}\nreturn {bookingQuickTimeSlots,bookingExactTimeMarkup};`)();
const denseHour = Array.from({length:60}, (_, minute) => `12:${String(minute).padStart(2, '0')}`);
assert.deepEqual(helperApi.bookingQuickTimeSlots(denseHour), Array.from({length:12}, (_, index) => `12:${String(index * 5).padStart(2, '0')}`),
  'Из 60 минут должны оставаться 12 быстрых вариантов');
assert.match(helperApi.bookingExactTimeMarkup('new', denseHour, '12:13'), /<details[^>]* open[\s\S]*value="12:13"/,
  'Выбранная точная минута должна оставаться видимой после перерисовки');
const offsetHour = Array.from({length:15}, (_, minute) => `12:${String(minute + 1).padStart(2, '0')}`);
const offsetQuick = helperApi.bookingQuickTimeSlots(offsetHour);
const offsetExact = helperApi.bookingExactTimeMarkup('new', offsetHour);
assert.equal(offsetQuick.length, 3, 'Смещённая сетка должна показывать только удобные пятиминутные варианты');
assert.match(offsetExact, /Ещё 12 вариантов/, 'Счётчик точных минут не исключает уже показанные быстрые варианты');
for (const time of offsetQuick) assert.doesNotMatch(offsetExact, new RegExp(`value="${time}"`), `Быстрое время ${time} продублировано в точном выборе`);
assert.match(provider, /closest\('\[data-edit-booking-hour\]'\)[\s\S]*bookingEditHour\s*=\s*editHour\.dataset\.editBookingHour[\s\S]*renderBookingEditTimePicker\([^)]*\)/,
  'Нажатие на час не перерисовывает точные варианты');
assert.match(renderEditPicker, /focusExact[\s\S]*querySelector\('\[data-edit-booking-time\]'\)\?\.focus\(\)/,
  'После смены часа клавиатурный фокус не переходит к точному времени');
assert.match(updateMovePreview, /data-edit-booking-hour[\s\S]*aria-pressed/,
  'Выбранный час не получает доступное состояние');

assert.match(provider, /timeZone:'Europe\/Samara'/,
  'Текущее время должно вычисляться в часовом поясе кабинета');
assert.match(nowMarker, /date !== businessTodayIso\(\)[\s\S]*data-schedule-now-marker[\s\S]*hidden/,
  'Маркер должен создаваться только для сегодняшней даты и скрываться вне шкалы');
assert.match(updateMarkers, /clock\.minutes >= start && clock\.minutes <= end[\s\S]*marker\.style\.top/,
  'Позиция маркера не вычисляется относительно видимого диапазона');
assert.match(renderTimeline, /scheduleNowMarkerMarkup\(selectedDate,[\s\S]*timeline-now-marker/,
  'Маркер текущего времени не встроен в дневной таймлайн');
assert.match(weekTimeline, /scheduleNowMarkerMarkup\(iso,[^)]*calendar-week-now-marker/,
  'Маркер текущего времени не встроен в сегодняшний столбец недели');
assert.match(styles, /\.timeline-now-marker[^}]*position:absolute;[^}]*pointer-events:none;/,
  'Дневная линия времени должна быть позиционной и не перехватывать нажатия');
assert.match(styles, /\.calendar-week-now-marker[^}]*position:absolute;[^}]*pointer-events:none;/,
  'Недельная линия времени должна быть позиционной и не перехватывать нажатия');
assert.match(styles, /\.calendar-week-now-marker,\.timeline-now-marker\s*\{[^}]*background:[^;}]*var\(--theme-accent/,
  'Линия текущего времени не использует акцент активной темы');

async function geometryCheck() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      console.log('Playwright geometry checks skipped: module is not available in NODE_PATH.');
      return;
    }
    throw error;
  }

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MINUTA_CHROME_PATH ? { executablePath:process.env.MINUTA_CHROME_PATH } : {})
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style>
      <style>html,body{margin:0}.test-shell{box-sizing:border-box;width:min(680px,calc(100vw - 24px));margin:12px auto}</style>
      </head><body class="provider-body" data-provider-theme="sage" data-provider-layout="soft">
      <main class="test-shell booking-editor-form booking-edit-form-compact">
        <div class="booking-editor-times booking-time-picker" id="editBookingTimes">
          <div class="booking-time-guide"><strong>1. Выберите час</strong><span>5 доступно</span></div>
          <div class="booking-time-hours">
            ${['10','11','12','13','14'].map((hour, index) => `<button type="button" class="${index === 0 ? 'active' : ''}">${hour}:00</button>`).join('')}
          </div>
          <div class="booking-time-guide"><strong>2. Выберите время</strong><span>12 быстрых вариантов · шаг 5 мин</span></div>
          <div class="booking-time-slots">
            ${Array.from({ length:12 }, (_, index) => `<button type="button">10:${String(index * 5).padStart(2, '0')}</button>`).join('')}
          </div>
          <details class="booking-exact-time" open>
            <summary><span>Указать точную минуту</span><small>Ещё 48 вариантов</small></summary>
            <div class="booking-exact-time-controls"><label><span>Часы и минуты</span><input type="time" value="10:13"></label><button type="button">Выбрать</button></div>
            <small class="booking-exact-time-hint">Показываются только свободные минуты выбранного часа.</small>
          </details>
        </div>
      </main></body></html>`);

    for (const width of [390, 760, 1440]) {
      await page.setViewportSize({ width, height:900 });
      const measurement = await page.evaluate(() => {
        const picker = document.querySelector('#editBookingTimes');
        const rect = picker.getBoundingClientRect();
        const buttons = [...picker.querySelectorAll('button')].filter(button => button.getClientRects().length);
        const guides = [...picker.querySelectorAll('.booking-time-guide')];
        const exactInput = picker.querySelector('.booking-exact-time input');
        return {
          documentOverflow:document.documentElement.scrollWidth - innerWidth,
          rect:{ left:rect.left, right:rect.right, width:rect.width, height:rect.height },
          buttonCount:buttons.length,
          exactInputHeight:exactInput.getBoundingClientRect().height,
          minButtonHeight:Math.min(...buttons.map(button => button.getBoundingClientRect().height)),
          clippedButtons:buttons.filter(button => button.scrollWidth > button.clientWidth + 1).length,
          clippedGuides:guides.filter(guide => guide.scrollWidth > guide.clientWidth + 1).length,
        };
      });
      assert.ok(measurement.documentOverflow <= 1, `${width}px: появился горизонтальный скролл`);
      assert.ok(measurement.rect.left >= 0 && measurement.rect.right <= width + 1, `${width}px: picker вышел за экран`);
      assert.equal(measurement.buttonCount, 18, `${width}px: потеряны часы, быстрые варианты или точный выбор`);
      assert.ok(measurement.minButtonHeight >= 40, `${width}px: зона нажатия меньше 40px`);
      assert.ok(measurement.exactInputHeight >= 40, `${width}px: точный ввод меньше 40px`);
      assert.equal(measurement.clippedButtons, 0, `${width}px: текст кнопок обрезан`);
      assert.equal(measurement.clippedGuides, 0, `${width}px: подписи этапов обрезаны`);
      console.log(`Picker geometry ${width}px: ${Math.round(measurement.rect.width)}x${Math.round(measurement.rect.height)} OK`);
      assert.ok(measurement.rect.height <= 600, `${width}px: раскрытый picker снова стал чрезмерно высоким`);
    }
  } finally {
    await browser.close();
  }
}

geometryCheck().then(() => {
  console.log('Reschedule hour picker and current-time markers checks passed.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
