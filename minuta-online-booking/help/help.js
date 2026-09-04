(function () {
  const articles = Array.isArray(window.MINUTA_HELP_ARTICLES) ? window.MINUTA_HELP_ARTICLES : [];
  const input = document.querySelector('#helpSearchInput');
  const results = document.querySelector('#searchResults');
  const cards = [...document.querySelectorAll('.section-card')];
  const audienceButtons = [...document.querySelectorAll('[data-audience][type="button"]')];
  const popular = document.querySelector('#popularGuides');
  let audience = 'specialist';

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
    const matches = articles.filter(article => normalize(`${article.title} ${article.excerpt} ${article.category} ${article.tags}`).includes(query)).slice(0, 5);
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

  audienceButtons.forEach(button => button.addEventListener('click', () => {
    audience = button.dataset.audience;
    audienceButtons.forEach(item => {
      const active = item === button;
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
    renderPopular();
  }));

  input?.addEventListener('input', renderSearch);
  input?.addEventListener('keydown', event => {
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

  cards.forEach(card => { card.hidden = card.dataset.audience !== audience; });
  const count = document.querySelector('#sectionCount');
  if (count) count.textContent = '4 раздела';
  renderPopular();
}());
