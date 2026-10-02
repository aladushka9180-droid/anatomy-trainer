(function initializeProviderSelects() {
  'use strict';

  function start() {
    const body = document.body;
    if (!body?.classList.contains('provider-body') || body.dataset.providerSelectsReady || typeof HTMLDialogElement === 'undefined') return;
    body.dataset.providerSelectsReady = 'true';
    const states = new Map();
    let active = null;
    let serial = 0;
    let typed = '';
    let typedAt = 0;
    let invalidFocused = false;

    const dialog = document.createElement('dialog');
    dialog.className = 'pro-select-dialog';
    dialog.innerHTML = '<header class="pro-select-head"><h2 id="proSelectTitle"></h2><button type="button" class="pro-select-close" aria-label="Закрыть выбор">×</button></header><div class="pro-select-list" id="proSelectList" role="listbox" aria-labelledby="proSelectTitle"></div>';
    dialog.setAttribute('aria-labelledby', 'proSelectTitle');
    body.append(dialog);
    const title = dialog.querySelector('h2');
    const list = dialog.querySelector('[role="listbox"]');

    function attribute(node, name, value) {
      if (value === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
      else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
    }

    function labelFor(select) {
      const explicit = select.getAttribute('aria-label');
      if (explicit) return explicit;
      const references = (select.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      if (references.length) return references.map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      const label = select.labels?.[0] || select.closest('label');
      if (!label) return 'Выберите вариант';
      const copy = label.cloneNode(true);
      copy.querySelectorAll('select,button,input,textarea,small,output,.session-service-name,.pro-select-error').forEach(node => node.remove());
      return copy.textContent.replace(/\s+/g, ' ').trim() || 'Выберите вариант';
    }

    function position() {
      if (!active || !dialog.open) return;
      if (innerWidth <= 760) { dialog.removeAttribute('style'); return; }
      const rect = active.trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 300), 520, innerWidth - 32);
      dialog.style.width = `${width}px`;
      const height = Math.min(dialog.getBoundingClientRect().height, innerHeight - 32);
      const below = rect.bottom + 8;
      const top = below + height <= innerHeight - 16 ? below : Math.max(16, rect.top - height - 8);
      dialog.style.left = `${Math.max(16, Math.min(rect.left, innerWidth - width - 16))}px`;
      dialog.style.top = `${Math.min(top, innerHeight - height - 16)}px`;
    }

    function close() {
      const previous = active;
      active = null;
      if (dialog.open) dialog.close();
      if (previous) {
        attribute(previous.trigger, 'aria-expanded', 'false');
        if (previous.trigger.isConnected && !previous.trigger.disabled && previous.trigger.getClientRects().length) previous.trigger.focus({ preventScroll:true });
      }
    }

    function choose(index) {
      const state = active;
      const option = state?.select.options[index];
      if (!state || state.select.matches(':disabled') || !option || option.disabled || option.parentElement.disabled) return;
      close();
      if (state.select.selectedIndex === index) return;
      state.select.selectedIndex = index;
      state.select.dispatchEvent(new Event('input', { bubbles:true }));
      state.select.dispatchEvent(new Event('change', { bubbles:true }));
      refresh(state);
    }

    function menu() {
      if (!active) return;
      const focusedIndex = list.contains(document.activeElement) ? document.activeElement.dataset.optionIndex : null;
      title.textContent = labelFor(active.select);
      list.replaceChildren();
      let group = null;
      [...active.select.options].forEach((option, index) => {
        const optgroup = option.parentElement.tagName === 'OPTGROUP' ? option.parentElement : null;
        if (option.hidden || optgroup?.hidden) return;
        if (optgroup && group !== optgroup) {
          const heading = document.createElement('div');
          heading.className = 'pro-select-group'; heading.textContent = optgroup.label;
          list.append(heading);
        }
        group = optgroup;
        const row = document.createElement('button');
        row.type = 'button'; row.className = 'pro-select-option';
        row.tabIndex = -1;
        row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === active.select.selectedIndex));
        row.dataset.optionIndex = String(index);
        row.disabled = option.disabled || Boolean(optgroup?.disabled);
        row.innerHTML = '<span class="pro-select-option-text"></span><span class="pro-select-mark" aria-hidden="true"></span>';
        row.firstElementChild.textContent = option.label;
        row.addEventListener('click', () => choose(index));
        list.append(row);
      });
      if (!list.querySelector('[role="option"]')) {
        const empty = document.createElement('p'); empty.className = 'pro-select-empty'; empty.textContent = 'Нет вариантов'; list.append(empty);
      }
      position();
      if (dialog.open && focusedIndex !== null) {
        focusOption(list.querySelector(`[data-option-index="${focusedIndex}"]:not(:disabled)`) || list.querySelector('[role="option"]:not(:disabled)'));
      }
    }

    function focusOption(row) {
      if (!row) return;
      list.querySelectorAll('[role="option"]').forEach(option => { option.tabIndex = option === row ? 0 : -1; });
      row?.focus({ preventScroll:true });
      row?.scrollIntoView({ block:'nearest' });
    }

    function open(state, edge) {
      refresh(state);
      if (state.trigger.disabled || state.trigger.hidden || !state.trigger.getClientRects().length) return;
      if (active) close();
      active = state; typed = ''; typedAt = 0;
      attribute(state.trigger, 'aria-expanded', 'true');
      menu(); dialog.showModal(); position();
      const options = [...list.querySelectorAll('[role="option"]:not(:disabled)')];
      const selected = options.find(row => row.getAttribute('aria-selected') === 'true');
      focusOption(edge === 'last' ? options.at(-1) : edge === 'first' ? options[0] : selected || options[0]);
    }

    function refresh(state) {
      const {select, trigger, value} = state;
      if (!select.isConnected) return;
      const text = select.selectedOptions[0]?.label || 'Выберите вариант';
      if (value.textContent !== text) value.textContent = text;
      const disabled = select.matches(':disabled');
      if (trigger.disabled !== disabled) trigger.disabled = disabled;
      const hidden = select.hidden || getComputedStyle(select).display === 'none';
      if (trigger.hidden !== hidden) trigger.hidden = hidden;
      attribute(trigger, 'aria-label', `${labelFor(select)}: ${text}${select.required ? '. Обязательное поле' : ''}`);
      if (select.validity.valid) { attribute(trigger, 'aria-invalid', null); if (!state.error.hidden) state.error.hidden = true; }
      const descriptions = [select.getAttribute('aria-describedby'), state.error.hidden ? '' : state.error.id].filter(Boolean).join(' ');
      attribute(trigger, 'aria-describedby', descriptions || null);
      attribute(trigger, 'data-empty', select.value ? null : 'true');
      if (active === state) { if (disabled || hidden) close(); else menu(); }
    }

    function enhance(select) {
      if (select.multiple || select.size > 1) return;
      if (states.has(select)) { refresh(states.get(select)); return; }
      const trigger = document.createElement('button');
      trigger.type = 'button'; trigger.className = 'pro-select-trigger';
      trigger.id = `proSelectTrigger${++serial}`;
      trigger.innerHTML = '<span class="pro-select-value"></span><svg class="pro-select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
      trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-controls', list.id); trigger.setAttribute('aria-expanded', 'false');
      const error = document.createElement('span'); error.className = 'pro-select-error'; error.id = `${trigger.id}Error`; error.hidden = true; error.setAttribute('role', 'alert');
      const state = { select, trigger, error, value:trigger.firstElementChild, originalTabindex:select.getAttribute('tabindex'), originalAriaHidden:select.getAttribute('aria-hidden'), descriptors:new Map() };
      states.set(select, state);
      select.after(trigger);
      trigger.after(error);
      select.classList.add('pro-select-native');
      select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      // Existing controllers still own the native field, its value and its events.
      for (const name of ['value', 'selectedIndex']) {
        if (Object.hasOwn(select, name)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, name);
        if (!descriptor?.set || !descriptor.get) continue;
        Object.defineProperty(select, name, { configurable:true, get:descriptor.get, set(next) { descriptor.set.call(this, next); refresh(state); } });
        state.descriptors.set(name, descriptor);
      }
      state.changed = () => refresh(state);
      state.focused = () => trigger.focus({ preventScroll:true });
      state.invalid = event => {
        event.preventDefault(); error.textContent = select.validationMessage; error.hidden = false; attribute(trigger, 'aria-invalid', 'true'); refresh(state);
        if (!invalidFocused) { invalidFocused = true; trigger.focus(); queueMicrotask(() => { invalidFocused = false; }); }
      };
      select.addEventListener('change', state.changed);
      select.addEventListener('input', state.changed);
      select.addEventListener('focus', state.focused);
      select.addEventListener('invalid', state.invalid);
      trigger.addEventListener('click', () => open(state));
      trigger.addEventListener('keydown', event => {
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); open(state, ['ArrowUp','End'].includes(event.key) ? 'last' : event.key === 'Home' ? 'first' : undefined); }
      });
      refresh(state);
    }

    function scan(root) {
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      if (root.matches('select')) enhance(root);
      root.querySelectorAll('select').forEach(enhance);
    }

    dialog.querySelector('.pro-select-close').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (active && !dialog.open) close(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') event.stopPropagation();
      const options = [...list.querySelectorAll('[role="option"]:not(:disabled)')];
      const index = options.indexOf(document.activeElement);
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? Math.min(index + 1, options.length - 1) : Math.max(index - 1, 0);
        focusOption(options[next]);
      } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now(); typed = now - typedAt > 700 ? event.key : typed + event.key; typedAt = now;
        const query = typed.toLocaleLowerCase('ru');
        focusOption(options.find(row => row.textContent.trim().toLocaleLowerCase('ru').startsWith(query)));
      }
    });
    document.addEventListener('reset', event => queueMicrotask(() => scan(event.target)), true);
    document.addEventListener('close', event => { if (active && event.target !== dialog && event.target.contains(active.select)) close(); }, true);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    new MutationObserver(records => {
      const changed = new Set();
      for (const record of records) {
        for (const node of record.addedNodes || []) scan(node);
        const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        const select = target?.closest('select');
        if (select && states.has(select)) changed.add(states.get(select));
        else if (target?.matches('fieldset')) target.querySelectorAll('select').forEach(node => { if (states.has(node)) changed.add(states.get(node)); });
        else if (target?.closest('label')) target.closest('label').querySelectorAll('select').forEach(node => { if (states.has(node)) changed.add(states.get(node)); });
      }
      for (const [select, state] of states) {
        if (select.isConnected) continue;
        if (active === state) close();
        state.trigger.remove(); state.error.remove();
        select.classList.remove('pro-select-native');
        attribute(select, 'tabindex', state.originalTabindex); attribute(select, 'aria-hidden', state.originalAriaHidden);
        for (const name of state.descriptors.keys()) delete select[name];
        select.removeEventListener('change', state.changed); select.removeEventListener('input', state.changed); select.removeEventListener('focus', state.focused); select.removeEventListener('invalid', state.invalid);
        states.delete(select);
      }
      changed.forEach(refresh);
      if (active && !active.trigger.getClientRects().length) close();
    }).observe(body, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['disabled','hidden','class','style','required','aria-label','aria-labelledby','aria-describedby','selected','label','value'] });
    scan(body);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
