(function () {
  const articles = Array.isArray(window.MINUTA_HELP_ARTICLES) ? window.MINUTA_HELP_ARTICLES : [];
  const slug = new URLSearchParams(location.search).get('slug') || 'first-booking';
  const article = articles.find(item => item.slug === slug);
  const navigate = value => window.MinutaHelpNavigation?.href(value) || value;

  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };
  const articleUrl = item => navigate(`article.html?slug=${encodeURIComponent(item.slug)}`);
  const categoryUrl = item => navigate(`category.html?category=${encodeURIComponent(item.categorySlug)}`);

  if (!article) {
    document.title = 'Инструкция не найдена — Eldion Pro';
    setText('#articleMeta', 'База знаний');
    setText('#articleTitle', 'Инструкция не найдена');
    setText('#articleIntro', 'Возможно, ссылка устарела. Вернитесь к разделам или воспользуйтесь поиском.');
    document.querySelector('#articleSteps').hidden = true;
    document.querySelector('#articleNote').hidden = true;
    document.querySelector('.related-articles').hidden = true;
    ['#articleToc', '#articlePrerequisites', '#articleOutcome', '#articleTroubleshooting', '.article-section-menu'].forEach(selector => {
      document.querySelector(selector)?.setAttribute('hidden', '');
    });
    return;
  }

  document.title = `${article.title} — Eldion Pro`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', article.excerpt);
  setText('#articleCategory', article.category);
  const categoryLink = document.querySelector('#articleCategory');
  if (categoryLink) categoryLink.href = categoryUrl(article);
  setText('#articleMeta', article.updatedAt ? `${article.category} · Обновлено ${article.updatedAt}` : article.category);
  setText('#articleTitle', article.title);
  setText('#articleIntro', article.intro);
  const articleBackLink = document.querySelector('#articleBackLink');
  if (articleBackLink) articleBackLink.href = navigate(`index.html?audience=${article.audience}`);
  const audienceHome = navigate(`index.html?audience=${article.audience}`);
  const brandLink = document.querySelector('.help-brand');
  if (brandLink) brandLink.href = audienceHome;
  const breadcrumbHome = document.querySelector('.breadcrumbs a');
  if (breadcrumbHome) breadcrumbHome.href = audienceHome;
  const productLink = document.querySelector('#productLink');
  const footerProductLink = document.querySelector('#footerProductLink');
  if (productLink) {
    productLink.href = navigate(article.audience === 'client' ? '../index.html' : '../provider.html');
    const label = productLink.querySelector('span');
    if (label) label.textContent = article.audience === 'client' ? 'К онлайн-записи' : 'Открыть Eldion Pro';
  }
  if (footerProductLink) {
    footerProductLink.href = navigate(article.audience === 'client' ? '../index.html' : '../provider.html');
    footerProductLink.textContent = article.audience === 'client' ? 'К онлайн-записи' : 'Вернуться в кабинет';
  }
  try { sessionStorage.setItem('minuta-help-audience', article.audience); } catch { /* Navigation still works. */ }

  const visualRoot = document.querySelector('#articleVisual');
  const dialog = document.querySelector('#articleVisualDialog');
  const fullImage = document.querySelector('#articleVisualFull');
  const visuals = Array.isArray(article.visuals) ? article.visuals : article.visual ? [article.visual] : [];
  function renderVisual(visual, destination) {
    if (!visual?.src || !destination) return;
    const figure = document.createElement('figure');
    figure.className = 'article-visual';
    if (visual.kind) figure.dataset.kind = visual.kind;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Увеличить изображение: ${visual.alt}`);
    const image = document.createElement('img');
    image.src = visual.src;
    image.alt = visual.alt;
    image.width = visual.width || 1200;
    image.height = visual.height || 675;
    image.loading = visual.step ? 'lazy' : 'eager';
    const zoom = document.createElement('span');
    const zoomIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    zoomIcon.setAttribute('aria-hidden', 'true');
    const zoomUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    zoomUse.setAttribute('href', '../ui-icons.svg#icon-search');
    zoomIcon.append(zoomUse);
    zoom.append(zoomIcon, document.createTextNode('Увеличить'));
    button.append(image, zoom);
    const caption = document.createElement('figcaption');
    caption.textContent = visual.caption;
    figure.append(button, caption);
    destination.append(figure);
    button.addEventListener('click', () => {
      if (!dialog || !fullImage || typeof dialog.showModal !== 'function') {
        window.open(visual.src, '_blank', 'noopener');
        return;
      }
      fullImage.src = visual.src;
      fullImage.alt = visual.alt;
      setText('#visualDialogTitle', visual.kind === 'diagram' ? 'Схема к инструкции' : 'Экран к инструкции');
      dialog.showModal();
    });
  }
  visuals.filter(visual => !visual.step).forEach(visual => renderVisual(visual, visualRoot));
  document.querySelector('#closeVisualDialog')?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  const prerequisites = document.querySelector('#articlePrerequisites');
  if (article.prerequisites?.length && prerequisites) {
    prerequisites.hidden = false;
    article.prerequisites.forEach(text => {
      const item = document.createElement('li');
      item.textContent = text;
      prerequisites.querySelector('ul')?.append(item);
    });
  }
  const outcome = document.querySelector('#articleOutcome');
  if (article.outcome && outcome) {
    outcome.hidden = false;
    outcome.querySelector('p').textContent = article.outcome;
  }
  const troubleshooting = document.querySelector('#articleTroubleshooting');
  if (article.troubleshooting?.length && troubleshooting) {
    troubleshooting.hidden = false;
    article.troubleshooting.forEach(problem => {
      const detail = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = problem.title;
      const text = document.createElement('p');
      text.textContent = problem.text;
      detail.append(title, text);
      troubleshooting.querySelector('div')?.append(detail);
    });
  }
  const sectionMenu = document.querySelector('.article-section-menu');
  if (sectionMenu) sectionMenu.open = window.matchMedia('(min-width: 901px)').matches;

  const steps = document.querySelector('#articleSteps');
  article.steps.forEach((step, index) => {
    const tocLink = document.createElement('a');
    tocLink.href = `#step-${index + 1}`;
    tocLink.textContent = `${index + 1}. ${step.title}`;
    document.querySelector('#articleToc nav')?.append(tocLink);
    const section = document.createElement('section');
    section.className = 'article-step';
    section.id = `step-${index + 1}`;
    const number = document.createElement('span');
    number.className = 'article-step-number';
    number.textContent = String(index + 1);
    const content = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = step.title;
    const body = document.createElement('p');
    body.textContent = step.text;
    content.append(title, body);
    if (step.href && step.action) {
      const action = document.createElement('a');
      action.className = 'article-action';
      action.href = navigate(step.href);
      action.textContent = step.action;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '../ui-icons.svg#icon-arrow-right');
      icon.append(use);
      action.append(icon);
      content.append(action);
    }
    visuals.filter(visual => visual.step === index + 1).forEach(visual => renderVisual(visual, content));
    section.append(number, content);
    steps.append(section);
  });

  const note = document.querySelector('#articleNote p');
  if (note) note.textContent = article.note;

  const sectionNav = document.querySelector('#articleSectionNav');
  articles.filter(item => item.categorySlug === article.categorySlug && item.audience === article.audience).forEach(item => {
    const link = document.createElement('a');
    link.href = articleUrl(item);
    link.textContent = item.title;
    if (item.slug === article.slug) link.setAttribute('aria-current', 'page');
    sectionNav.append(link);
  });

  const related = document.querySelector('#relatedList');
  const sameCategory = articles.filter(item => item.audience === article.audience && item.categorySlug === article.categorySlug && item.slug !== article.slug);
  const otherCategories = articles.filter(item => item.audience === article.audience && item.categorySlug !== article.categorySlug && item.slug !== article.slug);
  const chosenRelated = (article.related || []).map(slug => articles.find(item => item.slug === slug && item.audience === article.audience && item.slug !== article.slug)).filter(Boolean);
  const nextArticles = [...new Set([...chosenRelated, ...sameCategory, ...otherCategories])];
  nextArticles.slice(0, 3).forEach(item => {
    const link = document.createElement('a');
    link.href = articleUrl(item);
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const meta = document.createElement('small');
    meta.textContent = item.category;
    copy.append(title, meta);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '../ui-icons.svg#icon-arrow-right');
    icon.append(use);
    link.append(copy, icon);
    related.append(link);
  });

}());
