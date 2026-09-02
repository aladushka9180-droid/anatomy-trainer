(function initMinutaVoiceAssistant(global) {
  'use strict';

  const MONTHS = Object.freeze({
    января:0, январь:0, февраля:1, февраль:1, марта:2, март:2, апреля:3, апрель:3,
    мая:4, май:4, июня:5, июнь:5, июля:6, июль:6, августа:7, август:7,
    сентября:8, сентябрь:8, октября:9, октябрь:9, ноября:10, ноябрь:10, декабря:11, декабрь:11
  });
  const WEEKDAYS = Object.freeze({
    воскресенье:0, воскресенья:0, понедельник:1, понедельника:1, вторник:2, вторника:2,
    среду:3, среда:3, среды:3, четверг:4, четверга:4, пятницу:5, пятница:5, пятницы:5,
    субботу:6, суббота:6, субботы:6
  });
  const HOURS = Object.freeze({
    ноль:0, час:1, часу:1, один:1, два:2, две:2, три:3, четыре:4, пять:5, шесть:6,
    семь:7, восемь:8, девять:9, десять:10, одиннадцать:11, двенадцать:12,
    тринадцать:13, четырнадцать:14, пятнадцать:15, шестнадцать:16, семнадцать:17,
    восемнадцать:18, девятнадцать:19, двадцать:20, двадцатьодин:21, двадцатьдва:22, двадцатьтри:23
  });
  const ORDINAL_DAYS = Object.freeze({
    первое:1, первого:1, второе:2, второго:2, третье:3, третьего:3, четвертое:4, четвертого:4,
    пятое:5, пятого:5, шестое:6, шестого:6, седьмое:7, седьмого:7, восьмое:8, восьмого:8,
    девятое:9, девятого:9, десятое:10, десятого:10, одиннадцатое:11, одиннадцатого:11,
    двенадцатое:12, двенадцатого:12, тринадцатое:13, тринадцатого:13,
    четырнадцатое:14, четырнадцатого:14, пятнадцатое:15, пятнадцатого:15,
    шестнадцатое:16, шестнадцатого:16, семнадцатое:17, семнадцатого:17,
    восемнадцатое:18, восемнадцатого:18, девятнадцатое:19, девятнадцатого:19,
    двадцатое:20, двадцатого:20, двадцатьпервое:21, двадцатьпервого:21,
    двадцатьвторое:22, двадцатьвторого:22, двадцатьтретье:23, двадцатьтретьего:23,
    двадцатьчетвертое:24, двадцатьчетвертого:24, двадцатьпятое:25, двадцатьпятого:25,
    двадцатьшестое:26, двадцатьшестого:26, двадцатьседьмое:27, двадцатьседьмого:27,
    двадцатьвосьмое:28, двадцатьвосьмого:28, двадцатьдевятое:29, двадцатьдевятого:29,
    тридцатое:30, тридцатого:30, тридцатьпервое:31, тридцатьпервого:31
  });
  const HALF_HOURS = Object.freeze({
    первого:'00:30', второго:'01:30', третьего:'02:30', четвертого:'03:30', четвёртого:'03:30',
    пятого:'04:30', шестого:'05:30', седьмого:'06:30', восьмого:'07:30', девятого:'08:30',
    десятого:'09:30', одиннадцатого:'10:30', двенадцатого:'11:30', тринадцатого:'12:30',
    четырнадцатого:'13:30', пятнадцатого:'14:30', шестнадцатого:'15:30', семнадцатого:'16:30',
    восемнадцатого:'17:30', девятнадцатого:'18:30', двадцатого:'19:30'
  });
  // JavaScript treats Cyrillic letters as non-word characters for \b, even with /u.
  // The input is whitespace-normalized, so explicit whitespace boundaries are reliable here.
  const BOOKING_WORDS = /(?:^|\s)(запиши|записать|запишите|создай\s+запись|создать\s+запись|новая\s+запись)(?=\s|$)/i;
  const FREE_SLOT_WORDS = /(?:^|\s)(свободн[а-я]*\s+(?:окн[а-я]*|врем[а-я]*|слот[а-я]*)|найди\s+(?:свободн[а-я]*\s+)?(?:окн[а-я]*|врем[а-я]*|слот[а-я]*)|покажи\s+(?:свободн[а-я]*\s+)?(?:окн[а-я]*|врем[а-я]*|слот[а-я]*))(?=\s|$)/i;

  function normalizeText(value) {
    return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9:.\s-]/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function localIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function dateAtNoon(value = new Date()) {
    const date = new Date(value);
    date.setHours(12, 0, 0, 0);
    return date;
  }

  function parseRussianDate(command, now = new Date()) {
    const text = normalizeText(command);
    const base = dateAtNoon(now);
    if (/(?:^|\s)послезавтра(?=\s|$)/.test(text)) { base.setDate(base.getDate() + 2); return localIsoDate(base); }
    if (/(?:^|\s)завтра(?=\s|$)/.test(text)) { base.setDate(base.getDate() + 1); return localIsoDate(base); }
    if (/(?:^|\s)сегодня(?=\s|$)/.test(text)) return localIsoDate(base);

    const relative = text.match(/(?:^|\s)через\s+(?:(\d{1,3})|(один|одну|два|две|три|четыре|пять|шесть|семь))?\s*(день|дня|днеи|неделю|недели|недель)(?=\s|$)/);
    if (relative) {
      const counts = { один:1, одну:1, два:2, две:2, три:3, четыре:4, пять:5, шесть:6, семь:7 };
      const count = Number(relative[1]) || counts[relative[2]] || 1;
      const multiplier = relative[3].startsWith('недел') ? 7 : 1;
      base.setDate(base.getDate() + count * multiplier);
      return localIsoDate(base);
    }

    const numeric = text.match(/\b([0-3]?\d)[./-]([01]?\d)(?:[./-](\d{2,4}))?\b/);
    if (numeric) {
      let year = numeric[3] ? Number(numeric[3]) : base.getFullYear();
      if (year < 100) year += 2000;
      const candidate = dateAtNoon(new Date(year, Number(numeric[2]) - 1, Number(numeric[1])));
      if (!numeric[3] && candidate < base) candidate.setFullYear(candidate.getFullYear() + 1);
      if (candidate.getDate() === Number(numeric[1]) && candidate.getMonth() === Number(numeric[2]) - 1) return localIsoDate(candidate);
    }

    const monthNames = Object.keys(MONTHS).join('|');
    const named = text.match(new RegExp(`(?:^|\\s)([0-3]?\\d)\\s+(${monthNames})(?:\\s+(\\d{4}))?(?=\\s|$)`, 'i'));
    if (named) {
      const year = named[3] ? Number(named[3]) : base.getFullYear();
      const candidate = dateAtNoon(new Date(year, MONTHS[named[2]], Number(named[1])));
      if (!named[3] && candidate < base) candidate.setFullYear(candidate.getFullYear() + 1);
      if (candidate.getDate() === Number(named[1])) return localIsoDate(candidate);
    }

    const ordinalNames = Object.keys(ORDINAL_DAYS).join('|');
    const ordinal = text.match(new RegExp(`(?:^|\\s)(${ordinalNames.replace(/двадцать|тридцать/g, '$&\\s*')})\\s+(${monthNames})(?:\\s+(\\d{4}))?(?=\\s|$)`, 'i'));
    if (ordinal) {
      const ordinalKey = ordinal[1].replace(/\s+/g, '');
      const year = ordinal[3] ? Number(ordinal[3]) : base.getFullYear();
      const day = ORDINAL_DAYS[ordinalKey];
      const candidate = dateAtNoon(new Date(year, MONTHS[ordinal[2]], day));
      if (!ordinal[3] && candidate < base) candidate.setFullYear(candidate.getFullYear() + 1);
      if (candidate.getDate() === day && candidate.getMonth() === MONTHS[ordinal[2]]) return localIsoDate(candidate);
    }

    for (const [word, weekday] of Object.entries(WEEKDAYS)) {
      if (!new RegExp(`(?:^|\\s)${word}(?=\\s|$)`).test(text)) continue;
      let delta = (weekday - base.getDay() + 7) % 7;
      if (delta === 0 || new RegExp(`(?:^|\\s)следующ[а-я]*\\s+${word}(?=\\s|$)`).test(text)) delta += 7;
      base.setDate(base.getDate() + delta);
      return localIsoDate(base);
    }
    return '';
  }

  function parseRussianTime(command) {
    const text = normalizeText(command);
    const compactHalf = text.match(/(?:^|\s)пол\s*([а-я]+)(?=\s|$)/);
    if (compactHalf && HALF_HOURS[compactHalf[1]]) return HALF_HOURS[compactHalf[1]];
    const spokenHalf = text.match(/(?:^|\s)(?:в\s+)?половин(?:а|е|у)\s+([а-я]+)(?=\s|$)/);
    if (spokenHalf && HALF_HOURS[spokenHalf[1]]) return HALF_HOURS[spokenHalf[1]];

    const applyDayPart = (hour, dayPart) => {
      if ((dayPart === 'вечера' || dayPart === 'дня') && hour >= 1 && hour <= 11) return hour + 12;
      if ((dayPart === 'утра' || dayPart === 'ночи') && hour === 12) return 0;
      return hour;
    };
    const numericMatches = [...text.matchAll(/(?:^|\s)(?:в|к|на)\s+(\d{1,2})(?:(?:[:.]|\s)([0-5]\d))?(?:\s+(утра|дня|вечера|ночи))?(?=\s|$)/g)];
    for (const match of numericMatches) {
      const hour = applyDayPart(Number(match[1]), match[3]);
      const minute = Number(match[2] || 0);
      const tail = text.slice((match.index || 0) + match[0].length).trimStart();
      const looksLikeShortDate = match[0].trimStart().startsWith('на ') && match[0].includes('.') && minute >= 1 && minute <= 12;
      if (hour <= 23 && !looksLikeShortDate && !/^(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/.test(tail)) {
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      }
    }

    const words = text.split(' ');
    const minuteWords = { пятнадцать:15, тридцать:30, сорокпять:45 };
    for (let index = 0; index < words.length; index += 1) {
      if (!/^(в|к)$/.test(words[index])) continue;
      const compoundHour = HOURS[`${words[index + 1] || ''}${words[index + 2] || ''}`];
      const hourWords = Number.isInteger(compoundHour) ? 2 : 1;
      let hour = compoundHour ?? HOURS[words[index + 1]];
      if (!Number.isInteger(hour)) continue;
      const minuteIndex = index + 1 + hourWords;
      const compoundMinute = minuteWords[`${words[minuteIndex] || ''}${words[minuteIndex + 1] || ''}`];
      const minute = compoundMinute ?? minuteWords[words[minuteIndex]] ?? 0;
      const minuteWordCount = Number.isInteger(compoundMinute) ? 2 : (Number.isInteger(minuteWords[words[minuteIndex]]) ? 1 : 0);
      const dayPart = words[minuteIndex + minuteWordCount];
      hour = applyDayPart(hour, dayPart);
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    return '';
  }

  function parseDuration(command) {
    const text = normalizeText(command);
    const minutes = text.match(/(?:^|\s)(\d{1,3})\s*(?:мин|минута|минуту|минуты|минут)(?=\s|$)/);
    if (minutes) return Math.min(1440, Math.max(1, Number(minutes[1])));
    const hours = text.match(/(?:^|\s)(\d{1,2})(?:[.,](\d))?\s*(?:час|часа|часов)(?=\s|$)/);
    if (hours) return Math.round((Number(hours[1]) + Number(`0.${hours[2] || 0}`)) * 60);
    if (/(?:^|\s)полтора\s+часа(?=\s|$)/.test(text)) return 90;
    if (/(?:^|\s)(?:один\s+)?час(?=\s|$)/.test(text)) return 60;
    return 0;
  }

  function serviceStem(word) {
    const value = normalizeText(word);
    if (value.length < 4) return value;
    const ending = ['иями','ями','ами','ого','его','ому','ему','ыми','ими','ую','юю','ая','яя','ой','ей','ый','ий','ые','ие','ых','их','ов','ев','ам','ям','ах','ях','ы','и','а','я','у','ю','е','о'].find(item => value.endsWith(item) && value.length - item.length >= 3);
    return ending ? value.slice(0, -ending.length) : value;
  }

  function findServices(command, services = [], duration = 0) {
    const text = normalizeText(command);
    const commandWords = text.split(' ').filter(Boolean);
    const scored = services.map(service => {
      const name = normalizeText(service.name);
      const nameWords = name.split(' ').filter(Boolean);
      const words = nameWords.filter(word => word.length > 2 && !/^(для|или|при)$/.test(word));
      const exact = nameWords.length && commandWords.some((_, index) => nameWords.every((word, offset) => commandWords[index + offset] === word)) ? 100 : 0;
      const matchedWords = words.filter(word => commandWords.some(commandWord => serviceStem(commandWord) === serviceStem(word)));
      const inflectedPhrase = words.length && matchedWords.length === words.length ? 70 : 0;
      const wordScore = matchedWords.length * 5;
      const durationScore = duration && Number(service.durationMinutes) === duration ? 2 : 0;
      return { service, score:exact + inflectedPhrase + wordScore + durationScore };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || String(a.service.name).localeCompare(String(b.service.name), 'ru'));
    if (!scored.length) return [];
    const top = scored[0].score;
    return scored.filter(item => item.score === top).map(item => item.service).slice(0, 4);
  }

  function toNominativeName(value, fromGenitive = false) {
    const parts = String(value || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map(part => {
      let name = part;
      if (/ию$/i.test(name)) name = name.replace(/ию$/i, 'ия');
      else if (/ью$/i.test(name)) name = name.replace(/ью$/i, 'ья');
      else if (/скую$/i.test(name)) name = name.replace(/скую$/i, 'ская');
      else if (/цкую$/i.test(name)) name = name.replace(/цкую$/i, 'цкая');
      else if (/ую$/i.test(name)) name = name.replace(/ую$/i, 'ая');
      else if (/[а-я]у$/i.test(name)) name = name.replace(/у$/i, 'а');
      else if (fromGenitive && /ии$/i.test(name)) name = name.replace(/ии$/i, 'ия');
      else if (fromGenitive && /ьи$/i.test(name)) name = name.replace(/ьи$/i, 'ья');
      else if (fromGenitive && /ской$/i.test(name)) name = name.replace(/ской$/i, 'ская');
      else if (fromGenitive && /цкой$/i.test(name)) name = name.replace(/цкой$/i, 'цкая');
      else if (fromGenitive && /(овой|евой|иной)$/i.test(name)) name = name.replace(/ой$/i, 'а');
      else if (fromGenitive && /ы$/i.test(name)) name = name.replace(/ы$/i, 'а');
      else if (fromGenitive && /[гкх]и$/i.test(name)) name = name.replace(/и$/i, 'а');
      return name.charAt(0).toLocaleUpperCase('ru-RU') + name.slice(1).toLocaleLowerCase('ru-RU');
    }).join(' ');
  }

  function parseClientName(command) {
    const cleaned = String(command || '').replace(/[,.!?]/g, ' ').replace(/\s+/g, ' ').trim();
    const match = cleaned.match(/(?:запиши|записать|запишите|создай\s+запись(?:\s+для)?|создать\s+запись(?:\s+для)?|новая\s+запись(?:\s+для)?)\s+(.+?)(?=\s+(?:сегодня|завтра|послезавтра|в\s+\d|к\s+\d|на\s+\d|на\s+[а-яё]+|к\s+[а-яё]+|в\s+[а-яё]+)|$)/iu);
    if (!match) return '';
    const dateWords = new Set([...Object.keys(MONTHS), ...Object.keys(WEEKDAYS), ...Object.keys(ORDINAL_DAYS), 'сегодня', 'завтра', 'послезавтра', 'через']);
    const words = [];
    for (const word of match[1].trim().split(/\s+/)) {
      const normalized = normalizeText(word).replace(/\s+/g, '');
      if (!normalized || /^(клиента?|клиентку|для)$/.test(normalized)) continue;
      if (dateWords.has(normalized) || /^\d{1,2}[./-]\d{1,2}/.test(normalized) || /^(в|к|на)$/.test(normalized)) break;
      words.push(word);
      if (words.length === 2) break;
    }
    return toNominativeName(words.join(' '), /(?:^|\s)для(?=\s)/i.test(cleaned));
  }

  function formatDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return 'дата не указана';
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day, 12).toLocaleDateString('ru-RU', { weekday:'short', day:'numeric', month:'long' });
  }

  function snapshotTimeLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'время последней синхронизации неизвестно';
    return date.toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  }

  function activeBookings(snapshot, date) {
    return (snapshot.bookings || []).filter(item => item.date === date && item.status !== 'cancelled').sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  function interpretCommand(command, snapshot = {}, now = new Date()) {
    const raw = String(command || '').trim().slice(0, 500);
    const text = normalizeText(raw);
    const today = snapshot.today || localIsoDate(dateAtNoon(now));
    if (!text) return { kind:'error', title:'Команда не указана', message:'Скажите команду или введите её текстом.' };

    const duration = parseDuration(text);
    const date = parseRussianDate(text, now) || today;
    const time = parseRussianTime(text);
    const candidates = findServices(text, snapshot.services || [], duration);
    const service = candidates.length === 1 ? candidates[0] : null;

    if (BOOKING_WORDS.test(text)) {
      const clientName = parseClientName(raw);
      const missing = [];
      if (!clientName) missing.push('имя клиента');
      if (!time) missing.push('время');
      if (!service && candidates.length !== 1) missing.push(candidates.length > 1 ? 'точная услуга' : 'услуга');
      return {
        kind:'booking_draft',
        title:'Черновик новой записи',
        message:missing.length ? `Нужно уточнить: ${missing.join(', ')}.` : 'Команда распознана. Перед созданием проверьте данные в защищённой форме.',
        plan:{ clientName, date, time, serviceId:service?.id || '', serviceName:service?.name || '', durationMinutes:duration || Number(service?.durationMinutes || 0) },
        candidates:candidates.map(item => ({ id:item.id, name:item.name, durationMinutes:item.durationMinutes })),
        canPrepare:Boolean(clientName || service || time)
      };
    }

    if (FREE_SLOT_WORDS.test(text)) {
      return {
        kind:'find_slots',
        title:'Поиск свободного времени',
        message:'Открою защищённую форму записи. Она запросит у сервера только действительно свободные интервалы.',
        plan:{ clientName:'', date, time:'', serviceId:service?.id || '', serviceName:service?.name || '', durationMinutes:duration || Number(service?.durationMinutes || 0) },
        candidates:candidates.map(item => ({ id:item.id, name:item.name, durationMinutes:item.durationMinutes })),
        canPrepare:true
      };
    }

    if (/(?:^|\s)(какие|сколько|покажи|что)(?=\s|$).*?(?:^|\s)(запис[а-я]*|визит[а-я]*|клиент[а-я]*)/.test(text) || /(?:^|\s)кто(?=\s|$).*?(?:^|\s)(сегодня|завтра|записан[а-я]*)/.test(text)) {
      const items = activeBookings(snapshot, date);
      return {
        kind:'schedule_summary',
        title:`Записи: ${formatDate(date)}`,
        message:items.length ? `Найдено записей: ${items.length}.` : 'Активных записей на этот день нет.',
        items:items.slice(0, 12),
        total:items.length
      };
    }

    const clientSearch = raw.match(/(?:найди|покажи|история)\s+(?:клиента?\s+)?([А-ЯЁA-Z][А-ЯЁA-Za-zа-яё-]{1,}(?:\s+[А-ЯЁA-Za-zа-яё-]{1,})?)/iu);
    if (clientSearch) {
      const clientName = toNominativeName(clientSearch[1]);
      const needle = normalizeText(clientName);
      const matches = (snapshot.bookings || []).filter(item => normalizeText(item.clientName).includes(needle)).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
      return { kind:'client_search', title:`Клиент: ${clientName}`, message:matches.length ? `Найдено посещений и записей: ${matches.length}.` : 'Клиент не найден в загруженном журнале.', items:matches.slice(0, 12), total:matches.length };
    }

    return {
      kind:'help',
      title:'Я пока не уверен в команде',
      message:'Попробуйте назвать действие, дату, время и услугу. Никакие данные не были изменены.',
      examples:['Какие записи завтра?', 'Найди свободное время в пятницу на массаж 60 минут', 'Запиши Анну завтра в 10:30 на массаж']
    };
  }

  function applyOfflineContext(model, snapshot) {
    if (!snapshot?.offlineReadable) return model;
    const updated = snapshotTimeLabel(snapshot.lastUpdatedAt);
    if (model.kind === 'client_search') {
      return {
        kind:'offline_notice',
        title:'Поиск клиента офлайн недоступен',
        message:`В сохранённой копии имена и телефоны скрыты. Последнее обновление: ${updated}. Подключитесь к интернету для поиска.` ,
        offline:true
      };
    }
    if (model.kind === 'find_slots') {
      return {
        kind:'offline_notice',
        title:'Свободное время нужно перепроверить',
        message:`Сейчас нет интернета. По копии на ${updated} нельзя гарантировать, что окно осталось свободным. После подключения повторите запрос.`,
        offline:true
      };
    }
    if (model.kind === 'schedule_summary') {
      return {
        ...model,
        message:`${model.message} Это сохранённая копия на ${updated}; имена и телефоны скрыты.`,
        offline:true
      };
    }
    if (model.kind === 'booking_draft') {
      return {
        ...model,
        message:`Офлайн можно сохранить только черновик. Данные на ${updated}; свободное время будет проверено после подключения.`,
        offline:true
      };
    }
    return { ...model, offline:true, message:`${model.message} Используется сохранённая копия на ${updated}.` };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, symbol => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[symbol]);
  }

  function createController(options = {}) {
    const doc = options.document || global.document;
    const bridge = options.bridge || global.MinutaProviderAssistant;
    if (!doc || !bridge) return { bind() {}, destroy() {} };
    const dialog = doc.querySelector('#voiceAssistantDialog');
    const openButton = doc.querySelector('#openVoiceAssistant');
    const closeButton = doc.querySelector('[data-close-voice-assistant]');
    const form = doc.querySelector('#voiceAssistantForm');
    const input = doc.querySelector('#voiceAssistantInput');
    const listenButton = doc.querySelector('#voiceListenButton');
    const status = doc.querySelector('#voiceAssistantStatus');
    const result = doc.querySelector('#voiceAssistantResult');
    if (!dialog || !openButton || !form || !input || !listenButton || !status || !result) return { bind() {}, destroy() {} };

    const Recognition = global.SpeechRecognition || global.webkitSpeechRecognition;
    let recognition = null;
    let listening = false;
    let lastModel = null;
    let lastSessionGeneration = null;
    let recognitionEpoch = 0;

    function setListening(value) {
      listening = value;
      listenButton.classList.toggle('is-listening', value);
      listenButton.setAttribute('aria-pressed', String(value));
      listenButton.querySelector('span').textContent = value ? 'Слушаю…' : 'Говорить';
    }

    function abortRecognition() {
      recognitionEpoch += 1;
      try { recognition?.abort(); } catch {}
      recognition = null;
      setListening(false);
    }

    function close() {
      abortRecognition();
      if (dialog.open) dialog.close();
    }

    function reset() {
      close();
      try { global.speechSynthesis?.cancel(); } catch {}
      input.value = '';
      result.hidden = true;
      result.replaceChildren();
      lastModel = null;
      lastSessionGeneration = null;
      status.textContent = 'Нажмите «Говорить» или введите команду текстом.';
    }

    function detailsMarkup(model) {
      if (model.kind === 'booking_draft' || model.kind === 'find_slots') {
        const plan = model.plan || {};
        const rows = [
          ['Клиент', plan.clientName || 'указать в форме'],
          ['Дата', formatDate(plan.date)],
          ['Время', plan.time || 'выбрать из свободных'],
          ['Услуга', plan.serviceName || (model.candidates?.length > 1 ? `уточнить: ${model.candidates.map(item => item.name).join(', ')}` : 'выбрать в форме')]
        ];
        return `<dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
      }
      if (model.kind === 'schedule_summary' || model.kind === 'client_search') {
        const list = (model.items || []).map(item => `<li><strong>${escapeHtml(item.time || '')}</strong><span>${escapeHtml(item.clientName || 'Клиент')} · ${escapeHtml(item.serviceName || 'Услуга')}</span></li>`).join('');
        return list ? `<ul>${list}</ul>${model.total > model.items.length ? `<small>Показаны первые ${model.items.length} из ${model.total}</small>` : ''}` : '';
      }
      if (model.examples) return `<ul class="voice-help-list">${model.examples.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
      return '';
    }

    function renderModel(model, sessionGeneration = null) {
      lastModel = model;
      lastSessionGeneration = sessionGeneration;
      const prepareAction = model.canPrepare ? '<button class="primary" type="button" data-voice-prepare>Открыть черновик</button>' : '';
      const speakAction = global.speechSynthesis && global.SpeechSynthesisUtterance ? '<button class="secondary-button" type="button" data-voice-speak>Озвучить ответ</button>' : '';
      const actions = prepareAction || speakAction ? `<div class="voice-result-actions">${prepareAction}${speakAction}</div>` : '';
      const offlineNotice = model.offline ? '<p class="voice-offline-notice">Офлайн · сведения могут быть устаревшими</p>' : '';
      result.className = `voice-assistant-result is-${model.kind}`;
      result.innerHTML = `${offlineNotice}<div class="voice-result-heading"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#${model.kind === 'error' ? 'icon-alert' : 'icon-spark'}"></use></svg><div><strong>${escapeHtml(model.title)}</strong><p>${escapeHtml(model.message)}</p></div></div>${detailsMarkup(model)}${actions}`;
      result.hidden = false;
      result.querySelector('[data-voice-speak]')?.addEventListener('click', () => {
        const spokenItems = (lastModel?.items || []).slice(0, 12).map(item => `${item.time || ''}, ${item.serviceName || 'услуга'}`).join('. ');
        const utterance = new global.SpeechSynthesisUtterance([lastModel?.title, lastModel?.message, spokenItems].filter(Boolean).join('. ').slice(0, 1200));
        utterance.lang = 'ru-RU';
        try { global.speechSynthesis.cancel(); global.speechSynthesis.speak(utterance); } catch { status.textContent = 'Не удалось озвучить ответ на этом устройстве.'; }
      });
      result.querySelector('[data-voice-prepare]')?.addEventListener('click', () => {
        const currentSnapshot = bridge.getReadOnlySnapshot();
        const sameSession = Object.is(currentSnapshot?.sessionGeneration, lastSessionGeneration);
        const offlineDraftAllowed = Boolean(lastModel?.offline && lastModel?.kind === 'booking_draft' && currentSnapshot?.offlineReadable);
        if (!currentSnapshot?.authenticated || !sameSession || (!currentSnapshot.synchronized && !offlineDraftAllowed)) {
          lastModel = null;
          lastSessionGeneration = null;
          result.hidden = true;
          result.replaceChildren();
          status.textContent = 'Сессия или данные кабинета изменились. Повторите команду после синхронизации.';
          return;
        }
        const response = bridge.prepareBookingDraft(lastModel?.plan || {});
        if (!response?.ok) {
          status.textContent = 'Сначала дождитесь полной синхронизации кабинета. Черновик не открыт.';
          return;
        }
        close();
      });
    }

    function understand() {
      const snapshot = bridge.getReadOnlySnapshot();
      if (!snapshot?.authenticated) {
        renderModel({ kind:'error', title:'Нужно войти в кабинет', message:'После входа помощник сможет прочитать актуальное расписание.' });
        return;
      }
      if (!snapshot.synchronized && !snapshot.offlineReadable) {
        renderModel({ kind:'error', title:'Данные ещё синхронизируются', message:'Дождитесь полной синхронизации кабинета и повторите команду.' }, snapshot.sessionGeneration);
        status.textContent = 'Помощник не показывает устаревшие данные.';
        return;
      }
      const model = applyOfflineContext(interpretCommand(input.value, snapshot, new Date()), snapshot);
      renderModel(model, snapshot.sessionGeneration);
      status.textContent = model.offline ? 'Показана последняя сохранённая информация. Изменения не выполняются автоматически.' : model.kind === 'error' ? 'Команда не распознана.' : 'Готово. Проверьте результат перед следующим действием.';
    }

    function startRecognition() {
      if (!Recognition) {
        status.textContent = 'Этот браузер не поддерживает распознавание речи. Введите команду текстом.';
        input.focus();
        return;
      }
      if (listening) { abortRecognition(); return; }
      const epoch = ++recognitionEpoch;
      const currentRecognition = new Recognition();
      recognition = currentRecognition;
      currentRecognition.lang = 'ru-RU';
      currentRecognition.continuous = false;
      currentRecognition.interimResults = true;
      currentRecognition.maxAlternatives = 1;
      currentRecognition.onstart = () => {
        if (epoch !== recognitionEpoch || !dialog.open) return;
        setListening(true);
        status.textContent = 'Говорите обычной фразой. Ничего не будет выполнено автоматически.';
      };
      currentRecognition.onresult = event => {
        if (epoch !== recognitionEpoch || !dialog.open) return;
        const transcript = [...event.results].map(item => item[0]?.transcript || '').join(' ').trim();
        if (transcript) input.value = transcript.slice(0, 500);
        if ([...event.results].every(item => item.isFinal)) understand();
      };
      currentRecognition.onerror = event => {
        if (epoch !== recognitionEpoch || !dialog.open) return;
        const messages = { 'not-allowed':'Нет разрешения на микрофон. Разрешите доступ в настройках браузера или введите команду текстом.', 'no-speech':'Речь не услышана. Попробуйте ещё раз.', network:'Служба распознавания речи недоступна. Введите команду текстом.' };
        status.textContent = messages[event.error] || 'Не удалось распознать речь. Попробуйте ещё раз или используйте текст.';
      };
      currentRecognition.onend = () => {
        if (epoch !== recognitionEpoch) return;
        recognition = null;
        setListening(false);
      };
      try { currentRecognition.start(); } catch { abortRecognition(); status.textContent = 'Микрофон уже используется. Попробуйте ещё раз.'; }
    }

    function bind() {
      openButton.addEventListener('click', () => {
        abortRecognition();
        input.value = '';
        lastModel = null;
        lastSessionGeneration = null;
        result.hidden = true;
        result.replaceChildren();
        status.textContent = Recognition ? 'Нажмите «Говорить» или введите команду текстом.' : 'Голосовой ввод недоступен в этом браузере. Текстовые команды работают.';
        dialog.showModal();
        setTimeout(() => (Recognition ? listenButton : input).focus(), 0);
      });
      closeButton.addEventListener('click', close);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      form.addEventListener('submit', event => { event.preventDefault(); understand(); });
      listenButton.addEventListener('click', startRecognition);
      doc.querySelectorAll('[data-voice-example]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.voiceExample || ''; understand(); }));
      if (!Recognition) listenButton.classList.add('is-unsupported');
      global.addEventListener?.('minuta:provider-session-reset', reset);
    }

    function destroy() {
      reset();
      global.removeEventListener?.('minuta:provider-session-reset', reset);
    }

    return { bind, destroy, understand, reset };
  }

  const api = Object.freeze({ normalizeText, parseRussianDate, parseRussianTime, parseDuration, parseClientName, findServices, interpretCommand, applyOfflineContext, createController });
  if (global) global.MinutaVoiceAssistant = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (global?.document) {
    const boot = () => {
      if (!global.MinutaProviderAssistant || global.__minutaVoiceAssistantController) return;
      global.__minutaVoiceAssistantController = createController({ bridge:global.MinutaProviderAssistant });
      global.__minutaVoiceAssistantController.bind();
    };
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', boot, { once:true });
    else boot();
    global.addEventListener?.('minuta:provider-assistant-ready', boot, { once:true });
  }
})(typeof window !== 'undefined' ? window : globalThis);
