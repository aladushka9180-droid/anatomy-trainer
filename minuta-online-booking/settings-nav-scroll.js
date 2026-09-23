/* Mobile settings use one complete section picker; desktop keeps the visible section list. */
(() => {
  const nav = document.querySelector('[data-provider-panel="settings"] .provider-section-nav');
  if (!nav || nav.parentElement.classList.contains('settings-nav-scroll-shell')) return;

  const shell = document.createElement('div');
  shell.className = 'settings-nav-scroll-shell';
  nav.before(shell);

  const picker = document.createElement('details');
  picker.className = 'settings-section-picker';
  picker.innerHTML = '<summary aria-label="Выбрать раздел настроек"><span class="settings-section-picker-label">Раздел настроек</span><span class="settings-section-picker-current"></span><span class="settings-section-picker-chevron" aria-hidden="true"></span></summary><div class="settings-section-picker-menu" role="listbox" aria-label="Разделы настроек"></div>';
  const summary = picker.querySelector('summary');
  const current = picker.querySelector('.settings-section-picker-current');
  const menu = picker.querySelector('.settings-section-picker-menu');
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
    if (menu.dataset.signature !== signature) {
      menu.replaceChildren(...visible.map(button => {
        const item = document.createElement('button');
        item.type = 'button';
        item.dataset.settingsSectionTarget = button.dataset.sectionTarget;
        item.setAttribute('role', 'option');
        item.textContent = button.textContent.trim();
        return item;
      }));
      menu.dataset.signature = signature;
    }
    menu.querySelectorAll('[data-settings-section-target]').forEach(item => {
      const selected = item.dataset.settingsSectionTarget === selectedTarget;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    current.textContent = selectedButton?.textContent.trim() || '';
    picker.hidden = visible.length < 2;
  };

  const closePicker = ({ focus = false } = {}) => {
    if (!picker.open) return;
    picker.open = false;
    summary.setAttribute('aria-expanded', 'false');
    if (focus) summary.focus({ preventScroll:true });
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
  let viewportFrame = 0;
  const scheduleViewportRefresh = () => {
    if (viewportFrame) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      refresh();
      refreshStickyState();
    });
  };

  picker.addEventListener('toggle', () => {
    summary.setAttribute('aria-expanded', String(picker.open));
    if (picker.open) menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block:'nearest' });
  });
  menu.addEventListener('click', event => {
    const item = event.target.closest('[data-settings-section-target]');
    if (!item) return;
    const button = buttons().find(source => source.dataset.sectionTarget === item.dataset.settingsSectionTarget && !source.hidden);
    button?.click();
    refresh();
    closePicker({ focus:true });
  });
  nav.addEventListener('click', event => {
    if (!event.target.closest('[data-section-target]')) return;
    queueMicrotask(refresh);
  });
  document.addEventListener('pointerdown', event => { if (picker.open && !picker.contains(event.target)) closePicker(); }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !picker.open) return;
    event.preventDefault();
    closePicker({ focus:true });
  });
  document.addEventListener('scroll', event => {
    if (!picker.open || menu === event.target || menu.contains(event.target)) return;
    closePicker();
  }, { passive:true, capture:true });
  window.addEventListener('popstate', () => closePicker());
  new MutationObserver(refresh).observe(nav, { subtree:true, attributes:true, attributeFilter:['hidden'], childList:true });
  new MutationObserver(() => {
    const panel = picker.closest('[data-provider-panel="settings"]');
    if (panel?.hidden || !panel?.classList.contains('active')) closePicker();
  }).observe(picker.closest('[data-provider-panel="settings"]'), { attributes:true, attributeFilter:['hidden','class'] });
  document.addEventListener('scroll', scheduleStickyRefresh, { passive:true, capture:true });
  window.addEventListener('resize', scheduleViewportRefresh, { passive:true });
  refresh();
  summary.setAttribute('aria-expanded', 'false');
  refreshStickyState();
})();
