/* Mobile settings use one complete section picker; desktop keeps the visible section list. */
(() => {
  const nav = document.querySelector('[data-provider-panel="settings"] .provider-section-nav');
  if (!nav || nav.parentElement.classList.contains('settings-nav-scroll-shell')) return;

  const shell = document.createElement('div');
  shell.className = 'settings-nav-scroll-shell';
  nav.before(shell);

  const picker = document.createElement('label');
  picker.className = 'settings-section-picker';
  picker.innerHTML = '<span>Раздел настроек</span><select aria-label="Раздел настроек"></select>';
  const select = picker.querySelector('select');
  shell.append(picker, nav);

  const buttons = () => [...nav.querySelectorAll('[data-section-target]')];
  const refresh = () => {
    const visible = buttons().filter(button => !button.hidden);
    const selectedTarget = visible.find(button => button.getAttribute('aria-current') === 'location')?.dataset.sectionTarget
      || visible[0]?.dataset.sectionTarget
      || '';
    const signature = visible.map(button => `${button.dataset.sectionTarget}:${button.textContent.trim()}`).join('|');
    if (select.dataset.signature !== signature) {
      select.innerHTML = visible.map(button => `<option value="${button.dataset.sectionTarget}">${button.textContent.trim()}</option>`).join('');
      select.dataset.signature = signature;
    }
    select.value = selectedTarget;
    picker.hidden = visible.length < 2;
  };

  select.addEventListener('change', () => {
    const button = buttons().find(item => item.dataset.sectionTarget === select.value && !item.hidden);
    button?.click();
  });
  new MutationObserver(refresh).observe(nav, { subtree:true, attributes:true, attributeFilter:['hidden','class','aria-current'], childList:true });
  refresh();
})();
