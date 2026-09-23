(function () {
  'use strict';
  const matrix = window.MinutaProviderPorcelainMatrix;
  const catalog = window.MinutaThemeCatalog;
  if (!matrix || !catalog) return;
  const defaultPair = Object.freeze({ character:'petal', shade:'gentle-pink' });

  if (window.MINUTA_PORCELAIN_READ_ONLY_PREVIEW) {
    let lastDraft = null;
    function applyPreviewDraft() {
      if (!lastDraft || typeof displayPreferences === 'undefined') return;
      displayPreferences = normalizeDisplayPreferences({
        ...displayPreferences, theme:'pink-porcelain', color_mode:'light', porcelain:lastDraft
      });
      applyDisplayPreferences();
      renderBookings();
    }
    window.addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'minuta-porcelain-draft') return;
      lastDraft = {
        character:matrix.normalizeCharacter(event.data.character),
        shade:matrix.normalizeShade(event.data.shade)
      };
      applyPreviewDraft();
    });
    const dashboard = document.getElementById('dashboard');
    const announceReady = () => {
      if (dashboard?.hidden) return;
      applyPreviewDraft();
      window.parent.postMessage({ type:'minuta-porcelain-preview-ready' }, location.origin);
    };
    new MutationObserver(announceReady).observe(dashboard, { attributes:true, attributeFilter:['hidden'] });
    announceReady();
    return;
  }

  const appearanceCard = document.getElementById('appearanceSettingsCard');
  const displayForm = document.getElementById('providerDisplayForm');
  if (!appearanceCard || !displayForm) return;

  const page = document.createElement('section');
  page.className = 'provider-porcelain-page';
  page.id = 'providerPorcelainPage';
  page.hidden = true;
  page.setAttribute('aria-labelledby', 'providerPorcelainTitle');
  page.innerHTML = `
    <button class="provider-porcelain-back" id="providerPorcelainBack" type="button">← Все темы</button>
    <header class="provider-porcelain-page-head"><h2 id="providerPorcelainTitle" tabindex="-1">Розовый фарфор</h2><p id="providerPorcelainTagline"></p></header>
    <div class="provider-porcelain-page-grid">
      <div class="provider-porcelain-controls">
        <fieldset class="provider-porcelain-fieldset"><legend>Характер темы</legend><div class="provider-porcelain-characters" id="providerPorcelainDetailCharacters"></div></fieldset>
        <fieldset class="provider-porcelain-fieldset"><legend>Оттенок темы</legend><div class="provider-porcelain-shades" id="providerPorcelainDetailShades"></div></fieldset>
        <div class="provider-porcelain-actions"><button class="primary" id="providerPorcelainApply" type="button">Применить тему</button><button class="secondary-button" id="providerPorcelainReset" type="button">Сбросить</button></div>
        <p id="providerPorcelainStatus" role="status" aria-live="polite"></p>
      </div>
      <aside class="provider-porcelain-live" aria-label="Живой предпросмотр кабинета">
        <h3>Ваш мобильный кабинет</h3><p>Текущая дата и данные вашего кабинета. Можно переключать разделы и прокручивать; изменения в предпросмотре недоступны.</p>
        <div class="provider-porcelain-live-frame"><iframe id="providerPorcelainPreview" title="Только чтение: ваш мобильный кабинет в выбранной теме" loading="lazy"></iframe></div>
        <p class="provider-porcelain-live-status" id="providerPorcelainPreviewStatus" role="status">Подключаем предпросмотр…</p>
      </aside>
    </div>`;
  appearanceCard.append(page);

  const imageFor = Object.freeze({
    pearl:'porcelain-character-pearl-v2.webp',
    petal:'porcelain-character-petal-v2.webp',
    silk:'porcelain-character-silk-v2.webp'
  });
  const frame = page.querySelector('#providerPorcelainPreview');
  const characterList = page.querySelector('#providerPorcelainDetailCharacters');
  const shadeList = page.querySelector('#providerPorcelainDetailShades');
  const status = page.querySelector('#providerPorcelainStatus');
  const previewStatus = page.querySelector('#providerPorcelainPreviewStatus');
  let saved = null;
  let draft = { ...defaultPair };

  function sendDraft() {
    if (!frame.contentWindow || !frame.src || frame.src === 'about:blank') return;
    frame.contentWindow.postMessage({ type:'minuta-porcelain-draft', ...draft }, location.origin);
  }
  function render() {
    page.dataset.porcelainCharacter = draft.character;
    const characterOptions = catalog.porcelainCharacters;
    page.querySelector('#providerPorcelainTagline').textContent = characterOptions.find(item => item.key === draft.character)?.tagline || '';
    characterList.innerHTML = characterOptions.map(item => `
      <label class="provider-porcelain-character">
        <input type="radio" name="providerPorcelainDetailCharacter" value="${item.key}" ${draft.character === item.key ? 'checked' : ''}>
        <img src="${imageFor[item.key]}" alt="" width="960" height="600" loading="lazy">
        <strong>${item.label}</strong><small>${item.tagline}</small>
      </label>`).join('');
    shadeList.innerHTML = matrix.shadesFor(draft.character).map(item => {
      const palette = matrix.paletteFor(draft.character, item.key);
      return `<label class="provider-porcelain-shade">
        <input type="radio" name="providerPorcelainDetailShade" value="${item.key}" aria-label="${item.label}" ${draft.shade === item.key ? 'checked' : ''}>
        <span class="provider-porcelain-shade-disc" style="--porcelain-swatch:linear-gradient(135deg,#fff,${palette.surfaceAlt} 48%,${palette.bg})" aria-hidden="true"></span>
        <strong>${item.label}</strong>${item.recommended ? '<em>Рекомендуем</em>' : ''}
      </label>`;
    }).join('');
    sendDraft();
  }
  function previewUrl() {
    const url = new URL('provider.html', location.href);
    url.searchParams.set('porcelain-preview', '1');
    url.searchParams.set('section', 'bookings');
    const currentDate = typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? selectedDate : new Date().toISOString().slice(0, 10);
    url.searchParams.set('date', currentDate);
    url.searchParams.set('range', 'day');
    url.searchParams.set('records', 'day');
    url.searchParams.set('journal', 'timeline');
    return url.href;
  }
  function openEditor() {
    saved = normalizeDisplayPreferences(displayPreferences);
    draft = saved.theme === 'pink-porcelain' ? {
      character:matrix.normalizeCharacter(saved.porcelain?.character),
      shade:matrix.normalizeShade(saved.porcelain?.shade)
    } : { ...defaultPair };
    status.textContent = '';
    previewStatus.textContent = 'Подключаем предпросмотр…';
    page.hidden = false;
    document.body.dataset.porcelainEditorOpen = 'true';
    render();
    frame.src = previewUrl();
    requestAnimationFrame(() => page.querySelector('#providerPorcelainTitle').focus({ preventScroll:true }));
    page.scrollIntoView({ block:'start' });
  }
  function closeEditor() {
    page.hidden = true;
    delete document.body.dataset.porcelainEditorOpen;
    frame.src = 'about:blank';
    saved = null;
    displayForm.querySelector('input[name="providerTheme"][value="pink-porcelain"]')?.focus({ preventScroll:true });
  }

  // The existing radio auto-saves. A click on Pink Porcelain instead opens a
  // separate draft editor; no preference changes until Apply is pressed.
  displayForm.addEventListener('click', event => {
    if (!event.target.closest('.provider-theme-option.theme-pink-porcelain')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openEditor();
  }, true);
  displayForm.addEventListener('keydown', event => {
    if (!event.target.matches('.theme-pink-porcelain input') || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openEditor();
  }, true);

  page.addEventListener('change', event => {
    if (event.target.name === 'providerPorcelainDetailCharacter') draft.character = matrix.normalizeCharacter(event.target.value);
    else if (event.target.name === 'providerPorcelainDetailShade') draft.shade = matrix.normalizeShade(event.target.value);
    else return;
    status.textContent = 'Изменения пока только в предпросмотре.';
    render();
  });
  page.querySelector('#providerPorcelainBack').addEventListener('click', closeEditor);
  page.querySelector('#providerPorcelainReset').addEventListener('click', () => {
    if (saved?.theme !== 'pink-porcelain') { closeEditor(); return; }
    draft = { character:matrix.normalizeCharacter(saved.porcelain?.character), shade:matrix.normalizeShade(saved.porcelain?.shade) };
    status.textContent = 'Восстановлен сохранённый выбор.';
    render();
  });
  page.querySelector('#providerPorcelainApply').addEventListener('click', () => {
    saveDisplayPreferences({ ...displayPreferences, theme:'pink-porcelain', color_mode:'light', porcelain:draft });
    saved = normalizeDisplayPreferences(displayPreferences);
    status.textContent = 'Тема применена к вашему кабинету.';
    sendDraft();
  });
  frame.addEventListener('load', sendDraft);
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'minuta-porcelain-preview-ready') return;
    previewStatus.textContent = 'Только просмотр · данные вашего кабинета';
    sendDraft();
  });
})();
