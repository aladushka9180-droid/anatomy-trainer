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
  const BOOKING_WORDS = /(?:^|\s)(запиш[а-я]*|записать|добав[а-я]*|постав[а-я]*|заброниру[а-я]*|оформ[а-я]*|назнач[а-я]*|запланиру[а-я]*|созда[а-я]*)(?:\s+(?:новую?\s+)?(?:запись|визит|прием|сеанс))?(?=\s|$)/i;
  const BOOKING_PHRASES = /(?:^|\s)(?:хочу|нужно|надо|можно|давай)\s+(?:записать|добавить|поставить|забронировать|создать\s+запись)(?=\s|$)/i;
  const FREE_SLOT_WORDS = /(?:^|\s)(?:свободн[а-я]*\s+(?:окн[а-я]*|окошк[а-я]*|врем[а-я]*|слот[а-я]*)|(?:найд[а-я]*|покаж[а-я]*|подбер[а-я]*|предлож[а-я]*)\s+(?:свободн[а-я]*\s+)?(?:окн[а-я]*|окошк[а-я]*|врем[а-я]*|слот[а-я]*)|есть\s+ли\s+(?:свободн[а-я]*\s+)?(?:окн[а-я]*|окошк[а-я]*|врем[а-я]*|мест[а-я]*)|когда\s+(?:можно|получится)\s+(?:записать|прийти)|куда\s+(?:можно\s+)?(?:поставить|записать))(?=\s|$)/i;
  const SCHEDULE_WORDS = /(?:^|\s)(расписан[а-я]*|график|план[а-я]*|запис[а-я]*|визит[а-я]*|прием[а-я]*|сеанс[а-я]*|клиент[а-я]*)(?=\s|$)/i;
  const COMMAND_FILLERS = new Set(['пожалуйста', 'пожалуйсто', 'мне', 'новую', 'новый', 'запись', 'визит', 'прием', 'сеанс', 'клиента', 'клиентку', 'для']);
  const COMMAND_ALIASES = Object.freeze({
    ана:'анна', ану:'анну', акно:'окно', акошко:'окошко', выручька:'выручка', дабавь:'добавь', дила:'дела', дилла:'дела', завтраа:'завтра', завтро:'завтра', зафтра:'завтра',
    запеси:'записи', запесы:'записи', запесать:'записать', запеши:'запиши', запешы:'запиши', клеент:'клиент', клент:'клиент', клиен:'клиент', клентку:'клиентку', клеентку:'клиентку',
    клинт:'клиент', клинта:'клиента', клинту:'клиенту', матереал:'материал', напаминание:'напоминание', напеши:'напиши', настойки:'настройки', настоить:'настроить',
    пажалуйста:'пожалуйста', памаги:'помоги', паменять:'поменять', памошник:'помощник', питницу:'пятницу', пятнецу:'пятницу', прадвижение:'продвижение', придемай:'придумай', превет:'привет', привед:'привет',
    рекламма:'реклама', рассписание:'расписание', сацсети:'соцсети', сацсетей:'соцсетей', спосибо:'спасибо', спасиба:'спасибо',
    позавтра:'послезавтра', позафтра:'послезавтра', свабоднае:'свободное', свабодное:'свободное', свабодный:'свободный', севодня:'сегодня', сиводня:'сегодня',
    уведамление:'уведомление', уведамления:'уведомления', увидамление:'уведомление', увидамления:'уведомления', услига:'услуга', услиги:'услуги', усулга:'услуга', усулги:'услуги', атзыв:'отзыв', аписание:'описание'
  });
  const COMMAND_VOCABULARY = Object.freeze([...new Set([
    ...Object.keys(MONTHS), ...Object.keys(WEEKDAYS), ...Object.keys(HOURS),
    'десять', 'пятнадцать', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'девяносто', 'полтора', 'минута', 'минуты', 'минут',
    'час', 'часа', 'часов', 'утра', 'дня', 'вечера', 'ночи', 'день', 'дни', 'неделю', 'недели', 'недель', 'продолжительность',
    'после', 'обеда', 'между', 'клиентами', 'визитами', 'раньше', 'раннее', 'позже', 'позднее', 'самое', 'промежутке', 'обычно',
    'сегодня', 'завтра', 'послезавтра', 'запиши', 'записать', 'добавь', 'добавить', 'поставь', 'поставить',
    'забронируй', 'забронировать', 'создай', 'создать', 'найди', 'покажи', 'подбери', 'предложи', 'свободное', 'свободный', 'окно', 'окошко', 'слот',
    'расписание', 'график', 'запись', 'записи', 'визит', 'прием', 'сеанс', 'новую', 'новый', 'клиент', 'клиента', 'клиентку', 'выручка', 'доход', 'оплата', 'материал', 'остаток', 'склад', 'цена', 'стоимость',
    'уведомление', 'уведомления', 'напоминание', 'подтверждение', 'сообщение', 'отзыв', 'экспорт', 'настройки', 'настроить', 'тариф',
    'напиши', 'придумай', 'составь', 'подготовь', 'описание', 'публикация', 'пост', 'соцсети', 'продвижение', 'реклама', 'акция', 'цена', 'пожалуйста', 'помоги', 'помощник'
  ])]);
  const REMOTE_INTENTS = new Set([
    'schedule_summary', 'find_slots', 'booking_draft', 'client_search', 'revenue_summary', 'revenue_change',
    'inventory_summary', 'inventory_forecast', 'attention', 'clients_summary', 'service_performance',
    'team_summary', 'message_draft', 'content_draft', 'price_advice', 'promotion_ideas',
    'operational_briefing', 'workspace_help', 'operation_preview', 'small_talk', 'help'
  ]);
  const REMOTE_INTENT_KINDS = Object.freeze({
    schedule_summary:['schedule_summary'], find_slots:['find_slots'], booking_draft:['booking_draft'],
    client_search:['client_search'], revenue_summary:['revenue_summary'], revenue_change:['revenue_change'],
    inventory_summary:['inventory_summary'], inventory_forecast:['inventory_forecast'], attention:['attention'],
    clients_summary:['clients_summary'], service_performance:['service_performance'], team_summary:['team_summary'],
    message_draft:['message_draft'], content_draft:['content_draft'], price_advice:['price_advice','permission_notice'],
    promotion_ideas:['promotion_ideas'], operational_briefing:['operational_briefing'], workspace_help:['workspace_help'],
    operation_preview:['operation_preview'], small_talk:['small_talk'], help:['help']
  });
  const SPEECH_SETTINGS_KEY = 'minuta-assistant-speech-settings-v1';
  const DEFAULT_SPEECH_RATE = 1;

  function normalizeText(value) {
    return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9:.\s-]/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function levenshteinDistance(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = Array.from({ length:a.length + 1 }, (_, i) => Array.from({ length:b.length + 1 }, (_, j) => i ? (j ? 0 : i) : j));
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
    return matrix[a.length][b.length];
  }

  function phoneticKey(value) {
    return serviceStem(value)
      .replace(/[ьъ]/g, '')
      .replace(/й/g, 'и')
      .replace(/(тся|ться)$/g, 'ца')
      .replace(/([a-zа-я])\1+/g, '$1');
  }

  function wordsAreClose(left, right) {
    const a = serviceStem(left);
    const b = serviceStem(right);
    if (a === b) return true;
    if (phoneticKey(a) === phoneticKey(b)) return true;
    const longest = Math.max(a.length, b.length);
    if (longest < 6 || Math.min(a.length, b.length) < 5) return false;
    return levenshteinDistance(a, b) <= (longest >= 8 ? 2 : 1);
  }

  function repairCommand(value) {
    const source = normalizeText(value).replace(/(?:^|\s)после\s+завтра(?=\s|$)/g, ' послезавтра').trim();
    const corrections = [];
    const words = source.split(' ').map(word => {
      if (!word || /\d|[:.\-]/.test(word)) return word;
      const direct = COMMAND_ALIASES[word];
      if (direct) {
        corrections.push({ from:word, to:direct });
        return direct;
      }
      if (word.length < 5 || COMMAND_VOCABULARY.includes(word)) return word;
      const limit = word.length >= 8 ? 2 : 1;
      const candidates = COMMAND_VOCABULARY
        .filter(item => Math.abs(item.length - word.length) <= limit && (item[0] === word[0] || phoneticKey(item)[0] === phoneticKey(word)[0]))
        .map(item => ({ item, distance:levenshteinDistance(phoneticKey(word), phoneticKey(item)) }))
        .sort((left, right) => left.distance - right.distance || left.item.localeCompare(right.item, 'ru'));
      if (!candidates.length || candidates[0].distance > limit || candidates[1]?.distance === candidates[0].distance) return word;
      corrections.push({ from:word, to:candidates[0].item });
      return candidates[0].item;
    });
    return { text:words.join(' '), corrections:corrections.slice(0, 4) };
  }

  function normalizedLexiconRules(rules = []) {
    return (Array.isArray(rules) ? rules : []).map(rule => ({
      from:normalizeText(rule?.from).slice(0, 80),
      to:normalizeText(rule?.to).slice(0, 120)
    })).filter(rule => rule.from && rule.to && rule.from !== rule.to && /^[а-яa-z\s-]+$/i.test(rule.from) && /^[а-яa-z\s-]+$/i.test(rule.to)).slice(-40);
  }

  function applyLearnedCorrections(value, rules = []) {
    let text = normalizeText(value);
    const corrections = [];
    normalizedLexiconRules(rules).sort((left, right) => right.from.length - left.from.length).forEach(rule => {
      const escaped = rule.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, 'g');
      if (!pattern.test(text)) return;
      text = text.replace(pattern, match => `${match.startsWith(' ') ? ' ' : ''}${rule.to}`);
      corrections.push(rule);
    });
    return { text:text.replace(/\s+/g, ' ').trim(), corrections:corrections.slice(0, 4) };
  }

  function learnedCorrectionRules(original, corrected, snapshot = {}) {
    const before = normalizeText(original).split(' ').filter(Boolean);
    const after = normalizeText(corrected).split(' ').filter(Boolean);
    if (!before.length || !after.length || before.join(' ') === after.join(' ')) return [];
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    const fromWords = before.slice(prefix, before.length - suffix);
    const toWords = after.slice(prefix, after.length - suffix);
    if (!fromWords.length || !toWords.length || fromWords.length > 3 || toWords.length > 4) return [];
    const servicePhrases = (snapshot.services || []).map(item => normalizeText(item?.name)).filter(Boolean);
    const serviceWords = new Set(servicePhrases.flatMap(item => item.split(' ')));
    const allowedWord = word => serviceWords.has(word) || COMMAND_VOCABULARY.some(item => serviceStem(item) === serviceStem(word));
    const to = toWords.join(' ');
    if (!servicePhrases.includes(to) && !toWords.every(allowedWord)) return [];
    const from = fromWords.join(' ');
    if (!/^[а-яa-z-]{2,}(?:\s+[а-яa-z-]{2,}){0,2}$/i.test(from)) return [];
    return [{ from, to }];
  }

  function fuzzyRoot(text, roots) {
    const words = normalizeText(text).split(' ').filter(Boolean);
    return words.some(word => roots.some(root => word.startsWith(root) || (Math.min(word.length, root.length) >= 5 && levenshteinDistance(phoneticKey(word), phoneticKey(root)) <= (Math.max(word.length, root.length) >= 8 ? 2 : 1))));
  }

  function bookingSignal(text) {
    if (BOOKING_WORDS.test(text) || BOOKING_PHRASES.test(text)) return true;
    const nounForms = new Set(['запись', 'записи', 'записей', 'записью']);
    return normalizeText(text).split(' ').filter(word => word && !nounForms.has(word)).some(word =>
      ['запиш', 'записать', 'добавь', 'поставь', 'забронируй', 'оформи', 'назначь', 'запланируй', 'создай'].some(root =>
        word.startsWith(root) || (Math.min(word.length, root.length) >= 5 && levenshteinDistance(phoneticKey(word), phoneticKey(root)) <= 1)
      )
    );
  }

  function freeSlotSignal(text) {
    if (FREE_SLOT_WORDS.test(text)) return true;
    const slot = fuzzyRoot(text, ['свободн', 'окошк', 'окно', 'слот']);
    const search = fuzzyRoot(text, ['найди', 'покажи', 'подбери', 'предложи']);
    return slot && (search || /(?:^|\s)есть\s+ли(?=\s|$)/.test(text));
  }

  function understanding(model, repaired) {
    const ambiguous = Boolean(needsClarification(model) || (model?.candidates?.length || 0) > 1 || ['help','error','smart_clarification','ai_clarification'].includes(model?.kind));
    const contextual = Boolean(model?.continuedFromContext || model?.continuedFromScreen || model?.kind === 'compound_plan');
    const understandingConfidence = ambiguous ? 'low' : (repaired?.corrections?.length || contextual ? 'medium' : 'high');
    return repaired?.corrections?.length
      ? { ...model, understandingConfidence, corrections:repaired.corrections }
      : { ...model, understandingConfidence };
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
    const text = repairCommand(command).text;
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
    const text = repairCommand(command).text;
    const compactHalf = text.match(/(?:^|\s)пол\s*([а-я]+)(?=\s|$)/);
    if (compactHalf && HALF_HOURS[compactHalf[1]]) return HALF_HOURS[compactHalf[1]];
    const spokenHalf = text.match(/(?:^|\s)(?:в\s+)?половин(?:а|е|у)\s+([а-я]+)(?=\s|$)/);
    if (spokenHalf && HALF_HOURS[spokenHalf[1]]) return HALF_HOURS[spokenHalf[1]];

    const applyDayPart = (hour, dayPart) => {
      if ((dayPart === 'вечера' || dayPart === 'дня') && hour >= 1 && hour <= 11) return hour + 12;
      if ((dayPart === 'утра' || dayPart === 'ночи') && hour === 12) return 0;
      return hour;
    };
    const clock = text.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s+(утра|дня|вечера|ночи))?(?=\s|$)/);
    if (clock) {
      const hour = applyDayPart(Number(clock[1]), clock[3]);
      return `${String(hour).padStart(2, '0')}:${clock[2]}`;
    }
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
    const minuteWords = { пять:5, десять:10, пятнадцать:15, двадцать:20, двадцатьпять:25, тридцать:30, тридцатьпять:35, сорок:40, сорокпять:45, пятьдесят:50, пятьдесятпять:55 };
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
      const hasHourWord = /^(час|часа|часов)$/.test(words[minuteIndex] || '');
      const adjustedMinuteIndex = minuteIndex + (hasHourWord ? 1 : 0);
      const adjustedCompoundMinute = minuteWords[`${words[adjustedMinuteIndex] || ''}${words[adjustedMinuteIndex + 1] || ''}`];
      const adjustedMinute = adjustedCompoundMinute ?? minuteWords[words[adjustedMinuteIndex]] ?? minute;
      const adjustedMinuteWordCount = Number.isInteger(adjustedCompoundMinute) ? 2 : (Number.isInteger(minuteWords[words[adjustedMinuteIndex]]) ? 1 : minuteWordCount);
      const minuteSuffix = /^(минута|минуты|минут)$/.test(words[adjustedMinuteIndex + adjustedMinuteWordCount] || '') ? 1 : 0;
      const dayPart = words[adjustedMinuteIndex + adjustedMinuteWordCount + minuteSuffix];
      hour = applyDayPart(hour, dayPart);
      return `${String(hour).padStart(2, '0')}:${String(adjustedMinute).padStart(2, '0')}`;
    }
    return '';
  }

  const FLEXIBLE_HOUR_PATTERN = '(?:[0-2]?\\d(?::[0-5]\\d)?|ноль|час|один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|шестнадцать|семнадцать|восемнадцать|девятнадцать|двадцать(?:\\s+(?:один|два|три))?)(?:\\s+(?:утра|дня|вечера|ночи))?';

  function timeMinutes(value) {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
  }

  function timeFromMinutes(value) {
    const minutes = Math.max(0, Math.min(1439, Math.round(Number(value) || 0)));
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function businessBoundaryTime(value) {
    const source = normalizeText(value);
    const parsed = parseRussianTime(`в ${source}`);
    if (!parsed) return '';
    const minutes = timeMinutes(parsed);
    if (!/(?:утра|дня|вечера|ночи)/.test(source) && minutes >= 60 && minutes <= 7 * 60) return timeFromMinutes(minutes + 12 * 60);
    return parsed;
  }

  function parseTimePreference(command, preferences = {}) {
    const text = repairCommand(command).text;
    const preference = { minTime:'', maxTime:'', targetTime:'', order:'earliest', avoidFirst:false, betweenBookings:false, label:'', source:'' };
    const between = text.match(new RegExp(`(?:между|с)\\s+(${FLEXIBLE_HOUR_PATTERN})\\s+(?:и|до)\\s+(${FLEXIBLE_HOUR_PATTERN})(?=\\s|$)`));
    if (between) {
      preference.minTime = businessBoundaryTime(between[1]);
      preference.maxTime = businessBoundaryTime(between[2]);
      if (timeMinutes(preference.minTime) > timeMinutes(preference.maxTime)) [preference.minTime, preference.maxTime] = [preference.maxTime, preference.minTime];
      preference.targetTime = timeFromMinutes((timeMinutes(preference.minTime) + timeMinutes(preference.maxTime)) / 2);
      preference.order = 'nearest';
      preference.label = `между ${preference.minTime} и ${preference.maxTime}`;
      preference.source = 'explicit';
    } else if (/(?:после\s+обеда|во\s+второй\s+половине\s+дня)/.test(text)) {
      Object.assign(preference, { minTime:'14:00', targetTime:'15:00', order:'nearest', label:'после обеда', source:'explicit' });
    } else if (/(?:до\s+обеда|в\s+первой\s+половине\s+дня)/.test(text)) {
      Object.assign(preference, { maxTime:'13:00', targetTime:'11:00', order:'nearest', label:'до обеда', source:'explicit' });
    } else if (/(?:ближе\s+к\s+вечеру|вечером|на\s+вечер)/.test(text)) {
      Object.assign(preference, { minTime:'17:00', targetTime:'18:00', order:'nearest', label:'ближе к вечеру', source:'explicit' });
    } else if (/(?:утром|на\s+утро)/.test(text)) {
      Object.assign(preference, { minTime:'08:00', maxTime:'12:00', targetTime:'10:00', order:'nearest', label:'утром', source:'explicit' });
    } else {
      const after = text.match(new RegExp(`(?:после|не\\s+раньше)\\s+(${FLEXIBLE_HOUR_PATTERN})(?=\\s|$)`));
      const before = text.match(new RegExp(`(?:до|не\\s+позже)\\s+(${FLEXIBLE_HOUR_PATTERN})(?=\\s|$)`));
      if (after) preference.minTime = businessBoundaryTime(after[1]);
      if (before) preference.maxTime = businessBoundaryTime(before[1]);
      if (preference.minTime || preference.maxTime) {
        preference.targetTime = preference.minTime || preference.maxTime;
        preference.order = preference.minTime ? 'earliest' : 'latest';
        preference.label = preference.minTime && preference.maxTime ? `с ${preference.minTime} до ${preference.maxTime}` : preference.minTime ? `после ${preference.minTime}` : `до ${preference.maxTime}`;
        preference.source = 'explicit';
      }
    }
    if (/(?:не\s+(?:самое\s+)?(?:раннее|раньше)|не\s+первое\s+окн|не\s+с\s+утра)/.test(text)) {
      preference.avoidFirst = true;
      preference.label = preference.label ? `${preference.label}, не первое окно` : 'не первое свободное окно';
      preference.source = 'explicit';
    }
    if (/(?:между\s+(?:клиентами|записями|визитами)|в\s+промежутке\s+между\s+(?:клиентами|записями))/.test(text)) {
      preference.betweenBookings = true;
      preference.label = preference.label ? `${preference.label}, между записями` : 'между существующими записями';
      preference.source = 'explicit';
    }
    if (/(?:самое\s+позднее|попозже|как\s+можно\s+позже)/.test(text)) {
      preference.order = 'latest';
      preference.label = preference.label || 'как можно позже';
      preference.source = 'explicit';
    } else if (/(?:самое\s+раннее|пораньше|как\s+можно\s+раньше|первое\s+окн)/.test(text) && !preference.avoidFirst) {
      preference.order = 'earliest';
      preference.label = preference.label || 'как можно раньше';
      preference.source = 'explicit';
    }
    if (!preference.source && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(preferences.preferredTime || '')) && Number(preferences.observationCount || 0) >= 2) {
      preference.targetTime = String(preferences.preferredTime);
      preference.order = 'nearest';
      preference.label = `ближе к привычному времени ${preference.targetTime}`;
      preference.source = 'habit';
    }
    return preference.source ? preference : null;
  }

  function applySlotPreferences(slots = [], preference = null, context = {}) {
    const unique = [...new Set((Array.isArray(slots) ? slots : []).map(String).filter(item => timeMinutes(item) >= 0))].sort();
    if (!preference) return { slots:unique, options:unique.map((time, index) => ({ time, recommended:index === 0, reason:index === 0 ? 'Ближайшее свободное окно' : 'Свободно по актуальному расписанию' })) };
    const minimum = timeMinutes(preference.minTime);
    const maximum = timeMinutes(preference.maxTime);
    let filtered = unique.filter(time => (minimum < 0 || timeMinutes(time) >= minimum) && (maximum < 0 || timeMinutes(time) <= maximum));
    if (preference.avoidFirst && filtered.length > 1) filtered = filtered.slice(1);
    const target = timeMinutes(preference.targetTime);
    const date = String(context.date || '');
    const duration = Math.max(1, Number(context.durationMinutes) || 1);
    const dayBookings = (context.bookings || []).filter(item => item.date === date && item.status !== 'cancelled').map(item => ({
      start:timeMinutes(item.time),
      end:timeMinutes(item.time) + Math.max(1, Number(item.durationMinutes) || 1)
    })).filter(item => item.start >= 0);
    const betweenExistingBookings = time => {
      const start = timeMinutes(time);
      const end = start + duration;
      return dayBookings.some(item => item.end <= start) && dayBookings.some(item => item.start >= end);
    };
    filtered.sort((left, right) => {
      if (preference.betweenBookings && betweenExistingBookings(left) !== betweenExistingBookings(right)) return betweenExistingBookings(left) ? -1 : 1;
      if (preference.order === 'latest') return timeMinutes(right) - timeMinutes(left);
      if (preference.order === 'nearest' && target >= 0) return Math.abs(timeMinutes(left) - target) - Math.abs(timeMinutes(right) - target) || timeMinutes(left) - timeMinutes(right);
      return timeMinutes(left) - timeMinutes(right);
    });
    return {
      slots:filtered,
      options:filtered.map((time, index) => ({
        time,
        recommended:index === 0,
        reason:preference.betweenBookings && betweenExistingBookings(time) ? 'Заполняет промежуток между существующими записями' : index === 0 ? `Лучше соответствует условию «${preference.label}»` : `Подходит под условие «${preference.label}»`
      }))
    };
  }

  function parseDuration(command) {
    const text = repairCommand(command).text;
    const minutes = text.match(/(?:^|\s)(\d{1,3})\s*(?:мин|минута|минуту|минуты|минут)(?=\s|$)/);
    if (minutes) return Math.min(1440, Math.max(1, Number(minutes[1])));
    const spokenMinutes = text.match(/(?:^|\s)(пять|десять|пятнадцать|двадцать|двадцать\s+пять|тридцать|сорок|сорок\s+пять|пятьдесят|шестьдесят|девяносто|сто\s+двадцать)\s+(?:мин|минута|минуту|минуты|минут)(?=\s|$)/);
    if (spokenMinutes) {
      const values = { пять:5, десять:10, пятнадцать:15, двадцать:20, 'двадцать пять':25, тридцать:30, сорок:40, 'сорок пять':45, пятьдесят:50, шестьдесят:60, девяносто:90, 'сто двадцать':120 };
      return values[spokenMinutes[1]] || 0;
    }
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
      const exactWords = words.filter(word => commandWords.some(commandWord => serviceStem(commandWord) === serviceStem(word)));
      const fuzzyWords = words.filter(word => !exactWords.includes(word) && commandWords.some(commandWord => wordsAreClose(commandWord, word)));
      const allWordsMatched = words.length && exactWords.length + fuzzyWords.length === words.length;
      const inflectedPhrase = allWordsMatched ? (fuzzyWords.length ? 45 : 70) : 0;
      const wordScore = exactWords.length * 5 + fuzzyWords.length * 2;
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
    const cleaned = repairCommand(command).text.replace(/(?:^|\s)а\s+на(?=\s|$)/g, ' анна').trim();
    const match = cleaned.match(/(?:хочу\s+|нужно\s+|надо\s+|давай\s+)?(?:запиш[а-яё]*|записать|добав[а-яё]*|постав[а-яё]*|заброниру[а-яё]*|оформ[а-яё]*|назнач[а-яё]*|запланиру[а-яё]*|созда[а-яё]*)(?:\s+(?:новую?\s+)?(?:запись|визит|прием|приём|сеанс))?(?:\s+(?:для\s+)?(?:клиента?|клиентку))?\s+(.+)/iu);
    if (!match) return '';
    const dateWords = new Set([...Object.keys(MONTHS), ...Object.keys(WEEKDAYS), ...Object.keys(ORDINAL_DAYS), 'сегодня', 'завтра', 'послезавтра', 'через']);
    const words = [];
    for (const word of match[1].trim().split(/\s+/)) {
      const normalized = normalizeText(word).replace(/\s+/g, '');
      if (!normalized || COMMAND_FILLERS.has(normalized) || /^(клиент|клиентка)$/.test(normalized)) continue;
      if (dateWords.has(normalized) || /^\d{1,2}[./-]\d{1,2}/.test(normalized) || /^(в|к|на|с|продолжительностью)$/.test(normalized) || /^\d/.test(normalized)) break;
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

  function upcomingBookings(snapshot, now = new Date()) {
    const today = snapshot.today || localIsoDate(dateAtNoon(now));
    const minute = Number.isInteger(snapshot.currentMinute) ? snapshot.currentMinute : now.getHours() * 60 + now.getMinutes();
    return (snapshot.bookings || []).filter(item => item.date >= today
      && !['cancelled', 'completed', 'no_show'].includes(item.status)
      && !['completed', 'no_show'].includes(item.outcome)
      && (item.date > today || timeMinutes(item.time) >= minute))
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }

  function moneyLabel(value) {
    return `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} ₽`;
  }

  function countLabel(value, forms) {
    const count = Math.abs(Math.trunc(Number(value) || 0));
    const tens = count % 100;
    const units = count % 10;
    const form = tens >= 11 && tens <= 14 ? forms[2] : units === 1 ? forms[0] : units >= 2 && units <= 4 ? forms[1] : forms[2];
    return `${count} ${form}`;
  }

  function shiftIsoDate(iso, days) {
    const [year, month, day] = String(iso || '').split('-').map(Number);
    const date = new Date(year, month - 1, day, 12);
    date.setDate(date.getDate() + days);
    return localIsoDate(date);
  }

  function reportingPeriod(command, now = new Date()) {
    const text = repairCommand(command).text;
    const today = localIsoDate(dateAtNoon(now));
    if (/месяц/.test(text)) {
      const date = dateAtNoon(now);
      const start = localIsoDate(new Date(date.getFullYear(), date.getMonth(), 1, 12));
      const previousMonthLastDay = new Date(date.getFullYear(), date.getMonth(), 0, 12).getDate();
      const previousStartDate = new Date(date.getFullYear(), date.getMonth() - 1, 1, 12);
      const previousEndDate = new Date(date.getFullYear(), date.getMonth() - 1, Math.min(date.getDate(), previousMonthLastDay), 12);
      return { start, end:today, previousStart:localIsoDate(previousStartDate), previousEnd:localIsoDate(previousEndDate), label:'в этом месяце' };
    }
    if (/недел/.test(text) || /почему|упал|снизил|изменил/.test(text)) {
      const date = dateAtNoon(now);
      const weekday = (date.getDay() + 6) % 7;
      const start = shiftIsoDate(today, -weekday);
      const previousStart = shiftIsoDate(start, -7);
      return { start, end:today, previousStart, previousEnd:shiftIsoDate(previousStart, weekday), label:'на этой неделе' };
    }
    const requested = parseRussianDate(text, now) || today;
    return { start:requested, end:requested, previousStart:shiftIsoDate(requested, -1), previousEnd:shiftIsoDate(requested, -1), label:requested === today ? 'сегодня' : formatDate(requested) };
  }

  function bookingsInRange(snapshot, start, end) {
    return (snapshot.bookings || []).filter(item => item.date >= start && item.date <= end);
  }

  function revenueStats(snapshot, start, end) {
    const rows = bookingsInRange(snapshot, start, end);
    const completed = rows.filter(item => item.status !== 'cancelled' && item.outcome === 'completed');
    const revenue = completed.reduce((sum, item) => sum + Number(item.amountRub || 0), 0);
    return {
      revenue,
      completed:completed.length,
      average:completed.length ? Math.round(revenue / completed.length) : 0,
      cancelled:rows.filter(item => item.status === 'cancelled').length,
      noShows:rows.filter(item => item.outcome === 'no_show').length,
      unpaid:completed.filter(item => item.paymentMethod === 'unpaid').length
    };
  }

  function revenueModel(command, snapshot, now = new Date()) {
    const period = reportingPeriod(command, now);
    const current = revenueStats(snapshot, period.start, period.end);
    const compare = /почему|упал|снизил|изменил|сравн/.test(normalizeText(command));
    if (!compare) return {
      kind:'revenue_summary', title:`Выручка ${period.label}`, message:current.completed ? `Получено ${moneyLabel(current.revenue)} за ${countLabel(current.completed, ['завершённый визит', 'завершённых визита', 'завершённых визитов'])}.` : 'Завершённых визитов за этот период нет.',
      metrics:[{ value:moneyLabel(current.revenue), label:'выручка' }, { value:String(current.completed), label:'визитов' }, { value:moneyLabel(current.average), label:'средний чек' }],
      points:current.unpaid ? [`Без оплаты отмечено визитов: ${current.unpaid}`] : []
    };
    const previous = revenueStats(snapshot, period.previousStart, period.previousEnd);
    const difference = current.revenue - previous.revenue;
    const percent = previous.revenue ? Math.round((difference / previous.revenue) * 100) : null;
    const points = [];
    const visitDifference = current.completed - previous.completed;
    const averageDifference = current.average - previous.average;
    const cancellationDifference = current.cancelled - previous.cancelled;
    if (visitDifference) points.push(`${visitDifference > 0 ? 'Проведено больше' : 'Проведено меньше'} на ${countLabel(visitDifference, ['визит', 'визита', 'визитов'])}.`);
    if (averageDifference) points.push(`Средний чек ${averageDifference > 0 ? 'вырос' : 'снизился'} на ${moneyLabel(Math.abs(averageDifference))}.`);
    if (cancellationDifference > 0) points.push(`Отмен стало больше на ${cancellationDifference}.`);
    if (current.unpaid) points.push(`Без оплаты отмечено визитов: ${current.unpaid}.`);
    return {
      kind:'revenue_change', title:difference < 0 ? 'Что повлияло на снижение выручки' : difference > 0 ? 'Что изменило выручку' : 'Выручка не изменилась',
      message:previous.revenue ? `По сравнению с предыдущим периодом: ${difference > 0 ? '+' : ''}${moneyLabel(difference)}${percent === null ? '' : ` (${percent > 0 ? '+' : ''}${percent}%)`}. Это факторы, рассчитанные по записям, а не предположение.` : 'В предыдущем периоде нет выручки для корректного сравнения.',
      metrics:[{ value:moneyLabel(current.revenue), label:'текущий период' }, { value:moneyLabel(previous.revenue), label:'предыдущий период' }, { value:String(current.completed), label:'завершённых визитов' }],
      points:points.length ? points : ['Заметных изменений количества визитов, среднего чека и отмен не найдено.']
    };
  }

  function nameMatchScore(command, name) {
    const generic = /^(?:материал|остат|склад|закуп)/;
    const commandWords = normalizeText(command).split(' ').filter(word => word && !generic.test(word));
    const nameWords = normalizeText(name).split(' ').filter(word => word.length > 2 && !generic.test(word));
    return nameWords.reduce((score, word) => score + (commandWords.some(commandWord => serviceStem(commandWord) === serviceStem(word) || wordsAreClose(commandWord, word)) ? 1 : 0), 0);
  }

  function bookingChangeModel(command, snapshot, now) {
    const period = reportingPeriod(command, now);
    const current = bookingsInRange(snapshot, period.start, period.end);
    const previous = bookingsInRange(snapshot, period.previousStart, period.previousEnd);
    const count = rows => rows.filter(item => item.status !== 'cancelled').length;
    const difference = count(current) - count(previous);
    return {
      kind:'booking_change', title:'Как изменилось количество записей',
      message:`По загруженному журналу: ${difference > 0 ? '+' : ''}${difference} записей без отмен. Это сравнение дат визитов, а не количества новых заявок.`,
      metrics:[{ value:String(count(current)), label:'текущий период' }, { value:String(count(previous)), label:'предыдущий период' }],
      points:[`Периоды: ${formatDate(period.start)} — ${formatDate(period.end)} и ${formatDate(period.previousStart)} — ${formatDate(period.previousEnd)}.`,
        `Отмен: ${current.filter(item => item.status === 'cancelled').length}; в предыдущем периоде: ${previous.filter(item => item.status === 'cancelled').length}.`,
        'По одним записям нельзя установить причину изменения спроса. Проверьте рабочие часы, доступность услуг и источники новых клиентов.'],
      openSection:'bookings', openLabel:'Открыть записи'
    };
  }

  function inventoryForecastModel(item, snapshot, now = new Date()) {
    const usageRows = (snapshot.inventory?.usage || []).filter(row => String(row.itemId || '') === String(item.id || '') && Number(row.quantity) > 0);
    if (!usageRows.length) return {
      kind:'inventory_forecast',
      title:`Не могу рассчитать запас: ${item.name}`,
      message:'Для этого материала не указана норма расхода на услуги.',
      points:['Добавьте норму расхода в разделе «Склад», затем повторите запрос.']
    };
    const usageByService = new Map();
    usageRows.forEach(row => usageByService.set(String(row.serviceId || ''), (usageByService.get(String(row.serviceId || '')) || 0) + Number(row.quantity || 0)));
    const serviceIdByName = new Map((snapshot.services || []).map(service => [normalizeText(service.name), String(service.id || '')]));
    const today = snapshot.today || localIsoDate(dateAtNoon(now));
    const bookings = (snapshot.bookings || []).filter(booking => booking.date >= today && booking.status !== 'cancelled' && booking.outcome !== 'no_show').sort((left, right) => `${left.date}${left.time || ''}`.localeCompare(`${right.date}${right.time || ''}`));
    let plannedUsage = 0;
    let depletionDate = '';
    for (const booking of bookings) {
      const serviceId = String(booking.serviceId || serviceIdByName.get(normalizeText(booking.serviceName)) || '');
      const quantity = usageByService.get(serviceId) || 0;
      if (!quantity) continue;
      plannedUsage += quantity;
      if (!depletionDate && plannedUsage > Math.max(0, Number(item.quantity) || 0)) depletionDate = booking.date;
    }
    const unit = String(item.unit || '').trim();
    const quantityLabel = `${Math.max(0, Number(item.quantity) || 0).toLocaleString('ru-RU')} ${unit}`.trim();
    if (!plannedUsage) return {
      kind:'inventory_forecast',
      title:`Запас: ${item.name}`,
      message:`Сейчас в наличии ${quantityLabel}. В загруженном расписании нет услуг, расходующих этот материал.`,
      points:['Срок запаса появится, когда в расписании будут подходящие записи.']
    };
    if (depletionDate) {
      const days = Math.max(0, Math.round((dateAtNoon(new Date(`${depletionDate}T12:00:00`)) - dateAtNoon(new Date(`${today}T12:00:00`))) / 86400000));
      return {
        kind:'inventory_forecast',
        title:`Запаса может не хватить: ${item.name}`,
        message:`По текущим записям материал закончится ${formatDate(depletionDate)} — примерно через ${countLabel(days, ['день', 'дня', 'дней'])}.`,
        points:[`В наличии: ${quantityLabel}.`, `Плановый расход до этой записи превысит остаток.`]
      };
    }
    const remaining = Math.max(0, Number(item.quantity) - plannedUsage);
    return {
      kind:'inventory_forecast',
      title:`Запаса хватит по текущему расписанию: ${item.name}`,
      message:`На все загруженные будущие записи требуется ${plannedUsage.toLocaleString('ru-RU')} ${unit}.`,
      points:[`В наличии: ${quantityLabel}.`, `Останется: ${remaining.toLocaleString('ru-RU')} ${unit}.`]
    };
  }

  function inventoryModel(command, snapshot, now = new Date()) {
    const inventory = snapshot.inventory;
    if (!inventory) return { kind:'inventory_summary', title:'Складские данные недоступны', message:'Откройте раздел склада и дождитесь загрузки данных.', points:[] };
    if (!inventory.enabled) return { kind:'inventory_summary', title:'Складской учёт выключен', message:'Включите его в разделе «Склад», чтобы помощник мог контролировать остатки.', points:[] };
    const text = normalizeText(command);
    const scoredItems = (inventory.items || []).map(item => ({ item, score:nameMatchScore(text, item.name) })).filter(entry => entry.score > 0);
    const bestScore = Math.max(0, ...scoredItems.map(entry => entry.score));
    const named = scoredItems.filter(entry => entry.score === bestScore).map(entry => entry.item);
    if (/(?:на сколько|сколько\s+дн|до\s+.+\s+хватит|хватит\s+ли|хватит\s+на)/.test(text)) {
      if (named.length === 1) return inventoryForecastModel(named[0], snapshot, now);
      return {
        kind:'inventory_forecast',
        title:named.length ? 'Уточните материал' : 'Не удалось определить материал',
        message:named.length ? 'В запросе найдено несколько материалов. Назовите один из них.' : 'Назовите материал так, как он записан в разделе «Склад».',
        points:named.slice(0, 8).map(item => item.name)
      };
    }
    const source = named.length ? named : (inventory.items || []).filter(item => Number(item.quantity) <= Number(item.lowStockThreshold));
    const points = source.slice(0, 8).map(item => `${item.name}: ${(Number(item.quantity) || 0).toLocaleString('ru-RU')} ${item.unit || ''}${Number(item.quantity) <= Number(item.lowStockThreshold) ? ' — заканчивается' : ''}`);
    return { kind:'inventory_summary', title:named.length ? 'Остаток материала' : 'Материалы, требующие внимания', message:points.length ? `Найдено позиций: ${points.length}.` : 'Материалов ниже минимального остатка нет.', points };
  }

  function attentionModel(snapshot, now = new Date()) {
    const today = snapshot.today || localIsoDate(dateAtNoon(now));
    const futureEnd = shiftIsoDate(today, 6);
    const week = bookingsInRange(snapshot, today, futureEnd);
    const completed = (snapshot.bookings || []).filter(item => item.outcome === 'completed');
    const points = [];
    const unpaid = completed.filter(item => item.paymentMethod === 'unpaid').length;
    const cancelled = week.filter(item => item.status === 'cancelled').length;
    const lowStock = snapshot.inventory?.enabled ? (snapshot.inventory.items || []).filter(item => Number(item.quantity) <= Number(item.lowStockThreshold)) : [];
    if (unpaid) points.push(`Не оплачено завершённых визитов: ${unpaid}.`);
    if (cancelled) points.push(`Отмен на ближайшие 7 дней: ${cancelled}.`);
    if (snapshot.notifications?.failed) points.push(`Не доставлено уведомлений: ${snapshot.notifications.failed}.`);
    if (lowStock.length) points.push(`Заканчиваются материалы: ${lowStock.slice(0, 3).map(item => item.name).join(', ')}${lowStock.length > 3 ? ` и ещё ${lowStock.length - 3}` : ''}.`);
    if (!snapshot.services?.length) points.push('Нет активных услуг для онлайн-записи.');
    const inventoryChecked = Boolean(snapshot.inventory?.enabled);
    return { kind:'attention', title:points.length ? 'Требует внимания' : 'Всё спокойно', message:points.length ? `Найдено важных пунктов: ${points.length}.${inventoryChecked ? '' : ' Складские остатки не проверены.'}` : inventoryChecked ? 'Неоплаченных визитов, ближайших отмен и низких остатков не найдено.' : 'По доступным данным неоплаченных визитов и ближайших отмен нет. Складские остатки не загружены.', points };
  }

  function clientSummaryModel(command, snapshot, now = new Date()) {
    const period = reportingPeriod(command, now);
    const rows = bookingsInRange(snapshot, period.start, period.end).filter(item => item.status !== 'cancelled' && item.clientKey);
    const allBefore = new Set((snapshot.bookings || []).filter(item => item.date < period.start && item.status !== 'cancelled' && item.clientKey).map(item => item.clientKey));
    const current = new Set(rows.map(item => item.clientKey));
    const newClients = [...current].filter(key => !allBefore.has(key)).length;
    return { kind:'clients_summary', title:`Клиенты ${period.label}`, message:`Уникальных клиентов: ${current.size}.`, metrics:[{ value:String(newClients), label:'новых' }, { value:String(current.size - newClients), label:'повторных' }, { value:String(current.size), label:'всего' }] };
  }

  function servicePerformanceModel(command, snapshot, now = new Date()) {
    const period = reportingPeriod(command, now);
    const totals = new Map();
    bookingsInRange(snapshot, period.start, period.end).filter(item => item.status !== 'cancelled' && item.outcome === 'completed').forEach(item => {
      const serviceName = String(item.serviceName || 'Услуга');
      const current = totals.get(serviceName) || { visits:0, revenue:0 };
      current.visits += 1;
      current.revenue += Number(item.amountRub || 0);
      totals.set(serviceName, current);
    });
    const points = [...totals.entries()].sort((a, b) => b[1].revenue - a[1].revenue || b[1].visits - a[1].visits).slice(0, 6).map(([name, value]) => `${name}: ${moneyLabel(value.revenue)} · ${countLabel(value.visits, ['визит', 'визита', 'визитов'])}`);
    return { kind:'service_performance', title:`Услуги по выручке ${period.label}`, message:points.length ? 'Сначала показаны услуги с наибольшей полученной оплатой.' : `Завершённых услуг ${period.label} нет.`, points };
  }

  function nearestFutureBooking(command, snapshot, now = new Date()) {
    const requestedDate = parseRussianDate(command, now);
    const future = upcomingBookings(snapshot, now)
      .filter(item => !requestedDate || item.date === requestedDate)
      .sort((left, right) => `${left.date}${left.time || ''}`.localeCompare(`${right.date}${right.time || ''}`));
    const explicitId = normalizeText(command).match(/(?:^|\s)запись-id-([a-z0-9-]+)(?=\s|$)/)?.[1] || '';
    if (explicitId) return future.find(item => String(item.id || '') === explicitId) || null;
    const recipient = normalizeText(command).match(/(?:напиши|сообщи)\s+([а-я]+)(?=\s|$)/)?.[1];
    const namedRecipient = recipient && !/^(?:сообщение|напоминание|подтверждение|клиенту|ей|ему|что)$/.test(recipient);
    const matched = clientBookingMatches(namedRecipient ? recipient : command, future);
    if (matched.length) return matched.sort((left, right) => `${left.date}${left.time || ''}`.localeCompare(`${right.date}${right.time || ''}`))[0];
    return !namedRecipient && future.length === 1 ? future[0] : null;
  }

  function messageDraftModel(command, snapshot, now = new Date()) {
    const text = repairCommand(command).text;
    const booking = nearestFutureBooking(text, snapshot, now);
    const client = String(booking?.clientName || '').trim();
    const firstName = client.split(/\s+/)[0] || '';
    const greeting = firstName && firstName !== 'Клиент' ? `Здравствуйте, ${firstName}!` : 'Здравствуйте!';
    let title = 'Черновик сообщения клиенту';
    let draftText = '';
    const customMessage = String(command).match(/(?:напиши|сообщи)\s+[^,]+,?\s+что\s+(.+)$/i)?.[1]?.trim();
    if (customMessage) {
      title = client ? `Сообщение · ${client}` : 'Черновик сообщения клиенту';
      draftText = `${greeting} ${customMessage.charAt(0).toLocaleUpperCase('ru-RU')}${customMessage.slice(1)}${/[.!?]$/.test(customMessage) ? '' : '.'}`;
    } else if (/(?:отзыв|рецензи)/.test(text)) {
      const negative = /(?:плох|ужас|не понрав|недовол|опозд|груб)/.test(text);
      title = 'Черновик ответа на отзыв';
      draftText = negative
        ? 'Спасибо, что рассказали о ситуации. Нам важно разобраться и исправить впечатление. Пожалуйста, напишите нам удобным способом — уточним детали и предложим решение.'
        : 'Спасибо за ваш отзыв! Очень рады, что вам понравилось. Будем ждать вас снова!';
    } else if (/(?:подтвержд)/.test(text)) {
      title = client ? `Подтверждение · ${client}` : 'Черновик подтверждения записи';
      draftText = booking
        ? `${greeting} Подтверждаю вашу запись ${formatDate(booking.date)} в ${booking.time} на услугу «${booking.serviceName || 'Услуга'}». До встречи!`
        : `${greeting} Ваша запись подтверждена. Дата: [дата], время: [время], услуга: [услуга]. До встречи!`;
    } else if (/(?:вернут|давно|повторн|снова|реактив)/.test(text)) {
      title = client ? `Сообщение · ${client}` : 'Черновик сообщения постоянному клиенту';
      draftText = `${greeting} Давно вас не видели. Если захотите повторить любимую процедуру, выбрать удобное время можно через онлайн-запись. Будем рады встрече!`;
    } else {
      title = client ? `Напоминание · ${client}` : 'Черновик напоминания';
      draftText = booking
        ? `${greeting} Напоминаю о записи ${formatDate(booking.date)} в ${booking.time} на услугу «${booking.serviceName || 'Услуга'}». Если планы изменились, пожалуйста, сообщите заранее.`
        : `${greeting} Напоминаю о записи [дата] в [время] на услугу «[услуга]». Если планы изменились, пожалуйста, сообщите заранее.`;
    }
    return {
      kind:'message_draft',
      title,
      message:booking || /(?:отзыв|рецензи|вернут|давно|повторн|снова|реактив)/.test(text)
        ? 'Текст подготовлен по доступному контексту. Проверьте его перед отправкой.'
        : 'Не удалось однозначно выбрать запись, поэтому оставлены поля для проверки.',
      draftText,
      copyLabel:'Скопировать текст',
      openSection:'notifications',
      openLabel:'Открыть уведомления',
      needsDetail:!booking && !/(?:отзыв|рецензи|вернут|давно|повторн|снова|реактив)/.test(text) ? 'запись или клиент' : ''
    };
  }

  function serviceForCommand(command, snapshot) {
    const candidates = findServices(command, snapshot.services || []);
    return candidates.length === 1 ? candidates[0] : null;
  }

  function contentDraftModel(command, snapshot) {
    const text = repairCommand(command).text;
    const service = serviceForCommand(text, snapshot);
    const organization = String(snapshot.organizationName || '').trim();
    const brand = organization || 'мастера';
    const serviceName = service?.name || '[название услуги]';
    const price = Number(service?.priceRub) > 0 ? ` Стоимость — ${moneyLabel(service.priceRub)}.` : '';
    const duration = Number(service?.durationMinutes) > 1 ? ` Продолжительность — ${service.durationMinutes} минут.` : '';
    const isDescription = /(?:описан|карточк|каталог)/.test(text);
    const draftText = isDescription
      ? `${serviceName} — процедура с индивидуальным подходом и понятным результатом. Перед началом уточним ваши пожелания, после — дадим рекомендации по уходу.${duration}${price}`
      : `${organization ? `${organization}: ` : ''}${serviceName}. Позаботьтесь о себе и выберите удобное время онлайн.${duration}${price} Запись открыта — будем рады встрече!`;
    return {
      kind:'content_draft',
      title:isDescription ? `Описание услуги: ${serviceName}` : organization ? `Черновик публикации · ${brand}` : 'Черновик публикации',
      message:service ? 'Текст составлен по данным услуги без выдуманных обещаний.' : 'Услуга не определена. Замените поля в квадратных скобках или назовите услугу в следующей команде.',
      draftText,
      copyLabel:'Скопировать текст',
      openSection:service ? 'services' : 'portfolio',
      openLabel:service ? 'Открыть услуги' : 'Открыть портфолио',
      needsDetail:service ? '' : 'услуга'
    };
  }

  function roundPrice(value) {
    const amount = Math.max(0, Number(value) || 0);
    if (!amount) return 0;
    const step = amount < 1000 ? 50 : 100;
    return Math.max(step, Math.round(amount / step) * step);
  }

  function priceAdviceModel(command, snapshot) {
    const service = serviceForCommand(command, snapshot);
    if (!service) return {
      kind:'price_advice',
      title:'Уточните услугу для расчёта цены',
      message:'Назовите услугу так, как она указана в каталоге. Помощник не будет менять цену автоматически.',
      points:(snapshot.services || []).slice(0, 8).map(item => `${item.name}: ${moneyLabel(item.priceRub)}`),
      openSection:'services',
      openLabel:'Открыть услуги',
      needsDetail:'услуга'
    };
    const currentPrice = Number(service.priceRub) || 0;
    const completed = (snapshot.bookings || []).filter(item => item.status !== 'cancelled' && item.outcome === 'completed' && (String(item.serviceId || '') === String(service.id) || normalizeText(item.serviceName) === normalizeText(service.name)));
    if (!currentPrice) return {
      kind:'price_advice',
      title:`Цена услуги «${service.name}» не указана`,
      message:'Сначала задайте базовую цену. Без неё безопасный диапазон изменения рассчитать нельзя.',
      points:[`Завершённых визитов в доступной истории: ${completed.length}.`, 'Перед изменением сравните себестоимость, длительность и спрос.'],
      openSection:'services',
      openLabel:'Настроить услугу'
    };
    const careful = roundPrice(currentPrice * 1.05);
    const balanced = roundPrice(currentPrice * 1.1);
    return {
      kind:'price_advice',
      title:`Варианты цены для «${service.name}»`,
      message:'Это сценарии для проверки на собственной загрузке, а не рыночная оценка. Цена автоматически не изменена.',
      metrics:[{ value:moneyLabel(currentPrice), label:'сейчас' }, { value:String(completed.length), label:'завершённых визитов' }],
      points:[`Осторожный тест: ${moneyLabel(careful)} (+5%).`, `Сбалансированный тест: ${moneyLabel(balanced)} (+10%).`, 'Проверьте изменение числа записей и выручки через 2–4 недели.'],
      openSection:'services',
      openLabel:'Открыть цены'
    };
  }

  function promotionIdeasModel(snapshot, now = new Date()) {
    const today = snapshot.today || localIsoDate(dateAtNoon(now));
    const start = shiftIsoDate(today, -30);
    const counts = new Map((snapshot.services || []).map(item => [String(item.id), { service:item, completed:0 }]));
    (snapshot.bookings || []).filter(item => item.date >= start && item.date <= today && item.status !== 'cancelled' && item.outcome === 'completed').forEach(item => {
      const key = String(item.serviceId || '');
      if (counts.has(key)) counts.get(key).completed += 1;
    });
    const ranked = [...counts.values()].sort((left, right) => left.completed - right.completed || left.service.name.localeCompare(right.service.name, 'ru'));
    const focus = ranked[0]?.service || null;
    const nextWeek = bookingsInRange(snapshot, today, shiftIsoDate(today, 6)).filter(item => item.status !== 'cancelled').length;
    const focusName = focus?.name || 'выбранную услугу';
    return {
      kind:'promotion_ideas',
      title:'Идеи для продвижения',
      message:'Рекомендации основаны только на доступных записях и каталоге, без внешних рыночных данных.',
      metrics:[{ value:String(nextWeek), label:'записей на 7 дней' }, { value:String(snapshot.services?.length || 0), label:'активных услуг' }],
      points:[
        `Подсветить «${focusName}»: у неё меньше всего завершённых визитов за последние 30 дней.`,
        'Опубликовать ближайшие свободные окна с прямым призывом записаться онлайн.',
        'После завершённого визита отправить короткую просьбу об отзыве.',
        'Проверить результат через неделю: новые записи, отмены и выручку.'
      ],
      draftText:`На этой неделе открыта запись на «${focusName}». Выберите удобное время онлайн — будем рады встрече!`,
      copyLabel:'Скопировать публикацию',
      openSection:'analytics',
      openLabel:'Открыть статистику'
    };
  }

  function operationalBriefingModel(snapshot, now = new Date()) {
    const today = snapshot.today || localIsoDate(dateAtNoon(now));
    const schedule = activeBookings(snapshot, today);
    const attention = attentionModel(snapshot, now);
    const revenue = revenueStats(snapshot, today, today);
    const next = upcomingBookings(snapshot, now).find(item => item.date === today);
    const points = [];
    if (next) points.push(`Ближайшая запись: ${next.time} · ${next.clientName || 'Клиент'} · ${next.serviceName || 'Услуга'}.`);
    points.push(...(attention.points || []).slice(0, 4));
    if (!points.length) points.push('Срочных задач по доступным данным не найдено.');
    const metrics = [{ value:String(schedule.length), label:'записей сегодня' }, { value:String(attention.points?.length || 0), label:'категорий для проверки' }];
    if (roleAllowsFinancialData(snapshot)) metrics.splice(1, 0, { value:moneyLabel(revenue.revenue), label:'получено сегодня' });
    return {
      kind:'operational_briefing',
      title:'Короткая сводка и следующий шаг',
      message:next ? `Сегодня ${countLabel(schedule.length, ['запись', 'записи', 'записей'])}. Следующая — в ${next.time}.` : 'Предстоящих записей сегодня нет. Можно проверить свободные окна и задачи ниже.',
      metrics,
      points,
      explanation:next
        ? `Этот шаг выбран первым, потому что ближайший визит начнётся в ${next.time}, а остальные задачи можно выполнить после его проверки.`
        : attention.points?.length ? 'Этот шаг выбран первым, потому что в доступных данных есть задачи, требующие внимания.' : 'Срочных задач нет, поэтому полезнее сначала проверить загрузку ближайших дней.',
      openSection:'bookings',
      openLabel:'Открыть записи'
    };
  }

  function proactiveBriefingModel(snapshot, now = new Date()) {
    if (!snapshot?.authenticated || (!snapshot.synchronized && !snapshot.offlineReadable)) return null;
    const today = snapshot.today || localIsoDate(dateAtNoon(now));
    const attention = attentionModel(snapshot, now);
    const next = upcomingBookings(snapshot, now).find(item => item.date === today);
    if (attention.points?.length) return {
      title:`Нужно проверить: ${countLabel(attention.points.length, ['категория', 'категории', 'категорий'])}`,
      message:attention.points[0],
      prompt:'Что требует внимания?'
    };
    if (next) return {
      title:`Ближайшая запись в ${next.time}`,
      message:`${next.clientName || 'Клиент'} · ${next.serviceName || 'Услуга'}. Нажмите, чтобы получить план следующего шага.`,
      prompt:'Дай короткую сводку и план на день'
    };
    return {
      title:'Предстоящих записей сегодня нет',
      message:'Можно проверить свободные окна и выбрать действие для загрузки дня.',
      prompt:'Дай короткую сводку и план на день'
    };
  }

  function understoodAs(model) {
    const plan = model?.plan || {};
    if (model?.kind === 'find_slots') return `найти окно${plan.serviceName ? ` на «${plan.serviceName}»` : ''}${plan.date ? `, ${formatDate(plan.date)}` : ''}${plan.timePreference?.label ? `, ${plan.timePreference.label}` : ''}`;
    if (model?.kind === 'booking_draft') return `подготовить запись${plan.clientName ? ` для ${plan.clientName}` : ''}${plan.serviceName ? ` на «${plan.serviceName}»` : ''}${plan.date ? `, ${formatDate(plan.date)}` : ''}${plan.time ? ` в ${plan.time}` : plan.timePreference?.label ? `, ${plan.timePreference.label}` : ''}`;
    if (model?.kind === 'operation_preview') return `${model.operation === 'cancel' ? 'проверить отмену' : 'подготовить перенос'}${plan.clientName ? ` записи ${plan.clientName}` : ''}`;
    if (model?.kind === 'schedule_summary') return `показать расписание ${String(model.title || '').replace(/^Записи:\s*/i, '').toLocaleLowerCase('ru-RU')}`;
    if (model?.kind === 'compound_plan') return `выполнить безопасный план из ${(model.steps || []).length} шагов`;
    if (model?.kind === 'help' || model?.kind === 'error' || model?.kind === 'small_talk') return '';
    return String(model?.title || '').toLocaleLowerCase('ru-RU');
  }

  function roleAllowsFinancialData(snapshot) {
    const role = String(snapshot.currentRole || '').toLowerCase();
    return !role || ['owner', 'admin', 'manager'].includes(role);
  }

  function permissionNoticeModel() {
    return {
      kind:'permission_notice',
      title:'Недостаточно прав для финансовых данных',
      message:'Вы можете работать со своим расписанием, но выручка и рекомендации по цене доступны владельцу, администратору или менеджеру.',
      openSection:'bookings',
      openLabel:'Открыть записи'
    };
  }

  function operationPreviewModel(command, snapshot, now = new Date()) {
    const text = repairCommand(command).text;
    const operation = /(?:отмен|удал|освобод)/.test(text) ? 'cancel' : 'reschedule';
    if (/(?:^|\s)(?:всех|все|весь|массово)(?=\s|$)/.test(text)) return {
      kind:'operation_preview', operation, title:'Массовое изменение пока недоступно',
      message:'Помощник работает с одной записью за раз. Укажите клиента и нужную запись. Ничего не изменено.',
      needsDetail:'конкретная запись', candidates:[], plan:{ operation, bookingId:'' }
    };
    const today = snapshot.today || localIsoDate(dateAtNoon(now));
    const future = (snapshot.bookings || [])
      .filter(item => item.id && item.date >= today && item.status !== 'cancelled' && item.outcome !== 'completed')
      .sort((left, right) => `${left.date}${left.time || ''}`.localeCompare(`${right.date}${right.time || ''}`));
    const explicitId = text.match(/(?:^|\s)запись-id-([a-z0-9-]+)(?=\s|$)/)?.[1] || '';
    const matches = clientBookingMatches(text, future).sort((left, right) => `${left.date}${left.time || ''}`.localeCompare(`${right.date}${right.time || ''}`));
    const explicitBooking = future.find(item => String(item.id) === explicitId) || null;
    const booking = explicitBooking || (matches.length === 1 ? matches[0] : null) || (!matches.length && future.length === 1 ? future[0] : null);
    const targetDate = operation === 'reschedule' ? parseRussianDate(text, now) : '';
    const targetTime = operation === 'reschedule' ? parseRussianTime(text) : '';
    if (!explicitBooking && matches.length > 1) return {
      kind:'operation_preview',
      operation,
      title:`Уточните запись · ${matches[0].clientName || 'Клиент'}`,
      message:`Нашёл ${matches.length} будущие записи этого клиента. Выберите нужную — помощник не будет угадывать.`,
      needsDetail:'конкретная запись',
      candidates:matches.slice(0, 6),
      plan:{ operation, bookingId:'', targetDate, targetTime }
    };
    if (!booking) return {
      kind:'operation_preview',
      operation,
      title:operation === 'cancel' ? 'Уточните запись для отмены' : 'Уточните запись для переноса',
      message:'Назовите клиента или исходную дату. Ничего не изменено.',
      needsDetail:'клиент или исходная дата',
      candidates:future.slice(0, 6),
      plan:{ operation, bookingId:'', targetDate, targetTime }
    };
    const missing = operation === 'reschedule' ? [!targetDate ? 'новая дата' : '', !targetTime ? 'новое время' : ''].filter(Boolean) : [];
    return {
      kind:'operation_preview',
      operation,
      title:operation === 'cancel' ? `Проверка отмены · ${booking.clientName || 'Клиент'}` : `Проверка переноса · ${booking.clientName || 'Клиент'}`,
      message:missing.length ? `Запись найдена. Уточните: ${missing.join(', ')}.` : operation === 'cancel' ? 'Открою карточку записи. Отмена произойдёт только после отдельного подтверждения.' : 'Открою форму переноса с выбранными данными. Сохранение останется за вами.',
      needsDetail:missing.join(', '),
      candidates:[],
      plan:{
        operation,
        bookingId:String(booking.id || ''),
        clientName:String(booking.clientName || 'Клиент'),
        serviceName:String(booking.serviceName || 'Услуга'),
        fromDate:String(booking.date || ''),
        fromTime:String(booking.time || ''),
        targetDate,
        targetTime
      }
    };
  }

  function workspaceHelpModel(command) {
    const text = repairCommand(command).text;
    let section = 'settings';
    let label = 'настройки кабинета';
    if (/(?:бонус|промокод|лояльност)/.test(text)) { section = 'organization'; label = 'организацию → Лояльность'; }
    else if (/(?:лист\s+ожидан|ожидающ[а-я]*\s+клиент)/.test(text)) { section = 'waitlist'; label = 'лист ожидания'; }
    else if (/(?:портфолио|фото\s+работ)/.test(text)) { section = 'portfolio'; label = 'портфолио'; }
    else if (/(?:организац|команд|филиал)/.test(text)) { section = 'organization'; label = 'организацию'; }
    else if (/(?:уведом|напоминан|сообщен)/.test(text)) { section = 'notifications'; label = 'уведомления'; }
    else if (/(?:экспорт|выгруз|отчет|статист)/.test(text)) { section = 'analytics'; label = 'статистику и экспорт'; }
    else if (/(?:расписан|рабоч|выходн|перерыв)/.test(text)) { section = 'schedule'; label = 'рабочие часы'; }
    else if (/(?:цен|стоимост|услуг)/.test(text)) { section = 'services'; label = 'услуги и цены'; }
    else if (/(?:клиент|баз)/.test(text)) { section = 'clients'; label = 'клиентскую базу'; }
    else if (/(?:склад|материал|остат)/.test(text)) { section = 'organization'; label = 'склад организации'; }
    return {
      kind:'workspace_help',
      title:`Открыть ${label}`,
      message:'Помощник переведёт в нужный раздел, но ничего не изменит без вашего действия.',
      points:section === 'analytics' ? ['В разделе статистики доступна выгрузка записей.'] : section === 'schedule' ? ['Там можно настроить рабочие дни, перерывы и выходные.'] : section === 'notifications' ? ['Там находятся очередь и шаблоны сообщений клиентам.'] : [],
      openSection:section,
      openLabel:`Открыть ${label}`
    };
  }

  function workspaceNavigationModel(command) {
    const text = repairCommand(command).text.replace(/[.!?]+$/g, '').trim();
    const match = text.match(/^(?:пожалуйста\s+)?(?:открой|открыть|перейди|перейти|зайди|зайти)(?:\s+мне)?(?:\s+(?:в|на|к))?(?:\s+раздел)?\s+(.+)$/);
    if (!match) return null;
    const target = match[1].replace(/\s+пожалуйста$/g, '').trim();
    const destinations = [
      { pattern:/^(?:лист\s+ожидания|ожидающие\s+клиенты)$/, section:'waitlist', label:'лист ожидания' },
      { pattern:/^(?:портфолио|фото\s+работ)$/, section:'portfolio', label:'портфолио' },
      { pattern:/^(?:организацию|организация|организации|команду|команда|команды|филиалы?|филиалов|склад)$/, section:'organization', label:'организацию' },
      { pattern:/^(?:статистику|статистика|статистики|аналитику|аналитика|аналитики|отчеты?|отчёты?|выручку)$/, section:'analytics', label:'статистику' },
      { pattern:/^(?:уведомления|уведомление|уведомлений|напоминания|сообщения)$/, section:'notifications', label:'уведомления' },
      { pattern:/^(?:рабочие\s+часы|рабочих\s+часов|график\s+работы|настройки\s+расписания|выходные|перерывы)$/, section:'schedule', label:'рабочие часы' },
      { pattern:/^(?:услуги|услугу|услуг|цены|прайс|каталог\s+услуг)$/, section:'services', label:'услуги и цены' },
      { pattern:/^(?:клиентов|клиенты|клиентам|клиентскую\s+базу|базу\s+клиентов)$/, section:'clients', label:'клиентскую базу' },
      { pattern:/^(?:записи|записей|мои\s+записи|журнал|журнал\s+записей|расписание|календарь)$/, section:'bookings', label:'записи' },
      { pattern:/^(?:настройки|настроек|настройки\s+кабинета|кабинет)$/, section:'settings', label:'настройки кабинета' }
    ];
    const destination = destinations.find(item => item.pattern.test(target));
    if (!destination) return null;
    return {
      kind:'workspace_help',
      title:`Открыть ${destination.label}`,
      message:'Переход подготовлен. В выбранном разделе ничего не изменится без вашего действия.',
      openSection:destination.section,
      openLabel:`Открыть ${destination.label}`
    };
  }

  function isScheduleRequest(text) {
    if (/(?:^|\s)(?:что|кто)\s+у\s+меня(?=\s|$)/.test(text)) return true;
    if (/(?:^|\s)кто\s+(?:ко\s+мне\s+)?(?:сегодня|завтра|послезавтра)(?=\s|$)/.test(text)) return true;
    if (/(?:^|\s)(?:покаж[а-я]*|откро[а-я]*|скажи|какие|сколько|что|кто)(?=\s|$).*?\s(?:расписан[а-я]*|график|план[а-я]*|запис[а-я]*|визит[а-я]*|прием[а-я]*|сеанс[а-я]*|клиент[а-я]*)(?=\s|$)/.test(text)) return true;
    if (/^(?:мое\s+|мои\s+)?(?:расписан[а-я]*|график|планы|записи)(?=\s|$)/.test(text)) return true;
    return SCHEDULE_WORDS.test(text) && /(?:^|\s)(сегодня|завтра|послезавтра|на\s+день)(?=\s|$)/.test(text) && !BOOKING_WORDS.test(text);
  }

  function extractClientSearch(command) {
    const raw = repairCommand(command).text;
    const patterns = [
      /(?:найд[а-яё]*|покаж[а-яё]*|откро[а-яё]*)\s+(?:историю\s+)?(?:клиента?\s+|клиентку\s+)?([А-ЯЁA-ZА-ЯЁA-Za-zа-яё-]{2,}(?:\s+[А-ЯЁA-Za-zа-яё-]{2,})?)/iu,
      /(?:история|карточка)\s+(?:клиента?\s+)?([А-ЯЁA-ZА-ЯЁA-Za-zа-яё-]{2,}(?:\s+[А-ЯЁA-Za-zа-яё-]{2,})?)/iu,
      /(?:что\s+было\s+у|когда\s+(?:был|была|приходил|приходила))\s+([А-ЯЁA-ZА-ЯЁA-Za-zа-яё-]{2,}(?:\s+[А-ЯЁA-Za-zа-яё-]{2,})?)/iu
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match) {
        const nameParts = match[1].split(/\s+/).filter(part => !/^(сегодня|завтра|послезавтра|снова|еще)$/i.test(normalizeText(part)));
        return toNominativeName(nameParts.join(' '), /(?:^|\s)у(?=\s)/i.test(raw));
      }
    }
    return '';
  }

  function teamRoleLabel(role) {
    return ({ owner:'Владелец', admin:'Администратор', manager:'Менеджер', specialist:'Специалист', performer:'Исполнитель' })[String(role || '').toLowerCase()] || String(role || '');
  }

  function clientBookingMatches(query, bookings = []) {
    const needle = normalizeText(query);
    const needleWords = needle.split(' ').filter(word => word.length > 1);
    if (!needleWords.length) return [];
    const scored = (bookings || []).map(item => {
      const name = normalizeText(item.clientName);
      const nameWords = name.split(' ').filter(Boolean);
      const exact = name.includes(needle) ? 100 : 0;
      const wordScore = needleWords.reduce((sum, word) => {
        if (nameWords.some(candidate => serviceStem(candidate) === serviceStem(word))) return sum + 12;
        if (nameWords.some(candidate => wordsAreClose(candidate, word))) return sum + 6;
        return sum;
      }, 0);
      return { item, score:exact + wordScore };
    }).filter(entry => entry.score > 0).sort((left, right) => right.score - left.score || `${right.item.date}${right.item.time}`.localeCompare(`${left.item.date}${left.item.time}`));
    if (!scored.length) return [];
    const threshold = Math.max(6, scored[0].score - 6);
    return scored.filter(entry => entry.score >= threshold).map(entry => entry.item);
  }

  function contextualFollowUpCommand(command, previousModel = null) {
    if (!previousModel) return '';
    const text = repairCommand(command).text.replace(/^(?:а|и|ну)\s+/, '').trim();
    const period = /^(?:(?:что|как)\s+)?(?:(?:на|за|в)\s+)?(?:сегодня|завтра|послезавтра|этот\s+день|эту\s+неделю|этой\s+неделе|прошлую\s+неделю|прошлой\s+неделе|этот\s+месяц|этом\s+месяце|прошлый\s+месяц|прошлом\s+месяце|следующ(?:ую|ей)\s+недел(?:ю|е)|следующ(?:ий|ем)\s+месяц(?:е)?|следующ(?:ую|ей)\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|через\s+(?:(?:один|одну|два|две|три|четыре|пять|шесть|семь|\d+)\s+)?(?:день|дня|днеи|неделю|недели|недель)|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{1,2}\s+[а-я]+)\??$/.test(text);
    if (!period) return '';
    if (previousModel.kind === 'schedule_summary') return `покажи записи ${text}`;
    if (['revenue_summary','revenue_change'].includes(previousModel.kind)) return `какая выручка ${text}`;
    if (previousModel.kind === 'clients_summary') return `сколько клиентов ${text}`;
    if (previousModel.kind === 'service_performance') return `какие услуги принесли больше денег ${text}`;
    if (previousModel.kind === 'find_slots' && previousModel.plan?.serviceName) return `найди свободное время ${text} на ${previousModel.plan.serviceName}`;
    return '';
  }

  function guidedHelpModel(command) {
    const text = repairCommand(command).text;
    if (fuzzyRoot(text, ['клиент', 'карточк', 'истори'])) return {
      kind:'help',
      title:'Что сделать с клиентом?',
      message:'Могу найти карточку, показать историю, подготовить сообщение или создать запись. Скажите имя клиента и нужное действие.',
      examples:['Найди клиента Анну', 'Напиши напоминание Анне', 'Запиши Анну завтра в 10:30']
    };
    if (fuzzyRoot(text, ['пост', 'соцсет', 'описан', 'публикац'])) return {
      kind:'help',
      title:'Какой текст подготовить?',
      message:'Могу написать пост для соцсетей или описание услуги. Назовите формат и услугу — готовый текст останется проверить и скопировать.',
      examples:['Придумай пост про массаж', 'Напиши описание спортивного массажа']
    };
    if (fuzzyRoot(text, ['цен', 'стоимост', 'прайс', 'продвижен', 'реклам', 'акци'])) return {
      kind:'help',
      title:'Цена или продвижение?',
      message:'Могу предложить безопасный сценарий цены по вашим данным или идеи продвижения без внешней рыночной информации.',
      examples:['Какую цену поставить на массаж?', 'Дай идеи для продвижения']
    };
    if (fuzzyRoot(text, ['настройк', 'уведомлен', 'тариф', 'экспорт', 'расписан'])) return {
      kind:'help',
      title:'Какой раздел открыть?',
      message:'Могу показать, где находятся расписание, уведомления, услуги, цены, клиентская база и экспорт. Назовите нужную настройку.',
      examples:['Как настроить уведомления?', 'Где изменить расписание?', 'Выгрузи записи']
    };
    const hasDateOrTime = Boolean(parseRussianDate(text) || parseRussianTime(text));
    if (hasDateOrTime) return {
      kind:'help',
      title:'Что проверить на это время?',
      message:'Могу показать записи или найти свободное окно. Добавьте услугу, если нужен поиск подходящего интервала.',
      examples:['Покажи записи завтра', 'Найди окно в пятницу на массаж']
    };
    return {
      kind:'help',
      title:'Уточню задачу',
      message:'Скажите своими словами, что нужно узнать, подготовить или открыть. Можно писать коротко, разговорно и с небольшими ошибками.',
      examples:['Что у меня сегодня?', 'Напиши клиенту', 'Придумай пост', 'Как изменить расписание?']
    };
  }

  function updateConversationContext(context = {}, model = null) {
    const next = { ...context };
    const plan = model?.plan || {};
    if (plan.clientName) next.clientName = String(plan.clientName).slice(0, 100);
    if (plan.serviceId) next.serviceId = String(plan.serviceId).slice(0, 100);
    if (plan.serviceName) next.serviceName = String(plan.serviceName).slice(0, 120);
    if (plan.date) next.date = String(plan.date);
    if (plan.time) next.time = String(plan.time);
    if (plan.bookingId) next.bookingId = String(plan.bookingId).slice(0, 100);
    if (Number(plan.durationMinutes)) next.durationMinutes = Number(plan.durationMinutes);
    const items = Array.isArray(model?.items) ? model.items : [];
    if (items.length === 1) {
      const item = items[0] || {};
      if (item.clientName && item.clientName !== 'Клиент') next.clientName = String(item.clientName).slice(0, 100);
      if (item.serviceId) next.serviceId = String(item.serviceId).slice(0, 100);
      if (item.serviceName) next.serviceName = String(item.serviceName).slice(0, 120);
      if (item.date) next.date = String(item.date);
      if (item.time) next.time = String(item.time);
      if (item.id) next.bookingId = String(item.id).slice(0, 100);
    }
    return next;
  }

  function conversationContextFromSnapshot(snapshot = {}) {
    const booking = snapshot.screen?.booking;
    if (!booking?.id) return {};
    return {
      bookingId:String(booking.id).slice(0, 100),
      clientName:String(booking.clientName || '').slice(0, 100),
      serviceId:String(booking.serviceId || '').slice(0, 100),
      serviceName:String(booking.serviceName || '').slice(0, 120),
      date:String(booking.date || ''),
      time:String(booking.time || ''),
      durationMinutes:Number(booking.durationMinutes) || 0
    };
  }

  function screenAwareCommand(command, snapshot = {}) {
    const text = repairCommand(command).text;
    const booking = snapshot.screen?.booking;
    if (!text || !booking?.id) return '';
    if (/запись-id-[a-z0-9-]+/.test(text)) return '';
    const operation = /(?:^|\s)(?:перенес[а-я]*|сдвин[а-я]*|перестав[а-я]*|отмен[а-я]*|удал[а-я]*\s+запис[а-я]*)(?=\s|$)/.test(text);
    if (operation && (/(?:эту|ее|её|ее|ней|неё|запис[а-я]*)/.test(text) || !parseClientName(text))) return `${text} запись-id-${booking.id}`;
    const message = /(?:напиш[а-я]*|сообщен[а-я]*|напоминан[а-я]*|подтвержден[а-я]*)/.test(text);
    if (message && /(?:^|\s)(?:ей|ему|клиент[а-я]*|по\s+ней|по\s+нему)(?=\s|$)/.test(text)) return `${text} запись-id-${booking.id}`;
    return '';
  }

  function screenContextModel(command, snapshot = {}) {
    const text = repairCommand(command).text;
    if (!/(?:что\s+(?:здесь|открыто|за\s+запись|можно\s+сделать)|помоги\s+(?:здесь|с\s+этой\s+записью)|про\s+эту\s+запись|текущ[а-я]*\s+экран)/.test(text)) return null;
    const screen = snapshot.screen || {};
    const booking = screen.booking;
    if (booking?.id) return {
      kind:'screen_context',
      title:`Открыта запись · ${booking.clientName || 'Клиент'}`,
      message:`${formatDate(booking.date)} в ${booking.time || '—'} · ${booking.serviceName || 'Услуга'}. Можно продолжить без повторения имени клиента.`,
      points:['Перенести эту запись', 'Подготовить клиенту напоминание', 'Показать историю клиента'],
      examples:['Перенеси её на пятницу в 15:00', 'Напиши ей напоминание', 'Когда она была раньше?']
    };
    const view = String(screen.viewLabel || 'Кабинет');
    const viewExamples = {
      'Записи':['Что у меня сегодня?', 'Найди окно завтра на массаж'],
      'Клиенты':['Найди клиента Анну', 'Сколько новых клиентов сегодня?'],
      'Уведомления':['Напиши напоминание клиенту', 'Что требует внимания?'],
      'Статистика':['Какая выручка сегодня?', 'Какие услуги принесли больше денег?'],
      'Услуги':['Какую цену поставить на массаж?', 'Напиши описание услуги']
    };
    return {
      kind:'screen_context',
      title:`Сейчас открыт раздел «${view}»`,
      message:'Я учитываю текущий раздел и предложу действие по его данным. Выберите пример или скажите задачу своими словами.',
      examples:viewExamples[view] || ['Что у меня сегодня?', 'Что требует внимания?', 'С чего начать?']
    };
  }

  function undoPreviewModel(command, snapshot = {}) {
    const text = repairCommand(command).text;
    if (!/(?:верн[а-я]*\s+(?:назад|как\s+было)|отмен[а-я]*\s+(?:последн[а-я]*\s+)?(?:шаг|переход)|назад\s+как\s+было)/.test(text)) return null;
    if (!snapshot.undoAvailable) return {
      kind:'undo_preview',
      title:'Нечего возвращать',
      message:'Помощник не выполнял обратимого перехода в последние 10 минут. Данные кабинета не изменены.'
    };
    return {
      kind:'undo_preview',
      title:'Вернуть предыдущий экран?',
      message:'Верну раздел, дату и открытую карточку, которые были до последнего перехода помощника. Записи и другие данные не изменятся.',
      canUndo:true
    };
  }

  function contextualMemoryCommand(command, context = {}) {
    const original = repairCommand(command).text;
    const text = original.replace(/^(?:а|и|ну)\s+/, '').trim();
    const client = String(context.clientName || '').trim();
    const service = String(context.serviceName || '').trim();
    if (client && /(?:когда|где|что).*(?:она|он|клиент)|(?:она|он)\s+(?:записан|приходил)/.test(text)) return `найди клиента ${client}`;
    if (client && /(?:^|\s)(?:ей|ему|для\s+нее|для\s+него)(?=\s|$)/.test(text)) {
      if (/(?:напоминан|сообщен|подтвержден|напиш|отправ)/.test(text)) return `напиши сообщение клиенту ${client} ${text}`;
      if (/(?:перенес|сдвин|перестав|отмен)/.test(text)) return `${text} клиента ${client}`;
    }
    if (client && /^(?:перенес[а-я]*|сдвин[а-я]*|перестав[а-я]*|отмен[а-я]*)(?:\s|$)/.test(text) && !parseClientName(text)) return context.bookingId ? `${text} запись-id-${context.bookingId}` : `${text} клиента ${client}`;
    if (service && freeSlotSignal(text) && !serviceForCommand(text, { services:[{ id:context.serviceId || 'remembered', name:service }] })) return `${text} на ${service}`;
    return '';
  }

  function shortenDraft(value, maximum = 240) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maximum) return text;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    let shortened = '';
    for (const sentence of sentences) {
      if (`${shortened} ${sentence}`.trim().length > maximum) break;
      shortened = `${shortened} ${sentence}`.trim();
      if (shortened.length >= 120) break;
    }
    return shortened || `${text.slice(0, maximum - 1).trim()}…`;
  }

  function reviseDraftModel(command, previousModel = null, snapshot = {}) {
    if (!previousModel?.draftText) return null;
    const text = repairCommand(command).text;
    const shorter = /(?:^|\s)(?:короче|сократи|покороче|кратче)(?=\s|$)/.test(text);
    const warmer = /(?:теплее|дружелюбнее|мягче|душевнее)/.test(text);
    const formal = /(?:официальнее|формальнее|строже|деловее)/.test(text);
    const addPrice = /(?:добав[а-я]*|укаж[а-я]*|встав[а-я]*).*(?:цен[а-я]*|стоимост[а-я]*)/.test(text);
    const removeDiscount = /(?:убер[а-я]*|удал[а-я]*|без).*(?:скидк[а-я]*|акци[а-я]*|процент[а-я]*)/.test(text);
    if (!shorter && !warmer && !formal && !addPrice && !removeDiscount) return null;
    let draftText = String(previousModel.draftText).replace(/\s+/g, ' ').trim();
    const changes = [];
    if (removeDiscount) {
      draftText = draftText.split(/(?<=[.!?])\s+/).filter(sentence => !/(?:скидк|акци|\d+\s*%)/i.test(sentence)).join(' ').trim();
      changes.push('убрал упоминание скидки');
    }
    if (formal) {
      draftText = draftText.replace(/!/g, '.').replace(/Очень рады/gi, 'Благодарим').replace(/Будем рады встрече/gi, 'Будем ждать вашего ответа');
      changes.push('сделал текст официальнее');
    } else if (warmer) {
      if (!/будем (?:очень )?рады видеть вас/i.test(draftText)) draftText = `${draftText} Будем очень рады видеть вас!`;
      changes.push('сделал текст теплее');
    }
    if (addPrice && !/(?:стоимость|цена)\s*[—:-]/i.test(draftText)) {
      const rememberedService = snapshot.services?.find(item => String(item.id) === String(previousModel.plan?.serviceId || ''));
      const service = rememberedService || serviceForCommand(`${text} ${previousModel.title || ''} ${previousModel.draftText || ''}`, snapshot);
      if (!service || !(Number(service.priceRub) > 0)) return {
        ...previousModel,
        title:`${previousModel.title} · нужна услуга`,
        message:'Чтобы добавить точную цену, назовите услугу. Предыдущий черновик сохранён.',
        needsDetail:'услуга'
      };
      draftText = `${draftText} Стоимость — ${moneyLabel(service.priceRub)}.`;
      changes.push('добавил цену из каталога');
    }
    if (shorter) {
      draftText = shortenDraft(draftText, Math.max(80, Math.floor(draftText.length * 0.7)));
      changes.push('сократил текст');
    }
    return {
      ...previousModel,
      title:`${String(previousModel.title || 'Черновик').replace(/\s+·\s+(?:обновлён|нужна услуга)$/i, '')} · обновлён`,
      message:`Готово: ${changes.join(', ')}. Проверьте текст перед использованием.`,
      draftText,
      needsDetail:'',
      revised:true
    };
  }

  function compoundCommandModel(command, snapshot = {}, now = new Date(), conversationContext = {}) {
    const parts = String(command || '').split(/\s+(?:и\s+потом|а\s+потом|затем|потом|и)\s+/i).map(item => item.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    if (parts.length > 3) return {
      kind:'smart_clarification',
      title:'Разделим задачу на два плана',
      message:'В одной команде получилось больше трёх самостоятельных шагов. Сначала назовите первые два или три — так каждый результат можно безопасно проверить.',
      examples:[parts.slice(0, 3).join(' и потом ')]
    };
    const steps = parts.map(part => ({ command:part, model:interpretCommand(part, snapshot, now, null, conversationContext, false) }));
    if (steps.some(step => ['help','error','small_talk','compound_plan'].includes(step.model.kind))) return null;
    if (new Set(steps.map(step => step.model.kind)).size < 2) return null;
    return {
      kind:'compound_plan',
      title:`План из ${steps.length} шагов`,
      message:'Я разделил команду на последовательные безопасные шаги. Нажмите «Начать план» и проверяйте результат каждого шага.',
      steps:steps.map((step, index) => ({ command:step.command, label:`${index + 1}. ${step.model.title}`, kind:step.model.kind })),
      points:steps.map((step, index) => `${index + 1}. ${step.model.title}: ${step.model.message}`),
      understandingConfidence:'medium'
    };
  }

  function smallTalkModel(command, previousModel = null) {
    const text = repairCommand(command).text;
    if (!text) return null;
    if (/^(?:привет|приветик|здравствуй|здравствуйте|доброе\s+утро|добрый\s+день|добрый\s+вечер|здорово|салют)(?:\s+минута)?$/.test(text)) return {
      kind:'small_talk',
      title:'Привет!',
      message:'Я на связи. Можем просто поговорить или сразу посмотреть расписание, клиентов и дела на сегодня.',
      examples:['Как дела?', 'Что у меня сегодня?', 'Что требует внимания?']
    };
    if (/^(?:(?:привет|приветик|здравствуй|здравствуйте|добрый\s+день)\s+)?(?:ну\s+)?(?:как\s+(?:у\s+тебя\s+)?дела|у\s+тебя\s+как\s+дела|как\s+ты|как\s+настроение|что\s+нового|че\s+как|чо\s+как|как\s+жизнь)(?:\s+минута)?$/.test(text)) return {
      kind:'small_talk',
      title:'Всё хорошо',
      message:'Спасибо, что спросили. Я готов помочь: посмотреть расписание, проверить важные дела или подготовить сообщение клиенту.',
      examples:['Покажи записи сегодня', 'Что требует внимания?', 'Напиши напоминание клиенту']
    };
    if (/^(?:спасибо|благодарю|большое\s+спасибо|спс|понятно|ясно|супер|отлично|класс)$/.test(text)) return {
      kind:'small_talk',
      title:'Пожалуйста',
      message:'Рад помочь. Если нужно, можем продолжить с расписанием, клиентами или текущими задачами.'
    };
    if (/^(?:пока|до\s+свидания|до\s+встречи|увидимся|всего\s+доброго)$/.test(text)) return {
      kind:'small_talk',
      title:'До встречи!',
      message:'Буду здесь, когда снова понадоблюсь.'
    };
    if (/^(?:кто\s+ты|что\s+ты\s+умеешь|чем\s+ты\s+можешь\s+помочь|чем\s+можешь\s+помочь|помоги|помощь)$/.test(text)) return {
      kind:'small_talk',
      title:'Я помощник «Минута»',
      message:'Помогаю с расписанием и клиентами, сообщениями и отзывами, постами и описаниями услуг, ценами, продвижением и настройками «Минуты». Понимаю обычную речь и частые ошибки, а изменения всегда остаются под вашим контролем.',
      examples:['Какие записи сегодня?', 'Напиши напоминание клиенту', 'Придумай пост про массаж', 'Как настроить уведомления?']
    };
    if (/^(?:нет|неа|не\s+то|неправильно|отмена|отмени)$/.test(text)) return {
      kind:'small_talk',
      title:'Понял, это не то',
      message:'Предыдущий вариант не использую. Скажите задачу ещё раз своими словами — можно коротко и с ошибками.'
    };
    if (/^(?:да|ага|угу|ок|окей|хорошо|давай|продолжай|что\s+дальше)$/.test(text)) {
      if (previousModel?.kind === 'operation_preview') return {
        ...previousModel,
        title:'Готов продолжить безопасно',
        message:'Проверьте данные и используйте кнопку операции. Изменение произойдёт только в штатной форме после отдельного подтверждения.'
      };
      if (previousModel?.openSection) return {
        kind:'small_talk',
        title:'Продолжим',
        message:'Открою нужный раздел только после нажатия кнопки.',
        openSection:previousModel.openSection,
        openLabel:previousModel.openLabel || 'Открыть раздел'
      };
      return {
        kind:'small_talk',
        title:'Хорошо',
        message:'Я готов продолжить. Скажите, что нужно узнать, подготовить или открыть.'
      };
    }
    return null;
  }

  function interpretCommand(command, snapshot = {}, now = new Date(), previousModel = null, conversationContext = {}, allowCompound = true) {
    const raw = String(command || '').trim().slice(0, 500);
    const repaired = repairCommand(raw);
    const text = repaired.text;
    const finish = model => understanding(model, repaired);
    const today = snapshot.today || localIsoDate(dateAtNoon(now));
    if (!text) return finish({ kind:'error', title:'Команда не указана', message:'Скажите команду или введите её текстом.' });
    // Preserve dictated message content before interpreting its numbers as booking times.
    if (/^(?:напиши|сообщи)\s+.+\s+что\s+/.test(text)) return finish(messageDraftModel(raw, snapshot, now));
    if (/(?:почему|сравни).*(?:меньше|больше|количеств|число).*(?:запис|визит)/.test(text)) return finish(bookingChangeModel(text, snapshot, now));
    if (/(?:как|где|открой|включи|настрой).*?(?:бонус|промокод|лояльност)/.test(text)) return finish(workspaceHelpModel(text));
    if (/(?:кто.*следующ|следующ.*(?:клиент|запис)|ближайш.*запис)/.test(text)) {
      const next = upcomingBookings(snapshot, now)[0];
      return finish({ kind:'schedule_summary', title:'Следующая запись',
        message:next ? `${formatDate(next.date)} в ${next.time} · ${next.clientName || 'Клиент'}` : 'В загруженном расписании предстоящих записей нет.',
        items:next ? [next] : [], total:next ? 1 : 0 });
    }
    const undo = undoPreviewModel(text, snapshot);
    if (undo) return finish(undo);
    const screenContext = screenContextModel(text, snapshot);
    if (screenContext) return finish(screenContext);
    const screenCommand = screenAwareCommand(text, snapshot);
    if (screenCommand) return finish({ ...interpretCommand(screenCommand, snapshot, now, previousModel, conversationContext, false), continuedFromScreen:true });
    const smallTalk = smallTalkModel(text, previousModel);
    if (smallTalk) return finish(smallTalk);
    const directNavigation = workspaceNavigationModel(text);
    if (directNavigation) return finish(directNavigation);
    const revisedDraft = reviseDraftModel(text, previousModel, snapshot);
    if (revisedDraft) return finish(revisedDraft);
    const rememberedCommand = contextualMemoryCommand(text, conversationContext);
    if (rememberedCommand) return finish({ ...interpretCommand(rememberedCommand, snapshot, now, previousModel, {}, false), continuedFromContext:true });
    const contextualCommand = contextualFollowUpCommand(text, previousModel);
    if (contextualCommand) return finish({ ...interpretCommand(contextualCommand, snapshot, now, null, conversationContext, false), continuedFromContext:true });
    const compound = allowCompound ? compoundCommandModel(raw, snapshot, now, conversationContext) : null;
    if (compound) return finish(compound);

    const bookingRequest = bookingSignal(text);
    const writingAction = /(?:^|\s)(?:напиш[а-я]*|придум[а-я]*|состав[а-я]*|подготов[а-я]*|ответ[а-я]*)(?=\s|$)/.test(text);
    const messageRequest = writingAction
      || /(?:^|\s)(?:напомн[а-я]*|подтверд[а-я]*|сообщ[а-я]*)\s+(?:клиент[а-я]*|ей|ему)(?=\s|$)/.test(text)
      || /(?:что|как)\s+ответить\s+на\s+отзыв/.test(text)
      || /(?:текст|сообщение)\s+(?:для|к)\s+клиент[а-я]*/.test(text);
    const contentRequest = writingAction
      || /(?:иде[а-я]*|текст)\s+(?:для\s+)?(?:пост[а-я]*|соцсет[а-я]*|публикац[а-я]*)/.test(text)
      || (!/(?:^|\s)(?:как|где|откро[а-я]*|найд[а-я]*)(?=\s|$)/.test(text) && /(?:^|\s)(?:пост(?:\s|$)|описан[а-я]*\s+услуг[а-я]*)/.test(text));
    if (/(?:^|\s)(?:перенес[а-я]*|перенести|перенеси|сдвин[а-я]*|перестав[а-я]*|отмен[а-я]*|удал[а-я]*\s+запис[а-я]*|освобод[а-я]*\s+(?:запис[а-я]*|время))(?=\s|$)/.test(text)) return finish(operationPreviewModel(text, snapshot, now));
    if (/(?:что\s+(?:делать|важно)|с\s+чего\s+начать|дай\s+(?:сводку|план)|план\s+на\s+день|коротк[а-я]*\s+сводк)/.test(text)) return finish(operationalBriefingModel(snapshot, now));
    if (messageRequest && /(?:сообщен|напоминан|подтвержден|отзыв|клиент)/.test(text)) return finish(messageDraftModel(text, snapshot, now));
    if (contentRequest && /(?:пост|публикац|описан|карточк\s+услуг|текст\s+(?:для\s+)?соц)/.test(text)) return finish(contentDraftModel(text, snapshot));
    if (fuzzyRoot(text, ['цен', 'стоимост']) && fuzzyRoot(text, ['какую', 'какой', 'сколько', 'посоветуй', 'рекомендуй', 'подбери', 'поставить', 'изменить', 'поднять'])) return finish(roleAllowsFinancialData(snapshot) ? priceAdviceModel(text, snapshot) : permissionNoticeModel());
    if (/(?:иде[а-я]*\s+(?:для\s+)?продвижен|как\s+продвиг|чем\s+привлеч|что\s+рекламир|рекламн[а-я]*\s+иде|акци[а-я]*\s+предлож)/.test(text)) return finish(promotionIdeasModel(snapshot, now));
    if ((/(?:^|\s)(?:как|где|куда|откро[а-я]*|перейд[а-я]*|настро[а-я]*|измен[а-я]*|поменя[а-я]*)(?=\s|$)/.test(text) && /(?:настройк|уведомлен|тариф|экспорт|выгруз|отчет|статист|расписан|рабоч|выходн|перерыв|цен|услуг|клиент|баз|склад|лист\s+ожидан|портфолио|организац|команд|филиал)/.test(text)) || /(?:^|\s)(?:экспортируй|выгрузи)(?=\s|$)/.test(text)) return finish(workspaceHelpModel(text));

    if (!bookingRequest && (/(?:выручк|заработ|доход|средн[а-я]* чек|оплат)/.test(text) || fuzzyRoot(text, ['выручк', 'доход', 'оплат']))) return finish(roleAllowsFinancialData(snapshot) ? revenueModel(text, snapshot, now) : permissionNoticeModel());
    if (/(?:материал|остат|остал[а-я]*|склад|заканчива|закуп)/.test(text) || fuzzyRoot(text, ['материал', 'остаток', 'склад']) || /(?:на сколько|сколько\s+дн|до\s+.+\s+хватит|хватит\s+ли|хватит\s+на).*(?:масл|крем|шампун|краск|перчат|полотен|салфет)/.test(text)) return finish(inventoryModel(text, snapshot, now));
    if (/(?:требует внимания|важн[а-я]*|проблем[а-я]*|что проверить)/.test(text) || fuzzyRoot(text, ['важное', 'проблемы'])) return finish(attentionModel(snapshot, now));
    if (/(?:нов[а-я]* клиент|повторн[а-я]* клиент|сколько клиент)/.test(text)) return finish(clientSummaryModel(text, snapshot, now));
    if (/(?:популярн[а-я]* услуг|лучш[а-я]* услуг|услуг[а-я]* принесли|услуг[а-я]* принос)/.test(text)) return finish(roleAllowsFinancialData(snapshot) ? servicePerformanceModel(text, snapshot, now) : permissionNoticeModel());
    if (/(?:кто работает|команд[а-я]*|сотрудник[а-я]*|специалист[а-я]* работает)/.test(text)) {
      const members = snapshot.team || [];
      return finish({ kind:'team_summary', title:'Команда', message:members.length ? `Активных сотрудников: ${members.length}.` : 'Активные сотрудники не найдены.', points:members.map(item => `${item.name}${item.role ? ` · ${teamRoleLabel(item.role)}` : ''}`).slice(0, 12) });
    }

    const duration = parseDuration(text);
    const date = parseRussianDate(text, now) || today;
    const timePreference = parseTimePreference(text, snapshot.assistantPreferences || {});
    const time = timePreference?.source === 'explicit' ? '' : parseRussianTime(text);
    const candidates = findServices(text, snapshot.services || [], duration);
    const preferredService = (snapshot.services || []).find(item => String(item.id) === String(snapshot.assistantPreferences?.preferredServiceId || '')) || null;
    const service = candidates.length === 1 ? candidates[0] : (/(?:^|\s)как\s+обычно(?=\s|$)/.test(text) ? preferredService : null);
    const habitualDuration = service ? Number(snapshot.assistantPreferences?.usualDurations?.[String(service.id)] || 0) : 0;
    const selectedDuration = duration || (service?.perMinute ? habitualDuration : Number(service?.durationMinutes || 0));

    const clientName = parseClientName(text);
    if (bookingRequest && !freeSlotSignal(text)) {
      const missing = [];
      if (!clientName) missing.push('имя клиента');
      if (!time && !timePreference) missing.push('время');
      if (!service && candidates.length !== 1) missing.push(candidates.length > 1 ? 'точная услуга' : 'услуга');
      return finish({
        kind:'booking_draft',
        title:'Черновик новой записи',
        message:missing.length ? `Нужно уточнить: ${missing.join(', ')}.${timePreference ? ` Подберу время по условию «${timePreference.label}».` : ''}` : 'Команда распознана. Перед созданием проверьте данные в защищённой форме.',
        plan:{ clientName, date, time, ...(timePreference ? { timePreference } : {}), serviceId:service?.id || '', serviceName:service?.name || '', durationMinutes:selectedDuration, ...(service?.perMinute ? { perMinute:true, defaultDurationMinutes:Number(service.defaultDurationMinutes || 60) } : {}) },
        candidates:candidates.map(item => ({ id:item.id, name:item.name, durationMinutes:item.durationMinutes, defaultDurationMinutes:item.defaultDurationMinutes, perMinute:Boolean(item.perMinute) })),
        canPrepare:Boolean(clientName || service || time)
      });
    }

    if (freeSlotSignal(text)) {
      return finish({
        kind:'find_slots',
        title:'Поиск свободного времени',
        message:service ? `Проверю расписание и покажу действительно свободные интервалы${timePreference ? ` с учётом условия «${timePreference.label}»` : ''}.` : 'Сначала выберите услугу — от неё зависит длительность свободного окна.',
        plan:{ clientName:'', date, time:'', ...(timePreference ? { timePreference } : {}), serviceId:service?.id || '', serviceName:service?.name || '', durationMinutes:selectedDuration, ...(service?.perMinute ? { perMinute:true, defaultDurationMinutes:Number(service.defaultDurationMinutes || 60) } : {}) },
        candidates:candidates.map(item => ({ id:item.id, name:item.name, durationMinutes:item.durationMinutes, defaultDurationMinutes:item.defaultDurationMinutes, perMinute:Boolean(item.perMinute) })),
        canPrepare:true
      });
    }

    if (isScheduleRequest(text)) {
      const items = activeBookings(snapshot, date);
      return finish({
        kind:'schedule_summary',
        title:`Записи: ${formatDate(date)}`,
        message:items.length ? `Найдено записей: ${items.length}.` : 'Активных записей на этот день нет.',
        items:items.slice(0, 12),
        total:items.length
      });
    }

    const searchedClientName = extractClientSearch(raw);
    if (searchedClientName) {
      const needle = normalizeText(searchedClientName);
      const matches = clientBookingMatches(needle, snapshot.bookings || []);
      const clientKey = matches.find(item => item.clientKey)?.clientKey || '';
      return finish({ kind:'client_search', title:`Клиент: ${searchedClientName}`, message:matches.length ? `Найдено посещений и записей: ${matches.length}.` : 'Клиент не найден в загруженном журнале.', items:matches.slice(0, 12), total:matches.length, clientKey });
    }

    return finish(guidedHelpModel(text));
  }

  function commandUnderstandingScore(command, snapshot = {}, now = new Date()) {
    const model = interpretCommand(command, snapshot, now);
    if (model.kind === 'booking_draft') {
      const plan = model.plan || {};
      return 100 + (plan.clientName ? 18 : 0) + (plan.date ? 4 : 0) + (plan.time ? 16 : 0) + (plan.serviceId ? 18 : 0) - ((model.candidates || []).length > 1 ? 6 : 0);
    }
    if (model.kind === 'find_slots') return 90 + (model.plan?.serviceId ? 12 : 0) + (model.plan?.date ? 4 : 0);
    if (model.kind === 'schedule_summary') return 80;
    if (model.kind === 'client_search') return 70 + (model.total ? 8 : 0);
    if (model.kind === 'operation_preview') return 108 + (model.plan?.bookingId ? 14 : 0) + (model.needsDetail ? 0 : 12);
    if (model.kind === 'compound_plan') return 96;
    if (model.kind === 'screen_context') return 88;
    if (model.kind === 'undo_preview') return model.canUndo ? 94 : 78;
    if (model.kind === 'small_talk') return 86;
    if (['message_draft','content_draft','price_advice','promotion_ideas','operational_briefing','workspace_help','permission_notice'].includes(model.kind)) return 84;
    if (['revenue_summary','revenue_change','inventory_summary','inventory_forecast','attention','clients_summary','service_performance','team_summary'].includes(model.kind)) return 76;
    return Math.min(10, normalizeText(command).split(' ').filter(Boolean).length);
  }

  function chooseRecognitionTranscript(results, snapshot = {}, now = new Date()) {
    let variants = [{ text:'', confidence:0 }];
    for (const item of Array.from(results || [])) {
      const alternatives = Array.from(item || []).slice(0, 5).filter(entry => String(entry?.transcript || '').trim());
      if (!alternatives.length) continue;
      const next = [];
      for (const prefix of variants) {
        for (const alternative of alternatives) {
          next.push({
            text:`${prefix.text} ${alternative.transcript}`.trim().slice(0, 500),
            confidence:prefix.confidence + (Number.isFinite(Number(alternative.confidence)) ? Number(alternative.confidence) : 0)
          });
        }
      }
      variants = next.sort((left, right) => {
        const scoreDelta = commandUnderstandingScore(right.text, snapshot, now) - commandUnderstandingScore(left.text, snapshot, now);
        return scoreDelta || right.confidence - left.confidence;
      }).slice(0, 8);
    }
    return variants.sort((left, right) => {
      const scoreDelta = commandUnderstandingScore(right.text, snapshot, now) - commandUnderstandingScore(left.text, snapshot, now);
      return scoreDelta || right.confidence - left.confidence;
    })[0]?.text || '';
  }

  function supportsDirectRecognition(Recognition, navigatorLike = {}, standaloneDisplay = false) {
    if (!Recognition) return false;
    const userAgent = String(navigatorLike.userAgent || '');
    const ios = /iPhone|iPad|iPod/i.test(userAgent) || (navigatorLike.platform === 'MacIntel' && Number(navigatorLike.maxTouchPoints) > 1);
    const iosAlternativeBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA/i.test(userAgent);
    const homeScreen = navigatorLike.standalone === true || standaloneDisplay;
    const androidWebView = /Android/i.test(userAgent) && /(?:;\s*wv\)|Version\/\d[^\s]*\s+Chrome\/)/i.test(userAgent);
    // iOS may expose webkitSpeechRecognition inside a Home Screen app or WKWebView
    // even when the recognition service cannot request permission there.
    if (ios && (homeScreen || iosAlternativeBrowser)) return false;
    return !androidWebView;
  }

  function isSupportedAssistantVoice(voice) {
    return /^ru(?:[-_]|$)/i.test(String(voice?.lang || ''));
  }

  function selectRussianVoice(voices = []) {
    return Array.from(voices || []).filter(isSupportedAssistantVoice).sort((left, right) => {
      const score = voice => {
        const name = String(voice?.name || '');
        return (/^ru-RU$/i.test(String(voice?.lang || '')) ? 8 : 0)
          + (/svetlana|светлана/i.test(name) ? 100 : /dmitr(?:y|i)|дмитрий/i.test(name) ? 80 : 0)
          + (/natural|online/i.test(name) ? 3 : 0)
          + (voice?.default ? 1 : 0);
      };
      return score(right) - score(left) || String(left.name || '').localeCompare(String(right.name || ''), 'ru');
    })[0] || null;
  }

  // Speak the same substantive fields shown by detailsMarkup; never read IDs,
  // hidden snapshots, action buttons or feedback controls.
  function assistantSpeechText(model = {}) {
    const parts = [];
    const add = value => { if (value !== undefined && value !== null && String(value).trim()) parts.push(String(value).trim()); };
    const field = (label, value) => { if (value !== undefined && value !== null && String(value).trim()) add(`${label}: ${value}`); };
    const booking = item => add([item.date ? formatDate(item.date) : '', item.time, item.clientName || 'Клиент', item.serviceName || 'Услуга'].filter(Boolean).join(', '));
    if (model.offline) add('Офлайн. Сведения могут быть устаревшими');
    add(model.title);
    add(model.message);
    const plan = model.plan || {};
    if (model.kind === 'booking_draft' || model.kind === 'find_slots') {
      const services = plan.serviceId ? [] : ((model.candidates?.length ? model.candidates : model.availableServices) || []).slice(0, 8);
      if (services.length) {
        add('Выберите услугу');
        services.forEach(item => add(item.name));
      } else if (!plan.serviceId) add('Активных услуг для выбора сейчас нет');
      else if (plan.perMinute && !Number(plan.durationMinutes)) {
        add('Выберите длительность');
        [...new Set([Number(plan.defaultDurationMinutes || 60), 15, 30, 45, 60])].filter(value => value >= 1 && value <= 480).slice(0, 5).forEach(value => add(`${value} минут`));
        add('Или укажите точную длительность в минутах');
      } else if (model.loading) add('Проверяем расписание');
      else if (model.slotError) add('Свободное время не загружено. Повторите поиск после синхронизации');
      else if (Array.isArray(model.slots)) {
        field('Услуга', plan.serviceName);
        field('Дата', formatDate(plan.date));
        if (Number(plan.durationMinutes)) field('Длительность', `${plan.durationMinutes} минут`);
        if (!model.slots.length) add('На эту дату нет окна нужной длительности');
        else {
          add('Свободное время');
          (model.slotOptions || model.slots.map(time => ({ time }))).forEach(option => add([option.time, option.recommended ? option.reason : ''].filter(Boolean).join('. ')));
        }
      } else {
        field('Клиент', plan.clientName);
        field('Дата', formatDate(plan.date));
        field('Время', plan.time);
        field('Услуга', plan.serviceName);
        if (Number(plan.durationMinutes)) field('Длительность', `${plan.durationMinutes} минут`);
        add(model.draftText);
      }
    } else if (model.kind === 'operation_preview') {
      if (model.candidates?.length) {
        add('Выберите запись');
        model.candidates.forEach(booking);
      } else {
        field('Клиент', plan.clientName || 'Клиент');
        field('Услуга', plan.serviceName || 'Услуга');
        field('Было', [formatDate(plan.fromDate), plan.fromTime].filter(Boolean).join(', '));
        if (plan.operation === 'reschedule' && plan.targetDate) field('Станет', [formatDate(plan.targetDate), plan.targetTime].filter(Boolean).join(', '));
      }
    } else if (model.kind === 'schedule_summary' || model.kind === 'client_search') {
      (model.items || []).forEach(booking);
      if (model.total > (model.items || []).length) add(`Показаны первые ${(model.items || []).length} из ${model.total}`);
    } else if (model.kind === 'compound_plan') {
      (model.steps || []).forEach(step => add(step.label));
      (model.points || []).forEach(add);
    } else {
      if (model.examples) model.examples.forEach(add);
      else {
        (model.metrics || []).forEach(item => field(item.label, item.value));
        (model.points || []).forEach(add);
      }
      if (model.draftText) { add('Готовый черновик'); add(model.draftText); }
    }
    if (model.explanation) field('Почему', model.explanation);
    add(model.sourceLabel);
    return parts.map(part => /[.!?…]$/.test(part) ? part : `${part}.`).join(' ');
  }

  function splitSpeechText(value) {
    const chars = Array.from(String(value || '').replace(/\s+/g, ' ').trim());
    const chunks = [];
    for (let start = 0; start < chars.length;) {
      let end = Math.min(start + 600, chars.length);
      if (end < chars.length) {
        let space = -1;
        for (let index = end - 1; index > start + 300; index -= 1) {
          if (chars[index] !== ' ') continue;
          if (space < 0) space = index;
          if (/[.!?…]/.test(chars[index - 1])) { space = index; break; }
        }
        if (space > start) end = space;
      }
      chunks.push(chars.slice(start, end).join('').trim());
      start = end;
      while (chars[start] === ' ') start += 1;
    }
    return chunks;
  }

  function normalizedSpeechRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return DEFAULT_SPEECH_RATE;
    return Math.round(Math.min(2, Math.max(0.6, rate)) * 100) / 100;
  }

  function speechVoiceKey(voice) {
    if (!voice) return '';
    return String(voice.voiceURI || `${voice.lang || ''}|${voice.name || ''}`).slice(0, 300);
  }

  function normalizedSpeechVolume(value) {
    if (value == null || value === '' || !['number', 'string'].includes(typeof value)) return 1;
    const volume = Number(value);
    return Number.isFinite(volume) ? Math.round(Math.min(1, Math.max(0, volume)) * 100) / 100 : 1;
  }

  function applyOfflineContext(model, snapshot) {
    if (!snapshot?.offlineReadable) return model;
    const updated = snapshotTimeLabel(snapshot.lastUpdatedAt);
    if (model.kind === 'client_search' || model.kind === 'clients_summary') {
      return {
        kind:'offline_notice',
        title:model.kind === 'client_search' ? 'Поиск клиента офлайн недоступен' : 'Статистика клиентов офлайн недоступна',
        message:`В сохранённой копии имена и телефоны скрыты. Последнее обновление: ${updated}. Подключитесь к интернету для расчёта.` ,
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

  function needsClarification(model) {
    if (model?.needsDetail) return true;
    if (model?.kind === 'find_slots') return !model.plan?.serviceId || (model.plan?.perMinute && !Number(model.plan?.durationMinutes));
    if (model?.kind !== 'booking_draft') return false;
    return !model.plan?.clientName || (!model.plan?.time && !model.plan?.timePreference) || !model.plan?.serviceId || (model.plan?.perMinute && !Number(model.plan?.durationMinutes));
  }

  function canContinueCommand(previousCommand, previousModel, followUp, snapshot = {}, now = new Date()) {
    if (!String(previousCommand || '').trim() || !String(followUp || '').trim() || !needsClarification(previousModel)) return false;
    const standalone = interpretCommand(followUp, snapshot, now);
    return standalone.kind === 'help';
  }

  function continueCommand(previousCommand, previousModel, followUp) {
    const previous = String(previousCommand || '').trim();
    const addition = String(followUp || '').trim();
    if (!previous || !addition) return `${previous} ${addition}`.trim().slice(0, 500);
    if (previousModel?.kind === 'booking_draft' && !previousModel.plan?.clientName) {
      const repaired = repairCommand(previous).text;
      const action = /(?:^|\s)(?:запиш[а-я]*|записать|добав[а-я]*|постав[а-я]*|забронир[а-я]*|оформ[а-я]*|назнач[а-я]*|запланир[а-я]*|созда[а-я]*)(?=\s|$)/i;
      const match = action.exec(repaired);
      if (match) {
        const end = (match.index || 0) + match[0].length;
        return `${repaired.slice(0, end)} ${addition} ${repaired.slice(end)}`.replace(/\s+/g, ' ').trim().slice(0, 500);
      }
    }
    return `${previous} ${addition}`.replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function assistantContextText(value, maximum = 80) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
  }

  function buildAssistantContext(snapshot = {}) {
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(snapshot.today || '')) ? String(snapshot.today) : '';
    const earliest = today ? shiftIsoDate(today, -45) : '';
    const latest = today ? shiftIsoDate(today, 400) : '';
    const services = (Array.isArray(snapshot.services) ? snapshot.services : []).slice(0, 40).map(item => ({
      id:assistantContextText(item?.id, 80),
      name:assistantContextText(item?.name, 100),
      durationMinutes:Math.max(1, Math.min(480, Math.round(Number(item?.durationMinutes) || 60))),
      defaultDurationMinutes:Math.max(1, Math.min(480, Math.round(Number(item?.defaultDurationMinutes || item?.durationMinutes) || 60))),
      priceRub:Math.max(0, Math.min(100000000, Math.round(Number(item?.priceRub) || 0))),
      perMinute:Boolean(item?.perMinute)
    }));
    const scopedBookings = (Array.isArray(snapshot.bookings) ? snapshot.bookings : [])
      .filter(item => !today || (String(item?.date || '') >= earliest && String(item?.date || '') <= latest));
    const futureBookings = scopedBookings.filter(item => !today || String(item?.date || '') >= today)
      .sort((left, right) => `${left?.date || ''}${left?.time || ''}`.localeCompare(`${right?.date || ''}${right?.time || ''}`));
    const pastBookings = scopedBookings.filter(item => today && String(item?.date || '') < today)
      .sort((left, right) => `${right?.date || ''}${right?.time || ''}`.localeCompare(`${left?.date || ''}${left?.time || ''}`));
    const bookings = [...futureBookings, ...pastBookings]
      .slice(0, 36)
      .map(item => ({
        id:assistantContextText(item?.id, 80),
        clientName:assistantContextText(item?.clientName, 80),
        date:/^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || '')) ? String(item.date) : '',
        time:/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item?.time || '')) ? String(item.time) : '',
        durationMinutes:Math.max(1, Math.min(480, Math.round(Number(item?.durationMinutes) || 60))),
        serviceId:assistantContextText(item?.serviceId, 80),
        serviceName:assistantContextText(item?.serviceName, 100),
        status:assistantContextText(item?.status, 24),
        outcome:assistantContextText(item?.outcome, 24)
      }));
    const team = (Array.isArray(snapshot.team) ? snapshot.team : []).slice(0, 20).map(item => ({
      name:assistantContextText(item?.name, 80),
      role:assistantContextText(item?.role, 30)
    }));
    const inventory = snapshot.inventory && typeof snapshot.inventory === 'object' ? {
      enabled:Boolean(snapshot.inventory.enabled),
      items:(Array.isArray(snapshot.inventory.items) ? snapshot.inventory.items : []).slice(0, 24).map(item => ({
        id:assistantContextText(item?.id, 80),
        name:assistantContextText(item?.name, 100),
        unit:assistantContextText(item?.unit, 20),
        quantity:Math.max(0, Math.min(100000000, Number(item?.quantity) || 0)),
        lowStockThreshold:Math.max(0, Math.min(100000000, Number(item?.lowStockThreshold) || 0))
      }))
    } : null;
    const notifications = snapshot.notifications && typeof snapshot.notifications === 'object' ? {
      available:Boolean(snapshot.notifications.available),
      failed:Math.max(0, Math.min(100000, Math.round(Number(snapshot.notifications.failed) || 0))),
      pending:Math.max(0, Math.min(100000, Math.round(Number(snapshot.notifications.pending) || 0))),
      manualDue:Math.max(0, Math.min(100000, Math.round(Number(snapshot.notifications.manualDue) || 0))),
      manualDueWithin24Hours:Math.max(0, Math.min(100000, Math.round(Number(snapshot.notifications.manualDueWithin24Hours) || 0)))
    } : null;
    const context = {
      today,
      selectedDate:/^\d{4}-\d{2}-\d{2}$/.test(String(snapshot.selectedDate || '')) ? String(snapshot.selectedDate) : '',
      organizationName:assistantContextText(snapshot.organizationName, 100),
      currentRole:assistantContextText(snapshot.currentRole, 30),
      services,
      bookings,
      team,
      notifications,
      inventory
    };
    const contextBytes = () => new TextEncoder().encode(JSON.stringify(context)).byteLength;
    while (contextBytes() > 18 * 1024) {
      if (context.bookings.length > 12) context.bookings.pop();
      else if (context.inventory?.items?.length > 8) context.inventory.items.pop();
      else if (context.services.length > 12) context.services.pop();
      else if (context.team.length > 6) context.team.pop();
      else break;
    }
    return context;
  }

  function shouldUseRemoteUnderstanding(command, localModel, snapshot = {}) {
    const text = normalizeText(command);
    if (!text || !snapshot.synchronized || snapshot.offline || text.length > 500) return false;
    if (localModel?.kind === 'help' || localModel?.understandingConfidence === 'low' || needsClarification(localModel)) return true;
    if (/(?:^|\s)(?:это|эту|тот|ту|того|нее|ней|его|ее|предыдущ[а-я]*|последн[а-я]*|как\s+обычно|туда|потом|пораньше|попозже|на\s+час\s+(?:раньше|позже)|после\s+обеда)(?=\s|$)/.test(text)) return true;
    return text.split(' ').filter(Boolean).length >= 11;
  }

  function assistantAnalysisModel(analysis, snapshot = {}, now = new Date()) {
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return null;
    const intent = String(analysis.intent || '');
    const confidence = Number(analysis.confidence);
    const canonicalCommand = String(analysis.canonicalCommand || '').trim().slice(0, 500);
    const clarification = String(analysis.clarification || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!REMOTE_INTENTS.has(intent) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    if (clarification || confidence < 0.62) {
      const question = clarification || 'Уточните, что именно нужно узнать или подготовить.';
      return { kind:'ai_clarification', title:'Нужно небольшое уточнение', message:question, needsDetail:question, understandingConfidence:'low', aiEnhanced:true };
    }
    if (!canonicalCommand) return null;
    const interpreted = interpretCommand(canonicalCommand, snapshot, now);
    if (!(REMOTE_INTENT_KINDS[intent] || []).includes(interpreted.kind)) {
      return { kind:'ai_clarification', title:'Нужно небольшое уточнение', message:'Не удалось безопасно сопоставить смысл с операцией кабинета. Переформулируйте задачу одним предложением.', needsDetail:'задача', understandingConfidence:'low', aiEnhanced:true };
    }
    return { ...interpreted, aiEnhanced:true, canonicalCommand };
  }

  function createController(options = {}) {
    const doc = options.document || global.document;
    const bridge = options.bridge || global.MinutaProviderAssistant;
    if (!doc || !bridge) return { bind() {}, destroy() {} };
    const dialog = doc.querySelector('#voiceAssistantDialog');
    const openButton = doc.querySelector('#openVoiceAssistant');
    const closeButton = doc.querySelector('[data-close-voice-assistant]');
    const backButton = doc.querySelector('[data-voice-back]');
    const form = doc.querySelector('#voiceAssistantForm');
    const input = doc.querySelector('#voiceAssistantInput');
    const listenButton = doc.querySelector('#voiceListenButton');
    const status = doc.querySelector('#voiceAssistantStatus');
    const result = doc.querySelector('#voiceAssistantResult');
    const scrollArea = doc.querySelector('.voice-assistant-scroll');
    const starters = doc.querySelector('#voiceAssistantStarters');
    const capabilities = doc.querySelector('.voice-assistant-capabilities');
    const proactive = doc.querySelector('#voiceAssistantProactive');
    const proactiveTitle = doc.querySelector('#voiceAssistantProactiveTitle');
    const proactiveMessage = doc.querySelector('#voiceAssistantProactiveMessage');
    const speechSettings = doc.querySelector('#voiceAssistantSpeechSettings');
    const settings = doc.querySelector('#voiceAssistantSettings');
    const voiceSelect = doc.querySelector('#voiceAssistantVoice');
    const rateInput = doc.querySelector('#voiceAssistantRate');
    const rateValue = doc.querySelector('#voiceAssistantRateValue');
    const volumeInput = doc.querySelector('#voiceAssistantVolume');
    const volumeValue = doc.querySelector('#voiceAssistantVolumeValue');
    const voicePreviewButton = doc.querySelector('#voiceAssistantVoicePreview');
    const memoryText = doc.querySelector('#voiceAssistantMemoryText');
    const clearMemoryButton = doc.querySelector('#voiceAssistantClearMemory');
    if (!dialog || !openButton || !closeButton || !backButton || !form || !input || !listenButton || !status || !result) return { bind() {}, destroy() {} };

    const Recognition = global.SpeechRecognition || global.webkitSpeechRecognition;
    const standaloneDisplay = Boolean(global.matchMedia?.('(display-mode: standalone)').matches);
    const touchDevice = Boolean(global.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(global.navigator?.userAgent || ''));
    let directRecognitionAvailable = supportsDirectRecognition(Recognition, global.navigator, standaloneDisplay);
    let recognition = null;
    let recognitionStartTimer = null;
    let recognitionRestartTimer = null;
    let recordingRequested = false;
    let accumulatedTranscript = '';
    let listening = false;
    let finishingRecognition = false;
    let lastModel = null;
    let lastCommand = '';
    let lastSessionGeneration = null;
    let pendingCommand = '';
    let recognitionEpoch = 0;
    let speechEpoch = 0;
    let speaking = false;
    let russianVoice = null;
    let speechRate = DEFAULT_SPEECH_RATE;
    let speechVolume = 1;
    let preferredVoiceKey = '';
    let suppressCompatibilityClick = false;
    let compatibilityClickResetTimer = null;
    let activeTouchPointerId = null;
    let requestEpoch = 0;
    let conversationHistory = [];
    let conversationContext = {};
    let correctionOriginal = '';
    let activePlan = null;

    function refreshAssistantMemory(snapshot = bridge.getReadOnlySnapshot?.() || {}) {
      if (!memoryText) return;
      const preferences = bridge.getAssistantPreferences?.() || snapshot.assistantPreferences || {};
      const service = (snapshot.services || []).find(item => String(item.id) === String(preferences.preferredServiceId || ''));
      const parts = [];
      if (preferences.preferredTime) parts.push(`обычное время — около ${preferences.preferredTime}`);
      if (service) parts.push(`часто выбираемая услуга — «${service.name}»`);
      const duration = service ? Number(preferences.usualDurations?.[String(service.id)] || 0) : 0;
      if (duration) parts.push(`обычная длительность — ${duration} минут`);
      memoryText.textContent = parts.length
        ? `Запомнено для этого кабинета на этом устройстве: ${parts.join('; ')}. Имена клиентов и тексты команд не сохраняются.`
        : 'Пока привычки не определены. После двух подтверждённых выборов помощник сможет учитывать обычное время и длительность. Имена клиентов и тексты команд не сохраняются.';
      if (clearMemoryButton) clearMemoryButton.hidden = !Number(preferences.observationCount || 0);
    }

    function refreshProactive(snapshot = {}) {
      if (!proactive || !proactiveTitle || !proactiveMessage) return;
      const model = proactiveBriefingModel(snapshot, new Date());
      proactive.hidden = !model;
      proactive.dataset.voicePrompt = model?.prompt || '';
      proactiveTitle.textContent = model?.title || '';
      proactiveMessage.textContent = model?.message || '';
    }

    function rememberConversation(command, model) {
      const userText = String(command || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const assistantText = `${model?.title || ''}. ${model?.message || ''}`.replace(/\s+/g, ' ').trim().slice(0, 500);
      if (userText) conversationHistory.push({ role:'user', text:userText });
      if (assistantText) conversationHistory.push({ role:'assistant', text:assistantText });
      conversationHistory = conversationHistory.slice(-6);
    }

    function loadSpeechSettings() {
      try {
        const saved = JSON.parse(global.localStorage?.getItem(SPEECH_SETTINGS_KEY) || '{}');
        speechRate = normalizedSpeechRate(saved.rate);
        speechVolume = normalizedSpeechVolume(saved.volume);
        if (![1, 1.25, 1.5, 1.75, 2].includes(speechRate)) speechRate = DEFAULT_SPEECH_RATE;
        preferredVoiceKey = String(saved.voiceKey || '').slice(0, 300);
      } catch {
        speechRate = DEFAULT_SPEECH_RATE;
        speechVolume = 1;
        preferredVoiceKey = '';
      }
      if (rateInput) rateInput.value = String(speechRate);
      if (rateValue) rateValue.textContent = `${String(speechRate).replace('.', ',')}×`;
      refreshVolumeControls();
    }

    function refreshVolumeControls() {
      const percent = Math.round(speechVolume * 100);
      const label = percent ? `${percent}%` : 'Без звука';
      if (volumeInput) {
        volumeInput.value = String(percent);
        volumeInput.setAttribute('aria-valuetext', label);
      }
      if (volumeValue) volumeValue.textContent = label;
    }

    function saveSpeechSettings() {
      try { global.localStorage?.setItem(SPEECH_SETTINGS_KEY, JSON.stringify({ voiceKey:preferredVoiceKey, rate:speechRate, volume:speechVolume })); } catch {}
    }

    function russianVoices() {
      try {
        return Array.from(global.speechSynthesis?.getVoices?.() || []).filter(isSupportedAssistantVoice);
      } catch { return []; }
    }

    function refreshVoiceControls(voices) {
      if (!voiceSelect || typeof doc.createElement !== 'function') return;
      const currentKey = speechVoiceKey(russianVoice);
      voiceSelect.replaceChildren();
      if (!global.speechSynthesis || !global.SpeechSynthesisUtterance || !voices.length) {
        const option = doc.createElement('option');
        option.value = '';
        option.textContent = global.speechSynthesis && global.SpeechSynthesisUtterance ? 'Браузер пока не передал русский голос' : 'Озвучка не поддерживается';
        voiceSelect.append(option);
        voiceSelect.disabled = true;
        // Keep a user-initiated retry available when Android exposes voices late.
        if (voicePreviewButton) voicePreviewButton.disabled = !global.speechSynthesis || !global.SpeechSynthesisUtterance;
        return;
      }
      voices.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'ru')).forEach(voice => {
        const option = doc.createElement('option');
        option.value = speechVoiceKey(voice);
        option.textContent = String(voice.name || 'Русский голос устройства');
        voiceSelect.append(option);
      });
      voiceSelect.disabled = false;
      voiceSelect.value = currentKey;
      if (voicePreviewButton) voicePreviewButton.disabled = false;
    }

    function refreshRussianVoice() {
      const voices = russianVoices();
      russianVoice = voices.find(voice => speechVoiceKey(voice) === preferredVoiceKey) || selectRussianVoice(voices);
      if (russianVoice && preferredVoiceKey !== speechVoiceKey(russianVoice)) {
        preferredVoiceKey = speechVoiceKey(russianVoice);
        saveSpeechSettings();
      }
      refreshVoiceControls(voices);
      return russianVoice;
    }

    function playMicrophoneCue(active = true, audible = true) {
      try { global.navigator?.vibrate?.(active ? 35 : 20); } catch {}
      // На телефоне собственный звук после захвата микрофона может попасть в
      // распознавание или забрать Android audio focus. Там оставляем вибрацию
      // и визуальный индикатор, а звуковой сигнал сохраняем на компьютере.
      if (!audible) return;
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return;
      try {
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const startedAt = audio.currentTime;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(active ? 740 : 440, startedAt);
        gain.gain.setValueAtTime(0.0001, startedAt);
        gain.gain.exponentialRampToValueAtTime(0.11, startedAt + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.11);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.onended = () => { try { audio.close(); } catch {} };
        oscillator.start(startedAt);
        oscillator.stop(startedAt + 0.12);
      } catch {}
    }

    function setListening(value) {
      listening = value;
      if (!value) finishingRecognition = false;
      listenButton.classList.toggle('is-listening', value);
      listenButton.setAttribute('aria-pressed', String(value));
      listenButton.querySelector('span').textContent = value ? (finishingRecognition ? 'Распознаю…' : 'Остановить запись') : (directRecognitionAvailable ? 'Говорить' : touchDevice ? 'Открыть диктовку' : 'Говорить');
    }

    function resetPointerGesture({ preserveCompatibilityClick = false } = {}) {
      activeTouchPointerId = null;
      clearTimeout(compatibilityClickResetTimer);
      compatibilityClickResetTimer = null;
      if (!preserveCompatibilityClick) suppressCompatibilityClick = false;
    }

    function abortRecognition({ preserveCompatibilityClick = false } = {}) {
      recognitionEpoch += 1;
      clearTimeout(recognitionStartTimer);
      clearTimeout(recognitionRestartTimer);
      recognitionStartTimer = null;
      recognitionRestartTimer = null;
      recordingRequested = false;
      accumulatedTranscript = '';
      try { recognition?.abort(); } catch {}
      recognition = null;
      resetPointerGesture({ preserveCompatibilityClick });
      setListening(false);
    }

    function finishRecognition() {
      if ((!recordingRequested && !recognition) || finishingRecognition) return;
      recordingRequested = false;
      clearTimeout(recognitionStartTimer);
      clearTimeout(recognitionRestartTimer);
      recognitionStartTimer = null;
      recognitionRestartTimer = null;
      if (!recognition) {
        setListening(false);
        if (input.value.trim()) understand();
        else status.textContent = 'Речь не получена. Коснитесь микрофона и попробуйте ещё раз.';
        return;
      }
      finishingRecognition = true;
      setListening(true);
      status.textContent = 'Заканчиваю запись и распознаю сказанное…';
      playMicrophoneCue(false, !touchDevice);
      try { recognition.stop(); }
      catch { abortRecognition({ preserveCompatibilityClick:true }); status.textContent = 'Не удалось завершить запись. Попробуйте ещё раз.'; }
    }

    function openKeyboardDictation(message = '') {
      // A transient recognition failure must not disable the API until reload.
      recordingRequested = false;
      clearTimeout(recognitionStartTimer);
      clearTimeout(recognitionRestartTimer);
      recognitionStartTimer = null;
      recognitionRestartTimer = null;
      try { recognition?.abort(); } catch {}
      recognition = null;
      setListening(false);
      listenButton.classList.toggle('is-unsupported', !directRecognitionAvailable);
      status.textContent = message || 'Клавиатура открыта. Нажмите значок микрофона на клавиатуре и продиктуйте команду.';
      try {
        input.focus({ preventScroll:true });
        input.click?.();
        input.setSelectionRange?.(input.value.length, input.value.length);
      } catch { input.focus(); }
      setTimeout(() => input.scrollIntoView?.({ block:'center', behavior:'smooth' }), 0);
    }

    function setSpeaking(value) {
      speaking = Boolean(value);
      const button = result.querySelector('[data-voice-speak]');
      if (button) {
        button.classList.toggle('is-speaking', speaking);
        button.setAttribute('aria-pressed', String(speaking));
        button.textContent = speaking ? 'Остановить голос' : 'Озвучить ответ';
      }
      if (voicePreviewButton) {
        voicePreviewButton.classList.toggle('is-speaking', speaking);
        voicePreviewButton.setAttribute('aria-pressed', String(speaking));
        voicePreviewButton.textContent = speaking ? 'Остановить' : 'Проверить голос';
      }
    }

    function stopSpeech() {
      speechEpoch += 1;
      try { global.speechSynthesis?.cancel(); } catch {}
      setSpeaking(false);
    }

    function speakText(text, completedMessage = '') {
      if (speechVolume === 0) {
        stopSpeech();
        status.textContent = 'Озвучка выключена. Увеличьте громкость в настройках помощника.';
        return false;
      }
      if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) {
        setSpeaking(false);
        status.textContent = 'Этот браузер не поддерживает озвучивание. Вы можете прочитать ответ на экране.';
        return false;
      }
      const voice = refreshRussianVoice();
      if (!voice) {
        setSpeaking(false);
        status.textContent = 'Браузер пока не передал русский голос. Если в настройках телефона голос уже работает, полностью закройте и снова откройте браузер, затем нажмите «Проверить голос». Ответ доступен текстом.';
        if (speechSettings) speechSettings.open = true;
        if (settings) settings.open = true;
        return false;
      }
      const chunks = splitSpeechText(text);
      if (!chunks.length) return false;
      const epoch = ++speechEpoch;
      const rate = speechRate;
      const volume = speechVolume;
      const fail = () => {
        if (epoch !== speechEpoch) return;
        speechEpoch += 1;
        try { global.speechSynthesis.cancel(); } catch {}
        setSpeaking(false);
        status.textContent = 'Не удалось озвучить ответ на этом устройстве.';
      };
      const next = index => {
        if (epoch !== speechEpoch) return;
        if (index >= chunks.length) {
          setSpeaking(false);
          if (completedMessage) status.textContent = completedMessage;
          return;
        }
        try {
          const utterance = new global.SpeechSynthesisUtterance(chunks[index]);
          utterance.voice = voice;
          utterance.lang = String(voice.lang || 'ru-RU').replace('_', '-');
          utterance.rate = rate;
          utterance.volume = volume;
          utterance.pitch = 1;
          let settled = false;
          utterance.onend = () => { if (!settled) { settled = true; next(index + 1); } };
          utterance.onerror = () => { if (!settled) { settled = true; fail(); } };
          global.speechSynthesis.speak(utterance);
        } catch { fail(); }
      };
      try { global.speechSynthesis.cancel(); } catch { fail(); return false; }
      setSpeaking(true);
      next(0);
      return epoch === speechEpoch;
    }

    function close() {
      requestEpoch += 1;
      abortRecognition();
      stopSpeech();
      if (dialog.open) dialog.close();
    }

    function returnToMainMenu() {
      dialog.classList.remove('has-answer');
      requestEpoch += 1;
      abortRecognition();
      stopSpeech();
      input.value = '';
      input.placeholder = 'Напишите вопрос…';
      result.hidden = true;
      result.replaceChildren();
      lastModel = null;
      lastCommand = '';
      lastSessionGeneration = null;
      pendingCommand = '';
      conversationHistory = [];
      conversationContext = {};
      correctionOriginal = '';
      activePlan = null;
      starters?.classList.remove('is-secondary');
      if (capabilities) capabilities.open = false;
      backButton.hidden = true;
      status.textContent = directRecognitionAvailable ? (touchDevice ? 'Коснитесь микрофона и говорите. Повторное касание завершит запись.' : 'Ничего не изменится без вашего подтверждения.') : touchDevice ? 'Нажмите микрофон, затем значок диктовки на клавиатуре.' : 'Голосовой ввод недоступен в этом браузере. Текстовые команды работают.';
      setTimeout(() => (starters?.querySelector?.('button') || input).focus(), 0);
    }

    function reset() {
      dialog.classList.remove('has-answer');
      close();
      input.value = '';
      result.hidden = true;
      result.replaceChildren();
      lastModel = null;
      lastCommand = '';
      lastSessionGeneration = null;
      pendingCommand = '';
      conversationHistory = [];
      conversationContext = {};
      correctionOriginal = '';
      activePlan = null;
      if (proactive) { proactive.hidden = true; proactive.dataset.voicePrompt = ''; }
      if (proactiveTitle) proactiveTitle.textContent = '';
      if (proactiveMessage) proactiveMessage.textContent = '';
      if (memoryText) memoryText.textContent = 'Пока привычки не определены.';
      if (clearMemoryButton) clearMemoryButton.hidden = true;
      input.placeholder = 'Напишите вопрос…';
      starters?.classList.remove('is-secondary');
      backButton.hidden = true;
      status.textContent = 'Нажмите «Говорить» или введите команду текстом.';
    }

    function detailsMarkup(model) {
      const draft = model.draftText ? `<div class="voice-result-draft"><small>Готовый черновик</small><p>${escapeHtml(model.draftText)}</p></div>` : '';
      if (model.kind === 'booking_draft' || model.kind === 'find_slots') {
        const plan = model.plan || {};
        const services = plan.serviceId ? [] : ((model.candidates?.length ? model.candidates : model.availableServices) || []).slice(0, 8);
        if (services.length) return `<div class="voice-result-choices" aria-label="Выберите услугу">${services.map(item => `<button class="voice-result-choice" type="button" data-voice-service="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>`).join('')}</div>`;
        if (!plan.serviceId) return '<p class="voice-result-empty">Активных услуг для выбора сейчас нет.</p>';
        if (plan.perMinute && !Number(plan.durationMinutes)) {
          const preset = Number(plan.defaultDurationMinutes || 60);
          const values = [...new Set([preset, 15, 30, 45, 60])].filter(value => value >= 1 && value <= 480).slice(0, 5);
          return `<div class="voice-result-choices" aria-label="Выберите длительность">${values.map(value => `<button class="voice-result-choice" type="button" data-voice-duration="${value}">${value} минут</button>`).join('')}<form class="voice-duration-custom" data-voice-duration-form><input name="duration" type="number" inputmode="numeric" min="1" max="480" step="1" placeholder="Точное время, мин" aria-label="Точная длительность в минутах" required><button class="voice-result-choice" type="submit">Применить</button></form></div>`;
        }
        if (model.loading) return '<p class="voice-result-progress">Проверяем расписание…</p>';
        if (model.slotError) return '<p class="voice-result-empty">Свободное время не загружено. Повторите поиск после синхронизации.</p>';
        if (Array.isArray(model.slots)) {
          if (!model.slots.length) return '<p class="voice-result-empty">На эту дату нет окна нужной длительности.</p>';
          const options = model.slotOptions || model.slots.map(time => ({ time, reason:'Свободно по актуальному расписанию' }));
          const slotButton = option => `<button class="voice-result-choice voice-slot-choice${option.recommended ? ' is-recommended' : ''}" type="button" data-voice-slot="${escapeHtml(option.time)}"><strong>${escapeHtml(option.time)}</strong><small>${escapeHtml(option.recommended ? option.reason : 'Выбрать время')}</small></button>`;
          return `<p class="voice-slot-context">${escapeHtml(plan.serviceName || 'Услуга')} · ${escapeHtml(formatDate(plan.date))}${Number(plan.durationMinutes) ? ` · ${Number(plan.durationMinutes)} мин` : ''}</p><div class="voice-result-choices voice-slot-options" aria-label="Ближайшее свободное время">${options.slice(0, 4).map(slotButton).join('')}</div>${options.length > 4 ? `<details class="ux-disclosure voice-more-slots"><summary>Показать ещё время · ${options.length - 4}</summary><div class="voice-result-choices voice-slot-options">${options.slice(4).map(slotButton).join('')}</div></details>` : ''}`;
        }
        const rows = [
          plan.clientName ? ['Клиент', plan.clientName] : null,
          ['Дата', formatDate(plan.date)],
          plan.time ? ['Время', plan.time] : null,
          plan.serviceName ? ['Услуга', plan.serviceName] : null,
          Number(plan.durationMinutes) ? ['Длительность', `${plan.durationMinutes} минут`] : null
        ].filter(Boolean);
        return `${rows.length ? `<dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}${draft}`;
      }
      if (model.kind === 'operation_preview') {
        if (model.candidates?.length) return `<div class="voice-result-choices" aria-label="Выберите запись">${model.candidates.map(item => `<button class="voice-result-choice" type="button" data-voice-booking-option="${escapeHtml(`запись-id-${item.id || ''}`)}"><strong>${escapeHtml(item.clientName || 'Клиент')}</strong><span>${escapeHtml(`${formatDate(item.date)} · ${item.time || ''} · ${item.serviceName || 'Услуга'}`)}</span></button>`).join('')}</div>`;
        const plan = model.plan || {};
        const rows = [
          ['Клиент', plan.clientName || 'Клиент'],
          ['Услуга', plan.serviceName || 'Услуга'],
          ['Было', `${formatDate(plan.fromDate)} · ${plan.fromTime || ''}`],
          plan.operation === 'reschedule' && plan.targetDate ? ['Станет', `${formatDate(plan.targetDate)}${plan.targetTime ? ` · ${plan.targetTime}` : ''}`] : null
        ].filter(Boolean);
        return `<dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
      }
      if (model.kind === 'schedule_summary' || model.kind === 'client_search') {
        const list = (model.items || []).map(item => `<li><strong>${escapeHtml(item.time || '')}</strong><span>${escapeHtml(item.clientName || 'Клиент')} · ${escapeHtml(item.serviceName || 'Услуга')}</span></li>`).join('');
        return list ? `<ul>${list}</ul>${model.total > model.items.length ? `<small>Показаны первые ${model.items.length} из ${model.total}</small>` : ''}` : '';
      }
      if (model.kind === 'compound_plan') {
        const choices = (model.steps || []).map((step, index) => `<button class="voice-result-choice" type="button" data-voice-step="${escapeHtml(step.command)}" data-voice-step-index="${index}">${escapeHtml(step.label)}</button>`).join('');
        const points = (model.points || []).map(item => `<li><span>${escapeHtml(item)}</span></li>`).join('');
        return `${choices ? `<div class="voice-result-choices" aria-label="Шаги команды">${choices}</div>` : ''}${points ? `<ul class="voice-result-points">${points}</ul>` : ''}`;
      }
      if (model.examples) return `<ul class="voice-help-list">${model.examples.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>${draft}`;
      if (model.metrics?.length || model.points?.length) {
        const metrics = model.metrics?.length ? `<div class="voice-result-metrics">${model.metrics.map(item => `<div><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`).join('')}</div>` : '';
        const points = model.points?.length ? `<ul class="voice-result-points">${model.points.map(item => `<li><span>${escapeHtml(item)}</span></li>`).join('')}</ul>` : '';
        return `${metrics}${points}${draft}`;
      }
      return draft;
    }

    function runActivePlanStep(index) {
      if (!activePlan || !Array.isArray(activePlan.steps)) return;
      const nextIndex = Number(index);
      const step = activePlan.steps[nextIndex];
      if (!step?.command) return;
      activePlan.index = nextIndex;
      input.value = step.command;
      understand();
    }

    async function findSlots(model) {
      if (!model?.plan?.serviceId || (model.plan.perMinute && !Number(model.plan.durationMinutes))) { renderModel(model, lastSessionGeneration); return; }
      const epoch = ++requestEpoch;
      const expectedSessionGeneration = lastSessionGeneration;
      const pending = { ...model, loading:true, slots:null, message:'Проверяю расписание и занятые интервалы…' };
      renderModel(pending, expectedSessionGeneration);
      status.textContent = 'Ищем свободное время…';
      let response;
      try {
        response = await bridge.findAvailableSlots?.(model.plan);
      } catch {
        response = { ok:false, reason:'request_failed', slots:[] };
      }
      if (epoch !== requestEpoch || !dialog.open) return;
      const currentSnapshot = bridge.getReadOnlySnapshot();
      if (!currentSnapshot?.authenticated || !Object.is(currentSnapshot.sessionGeneration, expectedSessionGeneration)) {
        requestEpoch += 1;
        renderModel({ kind:'error', title:'Сессия кабинета изменилась', message:'Повторите поиск после завершения синхронизации.' }, currentSnapshot?.sessionGeneration);
        status.textContent = 'Устаревший результат поиска не показан.';
        return;
      }
      if (!currentSnapshot.synchronized && response?.ok) response = { ok:false, reason:'not_synchronized', slots:[] };
      const available = response?.ok && Array.isArray(response.slots) ? response.slots.filter(time => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) : [];
      const ranked = applySlotPreferences(available, model.plan?.timePreference || null, { bookings:currentSnapshot.bookings || [], date:model.plan?.date || '', durationMinutes:model.plan?.durationMinutes || response?.durationMinutes || 0 });
      const slots = ranked.slots;
      const preferenceLabel = model.plan?.timePreference?.label || '';
      const resolved = {
        ...model,
        loading:false,
        slots:response?.ok ? slots : null,
        slotOptions:response?.ok ? ranked.options : null,
        slotError:!response?.ok,
        explanation:response?.ok && slots.length ? (preferenceLabel ? `Первым показан вариант, который лучше всего соответствует условию «${preferenceLabel}». Все интервалы проверены по актуальному расписанию.` : 'Варианты отсортированы от ближайшего свободного времени. Все интервалы проверены по актуальному расписанию.') : '',
        message:response?.ok ? (slots.length ? `Нашёл подходящих вариантов: ${slots.length}. Лучший вариант показан первым.` : preferenceLabel && available.length ? `Свободные окна есть, но ни одно не соответствует условию «${preferenceLabel}». Измените ограничение времени.` : 'На эту дату свободного окна нужной длительности нет.') : response?.reason === 'not_synchronized' ? 'Кабинет сейчас не синхронизирован. Дождитесь обновления данных и повторите поиск.' : 'Не удалось проверить свободное время. Обновите данные и попробуйте ещё раз.'
      };
      renderModel(resolved, expectedSessionGeneration);
      status.textContent = response?.ok ? 'Свободные интервалы проверены по актуальному расписанию.' : 'Свободное время не загружено.';
    }

    function renderModel(model, sessionGeneration = null) {
      stopSpeech();
      lastModel = model;
      lastSessionGeneration = sessionGeneration;
      if (capabilities) capabilities.open = false;
      const planReady = model.kind === 'booking_draft' && model.canPrepare && model.plan?.serviceId && (model.plan?.time || model.offline) && (!model.plan.perMinute || Number(model.plan.durationMinutes));
      const prepareAction = planReady ? '<button class="primary" type="button" data-voice-prepare>Проверить запись</button>' : '';
      const copyAction = model.draftText && !model.needsDetail ? `<button class="primary" type="button" data-voice-copy>${escapeHtml(model.copyLabel || 'Скопировать')}</button>` : '';
      const clientAction = model.kind === 'client_search' && model.clientKey ? '<button class="primary" type="button" data-voice-open-client>Открыть карточку клиента</button>' : '';
      const openAction = model.openSection ? `<button class="secondary-button" type="button" data-voice-open-section="${escapeHtml(model.openSection)}">${escapeHtml(model.openLabel || 'Открыть раздел')}</button>` : '';
      const operationAction = model.kind === 'operation_preview' && model.plan?.bookingId && !model.needsDetail ? `<button class="primary" type="button" data-voice-operation>${model.operation === 'cancel' ? 'Открыть отмену' : 'Открыть перенос'}</button>` : '';
      const undoAction = model.kind === 'undo_preview' && model.canUndo ? '<button class="primary" type="button" data-voice-undo>Вернуть предыдущий экран</button>' : '';
      const planStartAction = model.kind === 'compound_plan' && model.steps?.length ? '<button class="primary" type="button" data-voice-plan-start>Начать план</button>' : '';
      const planNextAction = activePlan && model.kind !== 'compound_plan' && activePlan.index + 1 < activePlan.steps.length ? '<button class="primary" type="button" data-voice-plan-next>Следующий шаг</button>' : '';
      const speakAction = global.speechSynthesis && global.SpeechSynthesisUtterance && refreshRussianVoice() ? '<button class="secondary-button voice-speak-action" type="button" data-voice-speak aria-pressed="false">Озвучить ответ</button>' : '';
      const speechSettingsAction = speakAction ? '<button class="secondary-button voice-speech-settings-action" type="button" data-voice-speech-settings>Голос и скорость</button>' : '';
      const actions = prepareAction || copyAction || clientAction || openAction || operationAction || undoAction || planStartAction || planNextAction || speakAction ? `<div class="voice-result-actions">${planStartAction}${planNextAction}${prepareAction}${copyAction}${clientAction}${operationAction}${undoAction}${openAction}${speakAction}${speechSettingsAction}</div>` : '';
      const planProgress = activePlan && model.kind !== 'compound_plan' ? `<p class="voice-source-note">План · шаг ${activePlan.index + 1} из ${activePlan.steps.length}</p>` : '';
      const offlineNotice = model.offline ? '<p class="voice-offline-notice">Офлайн · сведения могут быть устаревшими</p>' : '';
      const sourceNote = model.sourceLabel ? `<p class="voice-source-note">${escapeHtml(model.sourceLabel)}</p>` : '';
      const correctionNote = model.corrections?.length
        ? `<p class="voice-correction-note">Понял с исправлением: ${model.corrections.map(item => `«${escapeHtml(item.from)}» → «${escapeHtml(item.to)}»`).join(', ')}</p>`
        : '';
      const understood = lastCommand ? understoodAs(model) : '';
      const confidenceLabel = model.understandingConfidence === 'low' ? 'Нужно уточнить' : model.understandingConfidence === 'medium' ? 'Понял с проверкой' : 'Понял';
      const understandingNote = understood ? `<p class="voice-understanding-note is-${escapeHtml(model.understandingConfidence || 'high')}"><strong>${confidenceLabel}:</strong> ${escapeHtml(understood)}.</p>` : '';
      const explanationNote = model.explanation ? `<p class="voice-decision-note"><strong>Почему:</strong> ${escapeHtml(model.explanation)}</p>` : '';
      const feedback = lastCommand && model.kind !== 'error' ? '<div class="voice-feedback" aria-label="Оценить понимание команды"><span>Я правильно понял?</span><button type="button" data-voice-feedback="yes">Да</button><button type="button" data-voice-feedback="fix">Исправить</button></div>' : '';
      result.className = `voice-assistant-result is-${model.kind}`;
      result.innerHTML = `${offlineNotice}${correctionNote}${understandingNote}${planProgress}<div class="voice-result-heading"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#${model.kind === 'error' ? 'icon-alert' : 'icon-spark'}"></use></svg><div><strong>${escapeHtml(model.title)}</strong><p>${escapeHtml(model.message)}</p></div></div>${detailsMarkup(model)}${explanationNote}${sourceNote}${actions}${feedback}`;
      result.hidden = false;
      dialog.classList.add('has-answer');
      starters?.classList.add('is-secondary');
      if (scrollArea) scrollArea.scrollTop = 0;
      backButton.hidden = false;
      result.querySelectorAll?.('[data-voice-feedback]')?.forEach(button => button.addEventListener('click', () => {
        if (button.dataset.voiceFeedback === 'fix') {
          correctionOriginal = lastCommand;
          input.value = lastCommand;
          input.focus();
          status.textContent = 'Исправьте команду и отправьте её ещё раз. Помощник запомнит только безопасную замену слова или рабочей фразы, но не полный текст команды.';
          return;
        }
        correctionOriginal = '';
        status.textContent = 'Понял. Оценка учтена только в текущем окне и не сохраняет текст команды.';
      }));
      result.querySelectorAll?.('[data-voice-step]')?.forEach(button => button.addEventListener('click', () => {
        activePlan = { steps:(model.steps || []).map(step => ({ ...step })), index:Number(button.dataset.voiceStepIndex || 0) };
        runActivePlanStep(activePlan.index);
      }));
      result.querySelector('[data-voice-plan-start]')?.addEventListener('click', () => {
        activePlan = { steps:(model.steps || []).map(step => ({ ...step })), index:0 };
        runActivePlanStep(0);
      });
      result.querySelector('[data-voice-plan-next]')?.addEventListener('click', () => runActivePlanStep(activePlan.index + 1));
      result.querySelector('[data-voice-undo]')?.addEventListener('click', () => {
        const response = bridge.undoLastAssistantStep?.();
        if (response?.ok) close();
        else status.textContent = 'Предыдущий переход уже недоступен. Данные кабинета не изменены.';
      });
      result.querySelectorAll?.('[data-voice-booking-option]')?.forEach(button => button.addEventListener('click', () => {
        input.value = button.dataset.voiceBookingOption || '';
        understand();
      }));
      result.querySelector('[data-voice-operation]')?.addEventListener('click', () => {
        const snapshot = bridge.getReadOnlySnapshot();
        if (!snapshot?.authenticated || !snapshot.synchronized || !Object.is(snapshot.sessionGeneration, lastSessionGeneration)) {
          status.textContent = 'Данные изменились. Повторите команду после синхронизации.';
          return;
        }
        const response = bridge.prepareBookingOperation?.(lastModel?.plan || {});
        if (response?.ok) { pendingCommand = ''; close(); }
        else status.textContent = 'Не удалось открыть операцию. Обновите расписание и повторите команду.';
      });
      result.querySelector('[data-voice-copy]')?.addEventListener('click', async () => {
        const draftText = String(lastModel?.draftText || '');
        if (!draftText) return;
        try {
          if (typeof global.navigator?.clipboard?.writeText !== 'function') throw new Error('clipboard_unavailable');
          await global.navigator.clipboard.writeText(draftText);
          status.textContent = 'Текст скопирован. Проверьте его перед отправкой или публикацией.';
        } catch {
          status.textContent = 'Не удалось скопировать автоматически. Выделите текст в черновике вручную.';
        }
      });
      result.querySelector('[data-voice-open-section]')?.addEventListener('click', event => {
        const section = event.currentTarget?.dataset?.voiceOpenSection || '';
        const response = bridge.openSection?.(section);
        if (response?.ok) { pendingCommand = ''; close(); }
        else status.textContent = 'Не удалось открыть раздел. Повторите после входа в кабинет.';
      });
      result.querySelector('[data-voice-open-client]')?.addEventListener('click', () => {
        const snapshot = bridge.getReadOnlySnapshot();
        if (!snapshot?.authenticated || !Object.is(snapshot.sessionGeneration, lastSessionGeneration)) {
          status.textContent = 'Сессия кабинета изменилась. Повторите поиск клиента.';
          return;
        }
        const response = bridge.openClient?.({ clientKey:lastModel?.clientKey || '', sessionGeneration:lastSessionGeneration });
        if (response?.ok) { pendingCommand = ''; close(); }
        else status.textContent = 'Карточка клиента уже недоступна. Обновите данные и повторите поиск.';
      });
      result.querySelectorAll?.('[data-voice-service]')?.forEach(button => button.addEventListener('click', () => {
        const snapshot = bridge.getReadOnlySnapshot();
        if (!snapshot?.authenticated || !Object.is(snapshot.sessionGeneration, lastSessionGeneration)) {
          requestEpoch += 1;
          renderModel({ kind:'error', title:'Сессия кабинета изменилась', message:'Повторите команду после завершения синхронизации.' }, snapshot?.sessionGeneration);
          return;
        }
        const service = (snapshot.services || []).find(item => String(item.id) === button.dataset.voiceService);
        if (!service || !lastModel?.plan) return;
        if (pendingCommand) pendingCommand = `${pendingCommand} ${service.name}`.trim().slice(0, 500);
        const updated = { ...lastModel, candidates:[], availableServices:[], plan:{ ...lastModel.plan, serviceId:String(service.id), serviceName:String(service.name), perMinute:Boolean(service.perMinute), defaultDurationMinutes:Number(service.defaultDurationMinutes || service.durationMinutes || 60), durationMinutes:lastModel.plan.durationMinutes || (service.perMinute ? 0 : Number(service.durationMinutes || 60)) } };
        updated.message = updated.plan.perMinute && !updated.plan.durationMinutes ? 'Укажите длительность — для поминутной услуги можно выбрать любое значение.' : (updated.kind === 'find_slots' ? 'Проверю расписание и покажу свободные интервалы.' : 'Услуга выбрана. Проверьте остальные данные записи.');
        if (updated.kind === 'find_slots') findSlots(updated); else renderModel(updated, lastSessionGeneration);
      }));
      result.querySelectorAll?.('[data-voice-duration]')?.forEach(button => button.addEventListener('click', () => {
        if (!lastModel?.plan) return;
        const snapshot = bridge.getReadOnlySnapshot();
        if (!snapshot?.authenticated || !Object.is(snapshot.sessionGeneration, lastSessionGeneration)) {
          requestEpoch += 1;
          renderModel({ kind:'error', title:'Сессия кабинета изменилась', message:'Повторите команду после завершения синхронизации.' }, snapshot?.sessionGeneration);
          return;
        }
        const durationMinutes = Math.max(1, Math.min(480, Math.round(Number(button.dataset.voiceDuration) || 0)));
        if (pendingCommand) pendingCommand = `${pendingCommand} ${durationMinutes} минут`.trim().slice(0, 500);
        const updated = { ...lastModel, plan:{ ...lastModel.plan, durationMinutes }, message:lastModel.kind === 'find_slots' ? 'Проверю расписание и покажу свободные интервалы.' : 'Длительность выбрана. Проверьте данные записи.' };
        if (updated.kind === 'find_slots') findSlots(updated); else renderModel(updated, lastSessionGeneration);
      }));
      result.querySelector('[data-voice-duration-form]')?.addEventListener('submit', event => {
        event.preventDefault();
        if (!lastModel?.plan) return;
        const snapshot = bridge.getReadOnlySnapshot();
        if (!snapshot?.authenticated || !Object.is(snapshot.sessionGeneration, lastSessionGeneration)) {
          requestEpoch += 1;
          renderModel({ kind:'error', title:'Сессия кабинета изменилась', message:'Повторите команду после завершения синхронизации.' }, snapshot?.sessionGeneration);
          return;
        }
        const requestedDuration = Number(new FormData(event.currentTarget).get('duration'));
        if (!Number.isFinite(requestedDuration) || requestedDuration < 1 || requestedDuration > 480) {
          status.textContent = 'Укажите длительность от 1 до 480 минут.';
          return;
        }
        const durationMinutes = Math.round(requestedDuration);
        if (pendingCommand) pendingCommand = `${pendingCommand} ${durationMinutes} минут`.trim().slice(0, 500);
        const updated = { ...lastModel, plan:{ ...lastModel.plan, durationMinutes }, message:lastModel.kind === 'find_slots' ? 'Проверю расписание и покажу свободные интервалы.' : 'Длительность выбрана. Проверьте данные записи.' };
        if (updated.kind === 'find_slots') findSlots(updated); else renderModel(updated, lastSessionGeneration);
      });
      result.querySelectorAll?.('[data-voice-slot]')?.forEach(button => button.addEventListener('click', () => {
        const snapshot = bridge.getReadOnlySnapshot();
        if (!lastModel?.plan || !snapshot?.authenticated || !snapshot.synchronized || !Object.is(snapshot.sessionGeneration, lastSessionGeneration)) {
          status.textContent = 'Расписание изменилось или недоступно. Повторите поиск свободного времени.';
          return;
        }
        const selectedPlan = { ...lastModel.plan, time:button.dataset.voiceSlot || '' };
        const response = bridge.prepareBookingDraft(selectedPlan);
        if (response?.ok) {
          bridge.rememberAssistantPreference?.(selectedPlan);
          refreshAssistantMemory(snapshot);
          close();
        }
        else status.textContent = 'Не удалось открыть запись. Обновите данные и повторите поиск.';
      }));
      result.querySelector('[data-voice-speak]')?.addEventListener('click', () => {
        if (speaking) {
          stopSpeech();
          status.textContent = 'Озвучивание остановлено.';
          return;
        }
        speakText(assistantSpeechText(lastModel), 'Ответ озвучен.');
      });
      result.querySelector('[data-voice-speech-settings]')?.addEventListener('click', () => {
        if (!speechSettings) return;
        speechSettings.open = true;
        if (settings) settings.open = true;
        speechSettings.scrollIntoView?.({ block:'nearest', behavior:'smooth' });
        setTimeout(() => voiceSelect?.focus?.({ preventScroll:true }), 0);
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
        bridge.rememberAssistantPreference?.(lastModel?.plan || {});
        refreshAssistantMemory(currentSnapshot);
        close();
      });
    }

    async function understand() {
      const epoch = ++requestEpoch;
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
      const enteredCommand = input.value.trim();
      const now = new Date();
      conversationContext = { ...conversationContext, ...conversationContextFromSnapshot(snapshot) };
      const learnedRules = correctionOriginal ? learnedCorrectionRules(correctionOriginal, enteredCommand, snapshot) : [];
      if (learnedRules.length) bridge.rememberAssistantCorrections?.(learnedRules);
      correctionOriginal = '';
      const continued = canContinueCommand(pendingCommand, lastModel, enteredCommand, snapshot, now);
      const command = continued ? continueCommand(pendingCommand, lastModel, enteredCommand) : enteredCommand;
      lastCommand = command;
      const personalRules = bridge.getAssistantLexicon?.() || [];
      const learnedCommand = applyLearnedCorrections(command, personalRules);
      let interpreted = interpretCommand(learnedCommand.text || command, snapshot, now, lastModel, conversationContext);
      if (learnedCommand.corrections.length) interpreted = {
        ...interpreted,
        corrections:[...learnedCommand.corrections, ...(interpreted.corrections || [])].slice(0, 4),
        understandingConfidence:'medium'
      };
      let aiUnavailable = false;
      if (bridge.remoteUnderstandingEnabled === true && typeof bridge.understandCommand === 'function' && shouldUseRemoteUnderstanding(command, interpreted, snapshot)) {
        status.textContent = 'Уточняю смысл сложной фразы…';
        let response;
        try {
          response = await bridge.understandCommand({ command, context:buildAssistantContext(snapshot), history:conversationHistory.slice(-6) });
        } catch {
          response = { ok:false, reason:'request_failed' };
        }
        if (epoch !== requestEpoch || !dialog.open) return;
        const currentSnapshot = bridge.getReadOnlySnapshot();
        if (!currentSnapshot?.authenticated || !currentSnapshot.synchronized || !Object.is(currentSnapshot.sessionGeneration, snapshot.sessionGeneration)) {
          renderModel({ kind:'error', title:'Сессия кабинета изменилась', message:'Повторите команду после завершения синхронизации.' }, currentSnapshot?.sessionGeneration);
          status.textContent = 'Устаревший ответ ИИ не показан.';
          return;
        }
        const enhanced = response?.ok ? assistantAnalysisModel(response.analysis, snapshot, now) : null;
        if (enhanced) interpreted = enhanced;
        else aiUnavailable = true;
      }
      if (['booking_draft','find_slots'].includes(interpreted.kind)) interpreted.availableServices = snapshot.services || [];
      const contextual = applyOfflineContext(interpreted, snapshot);
      const sourceLabel = interpreted.kind === 'small_talk'
        ? 'Разговорный ответ · без чтения данных кабинета'
        : snapshot.offlineReadable
        ? `Источник: сохранённая копия · ${snapshotTimeLabel(snapshot.lastUpdatedAt)}`
        : snapshot.synchronized ? `Источник: ${interpreted.aiEnhanced ? 'защищённый ИИ-разбор · ' : ''}актуальные данные кабинета${snapshot.lastUpdatedAt ? ` · ${snapshotTimeLabel(snapshot.lastUpdatedAt)}` : ''}` : '';
      const model = { ...contextual, sourceLabel };
      rememberConversation(command, model);
      conversationContext = updateConversationContext(conversationContext, model);
      if (needsClarification(model)) {
        pendingCommand = command;
        input.value = '';
        input.placeholder = model.needsDetail ? `Уточните: ${model.needsDetail}` : model.kind === 'find_slots' ? 'Уточните услугу или длительность' : 'Добавьте недостающую деталь';
      } else {
        pendingCommand = '';
        input.placeholder = 'Напишите вопрос…';
      }
      lastSessionGeneration = snapshot.sessionGeneration;
      const shouldFindSlots = snapshot.synchronized && ['find_slots','booking_draft'].includes(model.kind) && model.plan?.serviceId && !model.plan?.time && (!model.plan.perMinute || Number(model.plan.durationMinutes));
      if (shouldFindSlots) {
        findSlots(model);
        return;
      }
      renderModel(model, snapshot.sessionGeneration);
      status.textContent = learnedRules.length ? 'Исправление запомнено только для этого кабинета.' : model.offline ? 'Показана последняя сохранённая информация. Изменения не выполняются автоматически.' : aiUnavailable && model.kind === 'help' ? 'Защищённый ИИ-разбор сейчас недоступен. Локальный помощник не изменил данные.' : model.kind === 'error' ? 'Команда не распознана.' : model.kind === 'find_slots' && !model.plan?.serviceId ? 'Выберите услугу, чтобы проверить подходящие интервалы.' : 'Ответ готов. Ничего не изменится без вашего подтверждения.';
    }

    function joinRecognitionText(first, second) {
      return `${String(first || '').trim()} ${String(second || '').trim()}`.trim().replace(/\s+/g, ' ');
    }

    function startRecognitionSession({ continuation = false } = {}) {
      const epoch = ++recognitionEpoch;
      let currentRecognition;
      try { currentRecognition = new Recognition(); }
      catch {
        abortRecognition({ preserveCompatibilityClick:true });
        status.textContent = 'Браузер не смог запустить распознавание. Попробуйте ещё раз или используйте микрофон клавиатуры.';
        return;
      }
      recognition = currentRecognition;
      currentRecognition.lang = 'ru-RU';
      // Мобильные движки могут игнорировать continuous и закрывать отдельную
      // сессию после паузы. Флаг намерения пользователя остаётся активным, а
      // onend безопасно открывает следующую сессию до повторного касания.
      currentRecognition.continuous = touchDevice;
      currentRecognition.interimResults = true;
      currentRecognition.maxAlternatives = 5;
      let latestTranscript = '';
      let receivedFinal = false;
      let resultHandled = false;
      let recognitionError = '';
      currentRecognition.onstart = () => {
        if (epoch !== recognitionEpoch || !dialog.open) return;
        clearTimeout(recognitionStartTimer);
        recognitionStartTimer = null;
        setListening(true);
        status.textContent = continuation
          ? 'Микрофон продолжает слушать. Коснитесь ещё раз, чтобы завершить.'
          : 'Микрофон включён и останется активным до повторного касания.';
        playMicrophoneCue(true, !touchDevice);
      };
      currentRecognition.onaudiostart = () => {
        if (epoch !== recognitionEpoch || !dialog.open) return;
        status.textContent = 'Микрофон включён. Говорите команду.';
      };
      currentRecognition.onspeechstart = () => {
        if (epoch !== recognitionEpoch || !dialog.open) return;
        status.textContent = 'Слышу вас…';
      };
      currentRecognition.onresult = event => {
        if (epoch !== recognitionEpoch || !dialog.open) return;
        clearTimeout(recognitionStartTimer);
        recognitionStartTimer = null;
        const results = Array.from(event.results || []);
        const transcript = chooseRecognitionTranscript(results, bridge.getReadOnlySnapshot(), new Date());
        latestTranscript = transcript;
        if (transcript) input.value = joinRecognitionText(accumulatedTranscript, transcript).slice(0, 500);
        if (results.length && results.every(item => item.isFinal)) {
          receivedFinal = true;
          if (touchDevice && recordingRequested) {
            status.textContent = finishingRecognition
              ? 'Заканчиваю запись и распознаю сказанное…'
              : 'Фраза записана. Микрофон остаётся включённым до повторного касания.';
          } else {
            resultHandled = true;
            recordingRequested = false;
            understand();
          }
        }
      };
      currentRecognition.onerror = event => {
        if (epoch !== recognitionEpoch || !dialog.open) return;
        clearTimeout(recognitionStartTimer);
        recognitionStartTimer = null;
        recognitionError = String(event.error || 'unknown');
        const messages = { 'not-allowed':'Нет разрешения на микрофон. Разрешите доступ в настройках браузера или используйте микрофон клавиатуры.', 'service-not-allowed':'Браузер запретил службу распознавания. Используйте микрофон клавиатуры или текстовый ввод.', 'audio-capture':'Микрофон не найден или занят другим приложением.', 'no-speech':'Речь не услышана. Попробуйте ещё раз.', network:'Служба распознавания речи недоступна. Используйте микрофон клавиатуры или текстовый ввод.', 'language-not-supported':'Русский язык не установлен для распознавания на этом устройстве.' };
        if (event.error === 'no-speech' && touchDevice) {
          status.textContent = 'Пока не слышу речь. Микрофон остаётся включённым до повторного касания.';
          return;
        }
        if (touchDevice && ['not-allowed', 'service-not-allowed', 'network', 'language-not-supported'].includes(event.error)) {
          recordingRequested = false;
          recognitionEpoch += 1;
          openKeyboardDictation(`${messages[event.error]} Клавиатура открыта — нажмите её значок микрофона.`);
        } else {
          recordingRequested = false;
          status.textContent = messages[event.error] || 'Не удалось распознать речь. Попробуйте ещё раз или используйте текст.';
        }
      };
      currentRecognition.onend = () => {
        if (epoch !== recognitionEpoch) return;
        const endedByUser = finishingRecognition;
        clearTimeout(recognitionStartTimer);
        recognitionStartTimer = null;
        recognition = null;
        const restartAllowed = touchDevice
          && recordingRequested
          && dialog.open
          && !doc.hidden
          && (!recognitionError || recognitionError === 'no-speech');
        if (restartAllowed) {
          accumulatedTranscript = joinRecognitionText(accumulatedTranscript, latestTranscript).slice(0, 500);
          setListening(true);
          status.textContent = receivedFinal
            ? 'Микрофон остаётся включённым. Продолжайте или коснитесь ещё раз для завершения.'
            : 'Продолжаю слушать. Коснитесь ещё раз, чтобы завершить.';
          clearTimeout(recognitionRestartTimer);
          recognitionRestartTimer = setTimeout(() => {
            recognitionRestartTimer = null;
            if (!recordingRequested || !dialog.open || doc.hidden || recognition) return;
            startRecognitionSession({ continuation:true });
          }, 140);
          return;
        }
        setListening(false);
        if (!resultHandled && input.value.trim() && dialog.open) {
          resultHandled = true;
          receivedFinal = true;
          understand();
        } else if (!receivedFinal && !recognitionError && dialog.open) {
          status.textContent = endedByUser
            ? 'Речь не получена. Нажмите «Говорить» ещё раз и начинайте после сигнала.'
            : 'Браузер сам завершил прослушивание, не получив речь. Попробуйте ещё раз или используйте микрофон клавиатуры.';
        }
      };
      setListening(true);
      status.textContent = 'Включаю микрофон… Начинайте говорить после сигнала.';
      try {
        currentRecognition.start();
        recognitionStartTimer = setTimeout(() => {
          if (epoch !== recognitionEpoch || !dialog.open || !listening) return;
          recognitionEpoch += 1;
          openKeyboardDictation('Мобильный браузер не открыл микрофон. Клавиатура открыта — нажмите её значок микрофона. На iPhone также должна быть включена «Диктовка» или Siri.');
        }, 4500);
      } catch { abortRecognition({ preserveCompatibilityClick:true }); status.textContent = continuation ? 'Не удалось продолжить запись. Коснитесь микрофона и попробуйте ещё раз.' : 'Микрофон уже используется. Попробуйте ещё раз.'; }
    }

    function startRecognition() {
      // Не даём собственной озвучке помощника конкурировать с микрофоном за
      // аудиофокус телефона и попадать в распознаваемую фразу.
      stopSpeech();
      if (!directRecognitionAvailable) {
        if (touchDevice) openKeyboardDictation();
        else { status.textContent = 'Этот браузер не поддерживает распознавание речи. Введите команду текстом.'; input.focus(); }
        return;
      }
      if (recordingRequested || listening) { finishRecognition(); return; }
      recordingRequested = true;
      accumulatedTranscript = '';
      startRecognitionSession();
    }

    function bind() {
      loadSpeechSettings();
      volumeInput?.addEventListener('input', () => {
        speechVolume = normalizedSpeechVolume(Number(volumeInput.value) / 100);
        refreshVolumeControls();
        saveSpeechSettings();
        stopSpeech();
      });
      volumeInput?.addEventListener('change', () => {
        speechVolume = normalizedSpeechVolume(Number(volumeInput.value) / 100);
        refreshVolumeControls();
        saveSpeechSettings();
        stopSpeech();
        status.textContent = speechVolume === 0 ? 'Озвучка выключена.' : `Громкость сохранена: ${Math.round(speechVolume * 100)}%. Нажмите «Проверить голос».`;
      });
      rateInput?.addEventListener('input', () => {
        speechRate = normalizedSpeechRate(rateInput.value);
        if (rateValue) rateValue.textContent = `${String(speechRate).replace('.', ',')}×`;
      });
      rateInput?.addEventListener('change', () => {
        speechRate = normalizedSpeechRate(rateInput.value);
        saveSpeechSettings();
        stopSpeech();
        status.textContent = `Скорость озвучки сохранена: ${String(speechRate).replace('.', ',')}×.`;
      });
      voiceSelect?.addEventListener('change', () => {
        preferredVoiceKey = String(voiceSelect.value || '').slice(0, 300);
        saveSpeechSettings();
        stopSpeech();
        refreshRussianVoice();
        status.textContent = russianVoice ? `Голос сохранён: ${russianVoice.name || 'русский голос'}.` : 'Выбранный голос сейчас недоступен.';
      });
      voicePreviewButton?.addEventListener('click', () => {
        if (speaking) {
          stopSpeech();
          status.textContent = 'Проверка голоса остановлена.';
          return;
        }
        speakText('Здравствуйте! Я помощник Минута. Так будет звучать мой голос.', 'Настройки озвучки сохранены.');
      });
      proactive?.addEventListener('click', () => {
        input.value = proactive.dataset.voicePrompt || 'Дай короткую сводку и план на день';
        understand();
      });
      clearMemoryButton?.addEventListener('click', event => {
        event.preventDefault();
        const response = bridge.clearAssistantPreferences?.();
        if (response?.ok) {
          refreshAssistantMemory(bridge.getReadOnlySnapshot?.() || {});
          status.textContent = 'Рабочие привычки помощника удалены с этого устройства. Словарь явных исправлений не изменён.';
        } else status.textContent = 'Не удалось очистить привычки на этом устройстве.';
      });
      openButton.addEventListener('click', () => {
        refreshRussianVoice();
        dialog.classList.remove('has-answer');
        requestEpoch += 1;
        abortRecognition();
        input.value = '';
        lastModel = null;
        lastSessionGeneration = null;
        pendingCommand = '';
        conversationHistory = [];
        const openingSnapshot = bridge.getReadOnlySnapshot?.() || {};
        conversationContext = conversationContextFromSnapshot(openingSnapshot);
        refreshProactive(openingSnapshot);
        refreshAssistantMemory(openingSnapshot);
        correctionOriginal = '';
        activePlan = null;
        input.placeholder = 'Напишите вопрос…';
        result.hidden = true;
        result.replaceChildren();
        starters?.classList.remove('is-secondary');
        backButton.hidden = true;
        if (capabilities) capabilities.open = false;
        status.textContent = openingSnapshot.screen?.booking
          ? `Вижу открытую запись: ${openingSnapshot.screen.booking.clientName || 'клиент'} · ${openingSnapshot.screen.booking.time || ''}. Можно сказать «перенеси её» или «напиши ей».`
          : directRecognitionAvailable ? (touchDevice ? 'Коснитесь микрофона и говорите. Повторное касание завершит запись.' : 'Ничего не изменится без вашего подтверждения.') : touchDevice ? 'Нажмите микрофон, затем значок диктовки на клавиатуре.' : 'Голосовой ввод недоступен в этом браузере. Текстовые команды работают.';
        dialog.showModal();
        setTimeout(() => (Recognition ? listenButton : input).focus(), 0);
      });
      closeButton.addEventListener('click', close);
      backButton.addEventListener('click', returnToMainMenu);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      form.addEventListener('submit', event => { event.preventDefault(); understand(); });
      listenButton.addEventListener('pointerdown', event => {
        if (!/^(touch|pen)$/.test(event.pointerType || '')) return;
        if (event.isPrimary === false || activeTouchPointerId !== null) return;
        event.preventDefault();
        activeTouchPointerId = event.pointerId ?? 'primary';
        suppressCompatibilityClick = true;
        clearTimeout(compatibilityClickResetTimer);
        compatibilityClickResetTimer = null;
      });
      listenButton.addEventListener('pointerup', event => {
        if (!/^(touch|pen)$/.test(event.pointerType || '')) return;
        if (event.isPrimary === false || activeTouchPointerId === null) return;
        if (event.pointerId !== undefined && event.pointerId !== activeTouchPointerId) return;
        event.preventDefault();
        activeTouchPointerId = null;
        // Touch/pen user activation is granted on pointerup, not pointerdown.
        // Start synchronously here, before consuming the compatibility click.
        startRecognition();
        clearTimeout(compatibilityClickResetTimer);
        // compatibility click идёт после pointerup. Отсчёт начинается только
        // после отпускания, поэтому длительное удержание больше не превращается
        // во второе нажатие.
        compatibilityClickResetTimer = setTimeout(() => { suppressCompatibilityClick = false; }, 1200);
      });
      listenButton.addEventListener('pointercancel', event => {
        if (!/^(touch|pen)$/.test(event.pointerType || '')) return;
        if (event.isPrimary === false) return;
        if (activeTouchPointerId !== null && event.pointerId !== undefined && event.pointerId !== activeTouchPointerId) return;
        activeTouchPointerId = null;
        clearTimeout(compatibilityClickResetTimer);
        // Иногда Android заменяет long-press/scroll на pointercancel. Само
        // распознавание остаётся tap-to-toggle, но возможный поздний click всё
        // равно нужно поглотить.
        compatibilityClickResetTimer = setTimeout(() => { suppressCompatibilityClick = false; }, 1200);
      });
      listenButton.addEventListener('contextmenu', event => event.preventDefault());
      listenButton.addEventListener('click', event => {
        if (suppressCompatibilityClick) {
          event.preventDefault();
          suppressCompatibilityClick = false;
          clearTimeout(compatibilityClickResetTimer);
          compatibilityClickResetTimer = null;
          return;
        }
        startRecognition();
      });
      doc.addEventListener?.('visibilitychange', () => {
        if (doc.hidden) abortRecognition({ preserveCompatibilityClick:true });
        else refreshRussianVoice();
      });
      doc.querySelectorAll('[data-voice-example]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.voiceExample || ''; understand(); }));
      if (!directRecognitionAvailable) listenButton.classList.add('is-unsupported');
      refreshRussianVoice();
      global.speechSynthesis?.addEventListener?.('voiceschanged', refreshRussianVoice);
      global.addEventListener?.('minuta:provider-session-reset', reset);
    }

    function destroy() {
      reset();
      global.speechSynthesis?.removeEventListener?.('voiceschanged', refreshRussianVoice);
      global.removeEventListener?.('minuta:provider-session-reset', reset);
    }

    return { bind, destroy, understand, reset, stopSpeech };
  }

  const api = Object.freeze({ assistantSpeechText, splitSpeechText, normalizeText, repairCommand, normalizedLexiconRules, applyLearnedCorrections, learnedCorrectionRules, parseRussianDate, parseRussianTime, parseTimePreference, applySlotPreferences, parseDuration, parseClientName, findServices, reportingPeriod, revenueStats, revenueModel, inventoryModel, attentionModel, messageDraftModel, contentDraftModel, priceAdviceModel, promotionIdeasModel, operationalBriefingModel, proactiveBriefingModel, understoodAs, workspaceHelpModel, workspaceNavigationModel, clientBookingMatches, contextualFollowUpCommand, updateConversationContext, conversationContextFromSnapshot, screenAwareCommand, screenContextModel, undoPreviewModel, contextualMemoryCommand, shortenDraft, reviseDraftModel, compoundCommandModel, guidedHelpModel, smallTalkModel, interpretCommand, commandUnderstandingScore, chooseRecognitionTranscript, supportsDirectRecognition, selectRussianVoice, normalizedSpeechRate, speechVoiceKey, applyOfflineContext, needsClarification, canContinueCommand, continueCommand, buildAssistantContext, shouldUseRemoteUnderstanding, assistantAnalysisModel, createController });
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
