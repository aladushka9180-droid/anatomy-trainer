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
    if (visual.detail) figure.dataset.detail = 'true';
    if (visual.kind) figure.dataset.kind = visual.kind;
    if (visual.width > visual.height * 4) figure.dataset.zoom = 'below';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Увеличить изображение: ${visual.alt}`);
    const image = document.createElement('img');
    image.src = visual.src;
    image.alt = visual.alt;
    image.width = visual.width || 1200;
    image.height = visual.height || 675;
    image.loading = visual.step ? 'lazy' : 'eager';
    let imageElement = image;
    if (visual.variants?.length) {
      const picture = document.createElement('picture');
      for (const variant of visual.variants) {
        const source = document.createElement('source');
        source.media = `(min-width: ${variant.minWidth}px)`;
        source.srcset = variant.src;
        source.width = variant.width;
        source.height = variant.height;
        picture.append(source);
      }
      picture.append(image);
      imageElement = picture;
    }
    if (visual.detail) {
      const detail = document.createElement('div');
      detail.className = 'article-image-detail';
      function fitDetail() {
        const selected = visual.variants?.find(variant => new URL(variant.src, document.baseURI).href === image.currentSrc)
          || visual.variants?.find(variant => window.matchMedia(`(min-width: ${variant.minWidth}px)`).matches)
          || visual;
        const crop = selected.detail || visual.detail;
        detail.style.aspectRatio = `${crop.width} / ${crop.height}`;
        detail.style.setProperty('--detail-width', `${selected.width / crop.width * 100}%`);
        detail.style.setProperty('--detail-left', `${-crop.x / crop.width * 100}%`);
        detail.style.setProperty('--detail-top', `${-crop.y / crop.height * 100}%`);
        button.style.width = `${crop.width}px`;
      }
      image.addEventListener('load', fitDetail);
      fitDetail();
      detail.append(imageElement);
      imageElement = detail;
      image.alt = `Фрагмент: ${visual.alt}`;
    }
    const zoom = document.createElement('span');
    const zoomIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    zoomIcon.setAttribute('aria-hidden', 'true');
    const zoomUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    zoomUse.setAttribute('href', '../ui-icons.svg#icon-search');
    zoomIcon.append(zoomUse);
    zoom.append(zoomIcon, document.createTextNode(visual.detail ? 'Полный снимок' : 'Увеличить'));
    button.append(imageElement, zoom);
    const caption = document.createElement('figcaption');
    caption.textContent = visual.detail ? `Фрагмент экрана. ${visual.caption}` : visual.caption;
    figure.append(button, caption);
    destination.append(figure);
    button.addEventListener('click', () => {
      if (!dialog || !fullImage || typeof dialog.showModal !== 'function') {
        window.open(image.currentSrc || visual.src, '_blank', 'noopener');
        return;
      }
      fullImage.src = image.currentSrc || visual.src;
      fullImage.alt = visual.alt;
      setText('#visualDialogTitle', visual.detail ? 'Полный снимок экрана' : visual.kind === 'diagram' ? 'Схема к инструкции' : 'Экран к инструкции');
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
    if (step.alternative && !steps.querySelector('.article-choice-intro')) {
      const prompt = document.createElement('div');
      prompt.className = 'article-choice-intro';
      const heading = document.createElement('h2');
      heading.textContent = 'Что хотите сделать?';
      const text = document.createElement('p');
      text.textContent = article.chooseAction;
      prompt.append(heading, text);
      steps.append(prompt);
    }
    const tocLink = document.createElement('a');
    tocLink.href = `#step-${index + 1}`;
    tocLink.textContent = step.alternative ? step.title : `${index + 1}. ${step.title}`;
    document.querySelector('#articleToc nav')?.append(tocLink);
    const section = document.createElement(step.alternative ? 'details' : 'section');
    section.className = step.alternative ? 'article-step article-action-choice' : 'article-step';
    section.id = `step-${index + 1}`;
    const number = document.createElement('span');
    number.className = 'article-step-number';
    number.textContent = step.alternative ? '' : String(index + 1);
    if (step.alternative) number.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = step.title;
    const body = document.createElement('p');
    body.textContent = step.text;
    if (step.alternative) {
      section.setAttribute('name', 'booking-action');
      const summary = document.createElement('summary');
      summary.append(number, title);
      section.append(summary);
      content.className = 'article-choice-content';
      content.append(body);
      tocLink.addEventListener('click', () => {
        section.open = true;
        requestAnimationFrame(() => section.scrollIntoView({ block:'start' }));
      });
      section.addEventListener('toggle', () => {
        if (section.open) steps.querySelectorAll('.article-action-choice').forEach(other => {
          if (other !== section) other.open = false;
        });
      });
    } else content.append(title, body);
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
    if (step.explanation) {
      const detail = document.createElement('details');
      detail.className = 'article-step-explanation';
      const summary = document.createElement('summary');
      summary.textContent = step.explanation.title;
      detail.append(summary);
      step.explanation.paragraphs.forEach(text => {
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        detail.append(paragraph);
      });
      content.append(detail);
    }
    if (step.alternative) section.append(content);
    else section.append(number, content);
    steps.append(section);
  });
  if (article.chooseAction) {
    document.querySelector('#articleToc summary').textContent = 'Открыть запись и выбрать действие';
    const openAnchoredChoice = () => {
      const target = document.getElementById(location.hash.slice(1));
      if (target?.classList.contains('article-action-choice')) {
        target.open = true;
        requestAnimationFrame(() => target.scrollIntoView({ block:'start' }));
      }
    };
    window.addEventListener('hashchange', openAnchoredChoice);
    openAnchoredChoice();
  }

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
