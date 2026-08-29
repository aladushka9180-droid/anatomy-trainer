(() => {
  'use strict';

  const STORAGE_KEY = 'anatomy_professional_learning_v1';
  const techniques = Array.isArray(window.MASSAGE_TECHNIQUES) ? window.MASSAGE_TECHNIQUES : [];
  const curriculum = window.PRACTICE_CURRICULUM && typeof window.PRACTICE_CURRICULUM === 'object'
    ? window.PRACTICE_CURRICULUM
    : {};
  const techniqueSources = Array.isArray(window.TECHNIQUE_SOURCES) ? window.TECHNIQUE_SOURCES : [];
  const LESSON_PLAYLIST_ID = 'PL0QWH2rvIdsjtNyejciphmxdJR2PhS5I0';
  const TECHNIQUE_LESSONS = Object.freeze({
    effleurage: Object.freeze({ videoId: 'CZabcOzYZBI', index: 1, title: 'Поглаживание', duration: '7:59' }),
    friction: Object.freeze({ videoId: 'wdyDpeUqUpc', index: 3, title: 'Растирание', duration: '7:40' }),
    petrissage: Object.freeze({ videoId: 'VrpDK1aRBN0', index: 4, title: 'Разминание', duration: '11:05' }),
    vibration: Object.freeze({ videoId: 'ZuDxo4LRQPM', index: 5, title: 'Вибрация', duration: '6:23' })
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
  const levelLabel = value => LEVEL_LABELS[value] || value || '';
  const regionLabel = value => REGION_LABELS[value] || value || '';
  const textRows = value => {
    if (Array.isArray(value)) return value.flatMap(textRows).filter(Boolean);
    if (value && typeof value === 'object') {
      const direct = first(value, ['text', 'label', 'title', 'description']);
      if (direct) return [String(direct)];
      return Object.entries(value).map(([key, row]) => `${key === 'pressure' ? 'Давление' : key === 'tempo' ? 'Темп' : key === 'duration' ? 'Длительность' : key}: ${row}`);
    }
    return value ? [String(value)] : [];
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

  function lessonWatchUrl(lesson) {
    return `https://www.youtube.com/watch?v=${lesson.videoId}&list=${LESSON_PLAYLIST_ID}&index=${lesson.index}`;
  }

  function lessonCard(lesson, compact = false) {
    const title = `${lesson.title}. Уроки классического массажа`;
    return `<article class="video-lesson-card ${compact ? 'compact' : ''}">
      <a class="video-poster" href="${esc(lessonWatchUrl(lesson))}" target="_blank" rel="noopener noreferrer" aria-label="Смотреть на YouTube: ${esc(title)}">
        <img src="https://i.ytimg.com/vi/${esc(lesson.videoId)}/hqdefault.jpg" alt="Обложка видеоурока «${esc(lesson.title)}»" loading="lazy" decoding="async">
        <span class="video-play" aria-hidden="true">▶</span><span class="video-duration">${esc(lesson.duration)}</span>
      </a>
      <div class="video-lesson-copy"><h4>${esc(lesson.title)}</h4><p>${compact ? 'Наглядный показ базового приёма.' : 'Сначала посмотри движение целиком, затем повторяй медленно под наблюдением преподавателя или подготовленного партнёра.'}</p>
        <a href="${esc(lessonWatchUrl(lesson))}" target="_blank" rel="noopener noreferrer">Открыть на YouTube</a>
      </div>
    </article>`;
  }

  function techniqueLesson(item) {
    const lesson = TECHNIQUE_LESSONS[item.id];
    if (!lesson) return '';
    return `<section class="technique-media" aria-labelledby="techniqueVideoTitle"><div class="technique-media-head"><div><span class="eyebrow">Наглядный урок</span><h4 id="techniqueVideoTitle">Посмотри технику перед отработкой</h4></div><a href="https://www.youtube.com/playlist?list=${LESSON_PLAYLIST_ID}" target="_blank" rel="noopener noreferrer">Весь плейлист</a></div>${lessonCard(lesson)}<p class="video-safety-note"><b>Важно:</b> видео помогает увидеть движение, но не заменяет очный показ, коррекцию рук и проверку противопоказаний.</p></section>`;
  }

  function lessonLibrary() {
    return `<section class="video-library" aria-labelledby="videoLibraryTitle"><div class="video-library-head"><div><span class="eyebrow">Видео и наглядные примеры</span><h3 id="videoLibraryTitle">Базовые приёмы классического массажа</h3><p>Выбери приём: на обложке видно положение рук, а видео откроется на YouTube — на телефоне его можно смотреть в приложении.</p></div><a class="btn secondary" href="https://www.youtube.com/playlist?list=${LESSON_PLAYLIST_ID}" target="_blank" rel="noopener noreferrer">Все уроки на YouTube</a></div><div class="video-lesson-grid">${Object.values(TECHNIQUE_LESSONS).map(lesson => lessonCard(lesson, true)).join('')}</div><p class="video-safety-note"><b>Учебный порядок:</b> посмотри → назови цель и стоп-сигналы → повтори медленно → попроси обратную связь. Не копируй силу воздействия без очного обучения.</p></section>`;
  }

  function defaultState() {
    return { techniqueChecks: {}, checklistChecks: {}, scenarios: {}, journal: [] };
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
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!isRecord(saved)) return defaultState();
      return {
        techniqueChecks: normalizedChecks(saved.techniqueChecks),
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
  let journalMessage = '';

  function saveState() {
    let saved = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
        details.open = !details.open;
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
          <div><span class="eyebrow">Практические навыки</span><h2 id="professionalTitle">От знания к уверенной работе руками</h2><p>Приёмы, практические чек-листы, разбор ситуаций и журнал отработки. Материал не заменяет очное обучение, не присваивает квалификацию и не даёт допуска к медицинской деятельности.</p></div>
          <button type="button" class="btn secondary" data-go="menu">Готово</button>
        </div>
        <div id="professionalProgress" class="professional-progress" aria-label="Прогресс практических навыков"></div>
        <nav class="professional-tabs" role="tablist" aria-label="Разделы практического обучения">
          <button type="button" id="professionalTabTechniques" class="active" data-professional-tab="techniques" role="tab" aria-controls="professionalContent" aria-selected="true" tabindex="0">Приёмы</button>
          <button type="button" id="professionalTabPractice" data-professional-tab="practice" role="tab" aria-controls="professionalContent" aria-selected="false" tabindex="-1">Отработка</button>
          <button type="button" id="professionalTabJournal" data-professional-tab="journal" role="tab" aria-controls="professionalContent" aria-selected="false" tabindex="-1">Журнал</button>
          <button type="button" id="professionalTabMyths" data-professional-tab="myths" role="tab" aria-controls="professionalContent" aria-selected="false" tabindex="-1">Миф или факт</button>
        </nav>
        <div id="professionalContent" role="tabpanel" aria-labelledby="professionalTabTechniques" tabindex="0"></div>
      </section>`);
  }

  function renderProfessionalProgress() {
    const host = $('#professionalProgress');
    if (!host) return;
    const techniqueTotal = techniques.reduce((sum, item) => sum + techniqueChecklist(item).length, 0);
    const techniqueDone = techniques.reduce((sum, item) => {
      const rows = state.techniqueChecks[item.id] || {};
      return sum + techniqueChecklist(item).filter((_, index) => rows[index] === true).length;
    }, 0);
    const checklistTotal = allChecklists().reduce((sum, item) => sum + list(first(item, ['steps', 'checklist', 'items'])).length, 0);
    const checklistDone = allChecklists().reduce((sum, item) => {
      const rows = state.checklistChecks[item.id] || {};
      const steps = list(first(item, ['steps', 'checklist', 'items']));
      return sum + steps.filter((_, index) => rows[index] === true).length;
    }, 0);
    const scenarios = allScenarios();
    const scenariosDone = scenarios.filter(item => {
      const progress = state.scenarios[item.id];
      return progress?.reviewed === true && scenarioCanComplete(item, progress);
    }).length;
    const totalScenarios = scenarios.length;
    const techniquesReady = techniques.filter(item => {
      const steps = techniqueChecklist(item);
      const checked = state.techniqueChecks[item.id] || {};
      return steps.length > 0 && steps.every((_, index) => checked[index] === true);
    }).length;
    const checklistsReady = allChecklists().filter(item => {
      const steps = list(first(item, ['steps', 'checklist', 'items']));
      const checked = state.checklistChecks[item.id] || {};
      const required = Number(first(first(item, ['pass'], {}), ['requiredSteps'], steps.length));
      return steps.filter((_, index) => checked[index] === true).length >= required;
    }).length;
    const competencyLevels = list(first(curriculum, ['competencyLevels']));
    host.innerHTML = `
      <div><span>Приёмы с отмеченными чек-листами</span><strong>${techniquesReady}/${techniques.length}</strong><small>Отмечено шагов: ${techniqueDone}/${techniqueTotal}</small></div>
      <div><span>Чек-листы по областям тела</span><strong>${checklistsReady}/${allChecklists().length}</strong><small>Отмечено шагов: ${checklistDone}/${checklistTotal}</small></div>
      <div><span>Разобранные ситуации</span><strong>${scenariosDone}/${totalScenarios}</strong><small>Записей в журнале: ${state.journal.length}</small></div>
      <div class="competency-route"><b>Маршрут освоения:</b>${competencyLevels.length
        ? competencyLevels.map((level, index) => `<span><i>${index + 1}</i>${esc(first(level, ['title']))}</span>`).join('')
        : '<span><i>1</i>Знаю</span><span><i>2</i>Объясняю</span><span><i>3</i>Показываю</span><span><i>4</i>Проверено</span>'}</div>
      <p><b>Важно:</b> отметки в приложении показывают выполненную тренировку, а не подтверждённое владение приёмом. Уровень «Проверено» может отметить только квалифицированный преподаватель после очной демонстрации.</p>`;
  }

  function renderTechniques() {
    const host = $('#professionalContent');
    if (!techniques.length) {
      host.innerHTML = '<div class="empty-state"><h3>Библиотека приёмов готовится</h3><p>Данные будут доступны после обновления учебного пакета.</p></div>';
      return;
    }
    if (!techniques.some(item => item.id === activeTechnique)) activeTechnique = techniques[0].id;
    const item = techniques.find(row => row.id === activeTechnique) || techniques[0];
    const checklist = techniqueChecklist(item);
    const checked = state.techniqueChecks[item.id] || {};
    const fields = [
      ['Цель приёма', first(item, ['goal', 'purpose', 'summary'])],
      ['Положение клиента', first(item, ['clientPosition', 'startingPosition', 'startPosition', 'position'])],
      ['Положение рук', first(item, ['handPosition', 'hands'])],
      ['Направление движения', first(item, ['direction', 'movementDirection'])],
      ['Глубина и слой тканей', first(item, ['tissueLayer', 'layer'])],
      ['Давление, темп и длительность', first(item, ['dose', 'pressureTempoDuration', 'pressure'])],
      ['Нормальные ощущения', first(item, ['normalSensations', 'expectedSensations'])]
    ].filter(([, value]) => textRows(value).length);
    host.innerHTML = `
      <div class="technique-layout">
        <label class="technique-picker"><span>Выбери приём</span><select id="techniquePicker">
          ${techniques.map(row => `<option value="${esc(row.id)}" ${row.id === item.id ? 'selected' : ''}>${esc(first(row, ['title', 'name']))}</option>`).join('')}
        </select></label>
        <aside class="technique-list" aria-label="Список массажных приёмов">
          ${techniques.map(row => `<button type="button" data-technique-id="${esc(row.id)}" class="${row.id === item.id ? 'active' : ''}" aria-pressed="${row.id === item.id}"><strong>${esc(first(row, ['title', 'name']))}</strong><span>${esc(first(row, ['level', 'difficulty'], 'Базовый уровень'))}</span></button>`).join('')}
        </aside>
        <article class="technique-detail">
          <span class="eyebrow">${esc(first(item, ['level', 'difficulty'], 'Базовый уровень'))}</span>
          <h3>${esc(first(item, ['title', 'name']))}</h3>
          <p class="lead">${esc(first(item, ['summary', 'description', 'goal']))}</p>
          ${techniqueLesson(item)}
          <div class="skill-facts">${fields.map(([title, value]) => { const rows = textRows(value); return `<section><h4>${esc(title)}</h4>${rows.length > 1 ? `<ul>${rows.map(v => `<li>${esc(v)}</li>`).join('')}</ul>` : `<p>${esc(rows[0])}</p>`}</section>`; }).join('')}</div>
          ${titledList('Стоп-сигналы', first(item, ['stopSignals', 'stopSigns', 'redFlags']), 'warning')}
          ${titledList('Где требуется осторожность', first(item, ['limitations', 'restrictedAreas', 'restrictedZones', 'contraindications']), 'caution')}
          ${titledList('Частые ошибки', first(item, ['commonMistakes', 'mistakes']))}
          ${titledList('Профессиональные подсказки', first(item, ['tips', 'professionalTips', 'proTips']))}
          <section class="practice-checklist"><h4>Практический чек-лист</h4><p>Отмечай пункт только после реальной отработки на учебном партнёре.</p>
            ${checklist.map((step, index) => `<label><input type="checkbox" data-technique-check="${index}" ${checked[index] === true ? 'checked' : ''}><span>${esc(typeof step === 'string' ? step : first(step, ['text', 'label', 'title']))}</span></label>`).join('')}
            <div class="practice-ready technique-next-step ${checklist.length && checklist.every((_, index) => checked[index] === true) ? '' : 'hidden'}"><strong>Все пункты самостоятельной отработки отмечены.</strong><span>Следующий шаг — повторить приём в другой день и показать преподавателю очно.</span></div>
          </section>
          <p class="source-note">Проверка материала: ${esc(first(item, ['reviewDate', 'checkedAt', 'reviewedAt'], curriculum.reviewDate || '2026-08-29'))}. Практику выполняют только в пределах своей подготовки и компетенции.</p>
          ${techniqueSourceDetails(item)}
        </article>
      </div>`;
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
      const complete = $$('[data-technique-check]').length > 0 && $$('[data-technique-check]').every(row => row.checked);
      $('.technique-next-step')?.classList.toggle('hidden', !complete);
    }));
  }

  function renderChecklistCards() {
    const rows = allChecklists();
    if (!rows.length) return '<div class="empty-state"><p>Практические чек-листы готовятся.</p></div>';
    return `<div class="checklist-grid">${rows.map(item => {
      const id = first(item, ['id'], uid('checklist'));
      const steps = list(first(item, ['steps', 'checklist', 'items']));
      const checked = state.checklistChecks[id] || {};
      const completed = steps.filter((_, index) => checked[index] === true).length;
      const pass = first(item, ['pass'], {});
      const required = Number(first(pass, ['requiredSteps'], steps.length));
      const ready = completed >= required;
      const metadata = [regionLabel(first(item, ['regionId', 'region'])), levelLabel(first(item, ['level']))].filter(Boolean).join(' · ');
      return `<details class="practice-card" data-required-steps="${required}"><summary><span><strong>${esc(first(item, ['title', 'name']))}</strong><small>${esc(metadata)}</small></span><b>${ready ? 'Готов к показу' : `${completed}/${required}`}</b></summary>
        <div class="practice-card-body">
          ${first(item, ['purpose', 'goal']) ? `<p>${esc(first(item, ['purpose', 'goal']))}</p>` : ''}
          ${titledList('Перед началом', first(item, ['prerequisites']), 'prerequisites')}
          <p class="pass-rule"><b>Для самостоятельной отработки:</b> выполни ${required} обязательных шагов из ${steps.length}; критических ошибок — не более ${esc(first(pass, ['criticalErrorsAllowed'], 0))}.</p>
          ${steps.map((step, index) => `<label class="practice-step ${typeof step === 'object' && step.critical ? 'critical-step' : ''}"><input type="checkbox" data-checklist-id="${esc(id)}" data-checklist-step="${index}" ${checked[index] === true ? 'checked' : ''}><span>${esc(typeof step === 'string' ? step : first(step, ['text', 'label', 'title']))}${typeof step === 'object' && step.critical ? '<small>Критически важный шаг</small>' : ''}</span></label>`).join('')}
          ${titledList('Критические ошибки', first(item, ['criticalErrors', 'stopErrors'], criticalErrorsFor(item)), 'warning')}
          <div class="practice-ready checklist-next-step ${ready ? '' : 'hidden'}"><strong>Все обязательные пункты чек-листа отмечены.</strong><span>Это не допуск к самостоятельной работе: покажи весь чек-лист преподавателю без подсказок.</span></div>
        </div></details>`;
    }).join('')}</div>`;
  }

  function renderScenarioCards() {
    const rows = allScenarios();
    if (!rows.length) return '<div class="empty-state"><p>Сценарии построения сеанса готовятся.</p></div>';
    return `<div class="scenario-grid">${rows.map(item => {
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
      return `<article class="scenario-card">
        <span class="eyebrow">${esc(metadata)}</span>
        <h3>${esc(first(item, ['title', 'name']))}</h3>
        <p>${esc(first(item, ['situation', 'description', 'case', 'brief']))}</p>
        ${titledList('Продумай перед открытием разбора', first(item, ['questions', 'prompts', 'tasks', 'task']))}
        <label class="scenario-draft"><span>Сначала запиши своё решение</span><textarea data-scenario-draft="${esc(id)}" maxlength="1200" placeholder="Какие вопросы задашь, что сделаешь по порядку, когда остановишься?">${esc(draft)}</textarea><small data-scenario-draft-note="${esc(id)}">${canReveal ? 'Ответ сохранён. Теперь можно сравнить его с разбором.' : 'Нужно не менее 20 знаков: попытка вспомнить ответ важнее простого чтения.'}</small></label>
        <button type="button" class="btn secondary" data-reveal-scenario="${esc(id)}" aria-expanded="${progress.open ? 'true' : 'false'}" ${canReveal ? '' : 'disabled'}>${progress.open ? 'Скрыть разбор' : 'Сравнить с учебным разбором'}</button>
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
      </article>`;
    }).join('')}</div>`;
  }

  function renderPractice() {
    const host = $('#professionalContent');
    host.innerHTML = `
      ${lessonLibrary()}
      <div class="practice-switch" role="group" aria-label="Вид практической отработки">
        <button type="button" data-practice-mode="checklists" class="${practiceMode === 'checklists' ? 'active' : ''}" aria-pressed="${practiceMode === 'checklists'}">Чек-листы по областям</button>
        <button type="button" data-practice-mode="scenarios" class="${practiceMode === 'scenarios' ? 'active' : ''}" aria-pressed="${practiceMode === 'scenarios'}">Построение сеанса</button>
      </div>
      <aside class="practice-method"><b>${practiceMode === 'checklists' ? 'Как отрабатывать навык' : 'Как разбирать ситуацию'}</b><span>${practiceMode === 'checklists'
        ? 'Подготовься → выполни без подсказок → отметь шаги → получи обратную связь → повтори в другой день.'
        : 'Сначала сформулируй решение по памяти → затем открой разбор → найди пропуски и критические ошибки → объясни исправленный план.'}</span></aside>
      ${practiceMode === 'checklists' ? renderChecklistCards() : renderScenarioCards()}`;
    wireDetails('details.practice-card');
    $$('[data-practice-mode]').forEach(button => button.addEventListener('click', () => {
      practiceMode = button.dataset.practiceMode;
      renderPractice();
      requestAnimationFrame(() => $(`[data-practice-mode="${practiceMode}"]`)?.focus());
    }));
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
        <form id="practiceJournalForm" class="journal-form" autocomplete="off" aria-describedby="journalPrivacyNote">
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
          <button class="btn primary" type="submit">Сохранить запись</button>
        </form>
        <section class="journal-history"><h3>История отработки</h3><p id="journalStatus" class="journal-status ${journalMessage ? '' : 'hidden'}" role="status" aria-live="polite">${esc(journalMessage)}</p><div id="journalEntries"></div>
          <div class="practice-data-control"><h4>Данные практики на этом устройстве</h4><p>Здесь можно удалить журнал, отметки чек-листов и ответы на практические ситуации. Учебный прогресс из основного тренажёра не изменится.</p><button type="button" id="clearProfessionalData" class="btn danger">Удалить все данные практики</button></div>
        </section>
      </div>`;
    renderJournalEntries();
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
      renderJournal();
    });
    $('#clearProfessionalData')?.addEventListener('click', () => {
      if (!confirm('Удалить журнал, отметки чек-листов и ответы на практические ситуации с этого устройства? Это действие нельзя отменить.')) return;
      try {
        localStorage.removeItem(STORAGE_KEY);
        state = defaultState();
        journalMessage = 'Все данные практики удалены с этого устройства.';
        renderProfessionalProgress();
        renderJournal();
      } catch (error) {
        console.warn('Не удалось удалить данные практического обучения.', error);
        journalMessage = 'Не удалось удалить данные из хранилища браузера. Проверь настройки хранения данных.';
        renderJournal();
      }
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

  function renderMyths() {
    const host = $('#professionalContent');
    const tips = allTips();
    host.innerHTML = `
      <section class="myth-intro"><h3>Научное мышление и безопасные формулировки</h3><p>Задача массажиста — наблюдать реакцию человека, честно описывать границы метода и не подменять врача.</p></section>
      <div class="myth-grid">${allMyths().map(item => {
        const source = safeUrl(first(item, ['sourceUrl', 'url']));
        return `<details class="myth-card"><summary>${esc(first(item, ['myth', 'claim', 'title']))}</summary><div><span class="fact-label">${esc(first(item, ['verdict'], 'Разбор'))}</span><p>${esc(first(item, ['fact', 'explanation', 'answer']))}</p>${source !== '#' ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Источник</a>` : ''}</div></details>`;
      }).join('')}</div>
      ${tips.length ? `<section class="tips-section"><h3>Профессиональные подсказки</h3><div class="tips-grid">${tips.map(item => {
        const level = first(item, ['level', 'risk', 'type'], 'green');
        const label = level === 'red' ? 'Опасная ошибка' : level === 'yellow' ? 'Только после обучения' : 'Безопасная привычка';
        return `<article class="tip-card ${esc(level)}"><span>${esc(label)}</span><p>${esc(first(item, ['text', 'tip', 'description', 'title']))}</p></article>`;
      }).join('')}</div></section>` : ''}`;
    wireDetails('details.myth-card');
  }

  function renderActiveTab() {
    $$('[data-professional-tab]').forEach(button => {
      const active = button.dataset.professionalTab === activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const activeButton = $(`[data-professional-tab="${activeTab}"]`);
    $('#professionalContent')?.setAttribute('aria-labelledby', activeButton?.id || 'professionalTabTechniques');
    if (activeTab === 'techniques') renderTechniques();
    else if (activeTab === 'practice') renderPractice();
    else if (activeTab === 'journal') renderJournal();
    else renderMyths();
  }

  function openProfessional(tab = 'techniques') {
    activeTab = ['techniques', 'practice', 'journal', 'myths'].includes(tab) ? tab : 'techniques';
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
