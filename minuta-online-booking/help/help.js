(function () {
  const articles = Array.isArray(window.MINUTA_HELP_ARTICLES) ? window.MINUTA_HELP_ARTICLES : [];
  const categories = Array.isArray(window.MINUTA_HELP_CATEGORIES) ? window.MINUTA_HELP_CATEGORIES : [];
  const input = document.querySelector('#helpSearchInput');
  const results = document.querySelector('#searchResults');
  const sectionGrid = document.querySelector('#sectionGrid');
  const audienceButtons = [...document.querySelectorAll('[data-audience][type="button"]')];
  const popular = document.querySelector('#popularGuides');
  const quickStart = document.querySelector('#quickStartGuides');
  const navigate = value => window.MinutaHelpNavigation?.href(value) || value;
  const productLink = document.querySelector('#productLink');
  const footerProductLink = document.querySelector('#footerProductLink');
  let audience = new URLSearchParams(location.search).get('audience') === 'client' ? 'client' : 'specialist';

  try {
    const requestedAudience = new URLSearchParams(location.search).get('audience');
    const savedAudience = sessionStorage.getItem('minuta-help-audience');
    if (!requestedAudience && (savedAudience === 'client' || savedAudience === 'specialist')) audience = savedAudience;
  } catch {
    // The audience switch remains usable when storage is unavailable.
  }

  function articleUrl(article) {
    return navigate(`article.html?slug=${encodeURIComponent(article.slug)}`);
  }

  function categoryUrl(category) {
    return navigate(`category.html?category=${encodeURIComponent(category.slug)}`);
  }

  function pluralize(count, forms) {
    const remainder100 = count % 100;
    const remainder10 = count % 10;
    if (remainder100 >= 11 && remainder100 <= 19) return forms[2];
    if (remainder10 === 1) return forms[0];
    if (remainder10 >= 2 && remainder10 <= 4) return forms[1];
    return forms[2];
  }

  function renderSections() {
    if (!sectionGrid) return;
    sectionGrid.replaceChildren();
    const visibleCategories = categories.filter(category => category.audience === audience);
    const groups = audience === 'client' ? [
      ['Запись и уведомления', visibleCategories.map(category => category.slug)]
    ] : [
      ['Начало работы', ['getting-started']],
      ['Ежедневная работа', ['bookings', 'schedule', 'services', 'clients']],
      ['Управление бизнесом', ['team', 'finance', 'inventory', 'analytics']],
      ['Продвижение и возвращение клиентов', ['loyalty', 'portfolio', 'notifications']],
      ['Настройки и помощь', ['settings', 'assistant']]
    ];
    const categoryGrids = new Map();
    groups.forEach(([title, slugs]) => {
      const members = visibleCategories.filter(category => slugs.includes(category.slug));
      if (!members.length) return;
      const group = document.createElement('section');
      group.className = 'help-topic-group';
      const heading = document.createElement('h3');
      heading.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'section-grid';
      group.append(heading, grid);
      sectionGrid.append(group);
      members.forEach(category => categoryGrids.set(category.slug, grid));
    });
    visibleCategories.forEach(category => {
      const count = articles.filter(article => article.audience === audience && article.categorySlug === category.slug).length;
      if (!count) return;
      const link = document.createElement('a');
      link.className = 'section-card';
      const categoryArticles = articles.filter(article => article.audience === audience && article.categorySlug === category.slug);
      link.href = count === 1 ? articleUrl(categoryArticles[0]) : categoryUrl(category);

      const iconWrap = document.createElement('span');
      iconWrap.className = 'section-icon';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('aria-hidden', 'true');
      const iconUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      iconUse.setAttribute('href', `../ui-icons.svg#${category.icon || 'icon-list'}`);
      icon.append(iconUse);
      iconWrap.append(icon);

      const copy = document.createElement('span');
      copy.className = 'section-copy';
      const title = document.createElement('strong');
      title.textContent = category.title;
      const description = document.createElement('small');
      description.textContent = category.description;
      const total = document.createElement('em');
      total.textContent = `${count} ${pluralize(count, ['инструкция', 'инструкции', 'инструкций'])}`;
      copy.append(title, description, total);

      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arrow.classList.add('section-arrow');
      arrow.setAttribute('aria-hidden', 'true');
      const arrowUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      arrowUse.setAttribute('href', '../ui-icons.svg#icon-arrow-right');
      arrow.append(arrowUse);
      link.append(iconWrap, copy, arrow);
      (categoryGrids.get(category.slug) || sectionGrid).append(link);
    });
    const count = document.querySelector('#sectionCount');
    if (count) count.textContent = `${visibleCategories.length} ${pluralize(visibleCategories.length, ['раздел', 'раздела', 'разделов'])}`;
  }

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
  }

  const tokens = value => normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
  const stopWords = new Set(['как', 'что', 'где', 'и', 'в', 'на', 'для', 'по', 'с', 'не', 'ли', 'или', 'мне', 'за', 'из', 'о', 'об', 'от', 'к', 'ко', 'до', 'у', 'во', 'со', 'при', 'через']);
  const aliases = [
    ['добав', 'созда', 'новая', 'новую', 'новый'],
    ['измен', 'редак', 'исправ', 'помен', 'смен'],
    ['скрыт', 'скрыть', 'выклю', 'отклю'],
    ['удали', 'удале', 'убрат'],
    ['зарпл', 'выпла', 'начис'],
    ['баллы', 'бонус', 'лояль', 'награ'],
    ['телег', 'telegram'],
    ['предоп', 'аванс']
  ];
  const stem = value => value.length > 4 ? value.slice(0, 5) : value;
  function termMatches(term, words) {
    const prefix = stem(term);
    const matches = variant => words.some(word => variant.length < 4 ? word === variant : word.startsWith(variant));
    if (matches(prefix)) return true;
    if (prefix.length < 4) return false;
    const group = aliases.find(items => items.some(item => item.startsWith(prefix) || prefix.startsWith(item)));
    return Boolean(group?.some(matches));
  }
  function searchScore(article, query) {
    const terms = tokens(query).filter(term => !stopWords.has(term));
    if (!terms.length) return 0;
    const titleWords = tokens(article.title);
    const words = tokens(`${article.title} ${article.excerpt} ${article.category} ${article.tags || ''} ${article.steps.map(step => `${step.title} ${step.text}`).join(' ')} ${article.note || ''}`);
    if (!terms.every(term => termMatches(term, words))) return 0;
    return (normalize(article.title).includes(query) ? 40 : 0)
      + terms.filter(term => termMatches(term, titleWords)).length * 10 + 1;
  }

  function quickStartArticles() {
    const slugs = audience === 'client'
      ? ['book-online', 'reschedule', 'find-booking', 'connect-telegram']
      : ['first-booking', 'add-service', 'set-regular-workweek', 'share-free-slots'];
    const chosen = slugs.map(slug => articles.find(article => article.slug === slug && article.audience === audience)).filter(Boolean);
    const fallback = articles.filter(article => article.audience === audience && !chosen.includes(article));
    return [...chosen, ...fallback].slice(0, 4);
  }

  function renderQuickStart() {
    if (!quickStart) return;
    quickStart.replaceChildren();
    quickStartArticles().forEach((article, index) => {
      const link = document.createElement('a');
      link.className = 'quick-start-card';
      link.href = articleUrl(article);
      const number = document.createElement('span');
      number.className = 'quick-start-number';
      number.textContent = String(index + 1).padStart(2, '0');
      const title = document.createElement('strong');
      title.textContent = article.title;
      const description = document.createElement('small');
      description.textContent = article.excerpt;
      link.append(number, title, description);
      quickStart.append(link);
    });
    const heading = document.querySelector('#quickStartTitle');
    if (heading) heading.textContent = audience === 'client' ? 'Записаться и управлять визитом' : 'Быстрый старт';
  }

  function renderPopular() {
    if (!popular) return;
    popular.replaceChildren();
    const quickSlugs = new Set(quickStartArticles().map(article => article.slug));
    const audienceArticles = articles.filter(article => article.audience === audience && !quickSlugs.has(article.slug));
    const featured = audienceArticles.filter(article => article.featured);
    [...featured, ...audienceArticles.filter(article => !article.featured)].slice(0, 3).forEach((article, index) => {
      const link = document.createElement('a');
      link.href = articleUrl(article);
      link.className = 'guide-item';
      const number = document.createElement('span');
      number.textContent = String(index + 1).padStart(2, '0');
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = article.title;
      const meta = document.createElement('small');
      meta.textContent = article.category;
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
    const matches = articles.filter(article => article.audience === audience)
      .map(article => ({ article, score: searchScore(article, query) }))
      .filter(match => match.score > 0).sort((left, right) => right.score - left.score)
      .map(match => match.article);
    results.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      const strong = document.createElement('strong');
      strong.textContent = 'Ничего не нашли';
      const small = document.createElement('small');
      small.textContent = 'Попробуйте другое слово или откройте нужный раздел ниже.';
      empty.append(strong, small);
      results.append(empty);
    } else {
      matches.slice(0, 8).forEach(article => {
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
      if (matches.length > 8) {
        const more = document.createElement('div');
        more.className = 'search-more';
        more.textContent = `Показано 8 из ${matches.length}. Уточните запрос, чтобы сузить список.`;
        results.append(more);
      }
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
    const intro = document.querySelector('#helpIntroCopy');
    if (intro) intro.textContent = audience === 'client'
      ? 'Запись, перенос, отмена и уведомления — понятные шаги для клиента.'
      : 'Понятные инструкции по записям, расписанию и управлению кабинетом.';
    if (input) input.placeholder = audience === 'client'
      ? 'Например, выбрать время или перенести запись'
      : 'Например, настроить расписание';
    renderSections();
    if (productLink) {
      productLink.href = navigate(audience === 'client' ? '../index.html' : '../provider.html');
      const label = productLink.querySelector('span');
      if (label) label.textContent = audience === 'client' ? 'К онлайн-записи' : 'Открыть Eldion Pro';
    }
    if (footerProductLink) {
      footerProductLink.href = navigate(audience === 'client' ? '../index.html' : '../provider.html');
      footerProductLink.textContent = audience === 'client' ? 'К онлайн-записи' : 'Вернуться в кабинет';
    }
    try { sessionStorage.setItem('minuta-help-audience', audience); } catch { /* Keep the switch available. */ }
    renderSearch();
    renderPopular();
    renderQuickStart();
  }

  audienceButtons.forEach(button => button.addEventListener('click', () => applyAudience(button.dataset.audience)));

  document.querySelector('#helpSearch')?.addEventListener('submit', event => event.preventDefault());
  input?.addEventListener('input', renderSearch);
  input?.addEventListener('focus', renderSearch);
  input?.addEventListener('click', renderSearch);
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
      renderSearch();
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
    if (event.key === 'Escape') {
      input?.focus();
      results.hidden = true;
      input?.setAttribute('aria-expanded', 'false');
      return;
    }
    const links = [...results.querySelectorAll('a')];
    const current = links.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? Math.min(current + 1, links.length - 1) : current <= 0 ? -1 : current - 1;
    if (next === -1) input?.focus(); else links[next]?.focus();
  });

  applyAudience(audience);
}());
