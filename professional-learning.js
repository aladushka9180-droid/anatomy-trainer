(() => {
  'use strict';

  const STORAGE_KEY = 'anatomy_professional_learning_v1';
  const profileStorage = window.ProfileManager?.storage || window.localStorage;
  const techniques = Array.isArray(window.MASSAGE_TECHNIQUES) ? window.MASSAGE_TECHNIQUES : [];
  const curriculum = window.PRACTICE_CURRICULUM && typeof window.PRACTICE_CURRICULUM === 'object'
    ? window.PRACTICE_CURRICULUM
    : {};
  const techniqueSources = Array.isArray(window.TECHNIQUE_SOURCES) ? window.TECHNIQUE_SOURCES : [];
  const TECHNIQUE_LESSONS = Object.freeze({
    effleurage: Object.freeze({ videoId: 'CZabcOzYZBI', index: 1, title: 'Поглаживание', duration: '7:59' }),
    friction: Object.freeze({ videoId: 'wdyDpeUqUpc', index: 3, title: 'Растирание', duration: '7:40' }),
    petrissage: Object.freeze({ videoId: 'VrpDK1aRBN0', index: 4, title: 'Разминание', duration: '11:05' }),
    vibration: Object.freeze({ videoId: 'ZuDxo4LRQPM', index: 5, title: 'Вибрация', duration: '6:23' })
  });
  const TECHNIQUE_ILLUSTRATIONS = Object.freeze({
    compression: Object.freeze({
      src: './practice-compression.png',
      alt: 'Массажист выполняет широкую мягкую компрессию ладонями по обе стороны от позвоночника',
      title: 'Компрессия и статическое давление',
      description: 'Широкие ладони и нейтральные запястья помогают распределять давление по мышечной области, не перенося его на позвоночник.'
    }),
    percussion: Object.freeze({
      src: './practice-percussion.png',
      alt: 'Массажист показывает лёгкие ударные приёмы расслабленными кистями над мышцами спины',
      title: 'Ударные приёмы',
      description: 'Кисти остаются расслабленными, движение — лёгким и ритмичным, а рабочая зона располагается в стороне от позвоночника.'
    }),
    'passive-movement-stretch': Object.freeze({
      src: './practice-passive-stretch.png',
      alt: 'Массажист поддерживает колено и голеностоп во время мягкого пассивного движения ноги',
      title: 'Мягкие пассивные движения и растяжение',
      description: 'Сустав ведут двумя руками только в комфортном диапазоне: без рывков, продавливания и попытки дойти до предела.'
    })
  });

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const list = value => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
  const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const first = (obj, keys, fallback = '') => {
    for (const key of keys) {
      if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
    }
    return fallback;
  };
  const safeUrl = value => {
    try {
      const url = new URL(String(value || '').trim());
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const localHost = host === 'localhost'
        || host.endsWith('.local')
        || /^127(?:\.|$)/.test(host)
        || host === '0.0.0.0'
        || host === '::1'
        || host.startsWith('::ffff:127.');
      return url.protocol === 'https:' && !url.username && !url.password && !localHost ? url.href : '#';
    } catch (_) {
      return '#';
    }
  };
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const LEVEL_LABELS = { foundation: 'Базовая отработка', basic: 'Начальный уровень', intermediate: 'Средний уровень', advanced: 'Продвинутый уровень', safety: 'Безопасность' };
  const REGION_LABELS = { neck: 'Шея и голова', shoulder: 'Плечевой пояс', arm: 'Рука и локоть', back: 'Спина и поясница', pelvis: 'Таз и ягодичная область', thigh_knee: 'Бедро и колено', lower_leg_foot: 'Голень и стопа', whole_body: 'Общий сеанс' };
  const INTERNAL_LABELS = { 'admission-foundation': 'Пройдены условия безопасной учебной практики на партнёре' };
  const levelLabel = value => LEVEL_LABELS[value] || value || '';
  const regionLabel = value => REGION_LABELS[value] || value || '';
  const friendlyLabel = value => INTERNAL_LABELS[value] || value;
  const textRows = value => {
    if (Array.isArray(value)) return value.flatMap(textRows).filter(Boolean);
    if (value && typeof value === 'object') {
      const direct = first(value, ['text', 'label', 'title', 'description']);
      if (direct) return [String(direct)];
      return Object.entries(value).map(([key, row]) => `${key === 'pressure' ? 'Давление' : key === 'tempo' ? 'Темп' : key === 'duration' ? 'Длительность' : key}: ${row}`);
    }
    return value ? [String(friendlyLabel(value))] : [];
  };

  function techniqueSourceDetails(item) {
    const byId = new Map(techniqueSources.map(source => [source.id, source]));
    const rows = list(first(item, ['sourceIds'])).map(id => byId.get(id)).filter(Boolean);
    if (!rows.length) return '';
    return `<details class="technique-sources"><summary>Источники и границы применения</summary><div><ul>${rows.map(source => {
      const url = safeUrl(source.url);
      const title = esc(source.title || source.organization || 'Источник');
      return `<li>${url !== '#' ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}${source.organization ? `<small>${esc(source.organization)}</small>` : ''}</li>`;
    }).join('')}</ul><p>Источники подтверждают границы учебного материала и общие правила безопасности. Конкретный приём, силу и длительность воздействия определяют очная методика, состояние человека, назначение и локальный протокол; ссылки не подтверждают освоение навыка.</p></div></details>`;
  }

  function lessonCard(lesson, compact = false) {
    const title = `${lesson.title}. Уроки классического массажа`;
    const pageOrigin = window.location.origin;
    const pageReferrer = window.location.href.split('#')[0];
    const embedUrl = `https://www.youtube.com/embed/${lesson.videoId}?rel=0&playsinline=1&origin=${encodeURIComponent(pageOrigin)}&widget_referrer=${encodeURIComponent(pageReferrer)}`;
    return `<article class="video-lesson-card ${compact ? 'compact' : ''}">
      <iframe class="video-embed" src="${esc(embedUrl)}" title="${esc(title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen></iframe>
      <div class="video-lesson-copy"><h4>${esc(lesson.title)}</h4><p>${compact ? 'Наглядный показ базового приёма.' : 'Сначала посмотри движение целиком, затем повторяй медленно под наблюдением преподавателя или подготовленного партнёра.'}</p>
        <span class="video-duration-inline">Урок ${esc(lesson.duration)} · запускается здесь</span>
      </div>
    </article>`;
  }

  function illustrationCard(illustration) {
    return `<article class="technique-illustration-card">
      <figure class="technique-illustration">
        <img src="${esc(illustration.src)}" alt="${esc(illustration.alt)}" loading="lazy" decoding="async">
        <figcaption>Учебная иллюстрация положения рук и опоры</figcaption>
      </figure>
      <div class="video-lesson-copy"><h4>${esc(illustration.title)}</h4><p>${esc(illustration.description)}</p>
        <p class="illustration-cue"><b>Проверь себя:</b> можешь назвать опору, рабочую область и сигнал, при котором движение нужно остановить?</p>
      </div>
    </article>`;
  }

  function techniqueLesson(item) {
    const lesson = TECHNIQUE_LESSONS[item.id];
    const illustration = TECHNIQUE_ILLUSTRATIONS[item.id];
    if (!lesson && !illustration) return '';
    if (lesson) {
      return `<section class="technique-media" aria-labelledby="techniqueMediaTitle"><div class="technique-media-head"><div><span class="eyebrow">Наглядный урок</span><h4 id="techniqueMediaTitle">Посмотри технику перед отработкой</h4></div><span class="video-inline-note">Видео откроется здесь</span></div>${lessonCard(lesson)}<p class="video-safety-note"><b>Важно:</b> видео помогает увидеть движение, но не заменяет очный показ, коррекцию рук и проверку противопоказаний.</p></section>`;
    }
    return `<section class="technique-media" aria-labelledby="techniqueMediaTitle"><div class="technique-media-head"><div><span class="eyebrow">Наглядная опора</span><h4 id="techniqueMediaTitle">Посмотри положение рук перед отработкой</h4></div></div>${illustrationCard(illustration)}<p class="video-safety-note"><b>Важно:</b> иллюстрация показывает общий принцип, но не заменяет очный показ, коррекцию рук и проверку противопоказаний.</p></section>`;
  }

  function lessonLibrary() {
    return `<section class="video-library" aria-labelledby="videoLibraryTitle"><div class="video-library-head"><div><span class="eyebrow">Видео и наглядные примеры</span><h3 id="videoLibraryTitle">Базовые приёмы классического массажа</h3><p>Выбери приём: видео запустится прямо на этой странице и не уведёт из тренажёра.</p></div><span class="video-inline-note">4 коротких урока</span></div><div class="video-lesson-grid">${Object.values(TECHNIQUE_LESSONS).map(lesson => lessonCard(lesson, true)).join('')}</div><p class="video-safety-note"><b>Учебный порядок:</b> посмотри → назови цель и стоп-сигналы → повтори медленно → попроси обратную связь. Не копируй силу воздействия без очного обучения.</p></section>`;
  }

  function defaultState() {
    return { techniqueChecks: {}, mentorConfirmations: {}, checklistChecks: {}, scenarios: {}, journal: [] };
  }

  function normalizedFlags(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, checked]) => checked === true));
  }

  function normalizedChecks(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([id, rows]) => [
      id,
      isRecord(rows)
        ? Object.fromEntries(Object.entries(rows).filter(([, checked]) => checked === true))
        : {}
    ]));
  }

  function normalizedScenarios(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([id, row]) => {
      if (!isRecord(row)) return [id, {}];
      return [id, {
        open: row.open === true,
        reviewed: row.reviewed === true,
        draft: String(row.draft || '').slice(0, 1200),
        rubric: isRecord(row.rubric)
          ? Object.fromEntries(Object.entries(row.rubric).filter(([, checked]) => checked === true))
          : {},
        noCritical: row.noCritical === true
      }];
    }));
  }

  function normalizedJournal(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord).slice(0, 250).map(entry => ({
      id: String(entry.id || uid('practice')),
      date: String(entry.date || ''),
      region: String(entry.region || ''),
      goal: String(entry.goal || ''),
      techniques: String(entry.techniques || ''),
      feedback: String(entry.feedback || ''),
      next: String(entry.next || ''),
      supervised: entry.supervised === true,
      createdAt: String(entry.createdAt || '')
    }));
  }

  function loadState() {
    try {
      const saved = JSON.parse(profileStorage.getItem(STORAGE_KEY) || 'null');
      if (!isRecord(saved)) return defaultState();
      return {
        techniqueChecks: normalizedChecks(saved.techniqueChecks),
        mentorConfirmations: normalizedFlags(saved.mentorConfirmations),
        checklistChecks: normalizedChecks(saved.checklistChecks),
        scenarios: normalizedScenarios(saved.scenarios),
        journal: normalizedJournal(saved.journal)
      };
    } catch (_) {
      return defaultState();
    }
  }

  let state = loadState();
  allScenarios().forEach(item => {
    const progress = state.scenarios[item.id];
    if (!progress) return;
    if (String(progress.draft || '').trim().length < 20) progress.open = false;
    if (!scenarioCanComplete(item, progress)) progress.reviewed = false;
  });
  let activeTab = 'techniques';
  let activeTechnique = techniques[0]?.id || '';
  let practiceMode = 'checklists';
  let activeChecklist = allChecklists()[0]?.id || '';
  let activeScenario = allScenarios()[0]?.id || '';
  let journalFormOpen = false;
  let mythsExpanded = false;
  let journalMessage = '';

  function saveState() {
    let saved = false;
    try {
      profileStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saved = true;
    } catch (error) {
      console.warn('Не удалось сохранить прогресс практического обучения.', error);
    }
    renderProfessionalProgress();
    return saved;
  }

  function techniqueChecklist(item) {
    return list(first(item, ['checklist', 'practicalChecklist', 'practiceChecklist', 'steps']));
  }

  function allChecklists() {
    return list(first(curriculum, ['checklists', 'practicalChecklists']));
  }

  function allScenarios() {
    return list(first(curriculum, ['scenarios', 'sessionScenarios', 'cases']));
  }

  function scenarioCanComplete(item, progress) {
    if (!item || !isRecord(progress) || String(progress.draft || '').trim().length < 20 || progress.noCritical !== true) return false;
    const modelSteps = textRows(first(item, ['safePlan', 'modelAnswer', 'expectedPlan', 'decisionPath']));
    const rubric = isRecord(progress.rubric) ? progress.rubric : {};
    return modelSteps.length > 0 && modelSteps.every((_, index) => rubric[index] === true);
  }

  function allTips() {
    return list(first(curriculum, ['tips', 'professionalTips']));
  }

  function allMyths() {
    const configured = list(first(curriculum, ['myths', 'mythFacts']));
    if (configured.length) return configured;
    return [
      { id: 'toxins', myth: 'Массаж обязательно «выводит токсины».', fact: 'Это некорректное обещание. Лучше говорить о расслаблении, комфорте и наблюдаемой реакции клиента.' },
      { id: 'pain', myth: 'Чем больнее, тем эффективнее приём.', fact: 'Боль не является мерой качества. Давление увеличивают постепенно, а при резкой, простреливающей или отдающей в другую область боли приём прекращают.' },
      { id: 'vertebrae', myth: 'Массажист может «поставить позвонок на место».', fact: 'Такая формулировка выходит за безопасные границы. Массажист не ставит диагноз и не обещает изменить положение костей.' },
      { id: 'knots', myth: 'Любое уплотнение нужно немедленно продавить.', fact: 'Неизвестную, болезненную или пульсирующую структуру не продавливают. Сначала оценивают безопасность и при сомнении направляют к врачу.' }
    ];
  }

  function titledList(title, value, className = '') {
    const rows = textRows(value);
    if (!rows.length) return '';
    return `<section class="skilldetailsection ${className}"><h4>${esc(title)}</h4><ul>${rows.map(row => `<li>${esc(row)}</li>`).join('')}</ul></section>`;
  }

  function criticalErrorsFor(item) {
    const ids = list(first(item, ['criticalErrorIds']));
    const catalogue = list(first(curriculum, ['criticalErrors']));
    return ids.map(id => catalogue.find(row => row.id === id)).filter(Boolean).map(row => `${row.title}: ${row.description}`);
  }

  function wireDetails(selector) {
    $$(selector).forEach(details => {
      const summary = details.querySelector(':scope > summary');
      if (!summary) return;
      const sync = () => summary.setAttribute('aria-expanded', String(details.open));
      summary.setAttribute('role', 'button');
      sync();
      details.addEventListener('toggle', sync);
      summary.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        if (typeof window.toggleAppDetails === 'function') window.toggleAppDetails(details, !details.open);
        else details.open = !details.open;
      });
    });
  }

  function refreshScenarioCompletion(id) {
    const draft = $(`[data-scenario-draft="${CSS.escape(id)}"]`);
    const card = draft?.closest('.scenario-card');
    if (!card) return;
    const rubric = Array.from(card.querySelectorAll('[data-scenario-rubric]'));
    const noCritical = card.querySelector('[data-scenario-no-critical]');
    const reviewed = card.querySelector('[data-scenario-reviewed]');
    const label = card.querySelector('[data-scenario-reviewed-label]');
    const canComplete = draft.value.trim().length >= 20 && rubric.length > 0
      && rubric.every(input => input.checked) && noCritical?.checked === true;
    if (reviewed) {
      reviewed.disabled = !canComplete;
      if (!canComplete) reviewed.checked = false;
      reviewed.closest('label')?.classList.toggle('not-ready', !canComplete);
    }
    if (label) label.textContent = canComplete
      ? 'Я могу объяснить решение своими словами'
      : `Сначала сверь все пункты (${rubric.filter(input => input.checked).length}/${rubric.length}) и критические ошибки`;
  }

  function injectInterface() {
    const nav = $('.navlinks');
    if (nav && !$('#professionalShortcut')) {
      nav.insertAdjacentHTML('afterbegin', '<button type="button" id="professionalShortcut" class="navbutton">Практика</button>');
    }
    const mobile = $('.mobiletabbar');
    if (mobile && !$('#mobileProfessional')) {
      mobile.insertAdjacentHTML('beforeend', '<button type="button" id="mobileProfessional">Практика</button>');
    }
    const main = $('main');
    if (!main || $('#professionalScreen')) return;
    main.insertAdjacentHTML('beforeend', `
      <section id="professionalScreen" class="card screen professional-screen hidden" tabindex="-1" aria-labelledby="professionalTitle">
        <div class="professional-head">
          <div><h2 id="professionalTitle">Практика по одному шагу</h2><p>Выбери приём или учебную ситуацию. Отметки помогут спланировать повторение.</p></div>
          <button type="button" class="btn secondary compactback" data-go="menu">← Назад</button>
        </div>
        <div id="professionalProgress" class="professional-progress" aria-label="Прогресс практических навыков"></div>
        <div class="professional-workbar">
          <nav class="professional-tabs" role="tablist" aria-label="Разделы практического обучения">
            <button type="button" id="professionalTabTechniques" class="active" data-professional-tab="techniques" role="tab" aria-controls="professionalContent" aria-selected="true" tabindex="0">Приёмы</button>
            <button type="button" id="professionalTabPractice" data-professional-tab="practice" role="tab" aria-controls="professionalContent" aria-selected="false" tabindex="-1">Сценарии</button>
            <button type="button" id="professionalTabJournal" data-professional-tab="journal" role="tab" aria-controls="professionalContent" aria-selected="false" tabindex="-1">Журнал</button>
          </nav>
          <div id="professionalContextControl" class="professional-context-control" aria-live="polite"></div>
        </div>
        <div id="professionalContent" role="tabpanel" aria-labelledby="professionalTabTechniques" tabindex="0"></div>
      </section>`);
    const dataPanel = document.querySelector('[data-settings-panel="data"] .resetlist');
    if (dataPanel && !$('#clearProfessionalData')) {
      dataPanel.insertAdjacentHTML('beforeend', `<div class="professional-data-settings"><strong>Данные практики</strong><span>Удалить журнал, отметки чек-листов и ответы на практические ситуации текущего профиля.</span><button type="button" id="clearProfessionalData" class="btn danger">Удалить данные практики</button></div>`);
    }
  }

  function renderProfessionalProgress() {
    const host = $('#professionalProgress');
    if (!host) return;
    const techniqueRows = techniques.map(item => {
      const steps = techniqueChecklist(item);
      const checked = state.techniqueChecks[item.id] || {};
      const done = steps.filter((_, index) => checked[index] === true).length;
      return { item, done, ready: steps.length > 0 && done === steps.length };
    });
    const techniqueDone = techniqueRows.reduce((sum, row) => sum + row.done, 0);
    const checklistRows = allChecklists().map(item => {
      const steps = list(first(item, ['steps', 'checklist', 'items']));
      const checked = state.checklistChecks[item.id] || {};
      const done = steps.filter((_, index) => checked[index] === true).length;
      const required = Number(first(first(item, ['pass'], {}), ['requiredSteps'], steps.length));
      return { item, done, ready: done >= required };
    });
    const checklistDone = checklistRows.reduce((sum, row) => sum + row.done, 0);
    const scenarios = allScenarios();
    const scenarioRows = scenarios.map(item => {
      const progress = state.scenarios[item.id];
      const ready = progress?.reviewed === true && scenarioCanComplete(item, progress);
      const started = Boolean(String(progress?.draft || '').trim() || progress?.open || Object.keys(progress?.rubric || {}).length);
      return { item, ready, started };
    });
    const scenariosDone = scenarioRows.filter(row => row.ready).length;
    const techniquesReady = techniqueRows.filter(row => row.ready).length;
    const mentorConfirmed = techniqueRows.filter(row => row.ready && state.mentorConfirmations[row.item.id] === true).length;
    const checklistsReady = checklistRows.filter(row => row.ready).length;
    const competencyLevels = list(first(curriculum, ['competencyLevels']));
    const startedTechnique = techniqueRows.find(row => row.done > 0 && !row.ready);
    const startedChecklist = checklistRows.find(row => row.done > 0 && !row.ready);
    const startedScenario = scenarioRows.find(row => row.started && !row.ready);
    let nextAction;
    if (startedTechnique) {
      nextAction = { type: 'technique', item: startedTechnique.item, title: 'Продолжи начатый приём', description: `Вернись к «${first(startedTechnique.item, ['name', 'title'])}» и заверши оставшиеся шаги безопасной отработки.`, button: 'Продолжить приём' };
    } else if (startedChecklist) {
      nextAction = { type: 'checklist', item: startedChecklist.item, title: 'Продолжи чек-лист по области', description: `Вернись к «${first(startedChecklist.item, ['title', 'name'])}». Отмечай только реально выполненные шаги.`, button: 'Продолжить чек-лист' };
    } else if (startedScenario) {
      nextAction = { type: 'scenario', item: startedScenario.item, title: 'Заверши разбор ситуации', description: `Продолжи «${first(startedScenario.item, ['title', 'name'])}»: сначала свой план, затем сверка с учебным разбором.`, button: 'Продолжить ситуацию' };
    } else if (techniquesReady === 0 && techniqueRows.length) {
      nextAction = { type: 'technique', item: techniqueRows[0].item, title: 'Начни с одного базового приёма', description: `Разбери «${first(techniqueRows[0].item, ['name', 'title'])}»: цель, положение рук и ситуации, когда нужно остановиться.`, button: 'Начать первый приём' };
    } else if (checklistsReady === 0 && checklistRows.length) {
      nextAction = { type: 'checklist', item: checklistRows[0].item, title: 'Закрепи приём на одной области', description: `Открой «${first(checklistRows[0].item, ['title', 'name'])}» и пройди его на учебном партнёре с правом немедленно остановить практику.`, button: 'Открыть чек-лист' };
    } else if (scenariosDone === 0 && scenarioRows.length) {
      nextAction = { type: 'scenario', item: scenarioRows[0].item, title: 'Проверь безопасное решение', description: `Разбери «${first(scenarioRows[0].item, ['title', 'name'])}» и объясни решение своими словами.`, button: 'Разобрать ситуацию' };
    } else if (state.journal.length === 0) {
      nextAction = { type: 'journal', title: 'Зафиксируй первую отработку', description: 'Добавь короткую запись о реально выполненной практике и полученной обратной связи — без персональных и медицинских данных.', button: 'Добавить запись' };
    } else {
      const nextTechnique = techniqueRows.find(row => !row.ready);
      const nextChecklist = checklistRows.find(row => !row.ready);
      const nextScenario = scenarioRows.find(row => !row.ready);
      nextAction = nextTechnique
        ? { type: 'technique', item: nextTechnique.item, title: 'Возьми следующий приём', description: `Продолжи самостоятельную отработку с приёма «${first(nextTechnique.item, ['name', 'title'])}».`, button: 'Открыть следующий приём' }
        : nextChecklist
          ? { type: 'checklist', item: nextChecklist.item, title: 'Возьми следующую область', description: `Продолжи с чек-листом «${first(nextChecklist.item, ['title', 'name'])}».`, button: 'Открыть следующий чек-лист' }
          : nextScenario
            ? { type: 'scenario', item: nextScenario.item, title: 'Разбери следующую ситуацию', description: `Следующий безопасный шаг — «${first(nextScenario.item, ['title', 'name'])}».`, button: 'Открыть ситуацию' }
            : { type: 'journal', title: 'Подведи итог отработки', description: 'Добавь запись о последней реальной практике и реши, что повторить в другой день.', button: 'Добавить запись' };
    }
    const completedText = techniquesReady + checklistsReady + scenariosDone === 0
      ? (techniqueDone + checklistDone > 0 ? `Начатых шагов: ${techniqueDone + checklistDone}. Завершённых блоков пока нет.` : 'Завершённых блоков пока нет — начни с одного небольшого шага.')
      : `По шагам разобрано приёмов: ${techniquesReady}; наставник наблюдал: ${mentorConfirmed}; отработано областей: ${checklistsReady}; разобрано ситуаций: ${scenariosDone}.`;
    host.innerHTML = `
      <section class="professional-next-step" aria-labelledby="professionalNextTitle">
        <div class="professional-next-copy"><span class="professional-next-label">Следующий шаг</span><h3 id="professionalNextTitle">${esc(nextAction.title)}</h3>
          <p>${esc(nextAction.description)}</p><small class="professional-next-status">${esc(completedText)}</small></div>
        <button type="button" id="professionalNextAction" class="btn primary">${esc(nextAction.button)}</button>
        <p class="professional-boundary">Самоотработка не подтверждает владение приёмом — это может сделать только преподаватель после очного показа.</p>
      </section>
      <details class="competency-help"><summary>Как устроен путь освоения</summary><div class="competency-route">${competencyLevels.length
        ? competencyLevels.map((level, index) => `<span><i>${index + 1}</i>${esc(first(level, ['title']))}</span>`).join('')
        : '<span><i>1</i>Знаю</span><span><i>2</i>Объясняю</span><span><i>3</i>Показываю</span><span><i>4</i>Проверено</span>'}</div><p><b>Важно:</b> отметки показывают выполненную тренировку, а не подтверждённое владение приёмом. Уровень «Проверено» может отметить только квалифицированный преподаватель после очной демонстрации.</p></details>`;
    $('#professionalNextAction')?.addEventListener('click', () => {
      if (nextAction.type === 'technique') {
        activeTechnique = nextAction.item.id;
        activeTab = 'techniques';
      } else if (nextAction.type === 'checklist') {
        activeChecklist = nextAction.item.id;
        practiceMode = 'checklists';
        activeTab = 'practice';
      } else if (nextAction.type === 'scenario') {
        activeScenario = nextAction.item.id;
        practiceMode = 'scenarios';
        activeTab = 'practice';
      } else {
        journalFormOpen = true;
        activeTab = 'journal';
      }
      renderActiveTab();
      requestAnimationFrame(() => $('#professionalContent')?.focus({ preventScroll: true }));
    });
    wireDetails('details.competency-help');
  }

  function renderTechniques() {
    const host = $('#professionalContent');
    if (!techniques.length) {
      host.innerHTML = '<div class="empty-state"><h3>Библиотека приёмов готовится</h3><p>Данные будут доступны после обновления учебного пакета.</p></div>';
      return;
    }
    if (!techniques.some(item => item.id === activeTechnique)) activeTechnique = techniques[0].id;
    const item = techniques.find(row => row.id === activeTechnique) || techniques[0];
    const contextControl = $('#professionalContextControl');
    if (contextControl) contextControl.innerHTML = `<label class="technique-picker"><span>Приём</span><select id="techniquePicker">${techniques.map(row => `<option value="${esc(row.id)}" ${row.id === item.id ? 'selected' : ''}>${esc(first(row, ['title', 'name']))}</option>`).join('')}</select></label>`;
    const checklist = techniqueChecklist(item);
    const checked = state.techniqueChecks[item.id] || {};
    const checklistComplete = checklist.length > 0 && checklist.every((_, index) => checked[index] === true);
    const mentorConfirmed = checklistComplete && state.mentorConfirmations[item.id] === true;
    const fields = [
      ['Цель приёма', first(item, ['goal', 'purpose', 'summary'])],
      ['Положение клиента', first(item, ['clientPosition', 'startingPosition', 'startPosition', 'position'])],
      ['Положение рук', first(item, ['handPosition', 'hands'])],
      ['Направление движения', first(item, ['direction', 'movementDirection'])],
      ['Глубина и слой тканей', first(item, ['tissueLayer', 'layer'])],
      ['Давление, темп и длительность', first(item, ['dose', 'pressureTempoDuration', 'pressure'])],
      ['Нормальные ощущения', first(item, ['normalSensations', 'expectedSensations'])]
    ].filter(([, value]) => textRows(value).length);
    const lesson = techniqueLesson(item);
    const safety = `${titledList('Стоп-сигналы', first(item, ['stopSignals', 'stopSigns', 'redFlags']), 'warning')}${titledList('Где требуется осторожность', first(item, ['limitations', 'restrictedAreas', 'restrictedZones', 'contraindications']), 'caution')}`;
    const mistakes = `${titledList('Частые ошибки', first(item, ['commonMistakes', 'mistakes']))}${titledList('Профессиональные подсказки', first(item, ['tips', 'professionalTips', 'proTips']))}`;
    const techniqueSummary = first(item, ['summary', 'description', 'goal']);
    const techniqueGoal = first(item, ['goal', 'purpose', 'summary']);
    const techniqueGoalMarkup = techniqueGoal && techniqueGoal !== techniqueSummary ? `<p class="technique-goal">${esc(techniqueGoal)}</p>` : '';
    host.innerHTML = `
      <div class="technique-layout">
        <article class="technique-detail">
          <span class="technique-level">${esc(first(item, ['level', 'difficulty'], 'Базовый уровень'))}</span>
          <h3>${esc(first(item, ['title', 'name']))}</h3>
          <p class="lead">${esc(techniqueSummary)}</p>
          ${techniqueGoalMarkup}
          <div class="technique-accordions">
            ${lesson ? `<details class="technique-section"><summary><span>Видео или схема</span><small>Наглядный показ положения рук</small></summary><div class="technique-section-body">${lesson}</div></details>` : ''}
            <details class="technique-section"><summary><span>Как выполнять</span><small>Положение, направление и дозирование</small></summary><div class="technique-section-body"><div class="skill-facts">${fields.map(([title, value]) => { const rows = textRows(value); return `<section><h4>${esc(title)}</h4>${rows.length > 1 ? `<ul>${rows.map(v => `<li>${esc(v)}</li>`).join('')}</ul>` : `<p>${esc(rows[0])}</p>`}</section>`; }).join('')}</div></div></details>
            ${safety ? `<details class="technique-section safety"><summary><span>Безопасность</span><small>Стоп-сигналы и зоны осторожности</small></summary><div class="technique-section-body">${safety}</div></details>` : ''}
            ${mistakes ? `<details class="technique-section"><summary><span>Ошибки и подсказки</span><small>Что чаще всего мешает качеству</small></summary><div class="technique-section-body">${mistakes}</div></details>` : ''}
            <details class="technique-section"><summary><span>Чек-лист отработки</span><small>${checklist.filter((_, index) => checked[index] === true).length}/${checklist.length} отмечено</small></summary><div class="technique-section-body"><section class="practice-checklist"><p>Отмечай пункт только после реальной отработки на учебном партнёре.</p>
              ${checklist.map((step, index) => `<label><input type="checkbox" data-technique-check="${index}" ${checked[index] === true ? 'checked' : ''}><span>${esc(typeof step === 'string' ? step : first(step, ['text', 'label', 'title']))}</span></label>`).join('')}
              <div class="practice-ready technique-next-step ${checklistComplete ? '' : 'hidden'}"><strong>Все пункты самостоятельной отработки отмечены.</strong><span>Следующий шаг — повторить приём в другой день и показать преподавателю очно.</span></div>
              <div class="mentor-confirmation"><strong>Подтверждение наблюдения</strong><label class="${checklistComplete ? '' : 'not-ready'}"><input type="checkbox" data-technique-mentor ${mentorConfirmed ? 'checked' : ''} ${checklistComplete ? '' : 'disabled'}><span>Наставник или преподаватель лично наблюдал выполнение этого приёма.</span></label><small>Это локальная отметка ученика, а не сертификат и не автоматическое подтверждение квалификации.</small></div>
            </section></div></details>
          </div>
          <p class="source-note">Проверка материала: ${esc(first(item, ['reviewDate', 'checkedAt', 'reviewedAt'], curriculum.reviewDate || '2026-08-29'))}. Практику выполняют только в пределах своей подготовки и компетенции.</p>
          ${techniqueSourceDetails(item)}
        </article>
      </div>`;
    wireDetails('details.technique-section, details.technique-sources');
    $$('[data-technique-id]').forEach(button => button.addEventListener('click', () => {
      activeTechnique = button.dataset.techniqueId;
      renderTechniques();
      requestAnimationFrame(() => $(`[data-technique-id="${CSS.escape(activeTechnique)}"]`)?.focus());
    }));
    $('#techniquePicker')?.addEventListener('change', event => {
      activeTechnique = event.currentTarget.value;
      renderTechniques();
      requestAnimationFrame(() => $('#techniquePicker')?.focus());
    });
    $$('[data-technique-check]').forEach(input => input.addEventListener('change', () => {
      state.techniqueChecks[item.id] ||= {};
      state.techniqueChecks[item.id][input.dataset.techniqueCheck] = input.checked;
      saveState();
      const techniqueInputs = $$('[data-technique-check]');
      const complete = techniqueInputs.length > 0 && techniqueInputs.every(row => row.checked);
      const counter = input.closest('details')?.querySelector('summary small');
      if (counter) counter.textContent = `${techniqueInputs.filter(row => row.checked).length}/${techniqueInputs.length} отмечено`;
      $('.technique-next-step')?.classList.toggle('hidden', !complete);
      const mentor=$('[data-technique-mentor]');
      if(mentor){mentor.disabled=!complete;mentor.closest('label')?.classList.toggle('not-ready',!complete);if(!complete&&mentor.checked){mentor.checked=false;delete state.mentorConfirmations[item.id];saveState()}}
    }));
    $('[data-technique-mentor]')?.addEventListener('change', event => {
      if (event.currentTarget.checked) state.mentorConfirmations[item.id] = true;
      else delete state.mentorConfirmations[item.id];
      saveState();
    });
  }

  function renderChecklistCards() {
    const rows = allChecklists();
    if (!rows.length) return '<div class="empty-state"><p>Практические чек-листы готовятся.</p></div>';
    if (!rows.some(item => item.id === activeChecklist)) activeChecklist = rows[0].id;
    const item = rows.find(row => row.id === activeChecklist) || rows[0];
    const id = first(item, ['id'], uid('checklist'));
    const steps = list(first(item, ['steps', 'checklist', 'items']));
    const checked = state.checklistChecks[id] || {};
    const completed = steps.filter((_, index) => checked[index] === true).length;
    const pass = first(item, ['pass'], {});
    const required = Number(first(pass, ['requiredSteps'], steps.length));
    const ready = completed >= required;
    const metadata = [regionLabel(first(item, ['regionId', 'region'])), levelLabel(first(item, ['level']))].filter(Boolean).join(' · ');
    return `<div class="checklist-grid"><details class="practice-card" data-required-steps="${required}" ${completed ? 'open' : ''}><summary><span><strong>${esc(first(item, ['title', 'name']))}</strong><small>${esc(metadata)}</small></span><b>${ready ? 'Готов к показу' : `${completed}/${required}`}</b></summary>
      <div class="practice-card-body">
        ${first(item, ['purpose', 'goal']) ? `<p>${esc(first(item, ['purpose', 'goal']))}</p>` : ''}
        ${titledList('Перед началом', first(item, ['prerequisites']), 'prerequisites')}
        <p class="pass-rule"><b>Для самостоятельной отработки:</b> выполни ${required} обязательных шагов из ${steps.length}; критических ошибок — не более ${esc(first(pass, ['criticalErrorsAllowed'], 0))}.</p>
        ${steps.map((step, index) => `<label class="practice-step ${typeof step === 'object' && step.critical ? 'critical-step' : ''}"><input type="checkbox" data-checklist-id="${esc(id)}" data-checklist-step="${index}" ${checked[index] === true ? 'checked' : ''}><span>${esc(typeof step === 'string' ? step : first(step, ['text', 'label', 'title']))}${typeof step === 'object' && step.critical ? '<small>Критически важный шаг</small>' : ''}</span></label>`).join('')}
        ${titledList('Критические ошибки', first(item, ['criticalErrors', 'stopErrors'], criticalErrorsFor(item)), 'warning')}
        <div class="practice-ready checklist-next-step ${ready ? '' : 'hidden'}"><strong>Все обязательные пункты чек-листа отмечены.</strong><span>Это не допуск к самостоятельной работе: покажи весь чек-лист преподавателю без подсказок.</span></div>
      </div></details></div>`;
  }

  function renderScenarioCards() {
    const rows = allScenarios();
    if (!rows.length) return '<div class="empty-state"><p>Сценарии построения сеанса готовятся.</p></div>';
    if (!rows.some(item => item.id === activeScenario)) activeScenario = rows[0].id;
    const item = rows.find(row => row.id === activeScenario) || rows[0];
    const id = first(item, ['id'], uid('scenario'));
    const progress = state.scenarios[id] || {};
    const draft = String(progress.draft || '');
    const modelSteps = textRows(first(item, ['safePlan', 'modelAnswer', 'expectedPlan', 'decisionPath']));
    const rubric = progress.rubric && typeof progress.rubric === 'object' ? progress.rubric : {};
    const rubricDone = modelSteps.filter((_, index) => rubric[index] === true).length;
    const canReveal = draft.trim().length >= 20;
    const canComplete = scenarioCanComplete(item, progress);
    const metadata = [regionLabel(first(item, ['regionId', 'region'])), levelLabel(first(item, ['difficulty', 'level']))].filter(Boolean).join(' · ')
      || first(item, ['category'], 'Практическая ситуация');
    return `<div class="scenario-grid"><article class="scenario-card">
        <div class="scenario-brief"><span class="eyebrow">${esc(metadata)}</span>
          <h3>${esc(first(item, ['title', 'name']))}</h3>
          <p>${esc(first(item, ['situation', 'description', 'case', 'brief']))}</p>
          ${titledList('Продумай перед открытием разбора', first(item, ['questions', 'prompts', 'tasks', 'task']))}</div>
        <div class="scenario-work"><label class="scenario-draft"><span>Сначала запиши своё решение</span><textarea data-scenario-draft="${esc(id)}" maxlength="1200" placeholder="Какие вопросы задашь, что сделаешь по порядку, когда остановишься?">${esc(draft)}</textarea><small data-scenario-draft-note="${esc(id)}">${canReveal ? 'Ответ сохранён. Теперь можно сравнить его с разбором.' : 'Нужно не менее 20 знаков: попытка вспомнить ответ важнее простого чтения.'}</small></label>
        <button type="button" class="btn primary" data-reveal-scenario="${esc(id)}" aria-expanded="${progress.open ? 'true' : 'false'}" ${canReveal ? '' : 'disabled'}>${progress.open ? 'Скрыть разбор' : 'Сравнить с учебным разбором'}</button></div>
        <div class="scenario-answer ${progress.open ? '' : 'hidden'}" data-scenario-answer="${esc(id)}">
          ${titledList('Рекомендуемый ход рассуждения', modelSteps)}
          ${titledList('Когда остановиться и обратиться за помощью', first(item, ['stopSignals', 'redFlags', 'referral']))}
          ${titledList('Критические ошибки', first(item, ['criticalErrors', 'unsafeChoices'], criticalErrorsFor(item)), 'warning')}
          <section class="scenario-rubric"><h4>Сверь свой ответ</h4><p>Отметь только то, что уже было в твоём решении до открытия разбора. Пропущенные пункты добавь в следующую попытку.</p>
            ${modelSteps.map((step, index) => `<label><input type="checkbox" data-scenario-rubric="${esc(id)}" data-rubric-step="${index}" ${rubric[index] === true ? 'checked' : ''}><span>${esc(step)}</span></label>`).join('')}
            <label class="no-critical"><input type="checkbox" data-scenario-no-critical="${esc(id)}" ${progress.noCritical === true ? 'checked' : ''}><span>В моём решении не было перечисленных критических ошибок</span></label>
          </section>
          <label class="reviewed-check ${canComplete ? '' : 'not-ready'}"><input type="checkbox" data-scenario-reviewed="${esc(id)}" ${progress.reviewed === true && canComplete ? 'checked' : ''} ${canComplete ? '' : 'disabled'}><span data-scenario-reviewed-label>${canComplete ? 'Я могу объяснить решение своими словами' : `Сначала сверь все пункты (${rubricDone}/${modelSteps.length}) и критические ошибки`}</span></label>
        </div>
      </article></div>`;
  }

  function renderPractice() {
    const host = $('#professionalContent');
    const checklists = allChecklists();
    const scenarios = allScenarios();
    if (!checklists.some(item => item.id === activeChecklist)) activeChecklist = checklists[0]?.id || '';
    if (!scenarios.some(item => item.id === activeScenario)) activeScenario = scenarios[0]?.id || '';
    host.innerHTML = `
      <div class="practice-controls">
        <div class="practice-switch" role="group" aria-label="Вид практической отработки">
          <button type="button" data-practice-mode="checklists" class="${practiceMode === 'checklists' ? 'active' : ''}" aria-pressed="${practiceMode === 'checklists'}">Чек-листы</button>
          <button type="button" data-practice-mode="scenarios" class="${practiceMode === 'scenarios' ? 'active' : ''}" aria-pressed="${practiceMode === 'scenarios'}">Построение сеанса</button>
        </div>
        ${practiceMode === 'checklists' && checklists.length ? `<label class="practice-area-picker"><span>Область и задача</span><select id="practiceChecklistPicker">${checklists.map(item => `<option value="${esc(item.id)}" ${item.id === activeChecklist ? 'selected' : ''}>${esc(regionLabel(first(item, ['regionId', 'region'])))} — ${esc(first(item, ['title', 'name']))}</option>`).join('')}</select></label>` : ''}
        ${practiceMode === 'scenarios' && scenarios.length ? `<label class="practice-scenario-picker"><span>Учебная ситуация</span><select id="practiceScenarioPicker">${scenarios.map(item => `<option value="${esc(item.id)}" ${item.id === activeScenario ? 'selected' : ''}>${esc(first(item, ['title', 'name']))}</option>`).join('')}</select></label>` : ''}
      </div>
      <aside class="practice-method"><b>${practiceMode === 'checklists' ? 'Как отрабатывать навык' : 'Как разбирать ситуацию'}</b><span>${practiceMode === 'checklists'
        ? 'Подготовься → выполни без подсказок → отметь шаги → получи обратную связь → повтори в другой день.'
        : 'Сначала сформулируй решение по памяти → затем открой разбор → найди пропуски и критические ошибки → объясни исправленный план.'}</span></aside>
      ${practiceMode === 'checklists' ? `${renderChecklistCards()}<details class="practice-video-library"><summary>Видео базовых приёмов</summary><div>${lessonLibrary()}</div></details>` : renderScenarioCards()}`;
    wireDetails('details.practice-card');
    wireDetails('details.practice-video-library');
    $$('[data-practice-mode]').forEach(button => button.addEventListener('click', () => {
      practiceMode = button.dataset.practiceMode;
      renderPractice();
      requestAnimationFrame(() => $(`[data-practice-mode="${practiceMode}"]`)?.focus());
    }));
    $('#practiceChecklistPicker')?.addEventListener('change', event => {
      activeChecklist = event.currentTarget.value;
      renderPractice();
      requestAnimationFrame(() => $('#practiceChecklistPicker')?.focus());
    });
    $('#practiceScenarioPicker')?.addEventListener('change', event => {
      activeScenario = event.currentTarget.value;
      renderPractice();
      requestAnimationFrame(() => $('#practiceScenarioPicker')?.focus());
    });
    $$('[data-checklist-id]').forEach(input => input.addEventListener('change', () => {
      state.checklistChecks[input.dataset.checklistId] ||= {};
      state.checklistChecks[input.dataset.checklistId][input.dataset.checklistStep] = input.checked;
      saveState();
      const details = input.closest('details');
      const inputs = details ? Array.from(details.querySelectorAll('[data-checklist-step]')) : [];
      const counter = details?.querySelector('summary b');
      const required = Number(details?.dataset.requiredSteps) || inputs.length;
      const completed = inputs.filter(row => row.checked).length;
      const ready = completed >= required;
      if (counter) counter.textContent = ready ? 'Готов к показу' : `${completed}/${required}`;
      details?.querySelector('.checklist-next-step')?.classList.toggle('hidden', !ready);
    }));
    $$('[data-reveal-scenario]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.revealScenario;
      state.scenarios[id] ||= {};
      if (String(state.scenarios[id].draft || '').trim().length < 20) {
        $(`[data-scenario-draft="${CSS.escape(id)}"]`)?.focus();
        return;
      }
      state.scenarios[id].open = !state.scenarios[id].open;
      saveState();
      const open = state.scenarios[id].open;
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? 'Скрыть разбор' : 'Сравнить с учебным разбором';
      $(`[data-scenario-answer="${CSS.escape(id)}"]`)?.classList.toggle('hidden', !open);
    }));
    $$('[data-scenario-draft]').forEach(input => input.addEventListener('input', () => {
      const id = input.dataset.scenarioDraft;
      state.scenarios[id] ||= {};
      state.scenarios[id].draft = input.value;
      state.scenarios[id].reviewed = false;
      saveState();
      const button = $(`[data-reveal-scenario="${CSS.escape(id)}"]`);
      const note = $(`[data-scenario-draft-note="${CSS.escape(id)}"]`);
      const reviewed = $(`[data-scenario-reviewed="${CSS.escape(id)}"]`);
      const ready = input.value.trim().length >= 20;
      if (button && !state.scenarios[id].open) button.disabled = !ready;
      if (note) note.textContent = ready ? 'Ответ сохранён. Теперь можно сравнить его с разбором.' : 'Нужно не менее 20 знаков: попытка вспомнить ответ важнее простого чтения.';
      if (reviewed) {
        reviewed.checked = false;
        const scenario = allScenarios().find(item => item.id === id);
        reviewed.disabled = !scenarioCanComplete(scenario, state.scenarios[id]);
      }
      refreshScenarioCompletion(id);
    }));
    $$('[data-scenario-rubric]').forEach(input => input.addEventListener('change', () => {
      const id = input.dataset.scenarioRubric;
      state.scenarios[id] ||= {};
      state.scenarios[id].rubric ||= {};
      state.scenarios[id].rubric[input.dataset.rubricStep] = input.checked;
      state.scenarios[id].reviewed = false;
      saveState();
      refreshScenarioCompletion(id);
    }));
    $$('[data-scenario-no-critical]').forEach(input => input.addEventListener('change', () => {
      const id = input.dataset.scenarioNoCritical;
      state.scenarios[id] ||= {};
      state.scenarios[id].noCritical = input.checked;
      state.scenarios[id].reviewed = false;
      saveState();
      refreshScenarioCompletion(id);
    }));
    $$('[data-scenario-reviewed]').forEach(input => input.addEventListener('change', () => {
      const id = input.dataset.scenarioReviewed;
      state.scenarios[id] ||= {};
      const scenario = allScenarios().find(item => item.id === id);
      state.scenarios[id].reviewed = input.checked && scenarioCanComplete(scenario, state.scenarios[id]);
      input.checked = state.scenarios[id].reviewed;
      saveState();
    }));
  }

  function renderJournal() {
    const host = $('#professionalContent');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    host.innerHTML = `
      <div class="journal-layout">
        <section class="journal-history"><div class="journal-history-head"><div><h3>История отработки</h3><p>Сохраняй только учебные наблюдения без персональных и медицинских данных.</p></div><button type="button" id="showJournalForm" class="btn primary ${journalFormOpen ? 'hidden' : ''}">Добавить запись</button></div><p id="journalStatus" class="journal-status ${journalMessage ? '' : 'hidden'}" role="status" aria-live="polite">${esc(journalMessage)}</p><div id="journalEntries"></div></section>
        <form id="practiceJournalForm" class="journal-form ${journalFormOpen ? '' : 'hidden'}" autocomplete="off" aria-describedby="journalPrivacyNote">
          <h3>Новая запись практики</h3>
          <p id="journalPrivacyNote">Не вноси ФИО, контакты, даты рождения, диагнозы и другие сведения, по которым можно узнать клиента. Журнал хранится в незашифрованном хранилище браузера: его может увидеть любой, у кого есть доступ к этому профилю браузера или устройству.</p>
          <div class="journal-fields">
            <label>Дата<input name="date" type="date" value="${today}" required></label>
            <label>Область тела<input name="region" maxlength="80" required placeholder="Например: плечевой пояс"></label>
            <label>Цель учебной отработки<input name="goal" maxlength="180" required placeholder="Что хотел научиться делать"></label>
            <label>Отработанные приёмы<textarea name="techniques" maxlength="600" required></textarea></label>
            <label>Обратная связь партнёра<textarea name="feedback" maxlength="600"></textarea></label>
            <label>Что улучшить в следующий раз<textarea name="next" maxlength="600"></textarea></label>
          </div>
          <label class="reviewed-check"><input name="supervised" type="checkbox"> Практику наблюдал преподаватель или наставник</label>
          <div class="journal-form-actions"><button class="btn primary" type="submit">Сохранить запись</button><button class="btn secondary" id="cancelJournalForm" type="button">Отмена</button></div>
        </form>
      </div>`;
    renderJournalEntries();
    $('#showJournalForm')?.addEventListener('click', () => {
      journalFormOpen = true;
      renderJournal();
      requestAnimationFrame(() => $('#practiceJournalForm input[name="date"]')?.focus());
    });
    $('#cancelJournalForm')?.addEventListener('click', () => {
      journalFormOpen = false;
      renderJournal();
      requestAnimationFrame(() => $('#showJournalForm')?.focus());
    });
    $('#practiceJournalForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      state.journal.unshift({
        id: uid('practice'),
        date: String(data.get('date') || today),
        region: String(data.get('region') || '').trim(),
        goal: String(data.get('goal') || '').trim(),
        techniques: String(data.get('techniques') || '').trim(),
        feedback: String(data.get('feedback') || '').trim(),
        next: String(data.get('next') || '').trim(),
        supervised: data.get('supervised') === 'on',
        createdAt: new Date().toISOString()
      });
      state.journal = state.journal.slice(0, 250);
      journalMessage = saveState()
        ? 'Запись сохранена в журнале на этом устройстве.'
        : 'Не удалось сохранить запись в хранилище браузера. После перезагрузки она может исчезнуть.';
      journalFormOpen = false;
      renderJournal();
    });
  }

  function renderJournalEntries() {
    const host = $('#journalEntries');
    if (!host) return;
    if (!state.journal.length) {
      host.innerHTML = '<div class="empty-state"><p>Записей пока нет. Добавь первую реальную учебную отработку.</p></div>';
      return;
    }
    host.innerHTML = state.journal.map(entry => `<article class="journal-entry">
      <div><span>${esc(entry.date)}</span>${entry.supervised ? '<b>Ученик отметил: практику наблюдал наставник</b>' : '<b class="selfcheck">Самопроверка</b>'}</div>
      <h4>${esc(entry.region)}</h4><p><strong>Цель:</strong> ${esc(entry.goal)}</p><p><strong>Приёмы:</strong> ${esc(entry.techniques)}</p>
      ${entry.feedback ? `<p><strong>Обратная связь:</strong> ${esc(entry.feedback)}</p>` : ''}
      ${entry.next ? `<p><strong>Следующий шаг:</strong> ${esc(entry.next)}</p>` : ''}
      <button type="button" class="btn secondary journal-delete" data-journal-delete="${esc(entry.id)}">Удалить запись</button>
    </article>`).join('');
    $$('[data-journal-delete]').forEach(button => button.addEventListener('click', () => {
      if (!confirm('Удалить эту запись практики?')) return;
      state.journal = state.journal.filter(entry => entry.id !== button.dataset.journalDelete);
      journalMessage = saveState()
        ? 'Запись удалена из журнала.'
        : 'Не удалось удалить запись из хранилища браузера. После перезагрузки она может появиться снова.';
      renderJournal();
    }));
  }

  function clearProfessionalData() {
    if (!confirm('Удалить журнал, отметки чек-листов и ответы на практические ситуации текущего профиля? Это действие нельзя отменить.')) return;
    try {
      profileStorage.removeItem(STORAGE_KEY);
      state = defaultState();
      journalFormOpen = false;
      journalMessage = 'Все данные практики текущего профиля удалены.';
      renderProfessionalProgress();
      if (activeTab === 'journal') renderJournal();
    } catch (error) {
      console.warn('Не удалось удалить данные практического обучения.', error);
      journalMessage = 'Не удалось удалить данные из хранилища браузера. Проверь настройки хранения данных.';
      if (activeTab === 'journal') renderJournal();
    }
  }

  function renderMyths() {
    const host = $('#professionalContent');
    const tips = allTips();
    const myths = allMyths();
    const visibleMyths = mythsExpanded ? myths : myths.slice(0, 3);
    const visibleTips = mythsExpanded ? tips : tips.slice(0, 3);
    const hasMore = myths.length > 3 || tips.length > 3;
    host.innerHTML = `
      <section class="myth-intro"><h3>Научное мышление и безопасные формулировки</h3><p>Задача массажиста — наблюдать реакцию человека, честно описывать границы метода и не подменять врача.</p></section>
      <div class="myth-grid">${visibleMyths.map(item => {
        const source = safeUrl(first(item, ['sourceUrl', 'url']));
        return `<details class="myth-card"><summary>${esc(first(item, ['myth', 'claim', 'title']))}</summary><div><span class="fact-label">${esc(first(item, ['verdict'], 'Разбор'))}</span><p>${esc(first(item, ['fact', 'explanation', 'answer']))}</p>${source !== '#' ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Источник</a>` : ''}</div></details>`;
      }).join('')}</div>
      ${tips.length ? `<section class="tips-section"><h3>Профессиональные подсказки</h3><div class="tips-grid">${visibleTips.map(item => {
        const level = first(item, ['level', 'risk', 'type'], 'green');
        const label = level === 'red' ? 'Опасная ошибка' : level === 'yellow' ? 'Только после обучения' : 'Безопасная привычка';
        return `<article class="tip-card ${esc(level)}"><span>${esc(label)}</span><p>${esc(first(item, ['text', 'tip', 'description', 'title']))}</p></article>`;
      }).join('')}</div></section>` : ''}
      ${hasMore ? `<button type="button" id="toggleMythsMore" class="btn secondary myths-more" aria-expanded="${mythsExpanded}">${mythsExpanded ? 'Скрыть дополнительные материалы' : 'Показать остальные материалы'}</button>` : ''}`;
    wireDetails('details.myth-card');
    $('#toggleMythsMore')?.addEventListener('click', () => {
      mythsExpanded = !mythsExpanded;
      renderMyths();
      requestAnimationFrame(() => $('#toggleMythsMore')?.focus());
    });
  }

  function renderActiveTab() {
    $('#professionalProgress')?.classList.toggle('hidden', activeTab !== 'techniques');
    const contextControl = $('#professionalContextControl');
    if (contextControl) {
      contextControl.innerHTML = '';
      contextControl.classList.toggle('hidden', activeTab !== 'techniques');
    }
    $$('[data-professional-tab]').forEach(button => {
      const active = button.dataset.professionalTab === activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const activeButton = $(`[data-professional-tab="${activeTab}"]`);
    const content = $('#professionalContent');
    if (activeButton) {
      content?.setAttribute('aria-labelledby', activeButton.id);
      content?.removeAttribute('aria-label');
    } else {
      content?.removeAttribute('aria-labelledby');
      content?.setAttribute('aria-label', 'Миф или факт');
    }
    if (activeTab === 'techniques') renderTechniques();
    else if (activeTab === 'practice') renderPractice();
    else if (activeTab === 'journal') renderJournal();
    else renderMyths();
  }

  function openProfessional(tab = 'techniques', options = {}) {
    activeTab = ['techniques', 'practice', 'journal', 'myths'].includes(tab) ? tab : 'techniques';
    const regionId = String(options.regionId || '');
    if (regionId) {
      const matchingChecklist = allChecklists().find(item => String(first(item, ['regionId', 'region'])) === regionId);
      if (matchingChecklist) activeChecklist = matchingChecklist.id;
    }
    if (typeof window.show === 'function') window.show('professionalScreen');
    else {
      $$('.screen').forEach(screen => screen.classList.toggle('hidden', screen.id !== 'professionalScreen'));
    }
    renderProfessionalProgress();
    renderActiveTab();
    requestAnimationFrame(() => $('#professionalScreen')?.focus({ preventScroll: true }));
  }

  injectInterface();
  renderProfessionalProgress();
  $('#clearProfessionalData')?.addEventListener('click', clearProfessionalData);
  $('#professionalShortcut')?.addEventListener('click', () => openProfessional('techniques'));
  $('#mobileProfessional')?.addEventListener('click', () => openProfessional('techniques'));
  $$('[data-professional-tab]').forEach(button => button.addEventListener('click', () => {
    activeTab = button.dataset.professionalTab;
    renderActiveTab();
  }));
  $('.professional-tabs')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = $$('[data-professional-tab]');
    const current = Math.max(0, tabs.indexOf(document.activeElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : event.key === 'ArrowRight' ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  });
  $('#professionalScreen [data-go="menu"]')?.addEventListener('click', () => window.show?.('menu'));
  window.ProfessionalLearning = { open: openProfessional, getProgress: () => JSON.parse(JSON.stringify(state)) };
})();
