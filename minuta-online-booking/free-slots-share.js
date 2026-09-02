(function () {
  'use strict';

  const MAX_RANGE_DAYS = 31;
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

  function minutes(value) {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
    return match ? (Number(match[1]) * 60) + Number(match[2]) : 0;
  }

  function clock(value) {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function samaraMinuteNow() {
    const parts = new Intl.DateTimeFormat('ru-RU', { timeZone:'Europe/Samara', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return (Number(values.hour) * 60) + Number(values.minute);
  }

  function freeIntervalsForDate(dateIso, data) {
    const date = parseDate(dateIso);
    if (!date) return [];
    const weekday = ((date.getDay() + 6) % 7) + 1;
    const schedule = (data.scheduleRows || []).find(row => Number(row.weekday) === weekday);
    if (!schedule || schedule.enabled === false) return [];
    const step = Math.max(5, Number(schedule.slot_interval_minutes || 5));
    let start = minutes(schedule.start_time || '10:00');
    const end = minutes(schedule.end_time || '20:00');
    if (dateIso === data.today) start = Math.max(start, Math.ceil(samaraMinuteNow() / step) * step);
    if (end <= start) return [];

    const busy = [];
    if (schedule.break_start && schedule.break_end) busy.push([minutes(schedule.break_start), minutes(schedule.break_end)]);
    for (const item of data.daysOff || []) {
      if (item.off_date !== dateIso) continue;
      if (item.all_day) return [];
      busy.push([minutes(item.start_time), minutes(item.end_time)]);
    }
    for (const item of data.bookings || []) {
      if (item.booking_date !== dateIso || item.status === 'cancelled') continue;
      const itemStart = minutes(item.booking_time);
      const duration = Math.max(1, Number(item.duration_minutes || item.services?.duration_minutes || 60));
      busy.push([itemStart, itemStart + duration]);
    }

    const merged = busy
      .map(([left, right]) => [Math.max(start, left), Math.min(end, right)])
      .filter(([left, right]) => right > left)
      .sort((left, right) => left[0] - right[0])
      .reduce((result, interval) => {
        const previous = result[result.length - 1];
        if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
        else result.push(interval);
        return result;
      }, []);
    const serviceDurations = (data.services || []).filter(item => item.active !== false).map(item => Number(item.duration_minutes || 0)).filter(value => value > 0);
    const minimumDuration = Math.max(step, serviceDurations.length ? Math.min(...serviceDurations) : step);
    const free = [];
    let cursor = start;
    for (const [busyStart, busyEnd] of merged) {
      if (busyStart - cursor >= minimumDuration) free.push([cursor, busyStart]);
      cursor = Math.max(cursor, busyEnd);
    }
    if (end - cursor >= minimumDuration) free.push([cursor, end]);
    return free;
  }

  function formatDate(value) {
    return parseDate(value)?.toLocaleDateString('ru-RU', { weekday:'short', day:'numeric', month:'long' }).replace('.', '') || value;
  }

  function buildPublication(from, to, data) {
    const dates = dateSpan(from, to);
    const rows = dates.map(date => ({ date, intervals:freeIntervalsForDate(date, data) })).filter(row => row.intervals.length);
    const heading = dates.length === 1 ? `Свободные окна на ${formatDate(dates[0])}:` : 'Свободные окна для записи:';
    const body = rows.length
      ? rows.map(row => `${dates.length === 1 ? '' : `${formatDate(row.date)} — `}${row.intervals.map(([start, end]) => `${clock(start)}–${clock(end)}`).join(', ')}`).join('\n')
      : 'На выбранный период свободных окон пока нет.';
    const invitation = rows.length ? 'Выберите удобное время и запишитесь онлайн:' : 'Посмотрите другие даты онлайн:';
    return `${heading}\n${body}\n\n${invitation}\n${data.bookingUrl}`;
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
    const matrix = qrMatrix(text);
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

  function createController({ root, getData, notify }) {
    if (!root) return { open() {}, refresh() {} };
    const dialog = root;
    const modeControls = [...dialog.querySelectorAll('[name="freeSlotsPeriod"]')];
    const fromInput = dialog.querySelector('#freeSlotsFrom');
    const toField = dialog.querySelector('#freeSlotsToField');
    const toInput = dialog.querySelector('#freeSlotsTo');
    const textArea = dialog.querySelector('#freeSlotsText');
    const qrCanvas = dialog.querySelector('#freeSlotsQr');
    const bookingLink = dialog.querySelector('#freeSlotsBookingLink');
    const status = dialog.querySelector('#freeSlotsShareStatus');

    function rangeMode() { return modeControls.find(control => control.checked)?.value === 'range'; }
    function render() {
      const data = getData();
      const from = fromInput.value || data.today;
      const to = rangeMode() ? (toInput.value || from) : from;
      toField.hidden = !rangeMode();
      toInput.min = from;
      toInput.max = addDays(from, MAX_RANGE_DAYS - 1);
      if (!parseDate(toInput.value) || toInput.value < from) toInput.value = from;
      if (toInput.value > toInput.max) toInput.value = toInput.max;
      textArea.value = buildPublication(from, rangeMode() ? toInput.value : from, data);
      bookingLink.href = data.bookingUrl;
      bookingLink.textContent = data.bookingUrl;
      try {
        drawQr(qrCanvas, data.bookingUrl);
        qrCanvas.hidden = false;
        dialog.querySelector('#freeSlotsQrError').hidden = true;
      } catch {
        qrCanvas.hidden = true;
        dialog.querySelector('#freeSlotsQrError').hidden = false;
      }
      status.textContent = '';
    }

    function open() {
      const data = getData();
      fromInput.min = data.today;
      fromInput.value = data.selectedDate >= data.today ? data.selectedDate : data.today;
      toInput.value = addDays(fromInput.value, 6);
      render();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }

    const close = () => typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open');
    dialog.querySelectorAll('[data-close-free-slots]').forEach(button => button.addEventListener('click', close));
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    modeControls.forEach(control => control.addEventListener('change', render));
    fromInput.addEventListener('change', render);
    toInput.addEventListener('change', render);
    dialog.querySelector('#copyFreeSlots').addEventListener('click', async () => {
      const copied = await copyText(textArea.value);
      status.textContent = copied ? 'Текст скопирован.' : 'Не удалось скопировать автоматически. Выделите текст вручную.';
      notify(copied ? 'Свободные окна скопированы' : 'Выделите и скопируйте текст вручную');
    });
    dialog.querySelector('#shareFreeSlots').addEventListener('click', async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title:'Свободные окна для записи', text:textArea.value });
          status.textContent = 'Материал передан через системное меню.';
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      const copied = await copyText(textArea.value);
      status.textContent = copied ? 'Системная отправка недоступна — текст скопирован.' : 'Системная отправка недоступна. Выделите текст вручную.';
      notify(copied ? 'Текст скопирован — вставьте его в нужное приложение' : 'Выделите и скопируйте текст вручную');
    });
    return { open, refresh:() => { if (dialog.open) render(); } };
  }

  window.MinutaFreeSlots = { createController };
})();
