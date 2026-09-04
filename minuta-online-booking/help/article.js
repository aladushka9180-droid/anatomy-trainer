(function () {
  const articles = Array.isArray(window.MINUTA_HELP_ARTICLES) ? window.MINUTA_HELP_ARTICLES : [];
  const slug = new URLSearchParams(location.search).get('slug') || 'first-booking';
  const article = articles.find(item => item.slug === slug);

  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };
  const articleUrl = item => `article.html?slug=${encodeURIComponent(item.slug)}`;
  const categoryUrl = item => `category.html?category=${encodeURIComponent(item.categorySlug)}`;

  if (!article) {
    document.title = 'Инструкция не найдена — Minuta';
    setText('#articleMeta', 'База знаний');
    setText('#articleTitle', 'Инструкция не найдена');
    setText('#articleIntro', 'Возможно, ссылка устарела. Вернитесь к разделам или воспользуйтесь поиском.');
    document.querySelector('#articleSteps').hidden = true;
    document.querySelector('#articleNote').hidden = true;
    document.querySelector('.article-feedback').hidden = true;
    document.querySelector('.related-articles').hidden = true;
    return;
  }

  document.title = `${article.title} — Minuta`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', article.excerpt);
  setText('#articleCategory', article.category);
  const categoryLink = document.querySelector('#articleCategory');
  if (categoryLink) categoryLink.href = categoryUrl(article);
  setText('#articleMeta', `${article.category} · ${article.time} на чтение · Обновлено ${article.updated}`);
  setText('#articleTitle', article.title);
  setText('#articleIntro', article.intro);
  const productLink = document.querySelector('#productLink');
  const footerProductLink = document.querySelector('#footerProductLink');
  if (productLink) {
    productLink.href = article.audience === 'client' ? '../index.html' : '../provider.html';
    const label = productLink.querySelector('span');
    if (label) label.textContent = article.audience === 'client' ? 'К онлайн-записи' : 'Открыть Minuta';
  }
  if (footerProductLink) {
    footerProductLink.href = article.audience === 'client' ? '../index.html' : '../provider.html';
    footerProductLink.textContent = article.audience === 'client' ? 'К онлайн-записи' : 'Вернуться в кабинет';
  }
  try { sessionStorage.setItem('minuta-help-audience', article.audience); } catch { /* Navigation still works. */ }

  const steps = document.querySelector('#articleSteps');
  article.steps.forEach((step, index) => {
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
      action.href = step.href;
      action.textContent = step.action;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '../ui-icons.svg#icon-arrow-right');
      icon.append(use);
      action.append(icon);
      content.append(action);
    }
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
  [...sameCategory, ...otherCategories].slice(0, 3).forEach(item => {
    const link = document.createElement('a');
    link.href = articleUrl(item);
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const meta = document.createElement('small');
    meta.textContent = `${item.category} · ${item.time}`;
    copy.append(title, meta);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '../ui-icons.svg#icon-arrow-right');
    icon.append(use);
    link.append(copy, icon);
    related.append(link);
  });

  document.querySelectorAll('[data-feedback]').forEach(button => button.addEventListener('click', () => {
    document.querySelector('.feedback-actions').hidden = true;
    document.querySelector('#feedbackThanks').hidden = false;
  }));
}());
