(() => {
  'use strict';

  const VERSION = 1;
  const CATEGORIES = [
    ['massage', 'Массаж'],
    ['beauty', 'Косметология'],
    ['nails', 'Ногтевой сервис'],
    ['hair', 'Парикмахерские услуги'],
    ['wellness', 'Здоровье и практики'],
    ['other', 'Другое']
  ];
  const TEMPLATES = {
    massage: [['Классический массаж', 2500, 60], ['Массаж спины и шеи', 2000, 40], ['Спортивный массаж', 3000, 60]],
    beauty: [['Консультация', 1000, 30], ['Уходовая процедура', 3000, 60], ['Чистка лица', 3500, 90]],
    nails: [['Маникюр', 1800, 90], ['Маникюр с покрытием', 2500, 120], ['Педикюр', 2800, 120]],
    hair: [['Стрижка', 1800, 60], ['Окрашивание', 4500, 150], ['Укладка', 2000, 60]],
    wellness: [['Консультация', 2000, 60], ['Индивидуальная практика', 2500, 60], ['Повторный приём', 1800, 45]],
    other: [['Основная услуга', 2000, 60], ['Короткая встреча', 1000, 30], ['Расширенная услуга', 3000, 90]]
  };
  const DAY_LABELS = [['1', 'Пн'], ['2', 'Вт'], ['3', 'Ср'], ['4', 'Чт'], ['5', 'Пт'], ['6', 'Сб'], ['7', 'Вс']];

  let context = null;
  let root = null;
  let step = 1;
  let state = null;
  let busy = false;
  let generation = 0;

  const escapeHtml = value => `${value ?? ''}`.replace(/[&<>'"]/g, symbol => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[symbol]);
  const draftKey = userId => `minuta-onboarding-v${VERSION}:${userId}`;
  const defaultServices = category => (TEMPLATES[category] || TEMPLATES.other).map(([name, price, duration], index) => ({ id:`template-${index}`, enabled:index < 2, name, price, duration }));
  const defaultState = () => ({
    format: 'solo',
    category: 'massage',
    services: defaultServices('massage'),
    days: ['1', '2', '3', '4', '5'],
    start: '10:00',
    end: '19:00'
  });

  function readDraft(userId) {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey(userId)) || 'null');
      const draft = saved && saved.version === VERSION ? { ...defaultState(), ...saved.data } : defaultState();
      draft.days = Array.isArray(draft.days) ? [...new Set(draft.days.map(day => String(day) === '0' ? '7' : String(day)).filter(day => /^[1-7]$/.test(day)))] : defaultState().days;
      if (!Array.isArray(draft.services)) draft.services = defaultServices(draft.category);
      return draft;
    } catch (_) {
      return defaultState();
    }
  }

  function saveDraft() {
    if (!context?.user?.id || !state) return;
    try { localStorage.setItem(draftKey(context.user.id), JSON.stringify({ version:VERSION, data:state })); } catch {}
  }

  function mount() {
    if (root) return;
    root = document.createElement('dialog');
    root.id = 'providerOnboarding';
    root.className = 'provider-onboarding';
    root.setAttribute('aria-labelledby', 'providerOnboardingTitle');
    root.addEventListener('cancel', event => event.preventDefault());
    root.addEventListener('click', handleClick);
    root.addEventListener('input', handleInput);
    root.addEventListener('change', handleInput);
    document.body.append(root);
  }

  function progress() {
    return `<div class="onboarding-progress" aria-label="Шаг ${step} из 4"><i style="--progress:${step * 25}%"></i></div>`;
  }

  function shell(content, options = {}) {
    const back = step > 1 ? '<button class="onboarding-icon-button" type="button" data-onboarding-back aria-label="Назад">←</button>' : '<span></span>';
    const nextLabel = options.nextLabel || 'Продолжить';
    root.innerHTML = `
      <div class="onboarding-shell">
        <header class="onboarding-topbar">
          ${back}
          <span>Первичная настройка</span>
          <button class="onboarding-later" type="button" data-onboarding-later>Настроить позже</button>
        </header>
        ${progress()}
        <main class="onboarding-content">${content}</main>
        <footer class="onboarding-footer">
          <span>Шаг ${step} из 4</span>
          <button class="onboarding-primary" type="button" data-onboarding-next ${busy ? 'disabled' : ''}>${busy ? 'Сохраняем…' : nextLabel}</button>
        </footer>
      </div>`;
  }

  function renderStepOne() {
    const formats = [
      ['solo', 'Работаю один', 'Только ваше расписание и клиенты'],
      ['team', 'Работаем командой', 'Позже пригласите сотрудников и настройте роли']
    ];
    shell(`
      <section class="onboarding-hero">
        <small>Начнём с главного</small>
        <h1 id="providerOnboardingTitle">Как устроена ваша работа?</h1>
        <p>Ответьте на два вопроса. Остальное можно изменить в настройках в любое время.</p>
      </section>
      <fieldset class="onboarding-fieldset">
        <legend>Формат работы</legend>
        <div class="onboarding-choice-grid">${formats.map(([value, title, caption]) => `
          <label class="onboarding-choice ${state.format === value ? 'is-selected' : ''}">
            <input type="radio" name="onboardingFormat" value="${value}" ${state.format === value ? 'checked' : ''}>
            <span><strong>${title}</strong><small>${caption}</small></span><b aria-hidden="true">✓</b>
          </label>`).join('')}</div>
      </fieldset>
      <fieldset class="onboarding-fieldset">
        <legend>Чем вы занимаетесь?</legend>
        <div class="onboarding-chips">${CATEGORIES.map(([value, label]) => `<label class="${state.category === value ? 'is-selected' : ''}"><input type="radio" name="onboardingCategory" value="${value}" ${state.category === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
      </fieldset>`);
  }

  function renderStepTwo() {
    shell(`
      <section class="onboarding-hero">
        <small>Ваше предложение</small>
        <h1 id="providerOnboardingTitle">Добавьте первые услуги</h1>
        <p>Мы подготовили примеры. Оставьте нужные и поправьте цену или длительность.</p>
      </section>
      <div class="onboarding-service-list">${state.services.map((service, index) => `
        <article class="onboarding-service ${service.enabled ? 'is-selected' : ''}">
          <label class="onboarding-service-check"><input type="checkbox" data-service-enabled="${index}" ${service.enabled ? 'checked' : ''}><span aria-hidden="true">✓</span></label>
          <label><span>Название</span><input type="text" maxlength="120" value="${escapeHtml(service.name)}" data-service-name="${index}"></label>
          <label><span>Цена, ₽</span><input type="number" min="0" step="50" value="${Number(service.price) || 0}" data-service-price="${index}"></label>
          <label><span>Минут</span><input type="number" min="5" max="720" step="5" value="${Number(service.duration) || 60}" data-service-duration="${index}"></label>
        </article>`).join('')}</div>
      <button class="onboarding-text-button" type="button" data-onboarding-add-service>+ Добавить свою услугу</button>`);
  }

  function renderStepThree() {
    shell(`
      <section class="onboarding-hero">
        <small>Рабочее время</small>
        <h1 id="providerOnboardingTitle">Когда вас можно записывать?</h1>
        <p>Это основа доступных окон. Перерывы и отдельные выходные добавите позже.</p>
      </section>
      <div class="onboarding-presets">
        <button type="button" data-schedule-preset="weekdays">Будни</button>
        <button type="button" data-schedule-preset="six-days">Пн–Сб</button>
        <button type="button" data-schedule-preset="daily">Каждый день</button>
      </div>
      <fieldset class="onboarding-fieldset">
        <legend>Рабочие дни</legend>
        <div class="onboarding-days">${DAY_LABELS.map(([value, label]) => `<label class="${state.days.includes(value) ? 'is-selected' : ''}"><input type="checkbox" value="${value}" data-schedule-day ${state.days.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
      </fieldset>
      <div class="onboarding-time-grid">
        <label><span>Начало</span><input type="time" value="${state.start}" data-schedule-start></label>
        <span aria-hidden="true">—</span>
        <label><span>Конец</span><input type="time" value="${state.end}" data-schedule-end></label>
      </div>
      <aside class="onboarding-note"><strong>Онлайн-запись будет учитывать этот график.</strong><span>Вы всё равно сможете вручную создать запись вне рабочего времени.</span></aside>`);
  }

  function renderStepFour() {
    const chosen = state.services.filter(service => service.enabled && service.name.trim());
    const category = CATEGORIES.find(([value]) => value === state.category)?.[1] || 'Услуги';
    shell(`
      <section class="onboarding-hero onboarding-hero-final">
        <small>Проверьте настройки</small>
        <h1 id="providerOnboardingTitle">Посмотрите глазами клиента</h1>
        <p>После сохранения вы попадёте в расписание на сегодняшний день.</p>
      </section>
      <div class="onboarding-preview">
        <div class="onboarding-preview-brand"><i>${escapeHtml((context.user.user_metadata?.display_name || 'М').slice(0, 1).toUpperCase())}</i><span><small>${category}</small><strong>${escapeHtml(context.user.user_metadata?.display_name || 'Ваш кабинет')}</strong></span></div>
        <div class="onboarding-preview-status"><i></i> Предпросмотр страницы записи</div>
        <h2>Выберите услугу</h2>
        <div class="onboarding-preview-services">${chosen.length ? chosen.map(service => `<div><span><strong>${escapeHtml(service.name)}</strong><small>${service.duration} мин</small></span><b>${Number(service.price).toLocaleString('ru-RU')} ₽</b></div>`).join('') : '<p>Услуги можно добавить позже в кабинете.</p>'}</div>
        <p class="onboarding-link-note">Ссылка для клиентов будет доступна в кабинете после сохранения.</p>
      </div>
      <aside class="onboarding-summary"><span>Ваш график</span><strong>${state.days.length} дн. в неделю · ${state.start}–${state.end}</strong></aside>`, { nextLabel:'Сохранить и открыть мой день' });
  }

  function render() {
    if (!root || !state) return;
    if (step === 1) renderStepOne();
    if (step === 2) renderStepTwo();
    if (step === 3) renderStepThree();
    if (step === 4) renderStepFour();
  }

  function updateChoiceClasses(input) {
    input.closest('.onboarding-choice-grid, .onboarding-chips, .onboarding-days')?.querySelectorAll('label').forEach(label => label.classList.toggle('is-selected', Boolean(label.querySelector('input')?.checked)));
  }

  function handleInput(event) {
    if (busy || !state) return;
    const target = event.target;
    if (target.name === 'onboardingFormat') state.format = target.value;
    if (target.name === 'onboardingCategory') {
      state.category = target.value;
      state.services = defaultServices(target.value);
    }
    if (target.matches('[data-service-enabled]')) state.services[Number(target.dataset.serviceEnabled)].enabled = target.checked;
    if (target.matches('[data-service-name]')) state.services[Number(target.dataset.serviceName)].name = target.value;
    if (target.matches('[data-service-price]')) state.services[Number(target.dataset.servicePrice)].price = Math.max(0, Number(target.value) || 0);
    if (target.matches('[data-service-duration]')) state.services[Number(target.dataset.serviceDuration)].duration = Math.max(5, Number(target.value) || 5);
    if (target.matches('[data-schedule-day]')) state.days = [...root.querySelectorAll('[data-schedule-day]:checked')].map(input => input.value);
    if (target.matches('[data-schedule-start]')) state.start = target.value;
    if (target.matches('[data-schedule-end]')) state.end = target.value;
    updateChoiceClasses(target);
    target.closest('.onboarding-service')?.classList.toggle('is-selected', state.services[Number(target.dataset.serviceEnabled)]?.enabled ?? target.closest('.onboarding-service').querySelector('[data-service-enabled]').checked);
    saveDraft();
  }

  function validStep() {
    if (step === 2 && !state.services.some(service => service.enabled && service.name.trim())) return 'Выберите хотя бы одну услугу.';
    if (step === 2) {
      const chosen = state.services.filter(service => service.enabled && service.name.trim());
      if (new Set(chosen.map(service=>service.name.trim().toLocaleLowerCase('ru-RU'))).size !== chosen.length) return 'Названия услуг должны различаться.';
      if (chosen.some(service=>!Number.isFinite(Number(service.price)) || Number(service.price)<0 || !Number.isInteger(Number(service.duration)) || Number(service.duration)<5 || Number(service.duration)>720)) return 'Укажите цену от 0 ₽ и длительность от 5 до 720 минут.';
    }
    if (step === 3 && !state.days.length) return 'Выберите хотя бы один рабочий день.';
    if (step === 3 && state.start >= state.end) return 'Время окончания должно быть позже начала.';
    return '';
  }

  function showError(message) {
    let error = root.querySelector('.onboarding-error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'onboarding-error';
      error.setAttribute('role', 'alert');
      root.querySelector('.onboarding-footer').prepend(error);
    }
    error.textContent = message;
  }

  function errorMessage(error) {
    if (!navigator.onLine) return 'Нет соединения с интернетом. Настройки сохранены в черновике. Подключитесь и повторите сохранение.';
    const text = `${error?.code || ''} ${error?.message || ''}`;
    if (/existing_service_conflict/.test(text)) return 'Услуга с таким названием уже существует с другими параметрами. Вернитесь к услугам и задайте другое название или прежние параметры.';
    if (/42501|permission|row.level|forbidden/i.test(text)) return 'Недостаточно прав для сохранения. Войдите заново в кабинет исполнителя; черновик сохранён.';
    if (/PGRST20[024]|42P01|42703|schema|column|relation/i.test(text)) return 'Версия сервера не поддерживает эти настройки. Обновите страницу; если ошибка повторится, обратитесь в поддержку.';
    if (/23514|invalid_settings/i.test(text)) return 'Проверьте услуги и график: длительность 5–720 минут, окончание позже начала, хотя бы один рабочий день.';
    if (/401|jwt|session|refresh.token/i.test(text)) return 'Сессия истекла. Войдите повторно; черновик сохранён.';
    return 'Не удалось подтвердить сохранение. Повторная попытка проверит уже сохранённые услуги и график.';
  }
  async function serviceIdentity(userId, name) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`minuta-onboarding-service-v1:${userId}:${name.trim().toLocaleLowerCase('ru-RU')}`))).slice(0,16);
    bytes[6]=(bytes[6]&15)|80; bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  async function markStatus(status, operationContext = context, settings = state) {
    let writeError;
    try { const { error } = await operationContext.db.auth.updateUser({ data:{
      minuta_onboarding_status: status,
      minuta_onboarding_version: VERSION,
      minuta_onboarding_finished_at: new Date().toISOString(),
      minuta_work_format: settings.format,
      minuta_business_category: settings.category
    }}); writeError = error; } catch(error) { writeError = error; }
    const {data,error} = await operationContext.db.auth.getUser();
    const user = data?.user;
    if (error || user?.id !== operationContext.user.id || user.user_metadata?.minuta_onboarding_status !== status || user.user_metadata?.minuta_work_format !== settings.format || user.user_metadata?.minuta_business_category !== settings.category) throw writeError || error || new Error('onboarding_status_unconfirmed');
    operationContext.user.user_metadata = user.user_metadata;
  }

  async function finish() {
    if (busy) return;
    if (!navigator.onLine) { showError(errorMessage()); return; }
    const operationContext = context;
    const operationGeneration = generation;
    const settings = structuredClone(state);
    const assertCurrent = () => { if (generation !== operationGeneration || context?.user?.id !== operationContext.user.id) throw new Error('stale_session'); };
    busy = true;
    render();
    try {
      const selectedServices = settings.services.filter(service => service.enabled && service.name.trim());
      if (new Set(selectedServices.map(service=>service.name.trim().toLocaleLowerCase('ru-RU'))).size!==selectedServices.length || settings.days.some(day=>!DAY_LABELS.some(([value])=>value===day))) throw new Error('invalid_settings');
      if (!selectedServices.length || !settings.days.length || !/^\d{2}:\d{2}$/.test(settings.start) || !/^\d{2}:\d{2}$/.test(settings.end) || settings.start >= settings.end || selectedServices.some(service => !Number.isFinite(Number(service.price)) || Number(service.price)<0 || !Number.isInteger(Number(service.duration)) || Number(service.duration)<5 || Number(service.duration)>720)) throw new Error('invalid_settings');
      const { data: existing, error: servicesReadError } = await operationContext.db.from('services').select('name,price_rub,duration_minutes,active').eq('performer_id', operationContext.user.id);
      assertCurrent();
      if (servicesReadError) throw servicesReadError;
      if (!Array.isArray(existing)) throw new Error('services_read_unconfirmed');
      if(selectedServices.some(expected=>existing.some(actual=>String(actual.name).trim().toLocaleLowerCase('ru-RU')===expected.name.trim().toLocaleLowerCase('ru-RU') && (Number(actual.price_rub)!==Math.round(Number(expected.price)) || Number(actual.duration_minutes)!==Number(expected.duration) || actual.active!==true)))) throw new Error('existing_service_conflict');
      const names = new Set((existing || []).map(item => `${item.name || ''}`.trim().toLocaleLowerCase('ru-RU')));
      const additions = selectedServices.filter(service => { const key=service.name.trim().toLocaleLowerCase('ru-RU'); if(names.has(key))return false; names.add(key); return true; }).map(service => ({
        performer_id: operationContext.user.id,
        name: service.name.trim(),
        price_rub: Math.round(Number(service.price) || 0),
        duration_minutes: Math.max(5, Math.round(Number(service.duration) || 60)),
        active: true
      }));
      // A repeated insert after reload must collide on the same primary key,
      // even if the first write is still committing and not yet readable.
      for(const addition of additions) addition.id = await serviceIdentity(operationContext.user.id,addition.name);
      assertCurrent();
      if (additions.length) {
        let writeError;
        try { const { error } = await operationContext.db.from('services').insert(additions); writeError=error; } catch(error) { writeError=error; }
        assertCurrent();
        const {data,error} = await operationContext.db.from('services').select('name,price_rub,duration_minutes,active').eq('performer_id', operationContext.user.id);
        assertCurrent();
        if(error || !Array.isArray(data) || !additions.every(expected=>data.some(actual=>actual.name===expected.name && Number(actual.price_rub)===expected.price_rub && Number(actual.duration_minutes)===expected.duration_minutes && actual.active===true))) throw writeError || error || new Error('services_write_unconfirmed');
      }
      const rows = DAY_LABELS.map(([weekday]) => ({
        performer_id: operationContext.user.id,
        weekday: Number(weekday),
        enabled: settings.days.includes(weekday),
        start_time: settings.start,
        end_time: settings.end,
        break_start: null,
        break_end: null,
        slot_interval_minutes: 30
      }));
      let scheduleError;
      try { const {error} = await operationContext.db.from('provider_schedule').upsert(rows, { onConflict:'performer_id,weekday' }); scheduleError=error; } catch(error) { scheduleError=error; }
      assertCurrent();
      const {data:savedSchedule,error:readError} = await operationContext.db.from('provider_schedule').select('weekday,enabled,start_time,end_time,break_start,break_end,slot_interval_minutes').eq('performer_id', operationContext.user.id);
      assertCurrent();
      if(readError || !Array.isArray(savedSchedule) || !rows.every(expected=>savedSchedule.some(actual=>Number(actual.weekday)===expected.weekday && actual.enabled===expected.enabled && String(actual.start_time).slice(0,5)===expected.start_time && String(actual.end_time).slice(0,5)===expected.end_time && actual.break_start===null && actual.break_end===null && Number(actual.slot_interval_minutes)===expected.slot_interval_minutes))) throw scheduleError || readError || new Error('schedule_write_unconfirmed');
      await markStatus('completed',operationContext,settings);
      assertCurrent();
      try { localStorage.removeItem(draftKey(operationContext.user.id)); } catch {}
      close();
      if (typeof operationContext.refresh === 'function') { try { await operationContext.refresh(); } catch {} }
      assertCurrent();
      busy = false;
      operationContext.onComplete?.();
    } catch (error) {
      if (generation !== operationGeneration || context?.user?.id !== operationContext.user.id) return;
      busy = false;
      render();
      showError(errorMessage(error));
    }
  }

  async function postpone() {
    if (busy) return;
    busy = true;
    try {
      await markStatus('skipped');
      try { localStorage.removeItem(draftKey(context.user.id)); } catch {}
      close();
    } catch (_) {
      busy = false;
      render();
      showError('Не удалось сохранить выбор. Попробуйте ещё раз.');
    }
  }

  async function copyClientLink(button) {
    const url = new URL('index.html', location.href);
    url.search = '';
    url.hash = '';
    try {
      await navigator.clipboard.writeText(url.href);
      button.textContent = 'Ссылка скопирована';
    } catch (_) {
      window.prompt('Скопируйте ссылку для клиентов', url.href);
    }
  }

  function handleClick(event) {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.matches('[data-onboarding-back]')) { step = Math.max(1, step - 1); render(); return; }
    if (button.matches('[data-onboarding-later]')) { postpone(); return; }
    if (button.matches('[data-onboarding-add-service]')) {
      state.services.push({ id:`custom-${Date.now()}`, enabled:true, name:'Новая услуга', price:0, duration:60 });
      saveDraft(); render(); return;
    }
    if (button.matches('[data-schedule-preset]')) {
      const preset = button.dataset.schedulePreset;
      state.days = preset === 'weekdays' ? ['1','2','3','4','5'] : preset === 'six-days' ? ['1','2','3','4','5','6'] : ['1','2','3','4','5','6','7'];
      saveDraft(); render(); return;
    }
    if (button.matches('[data-copy-client-link]')) { copyClientLink(button); return; }
    if (button.matches('[data-onboarding-next]')) {
      const error = validStep();
      if (error) { showError(error); return; }
      if (step < 4) { step += 1; saveDraft(); render(); }
      else finish();
    }
  }

  function close() {
    if (!root) return;
    if (root.open && typeof root.close === 'function') root.close();
    else root.removeAttribute('open');
    document.documentElement.classList.remove('onboarding-open');
  }

  async function handleSession(nextContext) {
    if (busy && context?.user?.id === nextContext?.user?.id) { context = nextContext; return; }
    generation += 1;
    context = nextContext;
    const status = context?.user?.user_metadata?.minuta_onboarding_status;
    if (!context?.user?.id || status !== 'pending') { close(); return; }
    mount();
    state = readDraft(context.user.id);
    step = 1;
    busy = false;
    render();
    document.documentElement.classList.add('onboarding-open');
    if (!root.open) {
      if (typeof root.showModal === 'function') root.showModal();
      else root.setAttribute('open', '');
    }
  }

  function reset() {
    generation += 1;
    close();
    context = null;
    state = null;
    step = 1;
    busy = false;
  }

  window.MinutaProviderOnboarding = { handleSession, reset };
})();
