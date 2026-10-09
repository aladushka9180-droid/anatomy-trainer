(function () {
  'use strict';

  // Presentation only: move the existing controls so their ids and handlers survive.
  const icons = {
    card:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/>',
    receipt:'<path d="M6 3l3 2 3-2 3 2 3-2v18l-3-2-3 2-3-2-3 2V3Z M9 9h6M9 13h6"/>',
    settings:'<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
    history:'<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2"/>',
    flask:'<path d="M9 3h6M10 3v6L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3M8 14h8"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7h.01"/>',
    link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('payment-soft-icon');
    svg.innerHTML = icons[name] || icons.info;
    return svg;
  }
  function heading(text, name) {
    const node = document.createElement('h4');
    node.className = 'payment-soft-heading';
    node.append(icon(name), document.createTextNode(text));
    return node;
  }
  function mountSoftUI(panel, form, workspace) {
    panel.classList.add('payment-soft-panel');
    const title = panel.querySelector('.panel-head h3');
    title.textContent = 'Предоплата через ЮКассу';
    title.prepend(icon('card'));
    const state = panel.querySelector('#paymentProviderState');
    const badges = document.createElement('div');
    badges.className = 'payment-soft-badges';
    state.before(badges);
    const compact = document.createElement('span');
    compact.id = 'paymentSoftStatus';
    compact.className = 'payment-soft-badge';
    compact.setAttribute('role', 'status');
    compact.setAttribute('aria-live', 'polite');
    const mode = document.createElement('span');
    mode.id = 'paymentSoftMode';
    mode.className = 'payment-soft-badge payment-soft-mode';
    badges.append(state, compact, mode);
    state.classList.add('payment-soft-visually-hidden');
    state.setAttribute('aria-hidden', 'true');

    const helpHost = panel.querySelector('[data-contextual-help]');
    const decorateHelp = () => {
      const trigger = helpHost?.querySelector('.contextual-help__trigger');
      if (!trigger || trigger.querySelector('.payment-soft-icon')) return;
      trigger.textContent = 'Как подключить оплату';
      trigger.prepend(icon('info'));
    };
    if (helpHost) new MutationObserver(decorateHelp).observe(helpHost, {childList:true, subtree:true});
    decorateHelp();

    form.prepend(heading('Настройки оплаты', 'settings'));
    const controls = panel.querySelector('#paymentProviderControls');
    const receipt = panel.querySelector('#paymentFiscalizationEnabled').closest('label');
    controls.prepend(receipt);
    for (const [id, name, text, hint] of [
      ['paymentProviderEnabled','card','Принимать предоплату','После настройки и проверки подключения'],
      ['paymentFiscalizationEnabled','receipt','Отправлять чеки','Согласуйте параметры с бухгалтером']
    ]) {
      const input = panel.querySelector(`#${id}`);
      const label = input.closest('label');
      label.classList.add('payment-soft-setting');
      label.querySelector('strong').textContent = text;
      label.querySelector('small').textContent = hint;
      label.prepend(icon(name));
      label.append(input);
    }
    const footer = document.createElement('div');
    footer.className = 'payment-soft-footer';
    const submit = form.querySelector('button[type="submit"]');
    submit.before(footer);
    const hint = document.createElement('p');
    hint.id = 'paymentSoftSaveHint';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    footer.append(submit, hint);
    const operations = panel.querySelector('#paymentAttemptsList').closest('section');
    operations.classList.add('payment-soft-operations');
    const operationsHead = operations.querySelector('.resource-subhead');
    operationsHead.querySelector('strong').prepend(icon('history'));
    const sandbox = panel.querySelector('#paymentSandboxDisclosure');
    sandbox.querySelector('summary').prepend(icon('flask'));
    sandbox.querySelector('summary strong').textContent = 'Внутренняя проверка';
    workspace.after(sandbox);
    const integrations = panel.querySelector('#providerIntegrationsDisclosure');
    integrations?.querySelector('summary').prepend(icon('link'));
    return { compact, mode, footer, hint, sandbox };
  }

  function init() {
    const panel = document.querySelector('#paymentProviderPanel');
    const form = document.querySelector('#paymentProviderSettingsForm');
    const workspace = document.querySelector('#paymentProviderWorkspace');
    const environment = document.querySelector('#paymentProviderEnvironment');
    const providerState = document.querySelector('#paymentProviderState');
    const sandboxState = document.querySelector('#paymentSandboxState');
    if (!panel || !form || !workspace || !environment || !providerState || !sandboxState
      || document.querySelector('#paymentProviderReview')) return;

    const soft = mountSoftUI(panel, form, workspace);

    const review = document.createElement('section');
    review.id = 'paymentProviderReview';
    review.className = 'payment-soft-review';
    review.innerHTML = '<details class="ux-disclosure"><summary>Состояние подключения</summary><p id="paymentProviderReviewMode"></p><p id="paymentProviderReviewTest"></p><p id="paymentProviderReviewRights"></p></details><div id="paymentProviderProductionReview" hidden><strong>Перед включением рабочего магазина</strong><p>Проверьте оплату и чек в тестовом магазине ЮKassa с выбранными настройками. Внутренняя проверка Eldion не подтверждает подключение к ЮKassa.</p><label class="settings-check"><input id="paymentProviderExternalTestConfirmed" type="checkbox"><span>Я успешно проверил оплату и чек в тестовом магазине ЮKassa для этих настроек.</span></label><label class="settings-check"><input id="paymentProviderProductionAcknowledged" type="checkbox"><span>Я проверил настройки и подтверждаю включение рабочего магазина.</span></label><p id="paymentProviderReviewNotice" role="status"></p></div>';
    soft.sandbox.after(review);
    review.querySelector('summary').prepend(icon('info'));
    const mode = review.querySelector('#paymentProviderReviewMode');
    const test = review.querySelector('#paymentProviderReviewTest');
    const rights = review.querySelector('#paymentProviderReviewRights');
    const production = review.querySelector('#paymentProviderProductionReview');
    const externalTest = review.querySelector('#paymentProviderExternalTestConfirmed');
    const acknowledged = review.querySelector('#paymentProviderProductionAcknowledged');
    const notice = review.querySelector('#paymentProviderReviewNotice');
    soft.footer.before(production);
    let savedEnvironment = environment.value;
    const fields = ['paymentProviderEnabled', 'paymentProviderEnvironment', 'paymentFiscalizationEnabled', 'paymentTaxation', 'paymentVatCode', 'paymentMode'];
    const values = () => fields.map(id => {
      const field = document.getElementById(id);
      return field.type === 'checkbox' ? field.checked : field.value;
    });
    let savedValues = values();
    let testedValues = null;
    const fingerprint = () => JSON.stringify(values());
    function clearConfirmation() {
      testedValues = null;
      externalTest.checked = false;
      acknowledged.checked = false;
    }
    const externalTestCurrent = () => externalTest.checked && testedValues === fingerprint()
      && !form.hidden && !workspace.hidden && !panel.hidden;
    window.MinutaPaymentProductionReview = Object.freeze({ canEnable:() => externalTestCurrent() && acknowledged.checked });
    externalTest.addEventListener('change', () => {
      testedValues = externalTest.checked ? fingerprint() : null;
      acknowledged.checked = false;
      notice.textContent = '';
    });
    document.addEventListener('payment-settings-reset', clearConfirmation);
    form.addEventListener('input', event => {
      if (fields.includes(event.target.id)) clearConfirmation();
    });
    form.addEventListener('change', event => {
      if (fields.includes(event.target.id)) clearConfirmation();
    });
    function renderDraft() {
      const dirty = values().some((value, index) => value !== savedValues[index]);
      soft.hint.textContent = dirty ? 'Есть несохранённые изменения' : 'Изменений нет';
      soft.hint.dataset.dirty = String(dirty);
    }

    function render() {
      review.hidden = panel.hidden || workspace.hidden;
      soft.mode.hidden = review.hidden;
      if (review.hidden) { soft.compact.textContent = 'Не проверено'; soft.compact.dataset.enabled = 'false'; soft.compact.setAttribute('aria-label', 'Состояние предоплаты не проверено'); clearConfirmation(); notice.textContent = ''; production.hidden = true; return; }
      const savedMode = savedEnvironment === 'production' ? 'рабочий' : 'тестовый';
      mode.textContent = `${providerState.textContent.trim()}. Сохранённый режим: ${savedMode} магазин.`;
      const enabled = providerState.textContent.includes('Приём включён в настройках');
      soft.compact.textContent = enabled ? 'Включена в настройках' : 'Выключена';
      soft.compact.setAttribute('aria-label', providerState.textContent.trim());
      soft.compact.dataset.enabled = String(enabled);
      soft.mode.textContent = savedEnvironment === 'production' ? 'Рабочий магазин' : 'Тестовый магазин';
      test.textContent = `Внутренний тест: ${sandboxState.textContent.trim().toLowerCase() || 'нет результата'}. Он не проверяет ЮKassa.`;
      rights.textContent = form.hidden
        ? 'Доступ: администратор может просматривать; изменить настройки может владелец.'
        : 'Доступ: владелец может изменить настройки.';
      production.hidden = form.hidden || environment.value !== 'production';
      if (production.hidden) { clearConfirmation(); notice.textContent = ''; }
    }

    new MutationObserver(() => { savedEnvironment = environment.value; savedValues = values(); clearConfirmation(); renderDraft(); render(); })
      .observe(providerState, { childList:true, characterData:true, subtree:true });
    new MutationObserver(render).observe(sandboxState, { childList:true, characterData:true, subtree:true });
    new MutationObserver(render).observe(form, { attributes:true, attributeFilter:['hidden'] });
    new MutationObserver(render).observe(panel, { attributes:true, attributeFilter:['hidden'] });
    new MutationObserver(render).observe(workspace, { attributes:true, attributeFilter:['hidden'] });
    environment.addEventListener('change', render);
    form.addEventListener('change', renderDraft);
    document.addEventListener('submit', event => {
      if (event.target !== form || environment.value !== 'production' || !document.querySelector('#paymentProviderEnabled').checked) return;
      const tested = externalTestCurrent();
      if (tested && acknowledged.checked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!tested) {
        clearConfirmation();
        notice.textContent = 'Сначала подтвердите успешный тест оплаты и чека в тестовом магазине ЮKassa для этих настроек.';
        externalTest.focus();
      } else {
        notice.textContent = 'Проверьте настройки и подтвердите включение рабочего магазина.';
        acknowledged.focus();
      }
    }, true);
    renderDraft();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
