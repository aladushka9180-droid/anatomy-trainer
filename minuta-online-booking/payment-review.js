(function () {
  'use strict';

  function init() {
    const panel = document.querySelector('#paymentProviderPanel');
    const form = document.querySelector('#paymentProviderSettingsForm');
    const workspace = document.querySelector('#paymentProviderWorkspace');
    const environment = document.querySelector('#paymentProviderEnvironment');
    const providerState = document.querySelector('#paymentProviderState');
    const sandboxState = document.querySelector('#paymentSandboxState');
    if (!panel || !form || !workspace || !environment || !providerState || !sandboxState) return;

    const review = document.createElement('section');
    review.id = 'paymentProviderReview';
    review.className = 'organization-invite-help';
    review.setAttribute('aria-live', 'polite');
    review.innerHTML = '<strong>Состояние подключения</strong><p id="paymentProviderReviewMode"></p><p id="paymentProviderReviewTest"></p><p id="paymentProviderReviewRights"></p><div id="paymentProviderProductionReview" hidden><strong>Перед включением рабочего магазина</strong><p>Внутренняя проверка не подтверждает подключение к ЮKassa. Проверьте тестовый магазин и настройки чеков; включение рабочего магазина требует отдельной проверки и решения ответственного.</p><label class="settings-check"><input id="paymentProviderProductionAcknowledged" type="checkbox"><span>Я ознакомился с режимом и результатом проверки.</span></label><p id="paymentProviderReviewNotice" role="status"></p></div>';
    form.before(review);
    const mode = review.querySelector('#paymentProviderReviewMode');
    const test = review.querySelector('#paymentProviderReviewTest');
    const rights = review.querySelector('#paymentProviderReviewRights');
    const production = review.querySelector('#paymentProviderProductionReview');
    const acknowledged = review.querySelector('#paymentProviderProductionAcknowledged');
    const notice = review.querySelector('#paymentProviderReviewNotice');
    let savedEnvironment = environment.value;

    function render() {
      review.hidden = panel.hidden || workspace.hidden;
      if (review.hidden) { acknowledged.checked = false; notice.textContent = ''; return; }
      const savedMode = savedEnvironment === 'production' ? 'рабочий' : 'тестовый';
      mode.textContent = `${providerState.textContent.trim()}. Сохранённый режим: ${savedMode} магазин.`;
      test.textContent = `Внутренний тест: ${sandboxState.textContent.trim().toLowerCase() || 'нет результата'}. Он не проверяет ЮKassa.`;
      rights.textContent = form.hidden
        ? 'Доступ: администратор может просматривать; изменить настройки может владелец.'
        : 'Доступ: владелец может изменить настройки.';
      production.hidden = form.hidden || environment.value !== 'production';
      if (production.hidden) { acknowledged.checked = false; notice.textContent = ''; }
    }

    new MutationObserver(() => { savedEnvironment = environment.value; acknowledged.checked = false; render(); })
      .observe(providerState, { childList:true, characterData:true, subtree:true });
    new MutationObserver(render).observe(sandboxState, { childList:true, characterData:true, subtree:true });
    new MutationObserver(render).observe(form, { attributes:true, attributeFilter:['hidden'] });
    new MutationObserver(render).observe(panel, { attributes:true, attributeFilter:['hidden'] });
    new MutationObserver(render).observe(workspace, { attributes:true, attributeFilter:['hidden'] });
    environment.addEventListener('change', render);
    document.addEventListener('submit', event => {
      if (event.target !== form || environment.value !== 'production' || acknowledged.checked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      notice.textContent = 'Перед сохранением рабочего режима прочитайте условия проверки и подтвердите ознакомление.';
      acknowledged.focus();
    }, true);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
