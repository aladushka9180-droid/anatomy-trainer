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
    /внезапн.{0,25}(слабост|онемен|нарушен.{0,10}реч|перекос)/i,
    /(боль|давлен).{0,15}(груд|за грудин).{0,25}(одыш|не хватает воздуха)/i,
    /(одыш|не хватает воздуха).{0,25}(боль|давлен).{0,15}(груд|за грудин)/i,
    /(онемен.{0,15}промежност|нарушен.{0,20}мочеиспуск)/i,
    /(одна|одной).{0,15}(голен|рук|ног).{0,35}(отек|отёк|горяч|покрасн)/i,
    /(сильн.{0,15}кровотеч|потер.{0,10}сознан|судорог)/i
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

  function slug(value) {
    return normalize(value).replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 72) || "entry";
  }

  function cleanText(value, limit) {
    return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
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
    } catch (_) {
      return [];
    }
    return [];
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
      const type = /безопас|красн|противопоказ|практич/i.test(`${item.cat || ""} ${item.label || ""}`) ? "safety" : "palpation";
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
    return score;
  }

  function search(rawQuery, options) {
    if (!knowledge.length) buildKnowledge();
    const opts = options || {};
    const query = cleanText(rawQuery, MAX_QUERY_LENGTH);
    const queryTokens = tokenize(query);
    const types = Array.isArray(opts.types) && opts.types.length ? new Set(opts.types) : null;
    const limit = Math.max(1, Math.min(50, Number(opts.limit) || 12));
    return knowledge
      .filter((entry) => !types || types.has(entry.type))
      .map((entry) => ({entry, score: scoreEntry(entry, query, queryTokens)}))
      .filter((match) => query ? match.score > 0 : true)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, "ru"))
      .slice(0, limit)
      .map((match) => ({...match.entry, score: Math.round(match.score * 10) / 10}));
  }

  function inferIntent(query) {
    const text = normalize(query);
    if (/как.{0,14}запомн|ассоциац|мнемон/i.test(text)) return "memorize";
    if (/безопас|опас|можно ли массаж|нельзя|красн.{0,5}флаг/i.test(text)) return "safety";
    if (/где|креп|прикреп|начина|заканчива/i.test(text)) return "attachment";
    if (/движ|функц|что делает|как работает/i.test(text)) return "function";
    if (/проще|что значит|что такое|объясн/i.test(text)) return "explain";
    return "search";
  }

  function hasUrgentSignals(query) {
    return URGENT_PATTERNS.some((pattern) => pattern.test(query));
  }

  function compactSource(entry) {
    return {id: entry.id, title: entry.title};
  }

  function explainLocal(rawQuery, options) {
    const query = cleanText(rawQuery, MAX_QUERY_LENGTH);
    const intent = (options && options.intent) || inferIntent(query);
    const matches = search(query, {limit: (options && options.limit) || DEFAULT_CONTEXT_LIMIT, types: options && options.types});
    const warnings = [GENERIC_SAFETY];

    if (hasUrgentSignals(query)) {
      warnings.unshift("В описании есть возможные признаки неотложного состояния. Массаж не проводят: прекратите процедуру и обратитесь за срочной медицинской помощью.");
    }

    if (!query) {
      return {schemaVersion: SCHEMA_VERSION, mode: "local", intent, answer: "Напишите название мышцы, кости, движения или симптома — я найду подходящий материал в справочнике.", sources: [], warnings, matches: []};
    }

    if (!matches.length) {
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
    if (/^(api\.)?openai\.com$/i.test(url.hostname)) throw new Error("Браузер не должен обращаться к OpenAI API напрямую.");
    url.hash = "";
    return url.href;
  }

  function configure(nextConfig) {
    const next = nextConfig || {};
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
    const allowedSources = new Map(local.matches.map((item) => [item.id, item.title]));
    const sources = (Array.isArray(data.sources) ? data.sources : [])
      .filter((item) => item && allowedSources.has(String(item.id)))
      .slice(0, config.contextLimit)
      .map((item) => ({id: String(item.id), title: cleanText(item.title || allowedSources.get(String(item.id)), 220)}));
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: "remote",
      intent: local.intent,
      answer: cleanText(data.answer, MAX_ANSWER_LENGTH),
      sources,
      warnings: [...new Set([...(local.warnings || []), ...(Array.isArray(data.warnings) ? data.warnings.map((item) => cleanText(item, 500)) : [])])],
      requestId: cleanText(data.requestId, 160),
      matches: local.matches
    };
  }

  async function ask(rawQuery, options) {
    const query = cleanText(rawQuery, MAX_QUERY_LENGTH);
    const local = explainLocal(query, options);
    if (!config.endpoint || typeof global.fetch !== "function") return local;

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
    } catch (_) {
      return {...local, fallbackReason: "remote_unavailable"};
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
      setText(assistantStatus, result.fallbackReason ? "Сеть недоступна — показано локальное объяснение." : "Готово.");
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
