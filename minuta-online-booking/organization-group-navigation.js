/* Enhance the existing section buttons; provider.js remains the owner of
   permissions, lazy loading, section persistence and panel disclosure. */
(() => {
  'use strict';

  const nav = document.getElementById('organizationSectionNav');
  const workspace = document.getElementById('organizationWorkspace');
  if (!nav || !workspace || workspace.hasAttribute('data-organization-groups-ready')) return;

  const definitions = [
    { key:'overview', label:'Обзор', sections:['organizationOverviewSection'] },
    { key:'team', label:'Команда', sections:['organizationPeopleSection', 'resourcesPanel', 'shiftsPanel', 'inventoryPanel'] },
    { key:'finance', label:'Финансы', sections:['payrollPanel', 'paymentProviderPanel'] },
    { key:'sales', label:'Продажи', sections:['commercePanel', 'benefitsPanel', 'certificateDesignerPanel', 'loyaltyPanel', 'retentionPanel'] }
  ];
  const sectionGroups = new Map(definitions.flatMap(group => group.sections.map(id => [id, group.key])));
  const sections = () => [...nav.querySelectorAll('[data-section-target]')];
  const permitted = button => !button.hidden && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  // A future section must stay reachable even before this grouping is updated.
  if (sections().some(button => !sectionGroups.has(button.dataset.sectionTarget))) return;

  const groups = document.createElement('nav');
  groups.className = 'organization-section-groups';
  groups.setAttribute('aria-label', 'Группы разделов организации');
  const shell = document.createElement('div');
  shell.className = 'organization-group-navigation';
  const lastSections = new Map();
  let observer;
  let resizeObserver;

  const setAttribute = (element, name, value) => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  const cleanup = () => {
    observer?.disconnect();
    resizeObserver?.disconnect();
    if (nav.parentElement === shell) shell.before(nav);
    groups.remove();
    shell.remove();
    workspace.removeAttribute('data-organization-groups-ready');
    workspace.style.removeProperty('--organization-navigation-height');
    nav.removeAttribute('data-active-organization-group');
    sections().forEach(button => button.removeAttribute('data-organization-group-inactive'));
  };

  try {
    definitions.forEach(group => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.organizationGroup = group.key;
      button.textContent = group.label;
      button.setAttribute('aria-controls', nav.id);
      button.setAttribute('aria-pressed', 'false');
      groups.append(button);
    });
    nav.before(shell);
    shell.append(groups, nav);

    const updateScrollOffset = () => {
      const height = shell.getBoundingClientRect().height;
      if (height > 0 && workspace.style.getPropertyValue('--organization-navigation-height') !== `${height}px`) {
        workspace.style.setProperty('--organization-navigation-height', `${height}px`);
      }
    };

    const revealSelectedSection = (selected = null) => {
      if (nav.dataset.activeOrganizationGroup !== 'sales' || !window.matchMedia('(max-width:760px)').matches) return;
      const button = selected || sections().find(item => item.dataset.sectionTarget === nav.dataset.activeSectionTarget);
      if (!button || !permitted(button)) return;
      const bounds = button.getBoundingClientRect(), viewport = nav.getBoundingClientRect();
      if (bounds.left < viewport.left + 4) nav.scrollLeft += bounds.left - viewport.left - 4;
      else if (bounds.right > viewport.right - 4) nav.scrollLeft += bounds.right - viewport.right + 4;
    };

    const refresh = (preferred = null) => {
      const buttons = sections();
      if (buttons.some(button => !sectionGroups.has(button.dataset.sectionTarget))) {
        cleanup();
        return;
      }
      // Never overwrite `hidden`: it is owned by the original role/lazy logic.
      const available = buttons.filter(permitted);
      const selected = (preferred && available.includes(preferred) ? preferred : null)
        || available.find(button => button.dataset.sectionTarget === nav.dataset.activeSectionTarget)
        || available.find(button => button.getAttribute('aria-current') === 'location')
        || available.find(button => button.classList.contains('active'))
        || available[0];
      const selectedGroup = sectionGroups.get(selected?.dataset.sectionTarget) || '';
      if (selected) lastSections.set(selectedGroup, selected.dataset.sectionTarget);
      groups.querySelectorAll('[data-organization-group]').forEach(button => {
        const group = button.dataset.organizationGroup;
        const hidden = !available.some(section => sectionGroups.get(section.dataset.sectionTarget) === group);
        if (button.hidden !== hidden) button.hidden = hidden;
        setAttribute(button, 'aria-pressed', String(!hidden && group === selectedGroup));
      });
      buttons.forEach(button => {
        const inactive = sectionGroups.get(button.dataset.sectionTarget) !== selectedGroup;
        if (inactive) setAttribute(button, 'data-organization-group-inactive', '');
        else button.removeAttribute('data-organization-group-inactive');
      });
      setAttribute(nav, 'data-active-organization-group', selectedGroup);
      if (selected) setAttribute(workspace, 'data-organization-groups-ready', '');
      else workspace.removeAttribute('data-organization-groups-ready');
      groups.hidden = !selected;
      updateScrollOffset();
      revealSelectedSection(selected);
    };

    groups.addEventListener('click', event => {
      const groupButton = event.target.closest('[data-organization-group]');
      if (!groupButton || groupButton.hidden) return;
      const group = groupButton.dataset.organizationGroup;
      const available = sections().filter(button => permitted(button) && sectionGroups.get(button.dataset.sectionTarget) === group);
      const target = available.find(button => button.dataset.sectionTarget === lastSections.get(group)) || available[0];
      // The original delegated handler activates the existing section/controller.
      if (target && permitted(target)) {
        // Resolve wrapping/scroll margin before the original handler scrolls.
        refresh(target);
        target.click();
        refresh();
      }
    });

    groups.addEventListener('keydown', event => {
      const current = event.target.closest('[data-organization-group]');
      if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const visible = [...groups.querySelectorAll('[data-organization-group]')].filter(button => !button.hidden);
      if (!visible.length) return;
      event.preventDefault();
      const index = visible.indexOf(current);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length;
      visible[next].focus();
    });

    observer = new MutationObserver(() => {
      try { refresh(); } catch { cleanup(); }
    });
    observer.observe(nav, {
      subtree:true, childList:true, attributes:true,
      attributeFilter:['class', 'hidden', 'disabled', 'aria-disabled', 'aria-current', 'data-active-section-target']
    });
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => { updateScrollOffset(); revealSelectedSection(); });
      resizeObserver.observe(shell);
    }
    refresh();
  } catch {
    // Keep the original desktop strip/mobile selector if enhancement fails.
    cleanup();
  }
})();
