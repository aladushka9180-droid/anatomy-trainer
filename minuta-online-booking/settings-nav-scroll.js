/* Progressive enhancement: swipe stays available; arrows switch real sections. */
(() => {
  const nav = document.querySelector('[data-provider-panel="settings"] .provider-section-nav');
  if (!nav || nav.parentElement.classList.contains('settings-nav-scroll-shell')) return;
  const shell = document.createElement('div');
  shell.className = 'settings-nav-scroll-shell';
  nav.before(shell);
  shell.append(nav);
  nav.tabIndex = -1;
  const visibleTabs = () => [...nav.querySelectorAll('[data-section-target]')].filter(item => !item.hidden);
  const activeTab = tabs => tabs.find(item => item.classList.contains('active')) || tabs[0] || null;
  const centerTab = tab => {
    if (!tab || !nav.clientWidth) return;
    const left = tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2;
    nav.scrollTo({ left:Math.max(0, left), behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const makeArrow = (direction, label, glyph) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `settings-nav-scroll-arrow ${direction < 0 ? 'is-prev' : 'is-next'}`;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<span aria-hidden="true">${glyph}</span>`;
    button.hidden = true;
    shell.append(button);
    button.addEventListener('click', () => {
      const tabs = visibleTabs();
      const current = activeTab(tabs);
      const target = tabs[tabs.indexOf(current) + direction];
      if (!target) return;
      target.click();
      requestAnimationFrame(() => centerTab(target));
    });
    return button;
  };
  const prev = makeArrow(-1, 'Открыть предыдущий раздел настроек', '‹');
  const next = makeArrow(1, 'Открыть следующий раздел настроек', '›');
  let frame = 0;
  const refresh = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const mobile = matchMedia('(max-width:760px)').matches;
      // Measure the tabs themselves, independently of the reserved arrow space.
      const items = visibleTabs();
      const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
      const contentWidth = items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) + Math.max(0, items.length - 1) * gap;
      const overflow = nav.clientWidth > 0 && contentWidth > nav.clientWidth - 16;
      shell.classList.toggle('has-overflow', mobile && overflow);
      const currentIndex = items.indexOf(activeTab(items));
      for (const [button, visible] of [[prev, mobile && overflow && currentIndex > 0], [next, mobile && overflow && currentIndex >= 0 && currentIndex < items.length - 1]]) {
        if (!visible && document.activeElement === button) nav.focus({ preventScroll:true });
        button.hidden = !visible;
      }
    });
  };
  nav.addEventListener('scroll', refresh, { passive:true });
  window.addEventListener('resize', refresh, { passive:true });
  new ResizeObserver(refresh).observe(nav);
  new MutationObserver(refresh).observe(nav, { subtree:true, attributes:true, attributeFilter:['hidden','class'], childList:true });
  document.fonts?.ready.then(refresh);
  refresh();
})();
