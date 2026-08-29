/*
 * Справочник и безопасный помощник для статического сайта.
 *
 * ВАЖНО: этот файл никогда не принимает и не хранит API-ключ. GitHub Pages
 * обращается только к защищённому серверному endpoint, который сам вызывает
 * модель. Если endpoint не задан или недоступен, помощник продолжает работать
 * локально на материалах тренажёра.
 *
 * Контракт endpoint (POST, application/json):
 * request  = {schemaVersion:"1", clientRequestId, query, intent, locale,
 *             context:[{id,type,title,category,summary,safety}]}
 * response = {schemaVersion:"1", answer, sources:[{id,title}], warnings:[],
 *             requestId?}
 */
(function (global) {
  "use strict";

  const SCHEMA_VERSION = "1";
  const MAX_QUERY_LENGTH = 1200;
  const MAX_ANSWER_LENGTH = 8000;
  const DEFAULT_TIMEOUT_MS = 12000;
  const DEFAULT_CONTEXT_LIMIT = 4;
  const GENERIC_SAFETY = "Помощник объясняет учебный материал, но не ставит диагноз и не заменяет медицинскую помощь.";
  const PRIVACY_WARNING = "Не вводите ФИО, контакты, дату рождения, адрес, номера документов или другие данные, по которым можно узнать клиента.";
  const CLINICAL_SCOPE_WARNING = "Помощник не определяет диагноз, не назначает лечение, лекарства или персональную схему массажа.";

  const STOP_WORDS = new Set([
    "а", "без", "бы", "в", "во", "вот", "для", "до", "его", "ее", "её", "же", "за",
    "и", "из", "или", "к", "как", "ко", "ли", "мне", "на", "над", "не", "но", "о",
    "об", "от", "по", "под", "при", "про", "с", "со", "так", "у", "что", "это", "я"
  ]);

  const SYNONYMS = Object.freeze({
    "бицепс": ["двуглавая", "плеча"],
    "трицепс": ["трехглавая", "плеча"],
    "гксм": ["грудино", "ключично", "сосцевидная"],
    "крепится": ["крепление", "прикрепление", "начало"],
    "прикрепляется": ["крепление", "прикрепление", "начало"],
    "двигает": ["движение", "функция"],
    "работает": ["движение", "функция"],
    "поворачивает": ["ротация", "вращение"],
    "наружу": ["латеральная", "ротация"],
    "внутрь": ["медиальная", "ротация"],
    "вверх": ["поднимает", "сгибание"],
    "вниз": ["опускает", "разгибание"],
    "прощупать": ["пальпация", "ориентир"],
    "найти": ["пальпация", "ориентир"],
    "нельзя": ["безопасность", "противопоказание"],
    "опасно": ["безопасность", "красный", "флаг"]
  });

  const URGENT_PATTERNS = [
    /внезапн.{0,35}(слабост|онемен|наруш\w*.{0,12}реч|перекос)/iu,
    /(?:наруш\w*.{0,15}реч).{0,45}(?:слабост|онемен|перекос)|(?:слабост|онемен|перекос).{0,45}(?:наруш\w*.{0,15}реч)/iu,
    /(боль|давлен).{0,15}(груд|за грудин).{0,25}(одыш|не хватает воздуха)/i,
    /(одыш|не хватает воздуха).{0,25}(боль|давлен).{0,15}(груд|за грудин)/i,
    /(онемен.{0,15}промежност|нарушен.{0,20}мочеиспуск)/i,
    /(одна|одной).{0,15}(голен|рук|ног).{0,35}(отек|отёк|горяч|покрасн)/i,
    /(сильн.{0,15}кровотеч|потер.{0,10}сознан|судорог)/i
  ];

  const PERSONAL_DATA_PATTERNS = [
    /\b[\w.+-]+@[\w.-]+\.[a-zа-я]{2,}\b/iu,
    /(?:^|\D)(?:\+?7|8)[\s()-]*(?:\d[\s()-]*){10}(?:\D|$)/u,
    /(?:фио|снилс|паспорт|полис\s*(?:омс|дмс)?|дата\s*рождения|адрес\s*(?:проживания|регистрации)?)/iu,
    /(?:медицинск(?:ая|ой)\s+карт(?:а|ы)|номер\s+карты)\s*[:№#]?\s*[a-zа-я0-9/-]+/iu,
    /(?:родил(?:ся|ась)|дата\s*рождения)\s*[:=]?\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/iu,
    /(?:меня\s+зовут|имя\s+(?:клиента|пациента))/iu,
    /(?:[Кк]лиент|[Пп]ациент)\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){1,2}/u,
    /\bsk-[a-z0-9_-]{16,}\b/iu,
    /(?:api[_ -]?key|ключ\s+api|токен|пароль)\s*[:=]\s*\S+/iu
  ];

  const CLINICAL_REQUEST_PATTERNS = [
    /(?:постав|определ|назов|скажи).{0,24}диагноз/iu,
    /(?:назнач|подбер|состав).{0,30}(?:лечен|лекар|препарат|дозиров|курс\s+массажа|схем.{0,12}массажа)/iu,
    /(?:начать|прекратить|отменить|заменить|увеличить|уменьшить).{0,24}(?:лекар|препарат|доз)/iu,
    /(?:как|чем|что).{0,16}(?:лечить|вылечить|излечить)/iu,
    /(?:какой|как|можно\s+ли).{0,24}массаж.{0,35}(?:при\s+диагнозе|при\s+болезни|у\s+меня|у\s+клиента|у\s+пациента)/iu,
    /(?:какой|как|можно\s+ли).{0,24}массаж.{0,35}при\s+\S+/iu,
    /(?:что\s+делать|как\s+помочь|можно\s+ли\s+(?:массировать|делать\s+массаж)).{0,40}(?:при|если|когда)/iu,
    /(?:у\s+меня|у\s+моего\s+клиента|у\s+клиента|у\s+пациента).{0,80}(?:бол|от[её]к|онем|диагноз|грыж|артрит|остеохондр|температур|травм)/iu
  ];

  const UNSAFE_REMOTE_ANSWER_PATTERNS = [
    /(?:диагноз|диагностик|заболеван|патологи|синдром|лечение|лечить|лекарств|препарат|таблет|дозиров|рецепт)/iu,
    /(?:у\s+вас|у\s+клиента|у\s+пациента).{0,30}(?:диагноз|заболеван|синдром)/iu,
    /(?:вам|клиенту|пациенту).{0,30}(?:нужно|следует|можно|нельзя|рекомендуется)/iu,
    /(?:делайте|выполняйте|массируйте|разминайте|давите).{0,100}(?:минут|раз|дней|недел|ежеднев)/iu,
    /(?:поставить|подтвердить|исключить).{0,20}диагноз/iu,
    /(?:принимайте|начните\s+принимать|прекратите\s+принимать|отмените|измените\s+доз)/iu,
    /(?:назначаю|вам\s+нужно).{0,35}(?:лекар|препарат|дозиров|лечение)/iu,
    /(?:гарантированно|обязательно).{0,20}(?:вылечит|излечит|устранит\s+причину)/iu
  ];

  let config = Object.freeze({endpoint: "", timeoutMs: DEFAULT_TIMEOUT_MS, contextLimit: DEFAULT_CONTEXT_LIMIT});
  let knowledge = [];

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/g, "е")
      .replace(/[–—→/\\()\[\]{}.,;:!?«»"'`~@#$%^&*_+=|<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stem(word) {
    if (word.length < 5) return word;
    return word.replace(/(иями|ями|ами|его|ого|ему|ому|ыми|ими|ией|ый|ий|ой|ая|яя|ое|ее|ую|юю|ам|ям|ах|ях|ов|ев|ом|ем|ы|и|а|я|у|ю|е|о)$/u, "");
  }

  function tokenize(value) {
    const base = normalize(value).split(" ").filter(Boolean);
    const expanded = [];
    base.forEach((word) => {
      if (!STOP_WORDS.has(word)) expanded.push(stem(word));
      (SYNONYMS[word] || []).forEach((item) => expanded.push(stem(item)));
    });
    return [...new Set(expanded)];
  }

  function focusQuery(value) {
    const original = normalize(cleanText(value, MAX_QUERY_LENGTH));
    if (!original) return "";
    const focused = original
      .replace(/^(?:пожалуйста\s+)?(?:объясни|объясните|расскажи|расскажите|покажи|покажите)(?:\s+мне)?(?:\s+(?:совсем\s+)?прост(?:о|ыми\s+словами)|\s+понятно|\s+подробнее)?\s*/iu, "")
      .replace(/^(?:что\s+такое|что\s+значит|кто\s+такой|кто\s+такая)\s+/iu, "")
      .replace(/^(?:где\s+находится|как\s+найти|как\s+прощупать|что\s+делает|как\s+работает|где\s+крепится|куда\s+крепится)\s+/iu, "")
      .replace(/^(?:про|о|об)\s+/iu, "")
      .replace(/\s+при\s+пальпаци(?:и|я)\s*$/iu, "")
      .replace(/^[\s:;,.-]+|[\s:;,?.!-]+$/gu, "")
      .trim();
    return focused || original;
  }

  function slug(value) {
    return normalize(value).replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 72) || "entry";
  }

  function titleKey(value) {
    return normalize(value).split(" ").filter((token) => token && !STOP_WORDS.has(token)).map(stem).join(" ");
  }

  function cleanText(value, limit) {
    return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function rowsText(value) {
    if (Array.isArray(value)) return value.flatMap(rowsText).filter(Boolean);
    if (value && typeof value === "object") return Object.values(value).flatMap(rowsText).filter(Boolean);
    const text = cleanText(value, 1200);
    return text ? [text] : [];
  }

  function containsPersonalData(value) {
    const text = String(value || "");
    return PERSONAL_DATA_PATTERNS.some((pattern) => pattern.test(text));
  }

  function isClinicalRequest(value) {
    const text = String(value || "");
    return CLINICAL_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
  }

  function isUnsafeRemoteAnswer(value) {
    const text = String(value || "");
    return UNSAFE_REMOTE_ANSWER_PATTERNS.some((pattern) => pattern.test(text));
  }

  function makeEntry(raw) {
    const title = cleanText(raw.title, 220);
    const summary = cleanText(raw.summary, 1200);
    const details = cleanText(raw.details, 2400);
    const safety = cleanText(raw.safety, 900);
    const memory = cleanText(raw.memory, 700);
    const category = cleanText(raw.category || "Общее", 160);
    const type = cleanText(raw.type || "term", 40);
    const id = cleanText(raw.id || `${type}-${slug(title)}`, 120);
    const haystack = normalize([title, category, summary, details, safety, memory, raw.keywords || ""].join(" "));
    return Object.freeze({id, type, title, category, summary, details, safety, memory, haystack, tokens: tokenize(haystack)});
  }

  function sourceArray(name) {
    try {
      if (name === "ITEMS" && typeof ITEMS !== "undefined") return ITEMS;
      if (name === "MASSAGE_QUESTIONS" && typeof MASSAGE_QUESTIONS !== "undefined") return MASSAGE_QUESTIONS;
      if (name === "SIMPLE_TERMS" && typeof SIMPLE_TERMS !== "undefined") return SIMPLE_TERMS;
      if (name === "ANATOMY_TERMS" && typeof ANATOMY_TERMS !== "undefined") return ANATOMY_TERMS;
      if (name === "MASSAGE_TECHNIQUES" && Array.isArray(global.MASSAGE_TECHNIQUES)) return global.MASSAGE_TECHNIQUES;
    } catch (_) {
      return [];
    }
    return [];
  }

  function sourceObject(name) {
    try {
      const value = global && global[name];
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (_) {
      return {};
    }
  }

  function buildKnowledge(extraEntries) {
    const entries = [];

    sourceArray("ITEMS").forEach((item) => {
      const isBone = item.kind === "bone" || /кост|позвон/i.test(item.cat || "");
      entries.push(makeEntry({
        id: `anatomy:${item.id}`,
        type: isBone ? "bone" : "muscle",
        title: item.name,
        category: item.cat,
        summary: item.function,
        details: item.attach ? `${isBone ? "Ориентиры" : "Крепление"}: ${item.attach}` : "",
        keywords: isBone ? "кость позвонок ориентир строение" : "мышца функция движение крепление"
      }));
    });

    sourceArray("MASSAGE_QUESTIONS").forEach((item, index) => {
      const type = /безопас|красн|противопоказ|практич|топограф|зон.{0,12}осторож/i.test(`${item.cat || ""} ${item.label || ""}`) ? "safety" : "palpation";
      entries.push(makeEntry({
        id: item.key || `massage:${index}`,
        type,
        title: item.simple || item.text,
        category: item.cat || item.label || "Практика массажиста",
        summary: item.explain || item.correct,
        details: item.correct ? `Правильное действие: ${item.correct}` : "",
        safety: item.safety,
        memory: item.memory,
        keywords: `${item.text || ""} ${item.visual || ""} массаж пальпация безопасное решение`
      }));
    });

    [...sourceArray("SIMPLE_TERMS"), ...sourceArray("ANATOMY_TERMS")].forEach((term, index) => {
      if (!Array.isArray(term) || !term[1]) return;
      entries.push(makeEntry({
        id: `term:${slug(term[1])}:${index}`,
        type: "term",
        title: term[1],
        category: "Термины простыми словами",
        summary: term[2] || "",
        keywords: term[0] && term[0].source ? term[0].source : ""
      }));
    });

    sourceArray("MASSAGE_TECHNIQUES").forEach((item, index) => {
      const dose = rowsText(item.dose).join("; ");
      const details = [
        item.startPosition ? `Положение: ${item.startPosition}` : "",
        item.hands ? `Контакт рук: ${item.hands}` : "",
        item.direction ? `Направление: ${item.direction}` : "",
        dose ? `Учебное дозирование: ${dose}` : ""
      ].filter(Boolean).join(" ");
      const safety = [
        ...rowsText(item.stopSignals).map((text) => `Стоп-сигнал: ${text}`),
        ...rowsText(item.restrictedZones).map((text) => `Зона осторожности: ${text}`),
        ...rowsText(item.commonMistakes).map((text) => `Частая ошибка: ${text}`)
      ].join("; ");
      entries.push(makeEntry({
        id: `technique:${item.id || index}`,
        type: "technique",
        title: item.title,
        category: `Массажные приёмы · ${item.category || item.level || "учебная практика"}`,
        summary: item.goal || item.summary,
        details,
        safety,
        memory: rowsText(item.proTips).join("; "),
        keywords: `массаж приём техника ${item.summary || ""}`
      }));
    });

    const curriculum = sourceObject("PRACTICE_CURRICULUM");
    const criticalById = new Map((Array.isArray(curriculum.criticalErrors) ? curriculum.criticalErrors : []).map((item) => [item.id, item]));
    (Array.isArray(curriculum.checklists) ? curriculum.checklists : []).forEach((item, index) => {
      const critical = (Array.isArray(item.criticalErrorIds) ? item.criticalErrorIds : [])
        .map((id) => criticalById.get(id))
        .filter(Boolean)
        .map((error) => `${error.title}: ${error.description}`);
      entries.push(makeEntry({
        id: `practice:${item.id || index}`,
        type: "practice",
        title: item.title,
        category: `Практический чек-лист · ${item.regionId || item.level || "общий"}`,
        summary: "Учебная последовательность безопасной практики под наблюдением преподавателя или подготовленного партнёра.",
        details: (Array.isArray(item.steps) ? item.steps : []).map((step) => cleanText(step && step.text, 1200)).filter(Boolean).join("; "),
        safety: critical.join("; "),
        keywords: "массаж практика чек-лист положение последовательность безопасность"
      }));
    });
    (Array.isArray(curriculum.scenarios) ? curriculum.scenarios : []).forEach((item, index) => {
      const critical = (Array.isArray(item.criticalErrorIds) ? item.criticalErrorIds : [])
        .map((id) => criticalById.get(id))
        .filter(Boolean)
        .map((error) => `${error.title}: ${error.description}`);
      entries.push(makeEntry({
        id: `scenario:${item.id || index}`,
        type: item.difficulty === "safety" ? "safety" : "practice",
        title: item.title,
        category: `Учебный сценарий · ${item.regionId || item.difficulty || "общий"}`,
        summary: item.brief,
        details: [item.task, ...rowsText(item.expectedPlan)].filter(Boolean).join("; "),
        safety: [...rowsText(item.unsafeChoices).map((text) => `Небезопасно: ${text}`), ...critical].join("; "),
        keywords: "массаж сценарий решение учебный план безопасность"
      }));
    });
    (Array.isArray(curriculum.tips) ? curriculum.tips : []).forEach((item, index) => entries.push(makeEntry({
      id: `tip:${item.id || index}`,
      type: "tip",
      title: item.title,
      category: `Практические подсказки · ${item.level || "общий"}`,
      summary: item.text,
      keywords: "массаж подсказка лайфхак практика безопасность"
    })));
    (Array.isArray(curriculum.myths) ? curriculum.myths : []).forEach((item, index) => entries.push(makeEntry({
      id: `myth:${item.id || index}`,
      type: "myth",
      title: item.claim,
      category: "Мифы о массаже",
      summary: `${item.verdict || "Проверка утверждения"}: ${item.explanation || ""}`,
      keywords: "массаж миф заблуждение факт"
    })));

    (Array.isArray(extraEntries) ? extraEntries : []).forEach((item) => entries.push(makeEntry(item)));
    knowledge = [...new Map(entries.map((entry) => [entry.id, entry])).values()];
    return knowledge.slice();
  }

  function scoreEntry(entry, rawQuery, queryTokens) {
    const query = normalize(rawQuery);
    const title = normalize(entry.title);
    let score = 0;
    if (!query) return entry.type === "term" ? 1 : 0.5;
    if (title === query) score += 30;
    if (titleKey(title) === titleKey(query)) score += 40;
    if (title.startsWith(query)) score += 18;
    if (title.includes(query)) score += 12;
    if (entry.haystack.includes(query)) score += 7;
    queryTokens.forEach((token) => {
      if (token.length < 2) return;
      if (tokenize(title).includes(token)) score += 6;
      else if (entry.tokens.includes(token)) score += 2.5;
      else if (entry.tokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))) score += 1.2;
    });
    if (entry.type === "safety" && /опас|нельзя|противопоказ|красн|флаг|массаж/i.test(query)) score += 4;
    if (entry.type === "term" && /значит|термин|простыми|что такое/i.test(query)) score += 4;
    if (entry.type === "technique" && /прием|приём|поглаж|растира|размина|вибрац|компресс|ударн/i.test(query)) score += 4;
    if ((entry.type === "practice" || entry.type === "tip") && /практик|чек.?лист|лайфхак|план|последовательн/i.test(query)) score += 3;
    const meaningful = queryTokens.filter((token) => token.length >= 3);
    if (meaningful.length) {
      const matched = meaningful.filter((token) => entry.tokens.includes(token)
        || entry.tokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))).length;
      const coverage = matched / meaningful.length;
      if (coverage === 1) score += 10;
      else if (coverage >= 0.66) score += 5;
      else if (coverage < 0.5) score -= 5;
    }
    return score;
  }

  function search(rawQuery, options) {
    if (!knowledge.length) buildKnowledge();
    const opts = options || {};
    const query = cleanText(rawQuery, MAX_QUERY_LENGTH);
    const focusedQuery = focusQuery(query);
    const queryTokens = tokenize(focusedQuery);
    const types = Array.isArray(opts.types) && opts.types.length ? new Set(opts.types) : null;
    const limit = Math.max(1, Math.min(50, Number(opts.limit) || 12));
    return knowledge
      .filter((entry) => !types || types.has(entry.type))
      .map((entry) => ({entry, score: scoreEntry(entry, focusedQuery, queryTokens)}))
      .filter((match) => query ? match.score > 0 : true)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, "ru"))
      .slice(0, limit)
      .map((match) => ({...match.entry, score: Math.round(match.score * 10) / 10}));
  }

  function inferIntent(query) {
    const text = normalize(query);
    if (/как.{0,14}запомн|ассоциац|мнемон/i.test(text)) return "memorize";
    if (/безопас|опас|можно ли массаж|нельзя|красн.{0,5}флаг|(?:останов|прекрат).{0,18}массаж|массаж.{0,18}(?:останов|прекрат)/i.test(text)) return "safety";
    if (/где|креп|прикреп|начина|заканчива/i.test(text)) return "attachment";
    if (/движ|функц|что делает|как работает/i.test(text)) return "function";
    if (/проще|что значит|что такое|объясн/i.test(text)) return "explain";
    return "search";
  }

  function hasUrgentSignals(query) {
    return URGENT_PATTERNS.some((pattern) => pattern.test(query));
  }

  function asksWhenToStopMassage(query) {
    const text = normalize(query);
    return /(?:когда|в каких случаях|при чем|при чём)?.{0,20}(?:останов|прекрат).{0,18}массаж|массаж.{0,18}(?:останов|прекрат)/iu.test(text);
  }

  function compactSource(entry) {
    return {id: entry.id, title: entry.title};
  }

  function confidentMatch(matches, query) {
    if (!matches.length) return false;
    const focused = focusQuery(query);
    const title = normalize(matches[0].title);
    const category = normalize(matches[0].category);
    if (title === focused || title.startsWith(focused) || focused.startsWith(title)) return true;
    if (category === focused || titleKey(category) === titleKey(focused)) return true;
    const directTokens = normalize(focused).split(" ").filter((token) => token && !STOP_WORDS.has(token)).map(stem);
    const directTitleTokens = title.split(" ").filter((token) => token && !STOP_WORDS.has(token)).map(stem);
    if (directTokens.length === directTitleTokens.length && directTokens.every((token, index) => token === directTitleTokens[index])) return true;
    const tokens = tokenize(focused).filter((token) => token.length >= 3);
    const matched = tokens.filter((token) => matches[0].tokens.includes(token)
      || matches[0].tokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))).length;
    const coverage = tokens.length ? matched / tokens.length : 0;
    const titleTokens = tokenize(matches[0].title).filter((token) => token.length >= 3);
    const titleMatched = tokens.filter((token) => titleTokens.includes(token)
      || titleTokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))).length;
    const strongTitleMatch = tokens.length === 1
      ? titleTokens.length === 1 && titleMatched === 1
      : titleMatched >= 2 && titleMatched / tokens.length >= 0.66;
    if (matches[0].score >= 12 && strongTitleMatch) return true;
    const margin = matches.length > 1 ? matches[0].score - matches[1].score : matches[0].score;
    return matches[0].score >= 10 && coverage >= 0.66 && margin >= 2;
  }

  function categoryMatches(rawQuery, options) {
    if (!knowledge.length) buildKnowledge();
    const focused = focusQuery(rawQuery);
    const focusedKey = titleKey(focused);
    const types = options && Array.isArray(options.types) && options.types.length ? new Set(options.types) : null;
    let available = knowledge.filter((entry) => !types || types.has(entry.type));
    const exact = available.filter((entry) => titleKey(entry.category) === focusedKey);
    if (exact.length) return exact;

    const categoryRequest = normalize(focused).match(/^(безопас[а-яё]*|пальпац[а-яё]*|движен[а-яё]*)\s+(.+)$/iu);
    let categoryTopic = focused;
    if (categoryRequest) {
      categoryTopic = categoryRequest[2];
      if (categoryRequest[1].startsWith("безопас")) available = available.filter((entry) => entry.type === "safety");
      else if (categoryRequest[1].startsWith("пальпац")) available = available.filter((entry) => /пальпатор|пальпац/i.test(entry.category));
      else if (categoryRequest[1].startsWith("движен")) available = available.filter((entry) => /кинезиолог|движен/i.test(entry.category));
    }
    const queryTokens = tokenize(categoryTopic).filter((token) => token.length >= 3);
    if (!queryTokens.length) return [];
    const groups = new Map();
    available.forEach((entry) => {
      const key = titleKey(entry.category);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    const ranked = [...groups.values()].map((entries) => {
      const categoryTokens = tokenize(entries[0].category).filter((token) => token.length >= 3);
      const matched = queryTokens.filter((token) => categoryTokens.includes(token)
        || categoryTokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))).length;
      return {entries, coverage: matched / queryTokens.length, extra: Math.max(0, categoryTokens.length - matched)};
    }).filter((group) => group.coverage === 1 && (queryTokens.length > 1 || group.extra <= (categoryRequest ? 5 : 2)));
    ranked.sort((a, b) => a.extra - b.extra || b.entries.length - a.entries.length);
    return ranked[0] ? ranked[0].entries : [];
  }

  function explainCategory(entries) {
    if (!entries.length) return "";
    const unique = (values) => [...new Set(values.map((value) => cleanText(value, 1600)).filter(Boolean))];
    const category = cleanText(entries[0].category, 220).replace(/\s*·\s*/g, " — ");
    const summaries = unique(entries.map((entry) => entry.summary)).slice(0, 3);
    const actions = unique(entries.map((entry) => entry.details && entry.details.replace(/^Правильное действие:\s*/iu, ""))).slice(0, 2);
    const safety = unique(entries.map((entry) => entry.safety)).slice(0, 2);
    let answer = `${category}. ${summaries.join(" ")}`.trim();
    if (actions.length) answer += ` Главное: ${actions.join(" ")}`;
    if (safety.length) answer += ` Важно: ${safety.join(" ")}`;
    return cleanText(answer, MAX_ANSWER_LENGTH);
  }

  function explainLocal(rawQuery, options) {
    const query = cleanText(rawQuery, MAX_QUERY_LENGTH);
    const intent = (options && options.intent) || inferIntent(query);
    const warnings = [GENERIC_SAFETY];

    if (!query) {
      return {schemaVersion: SCHEMA_VERSION, mode: "local", intent, answer: "Напишите название мышцы, кости, движения или симптома — я найду подходящий материал в справочнике.", sources: [], warnings, matches: []};
    }

    const urgent = hasUrgentSignals(query);
    if (containsPersonalData(query)) {
      const answer = urgent
        ? "Если описанные признаки происходят сейчас, не проводите массаж и обратитесь за срочной медицинской помощью. Затем удалите из вопроса персональные данные и опишите только учебную ситуацию без ФИО, контактов, документов и других идентификаторов."
        : "Персональные данные не приняты. Удалите ФИО, контакты, дату рождения, адрес, номера документов и другие идентификаторы, затем задайте обезличенный учебный вопрос.";
      return {schemaVersion: SCHEMA_VERSION, mode: "local", intent, answer, sources: [], warnings: [PRIVACY_WARNING, GENERIC_SAFETY], matches: [], blockedReason: "personal_data", remoteAllowed: false};
    }

    if (urgent) {
      return {
        schemaVersion: SCHEMA_VERSION,
        mode: "local",
        intent: "safety",
        answer: "В описании есть возможные признаки неотложного состояния. Массаж не проводят: немедленно прекратите процедуру, вызовите экстренную помощь по номеру 112 или 103 и действуйте в пределах своей подготовки. Не оставляйте человека одного до передачи специалистам.",
        sources: [],
        warnings: [GENERIC_SAFETY],
        matches: [],
        blockedReason: "urgent_signal",
        remoteAllowed: false
      };
    }

    if (isClinicalRequest(query)) {
      return {
        schemaVersion: SCHEMA_VERSION,
        mode: "local",
        intent,
        answer: "Я не могу поставить диагноз, назначить лечение, лекарства или персональную схему массажа. Могу объяснить анатомию, общие правила безопасности и проверенные учебные приёмы без привязки к конкретному человеку.",
        sources: [],
        warnings: [CLINICAL_SCOPE_WARNING, GENERIC_SAFETY],
        matches: [],
        blockedReason: "clinical_request",
        remoteAllowed: false
      };
    }

    if (asksWhenToStopMassage(query)) {
      return {
        schemaVersion: SCHEMA_VERSION,
        mode: "local",
        intent: "safety",
        answer: "Массаж сразу прекращают, если человек просит остановиться, появилась резкая или нарастающая боль, онемение, ощущение тока, головокружение, тошнота, одышка, боль в груди, внезапная слабость, нарушение речи или резко ухудшилось самочувствие. При признаках угрозы жизни вызывают экстренную помощь по номеру 112 или 103 и действуют только в пределах своей подготовки.",
        sources: [],
        warnings,
        matches: [],
        remoteAllowed: false
      };
    }

    const categoryEntries = categoryMatches(query, options);
    if (categoryEntries.length) {
      const categoryLimit = (options && options.limit) || DEFAULT_CONTEXT_LIMIT;
      const matches = categoryEntries.slice(0, categoryLimit).map((entry) => ({...entry, score: 50}));
      return {schemaVersion: SCHEMA_VERSION, mode: "local", intent, answer: explainCategory(categoryEntries), sources: matches.slice(0, 3).map(compactSource), warnings, matches};
    }

    const matches = search(query, {limit: (options && options.limit) || DEFAULT_CONTEXT_LIMIT, types: options && options.types});

    if (!matches.length || !confidentMatch(matches, query)) {
      return {schemaVersion: SCHEMA_VERSION, mode: "local", intent, answer: "В материалах тренажёра пока нет точного ответа. Попробуйте написать название структуры или движения короче, например: «атлант», «отведение плеча» или «икроножная мышца».", sources: [], warnings, matches: []};
    }

    const top = matches[0];
    const summary = top.summary ? top.summary.charAt(0).toUpperCase() + top.summary.slice(1) : "";
    let answer = `${top.title}: ${summary}`.trim();
    if (intent === "attachment" && top.details) answer = `${top.title}. ${top.details}`;
    if (intent === "function") answer = `${top.title}: ${top.summary}`;
    if (intent === "memorize") {
      if (/^атлант(?:\s|$|\()/i.test(top.title)) answer = "Как запомнить: Атлант C1 держит голову, как мифический Атлант держал небо. Это первый шейный позвонок под черепом.";
      else answer = top.memory ? `Как запомнить: ${top.memory}` : `Как запомнить: свяжите «${top.title}» с главным признаком — ${top.summary}`;
    }
    if (intent === "safety") answer = top.safety ? `${top.summary} Безопасность: ${top.safety}` : `${top.summary} ${GENERIC_SAFETY}`;
    if ((intent === "explain" || intent === "search") && top.details) answer += ` ${top.details}`;
    if (top.safety && intent !== "safety") answer += ` Важно: ${top.safety}`;

    return {
      schemaVersion: SCHEMA_VERSION,
      mode: "local",
      intent,
      answer: cleanText(answer, MAX_ANSWER_LENGTH),
      sources: matches.slice(0, 3).map(compactSource),
      warnings,
      matches
    };
  }

  function validateEndpoint(value) {
    if (!value) return "";
    let url;
    try {
      url = new URL(String(value), global.location && global.location.href ? global.location.href : undefined);
    } catch (_) {
      throw new Error("Некорректный адрес защищённого endpoint.");
    }
    const localDev = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
    if (url.protocol !== "https:" && !(localDev && url.protocol === "http:")) throw new Error("Endpoint должен использовать HTTPS.");
    if (url.username || url.password) throw new Error("Не добавляйте логин, пароль или ключ в адрес endpoint.");
    if (/(^|\.)openai\.com$/i.test(url.hostname)) throw new Error("Браузер не должен обращаться к OpenAI API напрямую.");
    for (const key of url.searchParams.keys()) {
      if (/(?:api.?key|token|secret|auth|password|credential)/i.test(key)) throw new Error("Не добавляйте ключ или токен в адрес endpoint.");
    }
    if (/\bsk-[a-z0-9_-]{16,}\b/i.test(url.href)) throw new Error("Не добавляйте API-ключ в адрес endpoint.");
    url.hash = "";
    return url.href;
  }

  function configure(nextConfig) {
    const next = nextConfig || {};
    if (Object.keys(next).some((key) => /(?:api.?key|token|secret|auth|password|credential|headers?)/i.test(key))) {
      throw new Error("Помощник не принимает API-ключи, токены или пользовательские заголовки. Настройте только защищённый серверный endpoint.");
    }
    config = Object.freeze({
      endpoint: validateEndpoint(next.endpoint || ""),
      timeoutMs: Math.max(3000, Math.min(30000, Number(next.timeoutMs) || DEFAULT_TIMEOUT_MS)),
      contextLimit: Math.max(1, Math.min(6, Number(next.contextLimit) || DEFAULT_CONTEXT_LIMIT))
    });
    return {...config};
  }

  function requestId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    return `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function contextForEndpoint(matches) {
    return matches.slice(0, config.contextLimit).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      category: item.category,
      summary: item.summary,
      safety: item.safety || ""
    }));
  }

  function validateRemoteResponse(data, local) {
    if (!data || data.schemaVersion !== SCHEMA_VERSION || typeof data.answer !== "string") throw new Error("Endpoint вернул ответ неизвестного формата.");
    const answer = cleanText(data.answer, MAX_ANSWER_LENGTH);
    if (!answer || isUnsafeRemoteAnswer(answer) || containsPersonalData(answer)) {
      const error = new Error("Ответ endpoint отклонён правилами безопасности.");
      error.code = "unsafe_remote_response";
      throw error;
    }
    const allowedSources = new Map(local.matches.map((item) => [item.id, item.title]));
    const sources = (Array.isArray(data.sources) ? data.sources : [])
      .filter((item) => item && allowedSources.has(String(item.id)))
      .slice(0, config.contextLimit)
      .map((item) => ({id: String(item.id), title: allowedSources.get(String(item.id))}));
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: "remote",
      intent: local.intent,
      answer,
      sources,
      warnings: [...new Set(local.warnings || [])],
      requestId: cleanText(data.requestId, 160),
      matches: local.matches
    };
  }

  async function ask(rawQuery, options) {
    const query = cleanText(rawQuery, MAX_QUERY_LENGTH);
    const local = explainLocal(query, options);
    if (local.remoteAllowed === false || !config.endpoint || typeof global.fetch !== "function") return local;

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), config.timeoutMs) : null;
    try {
      const response = await global.fetch(config.endpoint, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "strict-origin-when-cross-origin",
        headers: {"Accept": "application/json", "Content-Type": "application/json"},
        body: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          clientRequestId: requestId(),
          query,
          intent: local.intent,
          locale: "ru-RU",
          context: contextForEndpoint(local.matches)
        }),
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error(`Endpoint недоступен (${response.status}).`);
      return validateRemoteResponse(await response.json(), local);
    } catch (error) {
      return {...local, fallbackReason: error && error.code === "unsafe_remote_response" ? "unsafe_remote_response" : "remote_unavailable"};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function setText(element, value) {
    if (element) element.textContent = value || "";
  }

  function renderReferenceResults(container, matches) {
    if (!container) return;
    container.replaceChildren();
    const fragment = document.createDocumentFragment();
    matches.forEach((item) => {
      const card = document.createElement("article");
      card.className = "reference-result";
      card.dataset.referenceType = item.type;
      const title = document.createElement("h3");
      title.textContent = item.title;
      const meta = document.createElement("p");
      meta.className = "reference-meta";
      meta.textContent = item.category;
      const body = document.createElement("p");
      body.textContent = item.summary;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn secondary reference-ask";
      button.dataset.assistantQuery = `Объясни проще: ${item.title}`;
      button.textContent = "Объяснить проще";
      card.append(title, meta, body);
      if (item.details) {
        const details = document.createElement("p");
        details.textContent = item.details;
        card.append(details);
      }
      card.append(button);
      fragment.append(card);
    });
    container.append(fragment);
  }

  function bindDom(root) {
    const scope = root || document;
    const searchInput = scope.querySelector("#assistantReferenceSearch");
    const searchResults = scope.querySelector("#assistantReferenceResults");
    const searchCount = scope.querySelector("#assistantReferenceCount");
    const assistantInput = scope.querySelector("#assistantQuery");
    const assistantButton = scope.querySelector("#assistantAsk");
    const assistantAnswer = scope.querySelector("#assistantAnswer");
    const assistantStatus = scope.querySelector("#assistantStatus");
    const assistantMode = scope.querySelector("#assistantMode");
    let activeTypes = null;

    if (assistantInput) {
      assistantInput.setAttribute("autocomplete", "off");
      const field = assistantInput.closest("label") || assistantInput.parentElement;
      if (field && !scope.querySelector("#assistantPrivacyNote")) {
        const note = document.createElement("small");
        note.id = "assistantPrivacyNote";
        note.className = "muted";
        note.textContent = "Не вводите ФИО, контакты, дату рождения, адрес, документы и другие персональные данные клиента.";
        field.append(note);
      }
    }

    function refreshSearch() {
      if (!searchInput || !searchResults) return;
      const matches = search(searchInput.value, {limit: 30, types: activeTypes});
      renderReferenceResults(searchResults, matches);
      setText(searchCount, matches.length ? `Найдено: ${matches.length}` : "Ничего не найдено");
    }

    async function submitAssistant() {
      if (!assistantInput || !assistantAnswer) return;
      const query = assistantInput.value.trim();
      if (!query) {
        setText(assistantStatus, "Напишите вопрос.");
        assistantInput.focus();
        return;
      }
      if (assistantButton) assistantButton.disabled = true;
      setText(assistantStatus, config.endpoint ? "Ищу в справочнике и уточняю объяснение…" : "Ищу объяснение в справочнике…");
      const result = await ask(query);
      const urgent = (result.warnings || []).filter((warning) => warning !== GENERIC_SAFETY);
      setText(assistantAnswer, [...urgent, result.answer].filter(Boolean).join("\n\n"));
      setText(assistantMode, result.mode === "remote" ? "ИИ-объяснение · проверено по справочнику" : "Локальное объяснение · работает без интернета");
      if (result.blockedReason === "personal_data") {
        assistantInput.value = "";
        setText(assistantStatus, "Персональные данные не приняты и никуда не отправлены.");
      } else if (result.blockedReason === "clinical_request") {
        setText(assistantStatus, "Запрос выходит за учебные границы помощника.");
      } else if (result.blockedReason === "urgent_signal") {
        setText(assistantStatus, "Показано правило безопасности. Онлайн-уточнение отключено.");
      } else if (result.fallbackReason === "unsafe_remote_response") {
        setText(assistantStatus, "Ответ сервера отклонён правилами безопасности — показано локальное объяснение.");
      } else {
        setText(assistantStatus, result.fallbackReason ? "Сеть недоступна — показано локальное объяснение." : "Готово.");
      }
      if (assistantButton) assistantButton.disabled = false;
      assistantAnswer.focus({preventScroll: true});
    }

    if (searchInput && searchResults) {
      searchInput.addEventListener("input", refreshSearch);
      refreshSearch();
    }
    if (assistantButton) assistantButton.addEventListener("click", submitAssistant);
    if (assistantInput) assistantInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitAssistant();
      }
    });
    scope.querySelectorAll("[data-reference-filter]").forEach((button) => button.addEventListener("click", () => {
      const value = button.dataset.referenceFilter;
      activeTypes = value && value !== "all" ? value.split(",") : null;
      scope.querySelectorAll("[data-reference-filter]").forEach((item) => item.classList.toggle("active", item === button));
      refreshSearch();
    }));
    scope.addEventListener("click", (event) => {
      const target = event.target.closest("[data-assistant-query],[data-ai-prompt]");
      if (!target || !assistantInput) return;
      assistantInput.value = target.dataset.assistantQuery || target.dataset.aiPrompt || "";
      assistantInput.focus();
    });
    return {refreshSearch, submitAssistant};
  }

  buildKnowledge();
  if (global.ANATOMY_AI_CONFIG) {
    try { configure(global.ANATOMY_AI_CONFIG); } catch (_) { config = Object.freeze({endpoint: "", timeoutMs: DEFAULT_TIMEOUT_MS, contextLimit: DEFAULT_CONTEXT_LIMIT}); }
  }

  const api = Object.freeze({
    version: SCHEMA_VERSION,
    buildKnowledge,
    entries: () => knowledge.slice(),
    search,
    explainLocal,
    ask,
    configure,
    bindDom,
    guardQuery: (query) => Object.freeze({
      personalData: containsPersonalData(query),
      clinicalRequest: isClinicalRequest(query),
      urgent: hasUrgentSignals(query)
    }),
    endpointContract: Object.freeze({
      method: "POST",
      contentType: "application/json",
      requestFields: ["schemaVersion", "clientRequestId", "query", "intent", "locale", "context"],
      responseFields: ["schemaVersion", "answer", "sources", "warnings", "requestId"]
    })
  });

  global.AnatomyAssistant = api;
  if (typeof document !== "undefined") {
    const ready = () => {
      api.bindDom(document);
      document.dispatchEvent(new CustomEvent("anatomy-assistant-ready", {detail: {entries: knowledge.length, remote: Boolean(config.endpoint)}}));
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, {once: true});
    else ready();
  }
})(typeof window !== "undefined" ? window : globalThis);
