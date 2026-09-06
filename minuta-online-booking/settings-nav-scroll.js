/* Progressive enhancement: arrows reveal tabs without changing the active section. */
(() => {
  const nav = document.querySelector('[data-provider-panel="settings"] .provider-section-nav');
  if (!nav || nav.parentElement.classList.contains('settings-nav-scroll-shell')) return;
  const shell = document.createElement('div');
  shell.className = 'settings-nav-scroll-shell';
  nav.before(shell);
  shell.append(nav);
  nav.tabIndex = -1;
  const visibleTabs = () => [...nav.querySelectorAll('[data-section-target]')].filter(item => !item.hidden);
  const makeArrow = (direction, label, glyph) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `settings-nav-scroll-arrow ${direction < 0 ? 'is-prev' : 'is-next'}`;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<span aria-hidden="true">${glyph}</span>`;
    button.hidden = true;
    shell.append(button);
    button.addEventListener('click', () => {
      const rect = nav.getBoundingClientRect();
      const buttons = visibleTabs();
      const hidden = direction > 0
        ? buttons.find(item => item.getBoundingClientRect().right > rect.right - 44 + 1)
        : buttons.reverse().find(item => item.getBoundingClientRect().left < rect.left + 44 - 1);
      const itemRect = hidden?.getBoundingClientRect();
      const distance = itemRect
        ? direction > 0 ? itemRect.right - (rect.right - 44) : itemRect.left - (rect.left + 44)
        : direction * Math.max(44, nav.clientWidth - 88);
      nav.scrollBy({ left:distance, behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return button;
  };
  const prev = makeArrow(-1, 'Показать предыдущие вкладки настроек', '‹');
  const next = makeArrow(1, 'Показать следующие вкладки настроек', '›');
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
      const max = nav.scrollWidth - nav.clientWidth;
      for (const [button, visible] of [[prev, mobile && overflow && nav.scrollLeft > 1], [next, mobile && overflow && nav.scrollLeft < max - 1]]) {
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
