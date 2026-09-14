/* Local, typo-tolerant settings search with optional browser speech input. */
(() => {
  const panel = document.querySelector('[data-provider-panel="settings"]');
  const nav = panel?.querySelector('.provider-section-nav');
  if (!panel || !nav || panel.querySelector('.settings-smart-search')) return;

  const SECTION_META = Object.freeze({
    appearanceSettingsCard:{ aliases:'оформление дизайн внешний вид цвет тема фон стиль структура интерфейс размер шрифт текст карточка запись', companions:[] },
    telegramClientSettingsCard:{ aliases:'уведомления сообщение телеграм telegram телега бот связь клиент посетитель сайта звук сигнал', companions:['visitorAlertSettingsCard'] },
    installAppCard:{ aliases:'приложение установить установка pwa ярлык рабочий стол главный экран полный экран fullscreen переход меню навигация вкладка роль', companions:['appNavigationSettingsCard'] },
    bookingRulesCard:{ aliases:'правила онлайн запись отмена перенос предоплата депозит завершение визит календарь команда смена групповой сеанс пакет даты серия', companions:['batchBookingSettingsCard','teamCalendarSettingsCard','groupBookingSettingsCard'] },
    batchBookingSettingsCard:{ aliases:'пакет пакетные несколько даты серия повторные записи лимит', companions:[] },
    subscriptionSettingsCard:{ aliases:'тариф подписка цена стоимость оплата месяц год специалисты филиалы пробный период бонус', companions:[] },
    dataGovernanceCard:{ aliases:'данные документы хранение скачать экспорт выгрузка удалить удаление очистка конфиденциальность политика резервная копия восстановление', companions:[] },
    accountSettingsCard:{ aliases:'безопасность аккаунт профиль пароль логин вход телефон sms код telegram vk вконтакте яндекс привязать восстановить доступ данные документы хранение скачать экспорт выгрузка удалить очистка конфиденциальность политика', companions:['dataGovernanceCard'] }
  });
  const STOP_WORDS = new Set('а без бы в вам вас весь где для до его ее ещё же за и из или как кабинет кабинета ли мне мой на не но о от по при про с со что чтобы это я хочу хотим нужно надо можно найти покажи показать посмотреть смотреть открыть перейти поменять изменить настроить включить выключить отключить убрать добавить создать сделать настройка настройки параметр параметры'.split(' '));
  const EN_LAYOUT = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,.';
  const RU_LAYOUT = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
  const search = document.createElement('section');
  search.className = 'settings-smart-search';
  search.setAttribute('aria-label', 'Поиск по настройкам');
  search.innerHTML = `<div class="settings-search-field"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-search"></use></svg><label><span class="sr-only">Найти настройку</span><input id="settingsSearchInput" type="search" inputmode="search" autocomplete="off" maxlength="160" placeholder="Например: отключить предоплату" role="combobox" aria-autocomplete="list" aria-controls="settingsSearchResults" aria-expanded="false"></label><button class="settings-search-clear" type="button" aria-label="Очистить поиск" hidden><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-close"></use></svg></button><button class="settings-search-voice" type="button" aria-label="Найти настройку голосом" aria-pressed="false"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-microphone"></use></svg></button></div><div class="settings-search-results" id="settingsSearchResults" role="listbox" hidden></div><p class="settings-search-status" role="status" aria-live="polite">Можно написать обычной фразой — поиск понимает опечатки.</p>`;
  const workspace = nav.closest('.settings-workspace');
  (workspace || (nav.parentElement.classList.contains('settings-nav-scroll-shell') ? nav.parentElement : nav)).before(search);

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
    return String(value || '').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function swapKeyboardLayout(value) {
    return String(value || '').toLocaleLowerCase('ru-RU').split('').map(char => {
      const englishIndex = EN_LAYOUT.indexOf(char);
      if (englishIndex >= 0) return RU_LAYOUT[englishIndex];
      const russianIndex = RU_LAYOUT.indexOf(char);
      return russianIndex >= 0 ? EN_LAYOUT[russianIndex] : char;
    }).join('');
  }

  function queryVariants(value) {
    const raw = String(value || '').toLocaleLowerCase('ru-RU');
    const original = normalize(raw);
    const variants = [original];
    if (/[a-zа-яё]/.test(raw)) variants.push(normalize(swapKeyboardLayout(raw)));
    return [...new Set(variants.filter(Boolean))];
  }

  function isStopWord(token) {
    if (STOP_WORDS.has(token)) return true;
    if (token.length < 5) return false;
    const allowed = token.length >= 9 ? 2 : 1;
    return [...STOP_WORDS].some(word => Math.abs(word.length - token.length) <= allowed && damerauDistance(token, word, allowed) <= allowed);
  }

  function usefulTokens(value) {
    const tokens = normalize(value).split(' ').filter(Boolean);
    const useful = tokens.filter(token => !isStopWord(token));
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

  function suggestionTokenScore(token, words) {
    const strict = tokenScore(token, words);
    if (strict) return strict;
    const allowed = token.length >= 9 ? 3 : token.length >= 5 ? 2 : token.length >= 3 ? 1 : 0;
    if (!allowed) return 0;
    let best = 0;
    for (const word of words) {
      const distance = damerauDistance(token, word, allowed);
      if (distance <= allowed) best = Math.max(best, 13 - distance);
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

  function suggestionScore(record, query) {
    const tokens = usefulTokens(query);
    const words = record.corpus.split(' ').filter(Boolean);
    const tokenScores = tokens.map(token => suggestionTokenScore(token, words));
    const matched = tokenScores.filter(Boolean).length;
    if (!matched || matched / tokens.length < 0.5) return 0;
    return tokenScores.reduce((sum, score) => sum + score, 0)
      + (record.type === 'item' ? 5 : 0)
      + Math.round((matched / tokens.length) * 8);
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

    const CABINET_SEARCH_REGISTRY_VERSION = 1;
    const CABINET_STOP_WORDS = new Set('а без бы в вам вас весь где для до его ее ещё же за и из или как кабинет кабинета ли мне мой на не но о от по при про с со что чтобы это я хочу хотим нужно надо можно найти покажи показать посмотреть смотреть перейти поменять изменить настроить включить выключить отключить убрать сделать настройка настройки параметр параметры'.split(' '));
    const CABINET_SEARCH_REGISTRY = Object.freeze([
      { id:'view-bookings', kind:'section', view:'bookings', keywords:'записи запись визит календарь расписание прием приемы сеанс клиент сегодня завтра журнал' },
      { id:'action-new-booking', kind:'action', view:'bookings', group:'Записи', label:'Новая запись', description:'Открыть форму создания записи', keywords:'новая запись создать добавить записать клиента прием визит', target:'#newBookingButton', behavior:'click', focus:'#bookingSheetContent input, #bookingSheet [role="dialog"]' },
      { id:'view-clients', kind:'section', view:'clients', keywords:'клиенты клиент карточка история контакты телефон заметки метки база' },
      { id:'view-notifications', kind:'section', view:'notifications', keywords:'уведомления сообщение сообщения клиентам шаблон whatsapp telegram телеграм рассылка напоминание доставка канал отправка' },
      { id:'view-schedule', kind:'section', view:'schedule', keywords:'график расписание рабочие часы время доступность перерыв выходной смена' },
      { id:'view-services', kind:'section', view:'services', keywords:'услуги услуга прайс цена стоимость длительность процедура сеанс' },
      { id:'action-add-service', kind:'action', view:'services', group:'Услуги', label:'Добавить услугу', description:'Открыть форму новой услуги', keywords:'добавить создать новая услуга процедура', target:'[data-provider-panel="services"] [data-open-service-creator]', behavior:'click', focus:'#serviceName, #serviceCreatorTitle' },
      { id:'view-organization', kind:'section', view:'organization', keywords:'организация компания бизнес профиль команда сотрудник специалист филиал адрес ресурсы роли доступ выплаты зарплата склад товар' },
      { id:'action-team-addresses', kind:'action', view:'organization', group:'Организация', label:'Люди и филиалы', description:'Команда, сотрудники и адреса', keywords:'команда сотрудники сотрудник специалисты мастер филиал филиалы адрес адреса профиль место работы', sectionTarget:'organizationPeopleSection', focus:'#organizationPeopleSection h3, #organizationPeopleSection' },
      { id:'view-portfolio', kind:'section', view:'portfolio', keywords:'портфолио фото фотографии работа работы галерея примеры' },
      { id:'view-analytics', kind:'section', view:'analytics', keywords:'статистика отчет отчеты аналитика доход выручка визиты показатели экспорт деньги заработок прибыль' },
      { id:'action-money', kind:'action', view:'analytics', group:'Статистика', label:'Деньги', description:'Доходы, расходы и оплата', keywords:'доход доходы деньги оплата оплаты выручка расход расходы прибыль заработок финансы финансовый результат', target:'[data-report-view="money"]', behavior:'click', focus:'#moneyDashboardTitle, #moneyDashboard' },
      { id:'view-waitlist', kind:'section', view:'waitlist', keywords:'лист ожидания ожидание свободное окно занята дата заявка очередь клиентов жду освободилось место занято нет мест свободное время окно освободится' },
      { id:'view-settings', kind:'section', view:'settings', keywords:'настройки кабинет тема стиль оформление интерфейс правила предоплата пароль подписка безопасность приложение профиль данные' },
      { id:'action-online-page', kind:'action', view:'settings', group:'Онлайн-запись', label:'Страница для клиентов', description:'Оформление публичной страницы записи', keywords:'онлайн онлайн запись страница записи публичная страница клиентская страница запись клиента сайт для клиентов ссылка для записи поделиться ссылкой', sectionTarget:'clientAppearanceSettingsCard', focus:'#clientAppearanceTitle, #clientAppearanceSettingsCard' },
      { id:'action-booking-links', kind:'action', view:'settings', group:'Онлайн-запись', label:'Ссылки и виджет', description:'Готовая ссылка на страницу записи', keywords:'онлайн онлайн запись ссылка для записи поделиться ссылкой страница записи запись клиента публичная ссылка виджет', sectionTarget:'clientAppearanceSettingsCard', target:'#openBookingWidgets', availabilityTarget:'#shareProviderClientPage', behavior:'click', focus:'#bookingWidgetOutput, #bookingWidgetsTitle' },
      { id:'action-provider-appearance', kind:'action', view:'settings', group:'Настройки кабинета', label:'Оформление', description:'Темы, фон и вид кабинета', keywords:'тема темы оформление дизайн внешний вид цвет фон стиль интерфейс', sectionTarget:'appearanceSettingsCard', focus:'#appearanceSettingsCard h3, #appearanceSettingsCard' },
      { id:'action-account-profile', kind:'action', view:'settings', group:'Настройки кабинета', label:'Аккаунт и данные', description:'Профиль, пароль и способы входа', keywords:'профиль аккаунт данные пароль вход логин безопасность телефон', sectionTarget:'accountSettingsCard', focus:'#accountSettingsCard h3, #accountSettingsCard' },
      { id:'view-feedback-inbox', kind:'section', view:'feedback-inbox', keywords:'обращения сообщения об ошибках предложения команды входящие' },
      { id:'action-help', kind:'link', view:'more', group:'Помощь', label:'База знаний', description:'Пошаговые инструкции по разделам', keywords:'помощь поддержка инструкция инструкции подсказка как сделать база знаний', target:'.mobile-help-shortcut', behavior:'click' },
      { id:'action-feedback', kind:'action', view:'more', group:'Помощь', label:'Обратная связь', description:'Сообщить о проблеме или предложении', keywords:'помощь поддержка проблема ошибка баг предложение улучшение написать обратная связь', target:'[data-open-product-feedback]', behavior:'click', requiresVisible:true, focus:'#productFeedbackTitle, #productFeedbackMessage' }
    ].map(record => Object.freeze(record)));
    const CABINET_EXAMPLE_IDS = Object.freeze(['action-new-booking', 'action-add-service', 'action-online-page']);
    const search = document.createElement('section');
    search.className = 'settings-smart-search cabinet-sections-search';
    search.setAttribute('aria-label', 'Поиск по разделам кабинета');
    search.innerHTML = `<div class="settings-search-field"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-search"></use></svg><label><span class="sr-only">Найти раздел кабинета</span><input id="cabinetSectionsSearchInput" type="search" inputmode="search" autocomplete="off" maxlength="160" placeholder="Найти раздел" role="combobox" aria-autocomplete="list" aria-controls="cabinetSectionsSearchResults" aria-expanded="false"></label><button class="settings-search-clear" type="button" aria-label="Очистить поиск" hidden><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-close"></use></svg></button></div><div class="settings-search-results" id="cabinetSectionsSearchResults" role="listbox" hidden></div><p class="settings-search-status" role="status" aria-live="polite">Поиск работает на устройстве по названию или задаче.</p>`;
    intro.after(search);

    const sectionsInput = search.querySelector('input');
    const sectionsResults = search.querySelector('.settings-search-results');
    const sectionsStatus = search.querySelector('.settings-search-status');
    const sectionsClearButton = search.querySelector('.settings-search-clear');
    let sectionMatches = [];
    let selectedSection = -1;

    function firstAvailableElement(selector, { visible = false } = {}) {
      if (!selector) return null;
      for (const candidate of String(selector).split(',').map(value => value.trim()).filter(Boolean)) {
        const element = [...document.querySelectorAll(candidate)].find(item => !item.disabled && (!visible || !item.hidden));
        if (element) return element;
      }
      return null;
    }

    function navigationElement(view) {
      return firstAvailableElement(`[data-provider-view="${view}"]`);
    }

    function currentSectionCopy(view) {
      const element = [...grid.querySelectorAll('[data-provider-view]')].find(item => item.dataset.providerView === view)
        || navigationElement(view);
      if (!element) return null;
      return {
        element,
        label:element.querySelector('strong')?.textContent.replace(/\s+/g, ' ').trim()
          || element.querySelector('span:last-child')?.textContent.replace(/\s+/g, ' ').trim()
          || element.textContent.replace(/\s+/g, ' ').trim(),
        description:element.querySelector('small')?.textContent.replace(/\s+/g, ' ').trim() || 'Открыть раздел'
      };
    }

    function registryRecord(definition) {
      const sectionCopy = definition.kind === 'section' ? currentSectionCopy(definition.view) : null;
      const element = definition.target
        ? firstAvailableElement(definition.target, { visible:Boolean(definition.requiresVisible) })
        : navigationElement(definition.view);
      const availabilityElement = definition.availabilityTarget
        ? firstAvailableElement(definition.availabilityTarget, { visible:true })
        : element;
      const sectionButton = definition.sectionTarget
        ? firstAvailableElement(`[data-provider-panel="${definition.view}"] [data-section-target="${definition.sectionTarget}"]`)
        : null;
      if ((definition.kind === 'section' && !sectionCopy) || !element || !availabilityElement || (definition.sectionTarget && !sectionButton)) return null;
      if (definition.requiresVisible && (element.hidden || element.disabled)) return null;
      const label = sectionCopy?.label || definition.label;
      const description = sectionCopy?.description || definition.description || 'Открыть раздел';
      const group = definition.group || (definition.kind === 'section' ? 'Раздел' : 'Действие');
      const displayLabel = definition.group && normalize(definition.group) !== normalize(label)
        ? `${definition.group} · ${label}`
        : label;
      const labelCorpus = normalize(`${label} ${displayLabel}`);
      return {
        ...definition,
        registryVersion:CABINET_SEARCH_REGISTRY_VERSION,
        element,
        sectionButton,
        label,
        displayLabel,
        description,
        group,
        labelCorpus,
        corpus:normalize(`${displayLabel} ${description} ${definition.keywords || ''}`)
      };
    }

    function buildSectionsIndex() {
      const records = CABINET_SEARCH_REGISTRY.map(registryRecord).filter(Boolean);
      const ids = new Set();
      return records.filter(record => {
        if (ids.has(record.id)) return false;
        ids.add(record.id);
        return true;
      });
    }

    function allTokensScore(tokens, words, scorer) {
      const scores = tokens.map(token => scorer(token, words));
      return scores.every(Boolean) ? scores.reduce((sum, score) => sum + score, 0) : 0;
    }

    function cabinetTokens(value) {
      const tokens = normalize(value).split(' ').filter(Boolean);
      const useful = tokens.filter(token => {
        if (CABINET_STOP_WORDS.has(token)) return false;
        if (token.length < 5) return true;
        const allowed = token.length >= 9 ? 2 : 1;
        return ![...CABINET_STOP_WORDS].some(word => Math.abs(word.length - token.length) <= allowed && damerauDistance(token, word, allowed) <= allowed);
      });
      return useful.length ? useful : tokens;
    }

    function cabinetRecordScore(record, query, typo = false) {
      const phrase = normalize(query);
      const tokens = cabinetTokens(phrase);
      if (!phrase || !tokens.length || (tokens.length === 1 && tokens[0].length < 3)) return 0;
      const words = record.corpus.split(' ').filter(Boolean);
      const labelWords = record.labelCorpus.split(' ').filter(Boolean);
      const scorer = typo ? suggestionTokenScore : tokenScore;
      const tokenScores = tokens.map(token => scorer(token, words));
      const matchedTokens = tokenScores.filter(Boolean).length;
      const tokenTotal = typo
        ? (matchedTokens / tokens.length >= 0.5 ? tokenScores.reduce((sum, score) => sum + score, 0) : 0)
        : allTokensScore(tokens, words, scorer);
      if (!tokenTotal) return 0;
      const labelTokenTotal = tokens.reduce((sum, token) => sum + scorer(token, labelWords), 0);
      const labelBoost = labelTokenTotal * 4;
      if (!typo && (phrase === normalize(record.label) || phrase === normalize(record.displayLabel))) return 500 + tokenTotal + labelBoost;
      if (!typo && (normalize(record.label).startsWith(phrase) || normalize(record.displayLabel).startsWith(phrase))) return 420 + tokenTotal + labelBoost;
      if (!typo && tokens.every(token => words.some(word => word === token || word.startsWith(token)))) return 330 + tokenTotal + labelBoost;
      if (!typo && record.corpus.includes(phrase)) return 250 + tokenTotal + labelBoost;
      return (typo ? 100 : 180) + tokenTotal + labelBoost;
    }

    function rankSections(value, typo = false) {
      const variants = queryVariants(value);
      return buildSectionsIndex().map(record => ({ ...record, score:Math.max(...variants.map(query => cabinetRecordScore(record, query, typo))) }))
        .filter(record => record.score > 0)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id, 'ru'))
        .slice(0, 6);
    }

    function findSections(value) {
      const query = normalize(value);
      const tokens = cabinetTokens(query);
      if (!query || (tokens.length === 1 && tokens[0].length < 3)) return [];
      const matches = rankSections(value);
      if (matches.length) return matches;
      if (tokens.some(token => token.length < 4)) return [];
      return rankSections(value, true).map(record => ({ ...record, suggested:true }));
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
      const selected = sectionMatches[selectedSection];
      if (selected && document.activeElement === sectionsInput) sectionsStatus.textContent = `Выбран ${selectedResultLabel(selected)}. ${selectedSection + 1} из ${sectionMatches.length}.`;
    }

    function selectedResultLabel(record) { return record.kind === 'section' ? `раздел «${record.displayLabel}»` : `пункт «${record.displayLabel}»`; }

    function focusDestination(record, fallback = null) {
      const target = firstAvailableElement(record.focus || '') || fallback;
      if (!target) return;
      for (let details = target.closest('details'); details; details = details.parentElement?.closest('details')) details.open = true;
      if (!target.matches('input,select,textarea,button,a,summary,[tabindex]')) target.setAttribute('tabindex', '-1');
      target.scrollIntoView({ behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'center' });
      target.focus?.({ preventScroll:true });
    }

    function focusWhenReady(record, fallback = null) {
      const deadline = performance.now() + 2500;
      const check = () => {
        const target = firstAvailableElement(record.focus || '') || fallback;
        const dialog = target?.closest('dialog');
        const hiddenAncestor = target?.closest('[hidden]');
        if (target && !hiddenAncestor && (!dialog || dialog.open)) { focusDestination(record, fallback); return; }
        if (performance.now() < deadline) requestAnimationFrame(check);
      };
      check();
    }

    function afterViewReady(view, callback) {
      const panel = document.querySelector(`[data-provider-panel="${view}"]`);
      const deadline = performance.now() + 1200;
      const check = () => {
        if (!panel || !panel.hidden) { callback(); return; }
        if (performance.now() >= deadline) return;
        requestAnimationFrame(check);
      };
      check();
    }

    function openSectionResult(record) {
      closeSectionsResults();
      sectionsStatus.textContent = `Открываем: ${record.displayLabel}.`;
      const navigate = record.view !== 'more' ? navigationElement(record.view) : null;
      navigate?.click();
      afterViewReady(record.view, () => requestAnimationFrame(() => {
        const sectionButton = record.sectionTarget
          ? firstAvailableElement(`[data-provider-panel="${record.view}"] [data-section-target="${record.sectionTarget}"]`)
          : null;
        if (sectionButton) {
          sectionButton.click();
          if (record.target) {
            const target = firstAvailableElement(record.target, { visible:Boolean(record.requiresVisible) });
            if (!target) return;
            if (record.behavior === 'focus') focusDestination(record, target);
            else {
              target.click();
              focusWhenReady(record, target);
            }
          } else focusDestination(record, document.getElementById(record.sectionTarget));
          return;
        }
        const target = record.target ? firstAvailableElement(record.target, { visible:Boolean(record.requiresVisible) }) : record.element;
        if (!target) return;
        if (record.behavior === 'focus') {
          target.closest('details')?.setAttribute('open', '');
          focusDestination(record, target);
          return;
        }
        if (record.kind === 'section') {
          focusDestination(record, document.querySelector(`[data-provider-panel="${record.view}"] .view-title h2`));
          return;
        }
        target.click();
        focusWhenReady(record, target);
      }));
    }

    function appendHighlightedText(element, value, query) {
      const text = String(value || '');
      const tokens = cabinetTokens(query).filter(token => token.length >= 3);
      const normalizedText = text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
      let match = null;
      for (const token of tokens) {
        const index = normalizedText.indexOf(token);
        if (index >= 0 && (!match || token.length > match.token.length)) match = { index, token };
      }
      if (!match) { element.textContent = text; return; }
      element.append(document.createTextNode(text.slice(0, match.index)));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(match.index, match.index + match.token.length);
      element.append(mark, document.createTextNode(text.slice(match.index + match.token.length)));
    }

    function renderSectionRecords(records, query = '', popular = false, keyboardSelectable = true) {
      sectionMatches = keyboardSelectable ? records : [];
      records.forEach((record, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `cabinetSectionsSearchResult${index}`;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', 'false');
        const path = document.createElement('small');
        path.textContent = popular ? 'Пример' : record.suggested ? 'Возможно, вы искали' : record.kind === 'section' ? 'Раздел' : 'Действие';
        const title = document.createElement('strong');
        appendHighlightedText(title, record.displayLabel, query);
        const description = document.createElement('span');
        appendHighlightedText(description, record.description, query);
        button.append(path, title, description);
        button.addEventListener('click', () => openSectionResult(record));
        sectionsResults.append(button);
      });
      sectionsResults.hidden = false;
      sectionsInput.setAttribute('aria-expanded', 'true');
      if (keyboardSelectable) setSelectedSection(0);
    }

    function renderSectionsSearch(value = sectionsInput.value) {
      const query = value.trim();
      sectionsClearButton.hidden = !query;
      sectionsResults.replaceChildren();
      sectionMatches = [];
      selectedSection = -1;
      sectionsInput.removeAttribute('aria-activedescendant');
      if (!query) {
        const index = buildSectionsIndex();
        const popular = CABINET_EXAMPLE_IDS.map(id => index.find(record => record.id === id)).filter(Boolean);
        renderSectionRecords(popular, '', true);
        sectionsStatus.textContent = `Примеры полезных направлений: ${popular.length}.`;
        return popular.length;
      }
      if (query.length < 3) {
        closeSectionsResults();
        sectionsStatus.textContent = 'Введите ещё один символ.';
        return 0;
      }
      sectionMatches = findSections(query);
      if (!sectionMatches.length) {
        const index = buildSectionsIndex();
        const alternatives = CABINET_EXAMPLE_IDS.map(id => index.find(record => record.id === id)).filter(Boolean);
        if (alternatives.length) {
          renderSectionRecords(alternatives, '', true, false);
          sectionsStatus.textContent = `Совпадений нет. Можно выбрать пример: ${alternatives.map(record => record.displayLabel).join(', ')}.`;
        } else {
          closeSectionsResults();
          sectionsStatus.textContent = 'Совпадений нет.';
        }
        return 0;
      }
      renderSectionRecords(sectionMatches, query);
      sectionsStatus.textContent = sectionMatches[0]?.suggested
        ? `Возможно, вы искали: ${sectionMatches.map(record => record.displayLabel).join(', ')}.`
        : `Найдено результатов: ${sectionMatches.length}. Выбран: ${sectionMatches[0].displayLabel}.`;
      return sectionMatches.length;
    }

    sectionsInput.addEventListener('input', () => renderSectionsSearch());
    sectionsInput.addEventListener('focus', () => renderSectionsSearch());
    sectionsInput.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedSection(selectedSection + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedSection(selectedSection - 1); }
      else if (event.key === 'Enter' && sectionMatches.length) { event.preventDefault(); openSectionResult(sectionMatches[selectedSection >= 0 ? selectedSection : 0]); }
      else if (event.key === 'Escape') { event.preventDefault(); closeSectionsResults(); }
    });
    sectionsClearButton.addEventListener('click', () => { sectionsInput.value = ''; renderSectionsSearch(); sectionsInput.focus(); });
    document.addEventListener('pointerdown', event => { if (!search.contains(event.target)) closeSectionsResults(); });
    return { registryVersion:CABINET_SEARCH_REGISTRY_VERSION, registry:CABINET_SEARCH_REGISTRY, findSections };
  }

  const sectionsSearch = initializeSectionsSearch();
  window.MinutaSettingsSearch = Object.freeze({ normalize, swapKeyboardLayout, findSettings, cabinetRegistryVersion:sectionsSearch?.registryVersion || 0, cabinetRegistry:sectionsSearch?.registry || [], findSections:sectionsSearch?.findSections || (() => []) });
})();
