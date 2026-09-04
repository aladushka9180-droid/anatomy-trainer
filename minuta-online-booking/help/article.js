(function () {
  const articles = Array.isArray(window.MINUTA_HELP_ARTICLES) ? window.MINUTA_HELP_ARTICLES : [];
  const slug = new URLSearchParams(location.search).get('slug') || 'first-booking';
  const article = articles.find(item => item.slug === slug) || articles[0];
  if (!article) return;

  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };
  const articleUrl = item => `article.html?slug=${encodeURIComponent(item.slug)}`;

  document.title = `${article.title} — Minuta`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', article.excerpt);
  setText('#articleCategory', article.category);
  setText('#articleMeta', `${article.category} · ${article.time} на чтение · Обновлено ${article.updated}`);
  setText('#articleTitle', article.title);
  setText('#articleIntro', article.intro);

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
  articles.filter(item => item.category === article.category).forEach(item => {
    const link = document.createElement('a');
    link.href = articleUrl(item);
    link.textContent = item.title;
    if (item.slug === article.slug) link.setAttribute('aria-current', 'page');
    sectionNav.append(link);
  });

  const related = document.querySelector('#relatedList');
  articles.filter(item => item.audience === article.audience && item.slug !== article.slug).slice(0, 3).forEach(item => {
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
