(function contextualHelpModule(global) {
  'use strict';

  const SELECTOR = '[data-contextual-help]';
  const instances = new WeakMap();
  let sequence = 0;

  function compactText(value, limit = 1000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return !/^(?:false|0|no|off)$/i.test(String(value).trim());
  }

  function option(value, fallback) {
    return value === undefined ? fallback : value;
  }

  function articleBySlug(slug) {
    if (!slug || !Array.isArray(global.MINUTA_HELP_ARTICLES)) return null;
    return global.MINUTA_HELP_ARTICLES.find(article => article?.slug === slug) || null;
  }

  function articleExample(article) {
    const step = article?.steps?.[0];
    if (!step) return '';
    return compactText(`${step.title || ''}${step.text ? `: ${step.text}` : ''}`, 1200);
  }

  function readConfiguration(host, overrides = {}) {
    const data = host.dataset || {};
    const slug = compactText(option(overrides.slug, data.helpSlug), 120);
    const articleData = articleBySlug(slug);
    const title = compactText(option(overrides.title, data.helpTitle) || articleData?.title, 180);
    const summary = compactText(option(overrides.summary, data.helpSummary) || articleData?.intro || articleData?.excerpt, 1200);
    const example = compactText(option(overrides.example, data.helpExample) || articleExample(articleData), 1200);
    const change = compactText(option(overrides.change, data.helpChange) || articleData?.note, 1200);
    const danger = parseBoolean(option(overrides.danger, data.helpDanger), data.helpVariant === 'danger');
    const customLabel = compactText(option(overrides.label, data.helpLabel), 80);
    const question = compactText(
      option(overrides.question, data.helpQuestion) || `Объясни подробнее: ${title || summary}`,
      500
    );

    return {
      title,
      summary,
      example,
      change,
      danger,
      label: customLabel || (danger ? 'Что произойдёт?' : 'Как это работает?'),
      article: compactText(option(overrides.article, data.helpArticle) || (slug ? `help/article.html?slug=${encodeURIComponent(slug)}` : ''), 2000),
      articleTarget: compactText(option(overrides.articleTarget, data.helpArticleTarget), 20) || '_blank',
      question,
      assistant: parseBoolean(option(overrides.assistant, data.helpAssistant), true)
    };
  }

  function safeArticleUrl(rawUrl, doc) {
    if (!rawUrl) return '';
    try {
      const url = new URL(rawUrl, doc.baseURI);
      return /^(?:https?:)$/i.test(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function appendTextElement(doc, parent, tagName, className, text) {
    const element = doc.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function appendDetail(doc, parent, label, text) {
    if (!text) return;
    const detail = doc.createElement('div');
    detail.className = 'contextual-help__detail';
    appendTextElement(doc, detail, 'strong', '', label);
    appendTextElement(doc, detail, 'p', '', text);
    parent.append(detail);
  }

  function openAssistant(question, options = {}) {
    const doc = options.document || global.document;
    if (!doc) return false;

    const input = doc.querySelector('#voiceAssistantInput');
    const dialog = doc.querySelector('#voiceAssistantDialog');
    const openButton = doc.querySelector('#openVoiceAssistant');
    if (!input || (!dialog && !openButton)) return false;

    if (!dialog?.open && openButton) {
      try {
        openButton.click();
      } catch {
        // The fallback below handles a dialog that was not opened by its controller.
      }
    }
    if (dialog && !dialog.open && typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        return false;
      }
    }

    input.value = compactText(question, Number(input.maxLength) > 0 ? Number(input.maxLength) : 500);
    const EventConstructor = doc.defaultView?.Event || global.Event;
    input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    global.setTimeout(() => input.focus({ preventScroll: true }), 0);
    return true;
  }

  function closePanel(instance, restoreFocus = false) {
    instance.panel.hidden = true;
    instance.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) instance.trigger.focus();
  }

  function openPanel(instance) {
    instance.panel.hidden = false;
    instance.trigger.setAttribute('aria-expanded', 'true');
  }

  function destroy(target) {
    const host = typeof target === 'string' ? global.document?.querySelector(target) : target;
    const instance = host && instances.get(host);
    if (!instance) return false;
    instance.wrapper.remove();
    instances.delete(host);
    return true;
  }

  function mount(target, configuration = {}) {
    const doc = configuration.document || global.document;
    const host = typeof target === 'string' ? doc?.querySelector(target) : target;
    const ElementConstructor = doc?.defaultView?.Element || global.Element;
    if (!doc || !ElementConstructor || !(host instanceof ElementConstructor)) return null;

    destroy(host);
    const config = readConfiguration(host, configuration);
    if (!config.summary && !config.title && !config.example && !config.change) return null;

    const wrapper = doc.createElement('div');
    wrapper.className = `contextual-help${config.danger ? ' contextual-help--danger' : ''}`;
    const trigger = doc.createElement('button');
    const panel = doc.createElement('section');
    const panelId = `contextual-help-panel-${++sequence}`;

    trigger.className = 'contextual-help__trigger';
    trigger.type = 'button';
    trigger.textContent = config.label;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', panelId);

    panel.className = 'contextual-help__panel';
    panel.id = panelId;
    panel.hidden = true;
    panel.setAttribute('role', 'region');

    if (config.title) {
      const title = appendTextElement(doc, panel, 'h4', 'contextual-help__title', config.title);
      title.id = `${panelId}-title`;
      panel.setAttribute('aria-labelledby', title.id);
    } else {
      panel.setAttribute('aria-label', config.label);
    }
    if (config.summary) appendTextElement(doc, panel, 'p', 'contextual-help__summary', config.summary);

    if (config.example || config.change) {
      const details = doc.createElement('div');
      details.className = 'contextual-help__details';
      appendDetail(doc, details, 'Первый шаг', config.example);
      appendDetail(doc, details, 'Важно', config.change);
      panel.append(details);
    }

    const articleUrl = safeArticleUrl(config.article, doc);
    if (articleUrl || config.assistant) {
      const actions = doc.createElement('div');
      actions.className = 'contextual-help__actions';

      if (articleUrl) {
        const article = doc.createElement('a');
        article.className = 'contextual-help__action';
        article.href = articleUrl;
        article.textContent = 'Подробнее';
        if (config.articleTarget === '_self') {
          article.target = '_self';
        } else {
          article.target = '_blank';
          article.rel = 'noopener noreferrer';
          article.setAttribute('aria-label', `Подробнее: ${config.title || config.label}. Откроется в новой вкладке`);
        }
        actions.append(article);
      }

      if (config.assistant) {
        const assistantButton = doc.createElement('button');
        assistantButton.className = 'contextual-help__action';
        assistantButton.type = 'button';
        assistantButton.textContent = 'Спросить помощника';
        assistantButton.addEventListener('click', () => {
          const CustomEventConstructor = doc.defaultView?.CustomEvent || global.CustomEvent;
          const request = new CustomEventConstructor('minuta:contextual-help-assistant', {
            bubbles: true,
            cancelable: true,
            detail: { host, title: config.title, question: config.question }
          });
          if (host.dispatchEvent(request)) openAssistant(config.question, { document: doc });
        });
        actions.append(assistantButton);
      }

      panel.append(actions);
    }

    wrapper.append(trigger, panel);
    if (host.tagName === 'LABEL') host.insertAdjacentElement('afterend', wrapper);
    else host.append(wrapper);

    const instance = { host, wrapper, trigger, panel, config };
    instances.set(host, instance);

    trigger.addEventListener('click', () => {
      if (panel.hidden) openPanel(instance);
      else closePanel(instance);
    });
    wrapper.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || panel.hidden) return;
      event.preventDefault();
      closePanel(instance, true);
    });

    return {
      host,
      open: () => openPanel(instance),
      close: () => closePanel(instance),
      destroy: () => destroy(host)
    };
  }

  function init(root = global.document) {
    if (!root?.querySelectorAll) return [];
    const hosts = [];
    if (root.matches?.(SELECTOR)) hosts.push(root);
    root.querySelectorAll(SELECTOR).forEach(host => hosts.push(host));
    return hosts.map(host => instances.get(host) || mount(host)).filter(Boolean);
  }

  const api = Object.freeze({ init, mount, destroy, openAssistant });
  global.MinutaContextualHelp = api;

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})(window);
