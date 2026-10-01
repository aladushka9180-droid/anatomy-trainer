(function () {
  'use strict';

  // Presentation only. Existing controller, inputs, forms and write guards stay intact.
  const paths = {
    percent: '<path d="m6 18 12-12"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M21 11h-5v6h5M17 14h1"/>',
    history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    advance: '<path d="M18 6 6 18M6 8v10h10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  };
  function icon(name) {
    const template = document.createElement('template');
    template.innerHTML = `<svg class="payroll-soft-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
    return template.content.firstElementChild;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
  function setHidden(node, hidden) { if (node.hidden !== hidden) node.hidden = hidden; }

  function mount() {
    const panel = document.getElementById('payrollPanel');
    if (!panel || panel.dataset.payrollSoftMounted) return;
    const find = selector => panel.querySelector(selector);
    const workspace = find('#payrollWorkspace');
    const toolbar = find('.payroll-toolbar');
    const planCreator = find('#payrollPlanCreator');
    const periodCreator = find('#payrollPeriodCreator');
    if (!workspace || !toolbar || !planCreator || !periodCreator) return;
    panel.dataset.payrollSoftMounted = 'true';

    const dates = element('div', 'payroll-soft-dates');
    toolbar.prepend(dates);
    for (const id of ['payrollStartDate', 'payrollEndDate']) dates.append(find('#' + id).closest('label'));
    const enabled = find('#payrollEnabled');
    const enabledField = find('#payrollEnabledField');
    const enabledTitle = enabledField.querySelector('strong');
    enabledTitle.textContent = 'Учёт зарплаты';
    const enabledStatus = element('span', 'payroll-soft-status');
    enabledStatus.id = 'payrollEnabledStatus';
    enabledTitle.after(enabledStatus);
    enabled.setAttribute('role', 'switch');
    enabled.setAttribute('aria-describedby', 'payrollEnabledHint');
    const metrics = [...find('.payroll-summary').children];
    ['document', 'wallet', 'clock', 'advance'].forEach((name, index) => metrics[index].querySelector('small').prepend(icon(name)));

    const management = find('.payroll-management-grid');
    const rulesSection = find('#payrollPlansList').closest('section');
    const periodsSection = find('#payrollPeriodsList').closest('section');
    periodsSection.classList.add('payroll-soft-periods');
    const periodHeading = periodsSection.querySelector('.resource-subhead');
    periodHeading.prepend(icon('calendar'));
    periodHeading.querySelector('small').hidden = true;
    const periodsCount = find('#payrollPeriodsCount');
    periodsCount.setAttribute('aria-label', 'Количество расчётных периодов');
    periodHeading.append(periodsCount);
    const prepare = element('button', 'primary-button payroll-soft-prepare', 'Подготовить расчёт');
    prepare.type = 'button';
    prepare.prepend(icon('plus'));
    prepare.setAttribute('aria-controls', 'payrollPeriodCreator');
    periodHeading.append(prepare);
    periodCreator.classList.add('payroll-soft-proxy-target');
    const payment = find('#payrollPaymentPanel');
    const recordPayment = element('button', 'secondary-button payroll-soft-pay', 'Записать выплату');
    recordPayment.type = 'button';
    recordPayment.prepend(icon('wallet'));
    recordPayment.setAttribute('aria-controls', 'payrollPaymentPanel');
    periodsSection.append(recordPayment);
    workspace.insertBefore(periodsSection, management);

    const setup = element('section', 'payroll-soft-setup');
    setup.setAttribute('aria-label', 'Настройка начислений');
    const setupTile = element('div', 'payroll-soft-tile');
    setupTile.append(icon('percent'));
    const setupCopy = element('div', 'payroll-soft-setup-copy');
    setupCopy.append(element('strong', '', 'Начните с правила начисления'));
    const setupNote = element('p', '');
    setupCopy.append(setupNote);
    const addRule = element('button', 'primary-button payroll-soft-add-rule', 'Добавить правило');
    addRule.type = 'button';
    addRule.prepend(icon('plus'));
    addRule.setAttribute('aria-controls', 'payrollPlanCreator');
    setup.append(setupTile, setupCopy, addRule);
    workspace.insertBefore(setup, periodsSection);

    const folds = element('div', 'payroll-soft-folds');
    workspace.append(folds);
    function wrapSection(section, id, title, symbol, count) {
      const details = element('details', 'payroll-soft-fold');
      details.id = id;
      const summary = element('summary', '');
      summary.append(icon(symbol), element('span', 'payroll-soft-fold-label', title));
      if (count) summary.append(count);
      const chevron = icon('chevron');
      chevron.classList.add('payroll-soft-chevron');
      summary.append(chevron);
      section.classList.add('payroll-soft-fold-content');
      section.querySelector('.resource-subhead').hidden = true;
      details.append(summary, section);
      folds.append(details);
      return details;
    }
    const rules = wrapSection(rulesSection, 'payrollRulesDisclosure', 'Правила начисления', 'percent', find('#payrollPlansCount'));
    const ledger = find('#payrollLedgerActions');
    const operations = wrapSection(ledger, 'payrollOperationsDisclosure', 'Выплаты и корректировки', 'wallet');
    for (const [selector, symbol] of [['.payroll-items', 'document'], ['#payrollAuditPanel', 'history']]) {
      const details = find(selector);
      details.classList.add('payroll-soft-fold');
      details.open = false;
      const summary = details.querySelector('summary');
      summary.prepend(icon(symbol));
      summary.querySelector('strong').classList.add('payroll-soft-fold-label');
      const chevron = icon('chevron');
      chevron.classList.add('payroll-soft-chevron');
      summary.append(chevron);
      folds.append(details);
    }
    management.remove();

    function openCreator(creator) {
      // Native disclosure keeps the controller's unsaved-form guard and toggle handling.
      const summary = creator.querySelector('summary');
      if (!creator.open) summary.click();
      if (creator === planCreator) summary.focus();
    }
    addRule.addEventListener('click', () => { rules.open = true; openCreator(planCreator); });
    prepare.addEventListener('click', () => {
      if (periodCreator.open) periodCreator.open = false;
      else openCreator(periodCreator);
    });
    recordPayment.addEventListener('click', () => {
      operations.open = true;
      openCreator(payment);
      payment.querySelector('summary').focus();
    });

    const observe = { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] };
    let scheduled = false;
    const observer = new MutationObserver(scheduleSync);
    function sync() {
      scheduled = false;
      observer.disconnect();
      setText(enabledStatus, enabled.checked ? 'Включён' : 'Выключен');
      setText(find('#payrollEnabledHint'), 'Включение само по себе не создаёт начислений и выплат.');
      const debt = Number(find('#payrollDebtTotal').textContent.replace(/[^\d,.\-]/g, '').replace(',', '.'));
      metrics[2].classList.toggle('is-debt', debt > 0);
      for (const metric of metrics) {
        const amount = metric.querySelector('strong');
        amount.classList.toggle('payroll-soft-long-total', amount.textContent.length >= 12);
      }
      const firstSetup = !planCreator.hidden && !find('#payrollPlansList .payroll-plan-row') && !find('#payrollPeriodsList .payroll-period-row');
      setHidden(setup, !firstSetup || (rules.open && planCreator.open));
      setHidden(periodsSection, firstSetup);
      setText(setupNote, enabled.checked
        ? 'Укажите процент для сотрудника. Затем подготовьте расчёт.'
        : 'Укажите процент для сотрудника. Затем включите учёт и подготовьте расчёт.');
      setHidden(prepare, periodCreator.hidden);
      prepare.setAttribute('aria-expanded', String(periodCreator.open));
      setHidden(recordPayment, ledger.hidden || payment.hidden);
      recordPayment.setAttribute('aria-expanded', String(operations.open && payment.open));
      setHidden(operations, ledger.hidden);
      if (workspace.hidden) { rules.open = false; operations.open = false; }
      observer.observe(workspace, observe);
    }
    function scheduleSync() {
      // After controller promises settle, including a rejected switch change.
      if (!scheduled) { scheduled = true; requestAnimationFrame(sync); }
    }
    workspace.addEventListener('toggle', event => {
      // The controller may reject an opening because another form is dirty.
      // Reveal that retained form, including the period whose native summary is replaced.
      if (event.newState === 'open' && !event.target.open) {
        const retained = workspace.querySelector('#payrollPlanCreator[open], #payrollPeriodCreator[open], .payroll-action-card[open]');
        if (retained) {
          const fold = retained.closest('.payroll-soft-fold');
          if (fold) fold.open = true;
          (retained === periodCreator ? prepare : retained.querySelector('summary')).focus();
        }
      }
      scheduleSync();
    }, true);
    enabled.addEventListener('change', scheduleSync);
    sync();
  }

  window.MinutaPayrollPresentation = { mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
