(() => {
  'use strict';
  const panel = document.querySelector('[data-provider-panel="clients"]');
  if (!panel) return;
  let preparation;
  function prepare() {
    const toolbar = panel.querySelector(':scope > .clients-search-tools');
    const list = panel.querySelector('#clientsList');
    if (!toolbar || !list) return false;
    preparation?.disconnect();
    panel.classList.add('clients-soft');
    const description = panel.querySelector(':scope > .view-description');
    if (description) description.textContent = 'История визитов и заметки';
    const help = panel.querySelector('.clients-directory > [data-contextual-help]');
    if (help) toolbar.append(help);
    const syncCounts = () => {
      list.querySelectorAll('.client-list-item').forEach(row => {
        const count = row.querySelector(':scope > b');
        const frameCount = row.querySelector(':scope > .client-framed-avatar .client-framed-count');
        // Different totals remain visible; only a proven duplicate becomes a chevron.
        row.classList.toggle('client-count-on-frame', Boolean(count && frameCount
          && count.textContent.trim() === frameCount.textContent.trim()));
      });
    };
    new MutationObserver(syncCounts).observe(list, { childList:true, subtree:true, characterData:true });
    syncCounts();
    return true;
  }
  if (!prepare()) {
    preparation = new MutationObserver(prepare);
    preparation.observe(panel, { childList:true });
  }
})();
