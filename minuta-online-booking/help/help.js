(function () {
  const articles = Array.isArray(window.MINUTA_HELP_ARTICLES) ? window.MINUTA_HELP_ARTICLES : [];
  const input = document.querySelector('#helpSearchInput');
  const results = document.querySelector('#searchResults');
  const cards = [...document.querySelectorAll('.section-card')];
  const audienceButtons = [...document.querySelectorAll('[data-audience][type="button"]')];
  const popular = document.querySelector('#popularGuides');
  const productLink = document.querySelector('#productLink');
  const footerProductLink = document.querySelector('#footerProductLink');
  let audience = 'specialist';

  try {
    const savedAudience = sessionStorage.getItem('minuta-help-audience');
    if (savedAudience === 'client' || savedAudience === 'specialist') audience = savedAudience;
  } catch {
    // The audience switch remains usable when storage is unavailable.
  }

  function articleUrl(article) {
    return `article.html?slug=${encodeURIComponent(article.slug)}`;
  }

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
  }

  function renderPopular() {
    if (!popular) return;
    popular.replaceChildren();
    articles.filter(article => article.audience === audience).slice(0, 4).forEach((article, index) => {
      const link = document.createElement('a');
      link.href = articleUrl(article);
      link.className = 'guide-item';
      const number = document.createElement('span');
      number.textContent = String(index + 1).padStart(2, '0');
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = article.title;
      const meta = document.createElement('small');
      meta.textContent = `${article.category} · ${article.time}`;
      copy.append(title, meta);
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '../ui-icons.svg#icon-arrow-right');
      icon.append(use);
      link.append(number, copy, icon);
      popular.append(link);
    });
  }

  function renderSearch() {
    if (!input || !results) return;
    const query = normalize(input.value);
    if (!query) {
      results.hidden = true;
      results.replaceChildren();
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    const matches = articles.filter(article => article.audience === audience && normalize(`${article.title} ${article.excerpt} ${article.category} ${article.tags}`).includes(query)).slice(0, 5);
    results.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      const strong = document.createElement('strong');
      strong.textContent = 'Ничего не нашли';
      const small = document.createElement('small');
      small.textContent = 'Попробуйте написать короче: «расписание» или «Telegram».';
      empty.append(strong, small);
      results.append(empty);
    } else {
      matches.forEach(article => {
        const link = document.createElement('a');
        link.href = articleUrl(article);
        const copy = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = article.title;
        const excerpt = document.createElement('small');
        excerpt.textContent = article.excerpt;
        copy.append(title, excerpt);
        const category = document.createElement('em');
        category.textContent = article.category;
        link.append(copy, category);
        results.append(link);
      });
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function applyAudience(nextAudience) {
    audience = nextAudience;
    audienceButtons.forEach(item => {
      const active = item.dataset.audience === audience;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    let visible = 0;
    cards.forEach(card => {
      const show = card.dataset.audience === audience;
      card.hidden = !show;
      if (show) visible += 1;
    });
    const count = document.querySelector('#sectionCount');
    if (count) count.textContent = `${visible} ${visible === 1 ? 'раздел' : visible < 5 ? 'раздела' : 'разделов'}`;
    if (productLink) {
      productLink.href = audience === 'client' ? '../index.html' : '../provider.html';
      const label = productLink.querySelector('span');
      if (label) label.textContent = audience === 'client' ? 'К онлайн-записи' : 'Открыть Minuta';
    }
    if (footerProductLink) {
      footerProductLink.href = audience === 'client' ? '../index.html' : '../provider.html';
      footerProductLink.textContent = audience === 'client' ? 'К онлайн-записи' : 'Вернуться в кабинет';
    }
    try { sessionStorage.setItem('minuta-help-audience', audience); } catch { /* Keep the switch available. */ }
    renderSearch();
    renderPopular();
  }

  audienceButtons.forEach(button => button.addEventListener('click', () => applyAudience(button.dataset.audience)));

  document.querySelector('#helpSearch')?.addEventListener('submit', event => event.preventDefault());
  input?.addEventListener('input', renderSearch);
  input?.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && !results.hidden) {
      const first = results.querySelector('a');
      if (first) { event.preventDefault(); first.focus(); }
    }
    if (event.key === 'Escape') {
      input.value = '';
      renderSearch();
      input.blur();
    }
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input?.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#helpSearch')) {
      results.hidden = true;
      input?.setAttribute('aria-expanded', 'false');
    }
  });
  results?.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') { input?.focus(); results.hidden = true; return; }
    const links = [...results.querySelectorAll('a')];
    const current = links.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? Math.min(current + 1, links.length - 1) : current <= 0 ? -1 : current - 1;
    if (next === -1) input?.focus(); else links[next]?.focus();
  });

  applyAudience(audience);
}());
