/* Local, typo-tolerant settings search with optional browser speech input. */
(() => {
  const panel = document.querySelector('[data-provider-panel="settings"]');
  const nav = panel?.querySelector('.provider-section-nav');
  if (!panel || !nav || panel.querySelector('.settings-smart-search')) return;

  const SECTION_META = Object.freeze({
    appearanceSettingsCard:{ aliases:'оформление дизайн внешний вид цвет тема фон стиль структура интерфейс размер шрифт текст карточка запись анимация переход меню навигация вкладка', companions:[] },
    telegramClientSettingsCard:{ aliases:'уведомления сообщение телеграм telegram телега бот связь клиент посетитель сайта звук сигнал', companions:['visitorAlertSettingsCard'] },
    installAppCard:{ aliases:'приложение установить установка pwa ярлык рабочий стол главный экран полный экран fullscreen', companions:[] },
    bookingRulesCard:{ aliases:'правила онлайн запись отмена перенос предоплата депозит завершение визит календарь команда смена групповой сеанс', companions:['teamCalendarSettingsCard','groupBookingSettingsCard'] },
    batchBookingSettingsCard:{ aliases:'пакет пакетные несколько даты серия повторные записи лимит', companions:[] },
    subscriptionSettingsCard:{ aliases:'тариф подписка цена стоимость оплата месяц год специалисты филиалы пробный период бонус', companions:[] },
    dataGovernanceCard:{ aliases:'данные документы хранение скачать экспорт выгрузка удалить удаление очистка конфиденциальность политика резервная копия восстановление', companions:[] },
    accountSettingsCard:{ aliases:'безопасность аккаунт профиль пароль логин вход телефон sms код telegram vk вконтакте яндекс привязать восстановить доступ', companions:[] }
  });
  const STOP_WORDS = new Set('а без бы в вам вас весь где для до его ее ещё же за и из или как кабинет кабинета ли мне мой на не но о от по при про с со что чтобы это я хочу хотим нужно надо можно найти покажи показать посмотреть смотреть открыть перейти поменять изменить настроить включить выключить отключить убрать добавить создать сделать настройка настройки параметр параметры'.split(' '));
  const EN_LAYOUT = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,.';
  const RU_LAYOUT = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
  const search = document.createElement('section');
  search.className = 'settings-smart-search';
  search.setAttribute('aria-label', 'Поиск по настройкам');
  search.innerHTML = `<div class="settings-search-field"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-search"></use></svg><label><span class="sr-only">Найти настройку</span><input id="settingsSearchInput" type="search" inputmode="search" autocomplete="off" maxlength="160" placeholder="Например: отключить предоплату" role="combobox" aria-autocomplete="list" aria-controls="settingsSearchResults" aria-expanded="false"></label><button class="settings-search-clear" type="button" aria-label="Очистить поиск" hidden><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-close"></use></svg></button><button class="settings-search-voice" type="button" aria-label="Найти настройку голосом" aria-pressed="false"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-microphone"></use></svg></button></div><div class="settings-search-results" id="settingsSearchResults" role="listbox" hidden></div><p class="settings-search-status" role="status" aria-live="polite">Можно написать обычной фразой — поиск понимает опечатки.</p>`;
  (nav.parentElement.classList.contains('settings-nav-scroll-shell') ? nav.parentElement : nav).before(search);

  const input = search.querySelector('input');
  const results = search.querySelector('.settings-search-results');
  const status = search.querySelector('.settings-search-status');
  const clearButton = search.querySelector('.settings-search-clear');
  const voiceButton = search.querySelector('.settings-search-voice');
  let renderedResults = [];
  let selectedResult = -1;
  let recognition = null;
  let recognitionTimer = null;
  let voiceTranscript = '';
  let voiceResultRendered = false;
  let highlightTimer = null;

  function normalize(value) {
    return String(value || '').normalize('NFKD').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function swapKeyboardLayout(value) {
    return String(value || '').toLocaleLowerCase('ru-RU').split('').map(char => {
      const index = EN_LAYOUT.indexOf(char);
      return index >= 0 ? RU_LAYOUT[index] : char;
    }).join('');
  }

  function queryVariants(value) {
    const original = normalize(value);
    const variants = [original];
    if (/[a-z]/.test(original) && !/[а-я]/.test(original)) variants.push(normalize(swapKeyboardLayout(original)));
    return [...new Set(variants.filter(Boolean))];
  }

  function usefulTokens(value) {
    const tokens = normalize(value).split(' ').filter(Boolean);
    const useful = tokens.filter(token => !STOP_WORDS.has(token));
    return useful.length ? useful : tokens;
  }

  function damerauDistance(left, right, limit = 2) {
    if (Math.abs(left.length - right.length) > limit) return limit + 1;
    const rows = Array.from({ length:left.length + 1 }, () => new Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
    for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
    for (let i = 1; i <= left.length; i += 1) {
      let rowBest = limit + 1;
      for (let j = 1; j <= right.length; j += 1) {
        const cost = left[i - 1] === right[j - 1] ? 0 : 1;
        rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
        rowBest = Math.min(rowBest, rows[i][j]);
      }
      if (rowBest > limit) return limit + 1;
    }
    return rows[left.length][right.length];
  }

  function tokenScore(token, words) {
    let best = 0;
    for (const word of words) {
      if (word === token) return 28;
      if (Math.min(word.length, token.length) >= 4 && (word.startsWith(token) || token.startsWith(word))) best = Math.max(best, 22);
      const allowed = token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
      if (allowed && damerauDistance(token, word, allowed) <= allowed) best = Math.max(best, 18 - allowed);
    }
    return best;
  }

  function directText(element) {
    const preferred = element.querySelector?.(':scope > strong, :scope > span > strong, :scope > div > strong');
    if (preferred?.textContent.trim()) return preferred.textContent.trim();
    const direct = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).filter(Boolean).join(' ');
    return (direct || element.getAttribute?.('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function sectionElements(targetId, meta) {
    const target = document.getElementById(targetId);
    const elements = target ? [target] : [];
    if (target?.classList.contains('provider-section-marker') && target.nextElementSibling) elements.push(target.nextElementSibling);
    for (const id of meta.companions || []) {
      const companion = document.getElementById(id);
      if (companion && !companion.hidden) elements.push(companion);
    }
    return [...new Set(elements)];
  }

  function focusableElement(element) {
    if (!element) return null;
    if (element.matches('input,select,textarea,button,a,summary')) return element;
    if (element.matches('label')) {
      if (element.htmlFor) return document.getElementById(element.htmlFor) || element;
      return element.querySelector('input,select,textarea,button') || element;
    }
    return element.closest('details')?.querySelector('summary') || element.closest('.settings-card') || element;
  }

  function buildIndex() {
    const records = [];
    for (const button of nav.querySelectorAll('[data-section-target]')) {
      if (button.hidden) continue;
      const targetId = button.dataset.sectionTarget;
      const meta = SECTION_META[targetId] || { aliases:'', companions:[] };
      const roots = sectionElements(targetId, meta);
      if (!roots.length) continue;
      const sectionTitle = button.textContent.replace(/\s+/g, ' ').trim();
      const sectionText = roots.map(root => root.textContent).join(' ');
      const sectionElement = roots.find(root => !root.classList.contains('provider-section-marker')) || roots[0];
      records.push({ targetId, sectionTitle, label:sectionTitle, description:'Открыть раздел настроек', element:focusableElement(sectionElement), corpus:normalize(`${sectionTitle} ${sectionText} ${meta.aliases}`), type:'section' });
      const seen = new Set();
      for (const root of roots) {
        for (const element of root.querySelectorAll('h3,legend,label,summary,button,a.settings-help-link')) {
          if (element.closest('[hidden]') || element.matches('[data-section-target]')) continue;
          const label = directText(element).slice(0, 100);
          const normalizedLabel = normalize(label);
          if (label.length < 3 || seen.has(normalizedLabel)) continue;
          seen.add(normalizedLabel);
          const context = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 260);
          records.push({ targetId, sectionTitle, label, description:context === label ? '' : context, element:focusableElement(element), corpus:normalize(`${label} ${context} ${sectionTitle}`), type:'item' });
        }
      }
    }
    return records;
  }

  function recordScore(record, query) {
    const tokens = usefulTokens(query);
    const words = record.corpus.split(' ').filter(Boolean);
    const tokenScores = tokens.map(token => tokenScore(token, words));
    const matched = tokenScores.filter(Boolean).length;
    if (!matched || matched / tokens.length < 0.6) return 0;
    const phrase = normalize(query);
    return tokenScores.reduce((sum, score) => sum + score, 0)
      + (phrase.length >= 3 && record.corpus.includes(phrase) ? 48 : 0)
      + (record.type === 'item' ? 14 : 0)
      + Math.round((matched / tokens.length) * 12);
  }

  function findSettings(value) {
    const records = buildIndex();
    const variants = queryVariants(value);
    const ranked = records.map(record => ({ ...record, score:Math.max(...variants.map(query => recordScore(record, query))) }))
      .filter(record => record.score > 0)
      .sort((left, right) => right.score - left.score || (left.type === right.type ? 0 : left.type === 'item' ? -1 : 1) || left.label.localeCompare(right.label, 'ru'));
    const unique = [];
    const keys = new Set();
    for (const record of ranked) {
      const key = `${record.targetId}:${normalize(record.label)}`;
      if (keys.has(key)) continue;
      keys.add(key);
      unique.push(record);
      if (unique.length === 6) break;
    }
    return unique;
  }

  function closeResults() {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    selectedResult = -1;
  }

  function setSelectedResult(index) {
    if (!renderedResults.length) return;
    selectedResult = (index + renderedResults.length) % renderedResults.length;
    [...results.querySelectorAll('button')].forEach((button, buttonIndex) => {
      const selected = buttonIndex === selectedResult;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      if (selected) input.setAttribute('aria-activedescendant', button.id);
    });
  }

  function showResult(record) {
    const sectionButton = [...nav.querySelectorAll('[data-section-target]')].find(button => button.dataset.sectionTarget === record.targetId && !button.hidden);
    if (!sectionButton) return;
    sectionButton.click();
    closeResults();
    clearTimeout(highlightTimer);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = record.element || document.getElementById(record.targetId);
      if (!target) return;
      for (let details = target.closest('details'); details; details = details.parentElement?.closest('details')) details.open = true;
      target.classList.add('settings-search-highlight');
      target.scrollIntoView({ behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'center' });
      if (!target.matches('input,select,textarea,button,a,summary')) target.setAttribute('tabindex', '-1');
      target.focus?.({ preventScroll:true });
      highlightTimer = setTimeout(() => target.classList.remove('settings-search-highlight'), 2600);
      status.textContent = `Открыто: ${record.sectionTitle}${record.label !== record.sectionTitle ? ` → ${record.label}` : ''}.`;
    }));
  }

  function renderSearch(value = input.value) {
    const query = value.trim();
    clearButton.hidden = !query;
    results.replaceChildren();
    renderedResults = [];
    selectedResult = -1;
    if (query.length < 2) {
      closeResults();
      status.textContent = query ? 'Введите ещё один символ.' : 'Можно написать обычной фразой — поиск понимает опечатки.';
      return 0;
    }
    renderedResults = findSettings(query);
    if (!renderedResults.length) {
      closeResults();
      status.textContent = 'Точного совпадения нет. Попробуйте назвать действие или функцию, например «предоплата» или «пароль».';
      return 0;
    }
    renderedResults.forEach((record, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `settingsSearchResult${index}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      const path = document.createElement('small');
      path.textContent = record.sectionTitle;
      const title = document.createElement('strong');
      title.textContent = record.label;
      const description = document.createElement('span');
      description.textContent = record.description || 'Открыть эту настройку';
      button.append(path, title, description);
      button.addEventListener('click', () => showResult(record));
      results.append(button);
    });
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    status.textContent = `Найдено вариантов: ${renderedResults.length}.`;
    return renderedResults.length;
  }

  function directRecognitionSupported(Recognition) {
    if (!Recognition) return false;
    const userAgent = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/i.test(userAgent) || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1);
    const iosAlternativeBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA/i.test(userAgent);
    const homeScreen = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const androidWebView = /Android/i.test(userAgent) && /(?:;\s*wv\)|Version\/\d[^\s]*\s+Chrome\/)/i.test(userAgent);
    return !(ios && (homeScreen || iosAlternativeBrowser)) && !androidWebView;
  }

  function setListening(listening) {
    voiceButton.classList.toggle('is-listening', listening);
    voiceButton.setAttribute('aria-pressed', String(listening));
    voiceButton.setAttribute('aria-label', listening ? 'Остановить голосовой поиск' : 'Найти настройку голосом');
  }

  function stopRecognition() {
    clearTimeout(recognitionTimer);
    recognitionTimer = null;
    try { recognition?.stop(); } catch {}
  }

  function startVoiceSearch() {
    if (recognition) { stopRecognition(); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const touchDevice = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    const supported = window.MinutaVoiceAssistant?.supportsDirectRecognition
      ? window.MinutaVoiceAssistant.supportsDirectRecognition(Recognition, navigator, matchMedia('(display-mode: standalone)').matches)
      : directRecognitionSupported(Recognition);
    if (!supported) {
      status.textContent = touchDevice ? 'Открыта клавиатура. Нажмите значок микрофона на ней и продиктуйте запрос.' : 'Этот браузер не поддерживает голосовой поиск. Введите запрос текстом.';
      input.focus();
      return;
    }
    try { recognition = new Recognition(); }
    catch { status.textContent = 'Не удалось запустить микрофон. Введите запрос текстом.'; return; }
    recognition.lang = 'ru-RU';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    voiceTranscript = '';
    voiceResultRendered = false;
    recognition.onstart = () => {
      setListening(true);
      status.textContent = 'Слушаю… Назовите настройку или действие.';
      recognitionTimer = setTimeout(() => { stopRecognition(); status.textContent = 'Речь не получена. Попробуйте ещё раз или введите запрос текстом.'; }, 15000);
    };
    recognition.onresult = event => {
      const transcript = Array.from(event.results || []).map(result => result[0]?.transcript || '').join(' ').replace(/\s+/g, ' ').trim();
      if (!transcript) return;
      voiceTranscript = transcript.slice(0, 160);
      input.value = transcript.slice(0, 160);
      if (Array.from(event.results || []).every(result => result.isFinal)) {
        const count = renderSearch(input.value);
        voiceResultRendered = true;
        status.textContent = count ? `Распознано: «${input.value}». Найдено вариантов: ${count}.` : `Распознано: «${input.value}», но точного совпадения нет.`;
      }
    };
    recognition.onerror = event => {
      const messages = { 'not-allowed':'Нет доступа к микрофону. Разрешите его в настройках браузера.', 'service-not-allowed':'Браузер запретил службу распознавания.', 'audio-capture':'Микрофон не найден или занят.', 'no-speech':'Речь не услышана. Попробуйте ещё раз.', network:'Служба распознавания сейчас недоступна.' };
      status.textContent = messages[event.error] || 'Не удалось распознать речь. Используйте текстовый поиск.';
    };
    recognition.onend = () => {
      clearTimeout(recognitionTimer);
      recognitionTimer = null;
      recognition = null;
      setListening(false);
      if (voiceTranscript && !voiceResultRendered) {
        input.value = voiceTranscript;
        const count = renderSearch(input.value);
        status.textContent = count ? `Распознано: «${input.value}». Найдено вариантов: ${count}.` : `Распознано: «${input.value}», но точного совпадения нет.`;
      }
    };
    try { recognition.start(); }
    catch { recognition = null; setListening(false); status.textContent = 'Микрофон уже используется. Попробуйте ещё раз.'; }
  }

  input.addEventListener('input', () => renderSearch());
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) renderSearch(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedResult(selectedResult + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedResult(selectedResult - 1); }
    else if (event.key === 'Enter' && renderedResults.length) { event.preventDefault(); showResult(renderedResults[selectedResult >= 0 ? selectedResult : 0]); }
    else if (event.key === 'Escape') { event.preventDefault(); closeResults(); }
  });
  clearButton.addEventListener('click', () => { input.value = ''; renderSearch(); input.focus(); });
  voiceButton.addEventListener('click', startVoiceSearch);
  document.addEventListener('pointerdown', event => { if (!search.contains(event.target)) closeResults(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && recognition) { try { recognition.abort(); } catch {} } });
  new MutationObserver(() => { if (panel.hidden && recognition) { try { recognition.abort(); } catch {} } }).observe(panel, { attributes:true, attributeFilter:['hidden'] });

  function initializeSectionsSearch() {
    const sectionsPanel = document.querySelector('[data-provider-panel="more"]');
    const grid = sectionsPanel?.querySelector('.mobile-more-grid');
    const intro = sectionsPanel?.querySelector('.mobile-more-intro');
    if (!sectionsPanel || !grid || !intro || sectionsPanel.querySelector('.cabinet-sections-search')) return null;

    const VIEW_ALIASES = Object.freeze({
      settings:'настройки кабинет тема стиль оформление интерфейс правила предоплата пароль подписка безопасность приложение',
      bookings:'записи запись визит календарь расписание создать прием сеанс клиент сегодня завтра',
      clients:'клиенты клиент карточка история контакты телефон заметки метки база',
      notifications:'уведомления сообщение сообщения шаблон whatsapp telegram телеграм рассылка напоминание',
      schedule:'график расписание рабочие часы время доступность перерыв выходной смена',
      services:'услуги услуга прайс цена стоимость длительность процедура сеанс',
      organization:'организация команда сотрудник специалист филиал ресурсы роли доступ выплаты зарплата склад товар',
      portfolio:'портфолио фото фотографии работа работы галерея примеры',
      analytics:'статистика отчет отчеты аналитика доход выручка визиты показатели экспорт',
      waitlist:'лист ожидания ожидание свободное окно занята дата заявка очередь',
      help:'база знаний помощь инструкция инструкции подсказка как сделать',
      feedback:'обратная связь помощь проблема ошибка баг предложение улучшение написать'
    });
    const search = document.createElement('section');
    search.className = 'settings-smart-search cabinet-sections-search';
    search.setAttribute('aria-label', 'Поиск по разделам кабинета');
    search.innerHTML = `<div class="settings-search-field"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-search"></use></svg><label><span class="sr-only">Найти раздел кабинета</span><input id="cabinetSectionsSearchInput" type="search" inputmode="search" autocomplete="off" maxlength="160" placeholder="Например: клиенты или рабочие часы" role="combobox" aria-autocomplete="list" aria-controls="cabinetSectionsSearchResults" aria-expanded="false"></label><button class="settings-search-clear" type="button" aria-label="Очистить поиск" hidden><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-close"></use></svg></button><button class="settings-search-voice" type="button" aria-label="Найти раздел голосом" aria-pressed="false"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-microphone"></use></svg></button></div><div class="settings-search-results" id="cabinetSectionsSearchResults" role="listbox" hidden></div><p class="settings-search-status" role="status" aria-live="polite">Можно искать по названию или описать, что вы хотите сделать.</p>`;
    intro.after(search);

    const sectionsInput = search.querySelector('input');
    const sectionsResults = search.querySelector('.settings-search-results');
    const sectionsStatus = search.querySelector('.settings-search-status');
    const sectionsClearButton = search.querySelector('.settings-search-clear');
    const sectionsVoiceButton = search.querySelector('.settings-search-voice');
    let sectionMatches = [];
    let selectedSection = -1;
    let sectionsRecognition = null;
    let sectionsRecognitionTimer = null;
    let sectionsTranscript = '';
    let sectionsVoiceRendered = false;

    function buildSectionsIndex() {
      return [...grid.querySelectorAll(':scope > button, :scope > a')].flatMap(element => {
        const view = element.dataset.providerView || (element.matches('.mobile-help-shortcut') ? 'help' : element.matches('[data-open-product-feedback]') ? 'feedback' : '');
        if (!view || (view === 'feedback' && element.hidden)) return [];
        const label = element.querySelector('strong')?.textContent.replace(/\s+/g, ' ').trim() || element.textContent.replace(/\s+/g, ' ').trim();
        const description = element.querySelector('small')?.textContent.replace(/\s+/g, ' ').trim() || 'Открыть раздел';
        return [{ view, label, description, element, type:'section', corpus:normalize(`${label} ${description} ${VIEW_ALIASES[view] || ''}`) }];
      });
    }

    function findSections(value) {
      const variants = queryVariants(value);
      const sectionScore = (record, query) => {
        const base = recordScore(record, query);
        if (!base) return 0;
        const labelWords = normalize(record.label).split(' ').filter(Boolean);
        const labelBoost = usefulTokens(query).reduce((sum, token) => sum + tokenScore(token, labelWords), 0);
        return base + labelBoost * 3;
      };
      return buildSectionsIndex().map(record => ({ ...record, score:Math.max(...variants.map(query => sectionScore(record, query))) }))
        .filter(record => record.score > 0)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, 'ru'))
        .slice(0, 6);
    }

    function closeSectionsResults() {
      sectionsResults.hidden = true;
      sectionsInput.setAttribute('aria-expanded', 'false');
      sectionsInput.removeAttribute('aria-activedescendant');
      selectedSection = -1;
    }

    function setSelectedSection(index) {
      if (!sectionMatches.length) return;
      selectedSection = (index + sectionMatches.length) % sectionMatches.length;
      [...sectionsResults.querySelectorAll('button')].forEach((button, buttonIndex) => {
        const selected = buttonIndex === selectedSection;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
        if (selected) sectionsInput.setAttribute('aria-activedescendant', button.id);
      });
    }

    function openSectionResult(record) {
      closeSectionsResults();
      sectionsStatus.textContent = `Открываем: ${record.label}.`;
      record.element.click();
    }

    function renderSectionsSearch(value = sectionsInput.value) {
      const query = value.trim();
      sectionsClearButton.hidden = !query;
      sectionsResults.replaceChildren();
      sectionMatches = [];
      selectedSection = -1;
      if (query.length < 2) {
        closeSectionsResults();
        sectionsStatus.textContent = query ? 'Введите ещё один символ.' : 'Можно искать по названию или описать, что вы хотите сделать.';
        return 0;
      }
      sectionMatches = findSections(query);
      if (!sectionMatches.length) {
        closeSectionsResults();
        sectionsStatus.textContent = 'Ничего похожего не найдено. Попробуйте назвать действие, например «посмотреть доход» или «добавить услугу».';
        return 0;
      }
      sectionMatches.forEach((record, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `cabinetSectionsSearchResult${index}`;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', 'false');
        const path = document.createElement('small');
        path.textContent = 'Разделы';
        const title = document.createElement('strong');
        title.textContent = record.label;
        const description = document.createElement('span');
        description.textContent = record.description;
        button.append(path, title, description);
        button.addEventListener('click', () => openSectionResult(record));
        sectionsResults.append(button);
      });
      sectionsResults.hidden = false;
      sectionsInput.setAttribute('aria-expanded', 'true');
      sectionsStatus.textContent = `Найдено разделов: ${sectionMatches.length}.`;
      return sectionMatches.length;
    }

    function setSectionsListening(listening) {
      sectionsVoiceButton.classList.toggle('is-listening', listening);
      sectionsVoiceButton.setAttribute('aria-pressed', String(listening));
      sectionsVoiceButton.setAttribute('aria-label', listening ? 'Остановить голосовой поиск' : 'Найти раздел голосом');
    }

    function stopSectionsRecognition() {
      clearTimeout(sectionsRecognitionTimer);
      sectionsRecognitionTimer = null;
      try { sectionsRecognition?.stop(); } catch {}
    }

    function startSectionsVoiceSearch() {
      if (sectionsRecognition) { stopSectionsRecognition(); return; }
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const touchDevice = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
      const supported = window.MinutaVoiceAssistant?.supportsDirectRecognition
        ? window.MinutaVoiceAssistant.supportsDirectRecognition(Recognition, navigator, matchMedia('(display-mode: standalone)').matches)
        : directRecognitionSupported(Recognition);
      if (!supported) {
        sectionsStatus.textContent = touchDevice ? 'Открыта клавиатура. Нажмите значок микрофона на ней и продиктуйте запрос.' : 'Этот браузер не поддерживает голосовой поиск. Введите запрос текстом.';
        sectionsInput.focus();
        return;
      }
      try { sectionsRecognition = new Recognition(); }
      catch { sectionsStatus.textContent = 'Не удалось запустить микрофон. Введите запрос текстом.'; return; }
      sectionsRecognition.lang = 'ru-RU';
      sectionsRecognition.continuous = false;
      sectionsRecognition.interimResults = true;
      sectionsRecognition.maxAlternatives = 3;
      sectionsTranscript = '';
      sectionsVoiceRendered = false;
      sectionsRecognition.onstart = () => {
        setSectionsListening(true);
        sectionsStatus.textContent = 'Слушаю… Назовите раздел или действие.';
        sectionsRecognitionTimer = setTimeout(() => { stopSectionsRecognition(); sectionsStatus.textContent = 'Речь не получена. Попробуйте ещё раз или введите запрос текстом.'; }, 15000);
      };
      sectionsRecognition.onresult = event => {
        const transcript = Array.from(event.results || []).map(result => result[0]?.transcript || '').join(' ').replace(/\s+/g, ' ').trim();
        if (!transcript) return;
        sectionsTranscript = transcript.slice(0, 160);
        sectionsInput.value = sectionsTranscript;
        if (Array.from(event.results || []).every(result => result.isFinal)) {
          const count = renderSectionsSearch();
          sectionsVoiceRendered = true;
          sectionsStatus.textContent = count ? `Распознано: «${sectionsInput.value}». Найдено разделов: ${count}.` : `Распознано: «${sectionsInput.value}», но совпадений нет.`;
        }
      };
      sectionsRecognition.onerror = event => {
        const messages = { 'not-allowed':'Нет доступа к микрофону. Разрешите его в настройках браузера.', 'service-not-allowed':'Браузер запретил службу распознавания.', 'audio-capture':'Микрофон не найден или занят.', 'no-speech':'Речь не услышана. Попробуйте ещё раз.', network:'Служба распознавания сейчас недоступна.' };
        sectionsStatus.textContent = messages[event.error] || 'Не удалось распознать речь. Используйте текстовый поиск.';
      };
      sectionsRecognition.onend = () => {
        clearTimeout(sectionsRecognitionTimer);
        sectionsRecognitionTimer = null;
        sectionsRecognition = null;
        setSectionsListening(false);
        if (sectionsTranscript && !sectionsVoiceRendered) {
          sectionsInput.value = sectionsTranscript;
          const count = renderSectionsSearch();
          sectionsStatus.textContent = count ? `Распознано: «${sectionsInput.value}». Найдено разделов: ${count}.` : `Распознано: «${sectionsInput.value}», но совпадений нет.`;
        }
      };
      try { sectionsRecognition.start(); }
      catch { sectionsRecognition = null; setSectionsListening(false); sectionsStatus.textContent = 'Микрофон уже используется. Попробуйте ещё раз.'; }
    }

    sectionsInput.addEventListener('input', () => renderSectionsSearch());
    sectionsInput.addEventListener('focus', () => { if (sectionsInput.value.trim().length >= 2) renderSectionsSearch(); });
    sectionsInput.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedSection(selectedSection + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedSection(selectedSection - 1); }
      else if (event.key === 'Enter' && sectionMatches.length) { event.preventDefault(); openSectionResult(sectionMatches[selectedSection >= 0 ? selectedSection : 0]); }
      else if (event.key === 'Escape') { event.preventDefault(); closeSectionsResults(); }
    });
    sectionsClearButton.addEventListener('click', () => { sectionsInput.value = ''; renderSectionsSearch(); sectionsInput.focus(); });
    sectionsVoiceButton.addEventListener('click', startSectionsVoiceSearch);
    document.addEventListener('pointerdown', event => { if (!search.contains(event.target)) closeSectionsResults(); });
    new MutationObserver(() => { if (sectionsPanel.hidden && sectionsRecognition) { try { sectionsRecognition.abort(); } catch {} } }).observe(sectionsPanel, { attributes:true, attributeFilter:['hidden'] });
    return { findSections };
  }

  const sectionsSearch = initializeSectionsSearch();
  window.MinutaSettingsSearch = Object.freeze({ normalize, swapKeyboardLayout, findSettings, findSections:sectionsSearch?.findSections || (() => []) });
})();
