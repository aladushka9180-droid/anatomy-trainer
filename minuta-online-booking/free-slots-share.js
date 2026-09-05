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
      ? rows.map(row => `${dates.length === 1 ? '' : `${formatDate(row.date)} — `}${row.times.join(', ')}`).join('\n')
      : 'На выбранный период свободных окон пока нет.';
    const invitation = rows.length ? 'Выберите удобное время и запишитесь онлайн:' : 'Посмотрите другие даты онлайн:';
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

  function createController({ root, getData, loadContext, loadSlots, notify }) {
    if (!root) return { open() {}, refresh() {} };
    const dialog = root;
    const modeControls = [...dialog.querySelectorAll('[name="freeSlotsPeriod"]')];
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
    let serverContext = null;
    let serverSlots = [];
    let requestRevision = 0;
    let publicationReady = false;

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
        return `${item.name || 'Филиал'}${address}`;
      });
      locationField.hidden = !locations.length;
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
      if (service?.id) targetUrl.searchParams.set('service', service.id);
      if (serverContext?.mode === 'organization' && location?.id) targetUrl.searchParams.set('location', location.id);
      const trackingUrl = trackedBookingUrl(targetUrl.href, sourceKey);
      return {
        from, to, service, location, trackingUrl,
        publicationData:{
          ...data,
          bookingUrl:trackingUrl,
          serviceLabel:service ? `${service.name || 'Услуга'}${service.performer_profiles?.display_name ? ` · ${service.performer_profiles.display_name}` : ''}` : '',
          locationLabel:location?.name || ''
        }
      };
    }

    function renderPublication() {
      if (!publicationReady) return;
      const model = publicationModel();
      textArea.value = buildPublication(model.from, model.to, model.publicationData, serverSlots);
      const trackingUrl = model.trackingUrl;
      bookingLink.href = trackingUrl;
      bookingLink.textContent = trackingUrl;
      try {
        drawQr(qrCanvas, trackingUrl);
        qrCanvas.hidden = false;
        dialog.querySelector('#freeSlotsQrError').hidden = true;
      } catch {
        qrCanvas.hidden = true;
        dialog.querySelector('#freeSlotsQrError').hidden = false;
      }
      status.textContent = '';
      copyButton.disabled = false;
      shareButton.disabled = false;
    }

    function showUnavailable(message) {
      publicationReady = false;
      serverSlots = [];
      textArea.value = 'Свободное время не опубликовано: сервер не подтвердил доступные слоты.';
      bookingLink.removeAttribute('href');
      bookingLink.textContent = '';
      qrCanvas.hidden = true;
      dialog.querySelector('#freeSlotsQrError').hidden = true;
      status.textContent = message;
      copyButton.disabled = true;
      shareButton.disabled = true;
      dialog.removeAttribute('aria-busy');
    }

    async function refreshFromServer({ reloadContext = false } = {}) {
      const revision = ++requestRevision;
      publicationReady = false;
      copyButton.disabled = true;
      shareButton.disabled = true;
      status.textContent = 'Проверяем свободное время на сервере…';
      dialog.setAttribute('aria-busy', 'true');
      try {
        const { from, to } = currentRange();
        const preferredService = serviceSelect.value;
        const preferredLocation = locationSelect.value;
        if (reloadContext || !serverContext) serverContext = await loadContext();
        if (revision !== requestRevision || !dialog.open) return;
        const services = configureTargets(preferredService, preferredLocation);
        if (!services.length) {
          showUnavailable(serverContext?.mode === 'organization' && locationSelect.value
            ? 'В выбранном филиале нет доступных услуг.'
            : 'Нет активных услуг для публикации.');
          return;
        }
        if (serverContext?.mode === 'organization' && !(serverContext.locations || []).length) {
          showUnavailable('У онлайн-записи организации нет активного филиала.');
          return;
        }
        const result = await loadSlots({
          context:serverContext,
          serviceId:serviceSelect.value,
          locationId:locationSelect.value || null,
          from,
          to
        });
        if (revision !== requestRevision || !dialog.open) return;
        if (result?.error) throw result.error;
        serverSlots = Array.isArray(result?.data) ? result.data : [];
        publicationReady = true;
        dialog.removeAttribute('aria-busy');
        renderPublication();
      } catch {
        if (revision !== requestRevision || !dialog.open) return;
        showUnavailable(navigator.onLine
          ? 'Не удалось проверить свободное время. Повторите попытку позже.'
          : 'Нет соединения. Для публикации нужна свежая проверка сервера.');
      }
    }

    async function open() {
      const data = getData();
      fromInput.min = data.today;
      fromInput.value = data.selectedDate >= data.today ? data.selectedDate : data.today;
      toInput.value = addDays(fromInput.value, 6);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      await refreshFromServer({ reloadContext:true });
    }

    const close = () => {
      requestRevision += 1;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
    dialog.querySelectorAll('[data-close-free-slots]').forEach(button => button.addEventListener('click', close));
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    modeControls.forEach(control => control.addEventListener('change', () => { void refreshFromServer(); }));
    sourceControls.forEach(control => control.addEventListener('change', renderPublication));
    fromInput.addEventListener('change', () => { void refreshFromServer(); });
    toInput.addEventListener('change', () => { void refreshFromServer(); });
    serviceSelect.addEventListener('change', () => { void refreshFromServer(); });
    locationSelect.addEventListener('change', () => {
      configureTargets('', locationSelect.value);
      void refreshFromServer();
    });
    copyButton.addEventListener('click', async () => {
      if (!publicationReady) return;
      const copied = await copyText(textArea.value);
      status.textContent = copied ? 'Текст скопирован.' : 'Не удалось скопировать автоматически. Выделите текст вручную.';
      notify(copied ? 'Свободные окна скопированы' : 'Выделите и скопируйте текст вручную');
    });
    shareButton.addEventListener('click', async () => {
      if (!publicationReady) return;
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
    return { open, refresh:() => { if (dialog.open) void refreshFromServer({ reloadContext:true }); } };
  }

  window.MinutaFreeSlots = { createController };
})();
