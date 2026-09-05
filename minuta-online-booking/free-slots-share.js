(function () {
  'use strict';

  const MAX_RANGE_DAYS = 31;
  const TRACKING_PRESETS = Object.freeze({
    master:{ source:'master', medium:'link' }, telegram:{ source:'telegram', medium:'messenger' },
    whatsapp:{ source:'whatsapp', medium:'messenger' }, vk:{ source:'vk', medium:'social' }, qr:{ source:'qr', medium:'offline' }
  });
  const QR_BLOCKS_L = Object.freeze({
    1:[[1, 26, 19]], 2:[[1, 44, 34]], 3:[[1, 70, 55]], 4:[[1, 100, 80]], 5:[[1, 134, 108]],
    6:[[2, 86, 68]], 7:[[2, 98, 78]], 8:[[2, 121, 97]], 9:[[2, 146, 116]], 10:[[2, 86, 68], [2, 87, 69]]
  });
  const QR_ALIGNMENT = Object.freeze({
    1:[], 2:[6, 18], 3:[6, 22], 4:[6, 26], 5:[6, 30], 6:[6, 34],
    7:[6, 22, 38], 8:[6, 24, 42], 9:[6, 26, 46], 10:[6, 28, 50]
  });

  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isoDate(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function addDays(value, count) {
    const date = parseDate(value);
    if (!date) return '';
    date.setDate(date.getDate() + count);
    return isoDate(date);
  }

  function dateSpan(from, to) {
    const start = parseDate(from);
    const finish = parseDate(to);
    if (!start || !finish || finish < start) return [];
    const result = [];
    for (const date = new Date(start); date <= finish && result.length < MAX_RANGE_DAYS; date.setDate(date.getDate() + 1)) result.push(isoDate(date));
    return result;
  }

  function formatDate(value) {
    return parseDate(value)?.toLocaleDateString('ru-RU', { weekday:'short', day:'numeric', month:'long' }).replace('.', '') || value;
  }

  function slotTime(value) {
    const match = /^(\d{2}):(\d{2})/.exec(String(value || ''));
    return match ? `${match[1]}:${match[2]}` : '';
  }

  function publicationClock(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone:'Europe/Samara', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
    }).formatToParts(new Date(now));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const minutes = Number(values.hour) * 60 + Number(values.minute) + Number(values.second) / 60;
    return { today:`${values.year}-${values.month}-${values.day}`, cutoff:Math.ceil(minutes / 60) * 60 };
  }

  function timeMinutes(value) {
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ''));
    if (!match || Number(match[1]) > 24 || Number(match[2]) > 59 || Number(match[3] || 0) > 59
      || (Number(match[1]) === 24 && Number(match[2]) > 0)) throw new Error('invalid_schedule_time');
    return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] || 0) / 60;
  }

  function minuteTime(value) {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function subtractIntervals(windows, busy) {
    if (busy.some(([start, end]) => !Number.isFinite(start) || !Number.isFinite(end) || end <= start)) throw new Error('invalid_busy_interval');
    return busy.reduce((result, [start, end]) => result.flatMap(([left, right]) => {
      if (end <= left || start >= right) return [[left, right]];
      return [[left, Math.min(right, start)], [Math.max(left, end), right]].filter(([a, b]) => b > a);
    }), windows);
  }

  // General windows describe ONE master's time, not availability of a chosen service.
  // The caller must supply fresh, complete, authenticated rows for that master only.
  function calculateFreeWindows({ from, to, schedule, daysOff, bookings, groups, policy, shifts = null, performerId, locationId, now }) {
    if (!Array.isArray(schedule) || !schedule.length) throw new Error('schedule_not_configured');
    const clock = publicationClock(now);
    const buffer = policy?.booking_buffer_enabled ? Number(policy.booking_buffer_minutes) : 0;
    if (!Number.isFinite(buffer) || buffer < 0 || buffer > 1440) throw new Error('invalid_booking_buffer');
    const result = [];
    for (const date of dateSpan(from, to)) {
      if (date < clock.today) continue;
      const weekday = parseDate(date).getDay() || 7;
      const day = schedule.find(row => Number(row.weekday) === weekday);
      if (!day?.enabled) continue;
      let windows = [[timeMinutes(day.start_time), timeMinutes(day.end_time)]];
      if (windows[0][1] <= windows[0][0]) throw new Error('invalid_working_hours');
      const breakOf = row => row.break_start || row.break_end
        ? [[timeMinutes(row.break_start), timeMinutes(row.break_end)]] : [];
      windows = subtractIntervals(windows, breakOf(day));
      if (shifts?.enabled) {
        if (shifts.absences.some(row => row.active && row.performer_id === performerId && row.starts_on <= date && row.ends_on >= date)) continue;
        windows = windows.flatMap(([left, right]) => shifts.shifts
          .filter(row => row.active && row.performer_id === performerId && row.location_id === locationId && row.shift_date === date)
          .flatMap(row => subtractIntervals([[Math.max(left, timeMinutes(row.start_time)), Math.min(right, timeMinutes(row.end_time))]], breakOf(row)))
          .filter(([left, right]) => right > left));
      }
      const off = daysOff.filter(row => row.off_date === date);
      if (off.some(row => row.all_day)) continue;
      const busy = off.map(row => [timeMinutes(row.start_time), timeMinutes(row.end_time)]);
      for (const row of [...bookings.filter(row => row.status !== 'cancelled'), ...groups.filter(row => ['published', 'closed'].includes(row.status))]) {
        const rowDate = row.booking_date || row.event_date;
        const offset = (Date.parse(`${rowDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000 * 1440;
        const start = offset + timeMinutes(row.booking_time || row.start_time);
        const duration = Number(row.duration_minutes);
        if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(offset)) throw new Error('invalid_busy_interval');
        // v101 applies booking buffers on the booking date, not to calendar blocks or group events.
        const padding = row.booking_date === date && String(row.client_phone || '').replace(/\D/g, '') !== '0000000000' ? buffer : 0;
        busy.push([start - padding, start + duration + padding]);
      }
      windows = subtractIntervals(windows, busy);
      const unique = new Set();
      for (const [left, right] of windows.sort((a, b) => a[0] - b[0] || b[1] - a[1])) {
        const start = Math.max(Math.ceil(left), date === clock.today ? clock.cutoff : 0);
        const end = Math.min(1440, Math.floor(right));
        const key = `${start}|${end}`;
        if (end <= start || unique.has(key)) continue;
        unique.add(key);
        result.push({ booking_date:date, start_time:minuteTime(start), end_time:minuteTime(end), duration_minutes:end - start });
      }
    }
    return result;
  }

  function durationLabel(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const unit = hours % 100 >= 11 && hours % 100 <= 14 ? 'часов' : hours % 10 === 1 ? 'час' : hours % 10 >= 2 && hours % 10 <= 4 ? 'часа' : 'часов';
    return [hours ? `${hours} ${unit}` : '', rest ? `${rest} мин` : ''].filter(Boolean).join(' ');
  }

  function buildGeneralPublication(from, to, data, windows) {
    const dates = dateSpan(from, to);
    const hourly = data.timeFormat === 'hourly';
    const rows = dates.map(date => {
      const dayWindows = windows.filter(row => row.booking_date === date);
      const times = [...new Set(dayWindows.flatMap(item => {
        const starts = [];
        // General mode has no service duration: advertise complete free HOURS,
        // not an unchecked promise that any procedure fits at these starts.
        for (let start = Math.ceil(timeMinutes(item.start_time) / 60) * 60; start + 60 <= timeMinutes(item.end_time); start += 60) starts.push(minuteTime(start));
        return starts;
      }))].sort();
      return { date, windows:dayWindows, times };
    }).filter(row => hourly ? row.times.length : row.windows.length);
    const heading = dates.length === 1 ? `Свободные окна на ${formatDate(from)}:` : 'Свободные окна для записи:';
    const target = data.locationLabel || '';
    const body = rows.length ? rows.map(row => `${dates.length > 1 ? `${formatDate(row.date)}:\n` : ''}${hourly ? row.times.join(', ') : row.windows.map(item => `${item.start_time}–${item.end_time} · ${durationLabel(item.duration_minutes)}`).join('\n')}`).join('\n\n')
      : hourly ? 'На выбранный период целых свободных часов нет. Более короткие окна смотрите по ссылке.' : 'На выбранный период свободных окон пока нет.';
    return `${heading}${target ? `\n${target}` : ''}\n${body}\n\n${rows.length ? 'Выберите услугу и запишитесь по ссылке. Доступность проверим при выборе услуги.' : 'Посмотрите другие даты онлайн:'}\n${data.bookingUrl}`;
  }

  // Select real server-confirmed starts, never manufacture hours from working hours.
  // Keep the first available start in each hour (HH:00 when allowed),
  // plus the beginning of a separate non-hour opening.
  function defaultPublicationTimes(times) {
    const sorted = [...new Set(times)].sort();
    const minutes = sorted.map(time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)));
    const gaps = minutes.slice(1).map((value, index) => value - minutes[index]).filter(value => value > 0);
    const step = gaps.length ? Math.min(...gaps) : 60;
    return sorted.filter((time, index) => index === 0
      || Math.floor(minutes[index] / 60) !== Math.floor(minutes[index - 1] / 60)
      || minutes[index] - minutes[index - 1] > step);
  }

  function buildPublication(from, to, data, slots) {
    const dates = dateSpan(from, to);
    const grouped = new Map(dates.map(date => [date, []]));
    for (const slot of slots || []) {
      const date = String(slot?.booking_date || '');
      const time = slotTime(slot?.booking_time);
      if (grouped.has(date) && time && !grouped.get(date).includes(time)) grouped.get(date).push(time);
    }
    const rows = dates.map(date => ({ date, times:grouped.get(date).sort() })).filter(row => row.times.length);
    const target = [data.serviceLabel, data.locationLabel].filter(Boolean).join(' · ');
    const heading = dates.length === 1 ? `Свободное время на ${formatDate(dates[0])}:` : 'Свободное время для записи:';
    const body = rows.length
      ? rows.map(row => {
          const times = row.times;
          return `${dates.length === 1 ? 'Начало сеанса: ' : `${formatDate(row.date)} — `}${times.join(', ')}`;
        }).join('\n')
      : 'На выбранный период свободных окон пока нет.';
    const invitation = rows.length ? 'Выбрать время и записаться:' : 'Посмотрите другие даты онлайн:';
    return `${heading}${target ? `\n${target}` : ''}\n${body}\n\n${invitation}\n${data.bookingUrl}`;
  }

  function trackedBookingUrl(value, sourceKey) {
    const preset = TRACKING_PRESETS[sourceKey] || TRACKING_PRESETS.master;
    const url = new URL(value, window.location.href);
    url.searchParams.set('utm_source', preset.source);
    url.searchParams.set('utm_medium', preset.medium);
    url.searchParams.set('utm_campaign', 'free_slots');
    return url.href;
  }

  function appendBits(target, value, length) {
    for (let index = length - 1; index >= 0; index -= 1) target.push((value >>> index) & 1);
  }

  function qrVersion(byteLength) {
    for (let version = 1; version <= 10; version += 1) {
      const dataWords = QR_BLOCKS_L[version].reduce((sum, [count,, data]) => sum + (count * data), 0);
      const countBits = version < 10 ? 8 : 16;
      if (4 + countBits + (byteLength * 8) <= dataWords * 8) return version;
    }
    throw new Error('qr_data_too_long');
  }

  function gfTables() {
    const exp = new Array(512);
    const log = new Array(256).fill(0);
    let value = 1;
    for (let index = 0; index < 255; index += 1) {
      exp[index] = value;
      log[value] = index;
      value <<= 1;
      if (value & 0x100) value ^= 0x11d;
    }
    for (let index = 255; index < 512; index += 1) exp[index] = exp[index - 255];
    return { exp, log };
  }

  const GF = gfTables();
  function gfMultiply(left, right) { return left && right ? GF.exp[GF.log[left] + GF.log[right]] : 0; }

  function reedSolomon(data, degree) {
    let divisor = [1];
    for (let index = 0; index < degree; index += 1) {
      const next = new Array(divisor.length + 1).fill(0);
      divisor.forEach((coefficient, position) => {
        next[position] ^= coefficient;
        next[position + 1] ^= gfMultiply(coefficient, GF.exp[index]);
      });
      divisor = next;
    }
    const remainder = new Array(degree).fill(0);
    for (const byte of data) {
      const factor = byte ^ remainder.shift();
      remainder.push(0);
      for (let index = 0; index < degree; index += 1) remainder[index] ^= gfMultiply(divisor[index + 1], factor);
    }
    return remainder;
  }

  function qrCodewords(text, version) {
    const bytes = [...new TextEncoder().encode(text)];
    const blocks = QR_BLOCKS_L[version];
    const dataWordCount = blocks.reduce((sum, [count,, data]) => sum + (count * data), 0);
    const bits = [];
    appendBits(bits, 4, 4);
    appendBits(bits, bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(byte => appendBits(bits, byte, 8));
    appendBits(bits, 0, Math.min(4, (dataWordCount * 8) - bits.length));
    while (bits.length % 8) bits.push(0);
    const words = [];
    for (let index = 0; index < bits.length; index += 8) words.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
    for (let pad = 0; words.length < dataWordCount; pad += 1) words.push(pad % 2 ? 0x11 : 0xec);

    const dataBlocks = [];
    const errorBlocks = [];
    let offset = 0;
    blocks.forEach(([count, total, data]) => {
      for (let block = 0; block < count; block += 1) {
        const chunk = words.slice(offset, offset + data);
        dataBlocks.push(chunk);
        errorBlocks.push(reedSolomon(chunk, total - data));
        offset += data;
      }
    });
    const result = [];
    const maxData = Math.max(...dataBlocks.map(block => block.length));
    const maxError = Math.max(...errorBlocks.map(block => block.length));
    for (let index = 0; index < maxData; index += 1) dataBlocks.forEach(block => { if (index < block.length) result.push(block[index]); });
    for (let index = 0; index < maxError; index += 1) errorBlocks.forEach(block => { if (index < block.length) result.push(block[index]); });
    return result;
  }

  function qrMatrix(text) {
    const bytes = new TextEncoder().encode(text);
    const version = qrVersion(bytes.length);
    const size = 17 + (4 * version);
    const modules = Array.from({ length:size }, () => new Array(size).fill(false));
    const functions = Array.from({ length:size }, () => new Array(size).fill(false));
    const setFunction = (x, y, value) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = Boolean(value);
      functions[y][x] = true;
    };
    const finder = (centerX, centerY) => {
      for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    for (let index = 0; index < size; index += 1) {
      if (!functions[6][index]) setFunction(index, 6, index % 2 === 0);
      if (!functions[index][6]) setFunction(6, index, index % 2 === 0);
    }
    for (const y of QR_ALIGNMENT[version]) for (const x of QR_ALIGNMENT[version]) {
      if (functions[y][x]) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    const formatData = 8;
    let formatRemainder = formatData << 10;
    for (let bit = 14; bit >= 10; bit -= 1) if ((formatRemainder >>> bit) & 1) formatRemainder ^= 0x537 << (bit - 10);
    const formatBits = ((formatData << 10) | formatRemainder) ^ 0x5412;
    const formatBit = index => ((formatBits >>> index) & 1) !== 0;
    for (let index = 0; index <= 5; index += 1) setFunction(8, index, formatBit(index));
    setFunction(8, 7, formatBit(6)); setFunction(8, 8, formatBit(7)); setFunction(7, 8, formatBit(8));
    for (let index = 9; index < 15; index += 1) setFunction(14 - index, 8, formatBit(index));
    for (let index = 0; index < 8; index += 1) setFunction(size - 1 - index, 8, formatBit(index));
    for (let index = 8; index < 15; index += 1) setFunction(8, size - 15 + index, formatBit(index));
    setFunction(8, size - 8, true);

    if (version >= 7) {
      let remainder = version << 12;
      for (let bit = 17; bit >= 12; bit -= 1) if ((remainder >>> bit) & 1) remainder ^= 0x1f25 << (bit - 12);
      const versionBits = (version << 12) | remainder;
      for (let index = 0; index < 18; index += 1) {
        const value = ((versionBits >>> index) & 1) !== 0;
        const left = size - 11 + (index % 3);
        const top = Math.floor(index / 3);
        setFunction(left, top, value); setFunction(top, left, value);
      }
    }

    const codewords = qrCodewords(text, version);
    const dataBits = [];
    codewords.forEach(word => appendBits(dataBits, word, 8));
    let bitIndex = 0;
    for (let right = size - 1, upward = true; right >= 1; right -= 2, upward = !upward) {
      if (right === 6) right -= 1;
      for (let vertical = 0; vertical < size; vertical += 1) {
        const y = upward ? size - 1 - vertical : vertical;
        for (let offset = 0; offset < 2; offset += 1) {
          const x = right - offset;
          if (functions[y][x]) continue;
          const value = bitIndex < dataBits.length ? Boolean(dataBits[bitIndex]) : false;
          modules[y][x] = value !== ((x + y) % 2 === 0);
          bitIndex += 1;
        }
      }
    }
    return modules;
  }

  function drawQr(canvas, text) {
    const code = window.qrcodegen?.QrCode;
    const qr = code ? code.encodeText(text, code.Ecc.LOW) : null;
    const matrix = qr ? Array.from({ length:qr.size }, (_, y) => Array.from({ length:qr.size }, (_, x) => qr.getModule(x, y))) : qrMatrix(text);
    const quiet = 4;
    const scale = 6;
    canvas.width = (matrix.length + (quiet * 2)) * scale;
    canvas.height = canvas.width;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#10291d';
    matrix.forEach((row, y) => row.forEach((value, x) => { if (value) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale); }));
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {}
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    input.remove();
    return copied;
  }

  function createController({ root, getData, loadContext, loadSlots, loadWindows, notify }) {
    if (!root) return { open() {}, refresh() {} };
    const dialog = root;
    const modeControls = [...dialog.querySelectorAll('[name="freeSlotsPeriod"]')];
    const bookingModeControls = [...dialog.querySelectorAll('[name="freeSlotsBookingMode"]')];
    const formatControls = [...dialog.querySelectorAll('[name="freeSlotsTimeFormat"]')];
    const formatSettings = dialog.querySelector('#freeSlotsFormatSettings');
    const formatHint = dialog.querySelector('#freeSlotsFormatHint');
    const serviceSelect = dialog.querySelector('#freeSlotsService');
    const locationField = dialog.querySelector('#freeSlotsLocationField');
    const locationSelect = dialog.querySelector('#freeSlotsLocation');
    const fromInput = dialog.querySelector('#freeSlotsFrom');
    const toField = dialog.querySelector('#freeSlotsToField');
    const toInput = dialog.querySelector('#freeSlotsTo');
    const textArea = dialog.querySelector('#freeSlotsText');
    const qrCanvas = dialog.querySelector('#freeSlotsQr');
    const bookingLink = dialog.querySelector('#freeSlotsBookingLink');
    const status = dialog.querySelector('#freeSlotsShareStatus');
    const sourceControls = [...dialog.querySelectorAll('[name="freeSlotsSource"]')];
    const copyButton = dialog.querySelector('#copyFreeSlots');
    const shareButton = dialog.querySelector('#shareFreeSlots');
    const copyLinkButton = dialog.querySelector('#copyFreeSlotsLink');
    const downloadQrButton = dialog.querySelector('#downloadFreeSlotsQr');
    const qrWrap = dialog.querySelector('.free-slots-qr-wrap');
    const fromLabel = dialog.querySelector('#freeSlotsFromLabel');
    const showServiceControl = dialog.querySelector('#freeSlotsShowService');
    const timeChoices = dialog.querySelector('#freeSlotsTimeChoices');
    const selectionSummary = dialog.querySelector('#freeSlotsSelectionSummary');
    const clearSelectionButton = dialog.querySelector('#freeSlotsClearSelection');
    const autoSelectionButton = dialog.querySelector('#freeSlotsAutoSelection');
    let serverContext = null;
    let serverSlots = [];
    let requestRevision = 0;
    let publicationReady = false;
    let publicationText = '';
    let selectionContext = '';
    let selectedTimes = new Set();
    let manualSelection = false;
    let checkingPublication = false;
    let confirmedPublication = null;
    let clockKey = '';
    const formatPreferences = new Map();

    function timeFormat() { return formatControls.find(control => control.checked)?.value === 'hourly' ? 'hourly' : 'intervals'; }
    function preferenceKey() { return `minuta:free-slots-format:${getData().userId || 'local'}`; }
    function restoreFormat() {
      const key = preferenceKey();
      let saved = formatPreferences.get(key);
      try { if (!saved) saved = window.localStorage.getItem(key); } catch {}
      const format = saved === 'hourly' ? 'hourly' : 'intervals';
      formatControls.forEach(control => { control.checked = control.value === format; });
    }
    function configureFormat() {
      if (!formatSettings) return;
      formatSettings.hidden = !generalMode();
    }

    function generalMode() { return bookingModeControls.find(control => control.checked)?.value === 'general'; }
    function currentClock() { return publicationClock(getData().now); }
    function configureMode() {
      const general = generalMode();
      dialog.dataset.bookingMode = general ? 'general' : 'service';
      serviceSelect.closest('label').hidden = general;
      showServiceControl.closest('label').hidden = general;
      timeChoices.closest('details').hidden = general;
      configureFormat();
      dialog.querySelector('.free-slots-help').textContent = general
        ? 'Ваше свободное время без привязки к услуге: рабочие часы за вычетом записей, перерывов и выходных. Клиент выберет услугу по ссылке; её длительность и условия записи проверятся отдельно.'
        : 'Свободные начала сеанса по часам с учётом длительности выбранной услуги. Сегодня — не раньше ближайшего целого часа: в 15:32 начнём с 16:00.';
    }

    function currentRows(rows) {
      const clock = currentClock();
      clockKey = `${clock.today}|${clock.cutoff}`;
      return rows.filter(row => row.booking_date >= clock.today).flatMap(row => {
        if (row.booking_date !== clock.today) return [row];
        if (!generalMode()) return timeMinutes(row.booking_time) >= clock.cutoff ? [row] : [];
        const start = Math.max(timeMinutes(row.start_time), clock.cutoff);
        const end = timeMinutes(row.end_time);
        return end > start ? [{ ...row, start_time:minuteTime(start), duration_minutes:end - start }] : [];
      });
    }

    function timeKey(slot) { return `${slot.booking_date}T${slotTime(slot.booking_time)}`; }

    function renderTimeChoices(contextKey) {
      const groups = new Map();
      const { from, to } = currentRange();
      const allowedDates = new Set(dateSpan(from, to));
      for (const slot of serverSlots) {
        const date = String(slot.booking_date || '');
        const time = slotTime(slot.booking_time);
        if (!allowedDates.has(date) || !time) continue;
        if (!groups.has(date)) groups.set(date, new Set());
        groups.get(date).add(time);
      }
      const rows = [...groups].sort(([left], [right]) => left.localeCompare(right))
        .map(([date, times]) => ({ date, times:[...times].sort() }));
      const availableKeys = new Set(rows.flatMap(row => row.times.map(time => `${row.date}T${time}`)));
      if (selectionContext !== contextKey) manualSelection = false;
      if (!manualSelection) {
        selectedTimes = new Set();
        for (const row of rows) {
          const times = defaultPublicationTimes(row.times);
          times.forEach(time => selectedTimes.add(`${row.date}T${time}`));
        }
      } else selectedTimes = new Set([...selectedTimes].filter(key => availableKeys.has(key)));
      selectionContext = contextKey;
      timeChoices.replaceChildren();
      for (const row of rows) {
        const section = document.createElement('section');
        const heading = document.createElement('h4'); heading.textContent = formatDate(row.date);
        const grid = document.createElement('div'); grid.className = 'free-slots-time-grid';
        for (const time of row.times) {
          const label = document.createElement('label');
          const input = document.createElement('input'); input.type = 'checkbox';
          input.value = `${row.date}T${time}`; input.checked = selectedTimes.has(input.value);
          input.setAttribute('aria-label', `${formatDate(row.date)}, начало в ${time}`);
          const caption = document.createElement('span'); caption.textContent = time;
          label.append(input, caption); grid.append(label);
        }
        section.append(heading, grid); timeChoices.append(section);
      }
      if (!rows.length) timeChoices.textContent = 'На выбранные даты свободного времени нет.';
      clearSelectionButton.disabled = !rows.length;
      if (autoSelectionButton) autoSelectionButton.disabled = !rows.length;
    }

    function rangeMode() { return modeControls.find(control => control.checked)?.value === 'range'; }

    function replaceOptions(select, items, value, label) {
      select.replaceChildren(...items.map(item => {
        const option = document.createElement('option');
        option.value = String(item.id || '');
        option.textContent = label(item);
        return option;
      }));
      if (items.some(item => String(item.id) === String(value))) select.value = String(value);
      else select.value = String(items[0]?.id || '');
    }

    function selectedLocation() {
      return (serverContext?.locations || []).find(item => String(item.id) === locationSelect.value) || null;
    }

    function eligibleServices() {
      const services = serverContext?.services || [];
      if (serverContext?.mode !== 'organization' || !serverContext.resourceScheduling || !locationSelect.value) return services;
      return services.filter(item => Array.isArray(item.location_ids) && item.location_ids.includes(locationSelect.value));
    }

    function configureTargets(preferredService = serviceSelect.value, preferredLocation = locationSelect.value) {
      const locations = serverContext?.mode === 'organization' ? (serverContext.locations || []) : [];
      replaceOptions(locationSelect, locations, preferredLocation || locations.find(item => item.is_primary)?.id, item => {
        const address = item.address ? ` · ${item.address}` : '';
        return `${item.name || 'Место приёма'}${address}`;
      });
      locationField.hidden = locations.length <= 1;
      dialog.dataset.singleLocation = String(locations.length <= 1);
      const services = eligibleServices();
      replaceOptions(serviceSelect, services, preferredService, item => {
        const performer = item.performer_profiles?.display_name;
        const duration = Number(item.duration_minutes || 0) > 0 ? ` · ${Number(item.duration_minutes)} мин` : '';
        return `${item.name || 'Услуга'}${performer ? ` · ${performer}` : ''}${duration}`;
      });
      return services;
    }

    function currentRange() {
      const data = getData();
      const from = fromInput.value || data.today;
      const to = rangeMode() ? (toInput.value || from) : from;
      toField.hidden = !rangeMode();
      if (fromLabel) fromLabel.textContent = rangeMode() ? 'С даты' : 'Дата';
      dialog.dataset.dateRange = String(rangeMode());
      toInput.min = from;
      toInput.max = addDays(from, MAX_RANGE_DAYS - 1);
      if (!parseDate(toInput.value) || toInput.value < from) toInput.value = from;
      if (toInput.value > toInput.max) toInput.value = toInput.max;
      return { data, from, to:rangeMode() ? toInput.value : from };
    }

    function publicationModel() {
      const { data, from, to } = currentRange();
      const service = eligibleServices().find(item => String(item.id) === serviceSelect.value) || null;
      const location = selectedLocation();
      const sourceKey = sourceControls.find(control => control.checked)?.value || 'master';
      const targetUrl = new URL(data.bookingUrl, window.location.href);
      // A catalog link must never carry an old service/time preselection.
      for (const key of ['service', 'date', 'time', 'repeat']) targetUrl.searchParams.delete(key);
      if (!generalMode() && service?.id) targetUrl.searchParams.set('service', service.id);
      if (serverContext?.mode === 'organization' && location?.id) targetUrl.searchParams.set('location', location.id);
      const trackingUrl = trackedBookingUrl(targetUrl.href, sourceKey);
      return {
        from, to, service, location, trackingUrl,
        publicationData:{
          ...data,
          timeFormat:timeFormat(),
          bookingUrl:trackingUrl,
          selectedOnly:true,
          serviceLabel:service && showServiceControl.checked ? (service.name || 'Услуга') : '',
          locationLabel:[
            (serverContext?.locations || []).length > 1 && !/^(?:(?:основной|главный|единственный)\s+)?филиал$/i.test(location?.name || '') ? location?.name : '',
            location?.address
          ].filter(Boolean).join(' · ')
        }
      };
    }

    function renderPublication() {
      if (!publicationReady) return;
      const model = publicationModel();
      const chosenSlots = generalMode() ? serverSlots : serverSlots.filter(slot => selectedTimes.has(timeKey(slot)));
      publicationText = (generalMode() ? buildGeneralPublication : buildPublication)(model.from, model.to, model.publicationData, chosenSlots);
      const hasSelection = chosenSlots.length > 0;
      selectionSummary.textContent = `${manualSelection ? 'Выбрано вручную' : 'Свободные начала сеанса'} · ${selectedTimes.size}`;
      const trackingUrl = model.trackingUrl;
      textArea.value = !hasSelection && serverSlots.length
        ? 'Отметьте время, которое хотите включить в публикацию.'
        : publicationText.slice(0, -trackingUrl.length) + 'Ссылка на онлайн-запись';
      bookingLink.href = trackingUrl;
      bookingLink.textContent = 'Открыть страницу записи';
      const showQr = sourceControls.some(control => control.checked && control.value === 'qr');
      qrWrap.hidden = !showQr;
      qrCanvas.hidden = true;
      downloadQrButton.hidden = true;
      dialog.querySelector('#freeSlotsQrError').hidden = true;
      if (showQr) {
        try {
          drawQr(qrCanvas, trackingUrl);
          qrCanvas.hidden = false;
          downloadQrButton.hidden = false;
        } catch {
          dialog.querySelector('#freeSlotsQrError').hidden = false;
        }
      }
      status.textContent = '';
      copyButton.disabled = !hasSelection && serverSlots.length > 0;
      shareButton.disabled = copyButton.disabled;
      copyLinkButton.disabled = false;
    }

    function showUnavailable(message) {
      publicationReady = false;
      publicationText = '';
      serverSlots = [];
      textArea.value = 'Свободное время не опубликовано: сервер не подтвердил доступные слоты.';
      bookingLink.removeAttribute('href');
      bookingLink.textContent = '';
      qrCanvas.hidden = true;
      qrWrap.hidden = true;
      downloadQrButton.hidden = true;
      dialog.querySelector('#freeSlotsQrError').hidden = true;
      status.textContent = message;
      copyButton.disabled = true;
      shareButton.disabled = true;
      copyLinkButton.disabled = true;
      clearSelectionButton.disabled = true;
      if (autoSelectionButton) autoSelectionButton.disabled = true;
      timeChoices.replaceChildren();
      selectionSummary.textContent = 'Время пока недоступно';
      dialog.removeAttribute('aria-busy');
    }

    async function refreshFromServer({ reloadContext = false } = {}) {
      const revision = ++requestRevision;
      configureMode();
      publicationReady = false;
      copyButton.disabled = true;
      shareButton.disabled = true;
      copyLinkButton.disabled = true;
      bookingLink.removeAttribute('href');
      qrWrap.hidden = true;
      clearSelectionButton.disabled = true;
      if (autoSelectionButton) autoSelectionButton.disabled = true;
      timeChoices.querySelectorAll('input').forEach(input => { input.disabled = true; });
      status.textContent = 'Проверяем свободное время на сервере…';
      textArea.value = 'Проверяем свободное время…';
      dialog.setAttribute('aria-busy', 'true');
      try {
        const { from, to } = currentRange();
        const preferredService = serviceSelect.value;
        const preferredLocation = locationSelect.value;
        if (reloadContext || !serverContext) {
          const freshContext = await loadContext();
          if (revision !== requestRevision || !dialog.open) return;
          serverContext = freshContext;
        }
        if (revision !== requestRevision || !dialog.open) return;
        const services = configureTargets(preferredService, preferredLocation);
        if (!services.length) {
          showUnavailable(serverContext?.mode === 'organization' && locationSelect.value
            ? 'В выбранном месте приёма нет доступных услуг.'
            : 'Нет активных услуг для публикации.');
          return;
        }
        if (serverContext?.mode === 'organization' && !(serverContext.locations || []).length) {
          showUnavailable('Для онлайн-записи не настроено место приёма.');
          return;
        }
        const result = await (generalMode() ? loadWindows : loadSlots)({
          context:serverContext,
          serviceId:serviceSelect.value,
          locationId:locationSelect.value || null,
          from,
          to
        });
        if (revision !== requestRevision || !dialog.open) return;
        if (result?.error) throw result.error;
        if (!Array.isArray(result?.data)) throw new Error('invalid_availability_response');
        serverSlots = currentRows(result.data);
        if (!generalMode()) renderTimeChoices(`${serviceSelect.value}|${locationSelect.value}|${from}|${to}`);
        publicationReady = true;
        dialog.removeAttribute('aria-busy');
        renderPublication();
        return true;
      } catch (error) {
        if (revision !== requestRevision || !dialog.open) return;
        showUnavailable(error?.message === 'own_services_unavailable'
          ? 'Для общей записи нужны ваши активные услуги в этом месте приёма. Для другого сотрудника выберите «Конкретная услуга».'
          : error?.message === 'schedule_not_configured' ? 'Сначала сохраните рабочий график в расписании.' : navigator.onLine
          ? 'Не удалось проверить свободное время. Повторите попытку позже.'
          : 'Нет соединения. Для публикации нужна свежая проверка сервера.');
      }
    }

    function hasFreshConfirmation() {
      const clock = currentClock();
      return confirmedPublication && publicationReady && dialog.open
        && clockKey === `${clock.today}|${clock.cutoff}`
        && confirmedPublication.revision === requestRevision
        && confirmedPublication.text === publicationText
        && Date.now() - confirmedPublication.at < 5000;
    }

    async function confirmFreshPublication(actionLabel) {
      if (checkingPublication || !publicationReady || !dialog.open) return false;
      checkingPublication = true;
      confirmedPublication = null;
      const previousSelection = [...selectedTimes];
      const previousText = publicationText;
      const expectedRevision = requestRevision + 1;
      try {
        const refreshed = await refreshFromServer({ reloadContext:true });
        if (refreshed !== true || requestRevision !== expectedRevision || !dialog.open || !publicationReady) return false;
        const removed = previousSelection.filter(key => !selectedTimes.has(key));
        if (generalMode() ? previousText !== publicationText : removed.length) {
          status.textContent = 'Часть выбранного времени уже недоступна и убрана из текста. Проверьте публикацию и нажмите кнопку ещё раз.';
          notify('Свободное время изменилось. Текст обновлён.');
          return false;
        }
        if (copyButton.disabled) return false;
        // Native share/clipboard can require a new trusted tap after a network wait.
        // Keep that confirmation short-lived and tied to the exact checked text.
        if (navigator.userActivation?.isActive !== true) {
          confirmedPublication = { revision:requestRevision, text:publicationText, at:Date.now() };
          status.textContent = `Время проверено. Нажмите «${actionLabel}» ещё раз для продолжения.`;
          return false;
        }
        return true;
      } finally {
        checkingPublication = false;
      }
    }

    async function open() {
      selectionContext = '';
      manualSelection = false;
      const data = getData();
      restoreFormat();
      fromInput.min = data.today;
      fromInput.value = data.selectedDate >= data.today ? data.selectedDate : data.today;
      toInput.value = addDays(fromInput.value, 6);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      await refreshFromServer({ reloadContext:true });
    }

    const close = () => {
      requestRevision += 1;
      confirmedPublication = null;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
    dialog.querySelectorAll('[data-close-free-slots]').forEach(button => button.addEventListener('click', close));
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    modeControls.forEach(control => control.addEventListener('change', () => { void refreshFromServer(); }));
    bookingModeControls.forEach(control => control.addEventListener('change', () => {
      confirmedPublication = null;
      selectionContext = '';
      selectedTimes.clear();
      void refreshFromServer({ reloadContext:true });
    }));
    sourceControls.forEach(control => control.addEventListener('change', renderPublication));
    formatControls.forEach(control => control.addEventListener('change', () => {
      confirmedPublication = null;
      const key = preferenceKey();
      formatPreferences.set(key, timeFormat());
      try {
        window.localStorage.setItem(key, timeFormat());
        formatHint.hidden = true;
        formatHint.textContent = '';
      } catch {
        formatHint.hidden = false;
        formatHint.textContent = 'Браузер не разрешил сохранение. Выбор действует до перезагрузки страницы.';
      }
      configureFormat();
      renderPublication();
    }));
    showServiceControl.addEventListener('change', renderPublication);
    timeChoices.addEventListener('change', event => {
      if (!publicationReady || event.target.type !== 'checkbox') return;
      manualSelection = true;
      if (event.target.checked) selectedTimes.add(event.target.value);
      else selectedTimes.delete(event.target.value);
      renderPublication();
    });
    clearSelectionButton.addEventListener('click', () => {
      if (!publicationReady) return;
      manualSelection = true;
      selectedTimes.clear();
      timeChoices.querySelectorAll('input').forEach(input => { input.checked = false; });
      renderPublication();
    });
    autoSelectionButton?.addEventListener('click', () => {
      manualSelection = false;
      void refreshFromServer({ reloadContext:true });
    });
    fromInput.addEventListener('change', () => { void refreshFromServer(); });
    toInput.addEventListener('change', () => { void refreshFromServer(); });
    serviceSelect.addEventListener('change', () => { void refreshFromServer(); });
    locationSelect.addEventListener('change', () => {
      configureTargets('', locationSelect.value);
      void refreshFromServer();
    });
    copyButton.addEventListener('click', async () => {
      if (!publicationReady || copyButton.disabled) return;
      if (!hasFreshConfirmation() && !(await confirmFreshPublication('Скопировать текст'))) return;
      confirmedPublication = null;
      const copied = await copyText(publicationText);
      status.textContent = copied ? 'Текст скопирован.' : 'Не удалось скопировать автоматически. Выделите текст вручную.';
      notify(copied ? 'Свободные окна скопированы' : 'Выделите и скопируйте текст вручную');
    });
    shareButton.addEventListener('click', async () => {
      if (!publicationReady || shareButton.disabled) return;
      if (!hasFreshConfirmation() && !(await confirmFreshPublication('Поделиться'))) return;
      confirmedPublication = null;
      if (navigator.share) {
        try {
          await navigator.share({ title:'Свободные окна для записи', text:publicationText });
          status.textContent = 'Материал передан через системное меню.';
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      const copied = await copyText(publicationText);
      status.textContent = copied ? 'Системная отправка недоступна — текст скопирован.' : 'Системная отправка недоступна. Выделите текст вручную.';
      notify(copied ? 'Текст скопирован — вставьте его в нужное приложение' : 'Выделите и скопируйте текст вручную');
    });
    copyLinkButton.addEventListener('click', async () => {
      if (!publicationReady) return;
      const copied = await copyText(bookingLink.href);
      status.textContent = copied ? 'Ссылка скопирована.' : 'Не удалось скопировать. Откройте страницу записи и скопируйте адрес.';
    });
    downloadQrButton.addEventListener('click', () => {
      if (!publicationReady || qrCanvas.hidden || qrWrap.hidden) return;
      const link = document.createElement('a');
      link.download = 'minuta-online-booking-qr.png';
      link.href = qrCanvas.toDataURL('image/png');
      link.click();
    });
    // An open preview must not keep advertising an hour that just became past.
    window.setInterval(() => {
      if (!dialog.open || !publicationReady || checkingPublication) return;
      const clock = currentClock();
      if (`${clock.today}|${clock.cutoff}` !== clockKey) void refreshFromServer({ reloadContext:true });
    }, 1000);
    return { open, refresh:() => { if (dialog.open) void refreshFromServer({ reloadContext:true }); } };
  }

  window.MinutaFreeSlots = { createController, calculateFreeWindows };
})();
