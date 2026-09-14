/* Mobile settings use one complete section picker; desktop keeps the visible section list. */
(() => {
  const nav = document.querySelector('[data-provider-panel="settings"] .provider-section-nav');
  if (!nav || nav.parentElement.classList.contains('settings-nav-scroll-shell')) return;

  const shell = document.createElement('div');
  shell.className = 'settings-nav-scroll-shell';
  nav.before(shell);

  const picker = document.createElement('label');
  picker.className = 'settings-section-picker';
  picker.innerHTML = '<span class="settings-section-picker-label">Раздел настроек</span><span class="settings-section-picker-current" aria-hidden="true"></span><span class="settings-section-picker-chevron" aria-hidden="true"></span><select aria-label="Раздел настроек"></select>';
  const select = picker.querySelector('select');
  const current = picker.querySelector('.settings-section-picker-current');
  shell.append(picker, nav);

  const buttons = () => [...nav.querySelectorAll('[data-section-target]')];
  const refresh = () => {
    const visible = buttons().filter(button => !button.hidden);
    const selectedButton = visible.find(button => button.getAttribute('aria-current') === 'location')
      || visible.find(button => button.classList.contains('active'))
      || visible[0];
    const selectedTarget = selectedButton?.dataset.sectionTarget
      || '';
    const signature = visible.map(button => `${button.dataset.sectionTarget}:${button.textContent.trim()}`).join('|');
    if (select.dataset.signature !== signature) {
      select.innerHTML = visible.map(button => `<option value="${button.dataset.sectionTarget}">${button.textContent.trim()}</option>`).join('');
      select.dataset.signature = signature;
    }
    select.value = selectedTarget;
    current.textContent = selectedButton?.textContent.trim() || '';
    picker.hidden = visible.length < 2;
  };

  let stickyFrame = 0;
  const refreshStickyState = () => {
    stickyFrame = 0;
    const mobile = matchMedia('(max-width:760px)').matches;
    const stickyTop = Number.parseFloat(getComputedStyle(shell).top) || 0;
    shell.classList.toggle('is-stuck', mobile && shell.getBoundingClientRect().top <= stickyTop + .5 && scrollY > 0);
  };
  const scheduleStickyRefresh = () => {
    if (!stickyFrame) stickyFrame = requestAnimationFrame(refreshStickyState);
  };

  select.addEventListener('change', () => {
    const button = buttons().find(item => item.dataset.sectionTarget === select.value && !item.hidden);
    button?.click();
    refresh();
  });
  new MutationObserver(refresh).observe(nav, { subtree:true, attributes:true, attributeFilter:['hidden','class','aria-current'], childList:true });
  document.addEventListener('scroll', scheduleStickyRefresh, { passive:true, capture:true });
  window.addEventListener('resize', scheduleStickyRefresh, { passive:true });
  refresh();
  refreshStickyState();
})();
