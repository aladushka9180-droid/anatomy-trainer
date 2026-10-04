/* Presentation for the approved return-clients mobile screen. Original controls
   retain permissions, section activation, writes and confirmed clipboard state. */
(() => {
  'use strict';
  const scriptUrl = document.currentScript?.src;
  function initialize() {
  const panel = document.getElementById('retentionPanel');
  const workspace = document.getElementById('organizationWorkspace');
  const nav = document.getElementById('organizationSectionNav');
  if (!panel || panel.dataset.retentionMobileReady) return;
  panel.dataset.retentionMobileReady = 'true';
  const mobile = window.matchMedia('(max-width:999px)');
  const glyph = name => {
    const paths = {
      building:'<path d="M5 21V3h10v18M15 9h4v12M3 21h18M8 7h4M8 11h4M8 15h4M8 19h4"/>',
      settings:'<circle cx="12" cy="12" r="3"/><path d="m9 3-.6 2.2-2 .9-2-.7-2 3.5 1.6 1.5v2.3l-1.6 1.5 2 3.5 2-.7 2 .9L9 21h4l.6-2.1 2-.9 2 .7 2-3.5-1.6-1.5v-2.3L19.6 10l-2-3.5-2 .7-2-.9L13 3Z"/>',
      document:'<path d="M6 3h8l4 4v14H6Z M14 3v5h4M9 12h6M9 16h4"/>',
      chevron:'<path d="m9 5 7 7-7 7"/>'
    };
    return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  };
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const permitted = button => !button.hidden && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  const toggleClass = (element, name, value) => {
    if (element && element.classList.contains(name) !== Boolean(value)) element.classList.toggle(name, Boolean(value));
  };
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  let navigation, groupSelect, sectionSelect, settings, settingsSummary;
  let scheduled = false;

  function updateNavigation() {
    const shell = nav?.closest('.organization-group-navigation');
    const groupButtons = shell?.querySelectorAll('[data-organization-group]');
    if (!workspace || !shell || !groupButtons?.length) return;
    if (!navigation) {
      navigation = node('div', 'retention-mobile-navigation');
      const top = node('div', 'retention-mobile-navigation-top');
      const title = node('span', 'retention-mobile-organization');
      title.innerHTML = glyph('building'); title.append(node('span', '', 'Организация'));
      const groups = node('label', 'retention-mobile-group-field');
      groupSelect = node('select'); groupSelect.id = 'retentionMobileGroup';
      groupSelect.setAttribute('aria-label', 'Группа разделов организации');
      groups.append(groupSelect);
      const sections = node('label', 'retention-mobile-section-field');
      sectionSelect = node('select'); sectionSelect.id = 'retentionMobileSection';
      sectionSelect.setAttribute('aria-label', 'Раздел организации');
      sections.append(sectionSelect); top.append(title, groups); navigation.append(top, sections); shell.append(navigation);
      groupSelect.addEventListener('change', () => {
        const target = [...groupButtons].find(button => button.dataset.organizationGroup === groupSelect.value);
        if (target && permitted(target)) target.click();
        schedule();
      });
      sectionSelect.addEventListener('change', () => {
        const target = [...nav.querySelectorAll('[data-section-target]')].find(button => button.dataset.sectionTarget === sectionSelect.value);
        if (target && permitted(target) && !target.hasAttribute('data-organization-group-inactive')) target.click();
        schedule();
      });
    }
    const replaceOptions = (select, buttons, key, selected) => {
      const signature = buttons.map(button => `${button.dataset[key]}:${button.textContent}`).join('|');
      if (select.dataset.options !== signature) {
        select.replaceChildren(...buttons.map(button => {
          const option = node('option', '', button.textContent.trim()); option.value = button.dataset[key]; return option;
        }));
        select.dataset.options = signature;
      }
      if (select.value !== selected) select.value = selected;
    };
    const groups = [...groupButtons].filter(permitted);
    const sections = [...nav.querySelectorAll('[data-section-target]')].filter(button => permitted(button) && !button.hasAttribute('data-organization-group-inactive'));
    replaceOptions(groupSelect, groups, 'organizationGroup', nav.dataset.activeOrganizationGroup || '');
    replaceOptions(sectionSelect, sections, 'sectionTarget', nav.dataset.activeSectionTarget || sections.find(button => button.classList.contains('active'))?.dataset.sectionTarget || '');
    const active = mobile.matches && !panel.hidden && sectionSelect.value === 'retentionPanel';
    toggleClass(workspace, 'retention-mobile-active', active);
    toggleClass(workspace.closest('[data-provider-panel="organization"]'), 'retention-mobile-view', active);
  }

  function updateSettings() {
    const form = panel.querySelector('#retentionSettingsForm');
    if (!form) return;
    if (!settings) {
      settings = node('details', 'retention-settings-disclosure'); settings.id = 'retentionSettingsDisclosure';
      settings.open = !mobile.matches;
      const summary = node('summary');
      summary.innerHTML = glyph('settings'); summary.append(node('span', 'retention-settings-label', 'Настройки подбора'));
      settingsSummary = node('span', 'retention-settings-summary'); summary.append(settingsSummary);
      summary.insertAdjacentHTML('beforeend', glyph('chevron'));
      form.before(settings); settings.append(summary, form);
    }
    if (settings.hidden !== form.hidden) settings.hidden = form.hidden;
    const days = Number(panel.querySelector('#retentionInactivityDays')?.value);
    const enabled = panel.querySelector('#retentionEnabled')?.checked;
    setText(settingsSummary, enabled && Number.isFinite(days) ? `Перерыв от ${days} дней` : 'Подбор выключен');
  }

  function updateRows() {
    panel.querySelectorAll('.retention-client-row').forEach(row => {
      const checkbox = row.querySelector('[data-retention-select]');
      toggleClass(row, 'retention-client-selected', checkbox?.checked);
      const consent = row.querySelector('[data-retention-consent]');
      const summary = row.querySelector('.retention-client-options>summary');
      if (consent && summary) {
        const label = consent.value === 'granted' ? 'Есть согласие' : consent.value === 'revoked' ? 'Клиент отказался' : 'Согласие не указано';
        if (!summary.querySelector('.retention-consent-mobile')) {
          summary.replaceChildren(node('span', 'retention-consent-desktop', summary.textContent));
          const mobileLabel = node('span', 'retention-consent-mobile');
          mobileLabel.innerHTML = glyph('document'); mobileLabel.append(node('span'));
          mobileLabel.insertAdjacentHTML('beforeend', glyph('chevron')); summary.append(mobileLabel);
        }
        setText(summary.querySelector('.retention-consent-mobile>span'), label);
      }
      const main = row.querySelector('.organization-row-main');
      const metadata = main?.querySelector('small');
      if (metadata && !metadata.dataset.retentionMetadata) {
        const parts = metadata.textContent.split(' · ');
        if (parts.length > 1 && /^\+?[\d\s()\-]+$/.test(parts[0].trim())) {
          const phone = parts.shift();
          const visits = node('span', 'retention-client-visits');
          const original = parts.join(' · ');
          const concise = original.replace(/^Последний визит /, '').replace(/ г\./, '').replace(/завершено (\d+)/, (_, count) => {
            const number = Number(count), one = number % 10 === 1 && number % 100 !== 11;
            const few = number % 10 >= 2 && number % 10 <= 4 && (number % 100 < 12 || number % 100 > 14);
            return `${count} ${one ? 'завершённый визит' : few ? 'завершённых визита' : 'завершённых визитов'}`;
          });
          visits.append(node('span', 'retention-visits-desktop', ` · ${original}`), node('span', 'retention-visits-mobile', concise));
          metadata.replaceChildren(node('span', 'retention-client-phone', phone), visits);
        }
        metadata.dataset.retentionMetadata = 'true';
      }
    });
    panel.querySelectorAll('.retention-message-snapshot').forEach(snapshot => {
      if (snapshot.closest('.retention-message-disclosure')) return;
      const disclosure = node('details', 'retention-message-disclosure');
      const summary = node('summary');
      summary.append(node('span', 'retention-message-excerpt', snapshot.textContent), node('span', 'retention-message-expand', 'Показать текст'));
      disclosure.open = !mobile.matches;
      snapshot.before(disclosure); disclosure.append(summary, snapshot);
      const expandLabel = summary.querySelector('.retention-message-expand');
      const updateLabel = () => setText(expandLabel, disclosure.open ? 'Свернуть текст' : 'Показать текст');
      disclosure.addEventListener('toggle', updateLabel); updateLabel();
    });
    panel.querySelectorAll('.retention-delivery-row>.organization-row-main>small:first-of-type').forEach(status => {
      if (status.textContent !== 'Подготовлено · не отправлено') return;
      status.replaceChildren(node('span', 'retention-delivery-status-desktop', status.textContent), node('span', 'retention-delivery-status-mobile', 'Не отправлено'));
    });
    const batch = panel.querySelector('[data-retention-prepare-selected]');
    if (batch) {
      const busy = batch.dataset.retentionBusy === 'true';
      if (busy && !batch.dataset.retentionIdleLabel) {
        batch.dataset.retentionIdleLabel = batch.textContent; setText(batch, 'Подготавливаем…'); batch.setAttribute('aria-busy', 'true');
      } else if (!busy && batch.dataset.retentionIdleLabel) {
        setText(batch, batch.dataset.retentionIdleLabel); delete batch.dataset.retentionIdleLabel; batch.removeAttribute('aria-busy');
      }
    }
  }
  function update() { updateNavigation(); updateSettings(); updateRows(); }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; update(); });
  }
  new MutationObserver(schedule).observe(panel, { subtree:true, childList:true, attributes:true, attributeFilter:['hidden', 'disabled', 'data-retention-busy'] });
  if (nav) new MutationObserver(schedule).observe(nav, { subtree:true, childList:true, attributes:true, attributeFilter:['hidden', 'disabled', 'aria-disabled', 'class', 'data-active-section-target', 'data-active-organization-group', 'data-organization-group-inactive'] });
  panel.addEventListener('input', schedule); panel.addEventListener('change', schedule);
  const onResize = () => {
    if (settings) settings.open = !mobile.matches;
    panel.querySelectorAll('.retention-message-disclosure').forEach(disclosure => { disclosure.open = !mobile.matches; });
    schedule();
  };
  mobile.addEventListener('change', onResize);
  update();
  }
  // Loaded through the existing lazy-controller loader; keep these assets out
  // of the cabinet's initial route and leave the original UI intact on failure.
  if (scriptUrl) {
    const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet';
    stylesheet.href = scriptUrl.replace(/\.js(?=\?|$)/, '.css');
    stylesheet.addEventListener('load', initialize, { once:true });
    document.head.append(stylesheet);
  } else initialize();
})();
