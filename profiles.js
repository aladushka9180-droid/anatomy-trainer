(() => {
  'use strict';

  const REGISTRY_KEY = 'anatomy_profiles_v1';
  const SESSION_KEY = 'anatomy_profile_selected_session_v1';
  const PREFIX = 'anatomy_profile_data_v1_';
  const GUEST_ID = 'guest';
  const LEGACY_KEYS = [
    'anatomy_trainer_github_v1',
    'anatomy_trainer_language_v1',
    'anatomy_trainer_voice_v1',
    'anatomy_trainer_appearance_v1',
    'anatomy_trainer_subject_v1',
    'anatomy_trainer_category_v1',
    'anatomy_trainer_path_v1',
    'anatomy_trainer_mode_v1',
    'anatomy_trainer_stage_v1',
    'anatomy_trainer_onboarding_v1',
    'anatomy_trainer_beginner_v1',
    'anatomy_professional_learning_v1'
  ];
  const COLORS = ['#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#64748b'];
  const AVATARS = ['care', 'balance', 'anatomy', 'motion', 'study', 'focus'];
  const LEGACY_AVATARS = {'👐': 'care', '🌿': 'balance', '🧠': 'anatomy', '💪': 'motion', '🦴': 'study', '⭐': 'focus'};
  const AVATAR_ICONS = {
    care: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13.5c2.5 0 4.2 1.1 5.5 3.5 1.3-2.4 3-3.5 5.5-3.5 2.7 0 4.5 1.7 5 4.5-2.8 1.8-5.5 2.7-8 2.7S6.8 19.8 4 18c.5-2.8 2.3-4.5 5-4.5"/><path d="M12 16c-2.7-1.6-4.2-3.6-4.2-5.7A2.8 2.8 0 0 1 12 7.9a2.8 2.8 0 0 1 4.2 2.4c0 2.1-1.5 4.1-4.2 5.7Z"/></svg>',
    balance: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20c-4.7 0-8-2.2-8-5.5 3.7-.2 6.4 1.2 8 4.2 1.6-3 4.3-4.4 8-4.2 0 3.3-3.3 5.5-8 5.5Z"/><path d="M12 18.5c-2.5-2.1-3.7-4.4-3.7-6.8S9.5 7.1 12 4c2.5 3.1 3.7 5.3 3.7 7.7S14.5 16.4 12 18.5Z"/></svg>',
    anatomy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7-4.1-7-10.1A4.1 4.1 0 0 1 12 7.5a4.1 4.1 0 0 1 7 2.9c0 6-7 10.1-7 10.1Z"/><path d="M4.7 13h4l1.5-3 2.5 6 1.6-3H20"/></svg>',
    motion: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><path d="m8 21 2-6-3-3 3-3 4 2 3-2"/><path d="m10 9 2 4 4 2 2 5"/></svg>',
    study: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c2.8-.8 5.5-.3 8 1.5v13c-2.5-1.8-5.2-2.3-8-1.5Z"/><path d="M20 5.5c-2.8-.8-5.5-.3-8 1.5v13c2.5-1.8 5.2-2.3 8-1.5Z"/></svg>',
    focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"/></svg>',
    guest: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6"/></svg>'
  };
  const guestMemory = new Map();

  const makeId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const cleanName = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const safeColor = (value) => COLORS.includes(value) ? value : COLORS[0];
  const safeAvatar = (value) => AVATARS.includes(value) ? value : (LEGACY_AVATARS[value] || AVATARS[0]);
  const avatarMarkup = (value) => AVATAR_ICONS[value === 'guest' ? 'guest' : safeAvatar(value)];
  const storageKey = (profileId, key) => `${PREFIX}${profileId}__${key}`;
  const readRegistry = () => {
    try {
      const value = JSON.parse(localStorage.getItem(REGISTRY_KEY) || 'null');
      if (!value || !Array.isArray(value.profiles)) return null;
      const profiles = value.profiles.filter((item) => item && typeof item.id === 'string' && cleanName(item.name)).map((item) => ({
        id: item.id,
        name: cleanName(item.name),
        color: safeColor(item.color),
        avatar: safeAvatar(item.avatar),
        createdAt: item.createdAt || new Date().toISOString()
      }));
      const activeId = value.activeId === GUEST_ID || profiles.some((item) => item.id === value.activeId)
        ? value.activeId
        : (profiles[0]?.id || GUEST_ID);
      return {version: 1, profiles, activeId};
    } catch (_) {
      return null;
    }
  };
  const writeRegistry = (value) => localStorage.setItem(REGISTRY_KEY, JSON.stringify(value));
  const createInitialRegistry = () => {
    const profile = {id: makeId(), name: 'Мой профиль', color: COLORS[0], avatar: AVATARS[0], createdAt: new Date().toISOString()};
    const value = {version: 1, profiles: [profile], activeId: profile.id};
    writeRegistry(value);
    return value;
  };

  let registry = readRegistry() || createInitialRegistry();
  let pickerOpen = false;
  let pickerRequired = false;
  let returnFocus = null;

  function migrateLegacyData() {
    const target = registry.profiles.find((item) => item.id === registry.activeId) || registry.profiles[0];
    if (!target) return;
    LEGACY_KEYS.forEach((key) => {
      const legacy = localStorage.getItem(key);
      if (legacy === null) return;
      const targetKey = storageKey(target.id, key);
      try {
        if (localStorage.getItem(targetKey) === null) localStorage.setItem(targetKey, legacy);
        localStorage.removeItem(key);
      } catch (_) {
        /* Keep the legacy value and let the trainer continue without blocking. */
      }
    });
  }

  migrateLegacyData();

  const currentProfile = () => registry.activeId === GUEST_ID
    ? {id: GUEST_ID, name: 'Гость', color: '#94a3b8', avatar: 'guest', guest: true}
    : (registry.profiles.find((item) => item.id === registry.activeId) || registry.profiles[0] || {id: GUEST_ID, name: 'Гость', color: '#94a3b8', avatar: 'guest', guest: true});

  const storage = {
    getItem(key) {
      const profile = currentProfile();
      if (profile.id === GUEST_ID) return guestMemory.has(key) ? guestMemory.get(key) : null;
      return localStorage.getItem(storageKey(profile.id, key));
    },
    setItem(key, value) {
      const profile = currentProfile();
      const stringValue = String(value);
      if (profile.id === GUEST_ID) guestMemory.set(key, stringValue);
      else localStorage.setItem(storageKey(profile.id, key), stringValue);
    },
    removeItem(key) {
      const profile = currentProfile();
      if (profile.id === GUEST_ID) guestMemory.delete(key);
      else localStorage.removeItem(storageKey(profile.id, key));
    }
  };

  function saveRegistry() {
    writeRegistry(registry);
  }

  function profileData(profileId) {
    const result = {};
    const prefix = `${PREFIX}${profileId}__`;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) result[key.slice(prefix.length)] = localStorage.getItem(key);
    }
    return result;
  }

  function removeProfileData(profileId) {
    const prefix = `${PREFIX}${profileId}__`;
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  }

  function switchProfile(id, forceReload = false) {
    if (id !== GUEST_ID && !registry.profiles.some((item) => item.id === id)) return;
    const changed = registry.activeId !== id;
    registry.activeId = id;
    saveRegistry();
    sessionStorage.setItem(SESSION_KEY, 'done');
    pickerRequired = false;
    closePicker();
    if (changed || forceReload) location.reload();
    else window.dispatchEvent(new CustomEvent('anatomy-profile-ready'));
  }

  function createProfile(name, color, avatar) {
    const cleaned = cleanName(name);
    if (!cleaned) throw new Error('Введите имя профиля.');
    if (registry.profiles.length >= 10) throw new Error('Можно создать не больше 10 профилей. Удалите ненужный профиль или используйте гостевой режим.');
    if (registry.profiles.some((item) => item.name.toLowerCase() === cleaned.toLowerCase())) throw new Error('Профиль с таким именем уже есть. Выберите другое имя.');
    const profile = {id: makeId(), name: cleaned, color: safeColor(color), avatar: safeAvatar(avatar), createdAt: new Date().toISOString()};
    const nextRegistry = {...registry, profiles: [...registry.profiles, profile], activeId: profile.id};
    writeRegistry(nextRegistry);
    registry = nextRegistry;
    sessionStorage.setItem(SESSION_KEY, 'done');
    location.reload();
  }

  function deleteCurrentProfile() {
    const profile = currentProfile();
    if (profile.id === GUEST_ID) return;
    if (!confirm(`Удалить профиль «${profile.name}» и весь его прогресс? Восстановить его можно будет только из заранее экспортированного файла.`)) return;
    removeProfileData(profile.id);
    registry.profiles = registry.profiles.filter((item) => item.id !== profile.id);
    registry.activeId = registry.profiles[0]?.id || GUEST_ID;
    saveRegistry();
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  }

  function exportCurrentProfile() {
    const profile = currentProfile();
    if (profile.id === GUEST_ID) {
      alert('Гостевой режим не сохраняет результаты, поэтому экспортировать его нельзя.');
      return;
    }
    const payload = {
      format: 'anatomy-trainer-profile',
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: {name: profile.name, color: profile.color, avatar: profile.avatar},
      data: profileData(profile.id)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `anatomy-profile-${profile.name.toLowerCase().replace(/[^а-яёa-z0-9]+/gi, '-') || 'user'}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function importProfile(file) {
    if (file.size > 2 * 1024 * 1024) throw new Error('Файл профиля слишком большой. Максимальный размер — 2 МБ.');
    const payload = JSON.parse(await file.text());
    const plainData = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data) && Object.getPrototypeOf(payload.data) === Object.prototype;
    if (!payload || payload.format !== 'anatomy-trainer-profile' || payload.version !== 1 || !payload.profile || !plainData) {
      throw new Error('Это не файл профиля тренажёра.');
    }
    const baseName = cleanName(payload.profile.name) || 'Восстановленный профиль';
    let name = baseName;
    let suffix = 2;
    while (registry.profiles.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      const ending = ` ${suffix++}`;
      name = `${baseName.slice(0, 30 - ending.length)}${ending}`;
    }
    if (registry.profiles.length >= 10) throw new Error('Можно хранить не больше 10 профилей. Удалите ненужный профиль перед восстановлением.');
    const entries = Object.entries(payload.data).filter(([key, value]) => typeof key === 'string' && typeof value === 'string' && value.length <= 1500000 && LEGACY_KEYS.includes(key));
    const profile = {id: makeId(), name, color: safeColor(payload.profile.color), avatar: safeAvatar(payload.profile.avatar), createdAt: new Date().toISOString()};
    const previousActiveId = registry.activeId;
    try {
      entries.forEach(([key, value]) => localStorage.setItem(storageKey(profile.id, key), value));
      registry.profiles.push(profile);
      registry.activeId = profile.id;
      saveRegistry();
    } catch (error) {
      registry.profiles = registry.profiles.filter((item) => item.id !== profile.id);
      registry.activeId = previousActiveId;
      removeProfileData(profile.id);
      throw new Error('Не хватило места для восстановления профиля.');
    }
    sessionStorage.setItem(SESSION_KEY, 'done');
    location.reload();
  }

  function renderProfileList() {
    const list = document.querySelector('#profileList');
    if (!list) return;
    const active = currentProfile();
    const profiles = [...registry.profiles, {id: GUEST_ID, name: 'Гость', color: '#94a3b8', avatar: 'guest', guest: true}];
    list.innerHTML = profiles.map((profile) => `
      <button type="button" class="profilechoice${active.id === profile.id ? ' active' : ''}" data-profile-id="${profile.id}" aria-pressed="${active.id === profile.id}">
        <span class="profileavatar" style="--profile-color:${profile.color}" aria-hidden="true">${avatarMarkup(profile.avatar)}</span>
        <span><strong>${escapeHtml(profile.name)}</strong><small>${profile.guest ? 'Без сохранения результатов' : active.id === profile.id ? 'Сейчас занимается' : 'Прогресс хранится отдельно'}</small></span>
        <span class="profilecheck" aria-hidden="true">${active.id === profile.id ? '✓' : '→'}</span>
      </button>`).join('');
    list.querySelectorAll('[data-profile-id]').forEach((button) => button.addEventListener('click', () => switchProfile(button.dataset.profileId, pickerRequired)));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character]));
  }

  function renderCurrentProfile() {
    const profile = currentProfile();
    document.querySelectorAll('[data-current-profile-name]').forEach((element) => { element.textContent = profile.name; });
    document.querySelectorAll('[data-current-profile-avatar]').forEach((element) => {
      element.innerHTML = avatarMarkup(profile.avatar);
      element.style.setProperty('--profile-color', profile.color);
    });
    const note = document.querySelector('#profileDataNote');
    if (note) note.textContent = profile.id === GUEST_ID
      ? 'Гостевой режим: изменения и результаты исчезнут после обновления страницы.'
      : `Данные профиля «${profile.name}» хранятся только в этом браузере.`;
    const exportButton = document.querySelector('#exportProfile');
    const deleteButton = document.querySelector('#deleteProfile');
    if (exportButton) exportButton.disabled = profile.id === GUEST_ID;
    if (deleteButton) deleteButton.disabled = profile.id === GUEST_ID;
    const mobileButton = document.querySelector('#mobileProfileShortcut');
    if (mobileButton) mobileButton.setAttribute('aria-label', `Сменить профиль: ${profile.name}`);
  }

  function showCreateForm() {
    document.querySelector('#profilePickerView')?.classList.add('hidden');
    document.querySelector('#profileCreateView')?.classList.remove('hidden');
    document.querySelector('#profileDialog')?.setAttribute('aria-labelledby', 'profileCreateTitle');
    const input = document.querySelector('#profileName');
    if (input) {
      input.value = '';
      requestAnimationFrame(() => input.focus());
    }
  }

  function showPickerView() {
    document.querySelector('#profileCreateView')?.classList.add('hidden');
    document.querySelector('#profilePickerView')?.classList.remove('hidden');
    document.querySelector('#profileDialog')?.setAttribute('aria-labelledby', 'profileDialogTitle');
    renderProfileList();
  }

  function setBackgroundInert(value) {
    document.querySelector('.wrap')?.toggleAttribute('inert', value);
    document.querySelector('.mobiletabbar')?.toggleAttribute('inert', value);
    document.body.classList.toggle('profilemodalopen', value);
  }

  function openPicker(required = false) {
    const dialog = document.querySelector('#profileDialog');
    if (!dialog) return;
    returnFocus = document.activeElement;
    pickerOpen = true;
    pickerRequired = required;
    showPickerView();
    dialog.classList.remove('hidden');
    setBackgroundInert(true);
    const close = document.querySelector('#closeProfiles');
    close?.classList.toggle('hidden', required);
    requestAnimationFrame(() => dialog.querySelector('.profilechoice')?.focus());
  }

  function closePicker() {
    if (pickerRequired) return;
    pickerOpen = false;
    document.querySelector('#profileDialog')?.classList.add('hidden');
    setBackgroundInert(false);
    if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
  }

  function initUI() {
    renderCurrentProfile();
    document.querySelector('#profileSwitcher')?.addEventListener('click', () => openPicker(false));
    document.querySelector('#mobileProfileShortcut')?.addEventListener('click', () => openPicker(false));
    document.querySelector('#switchProfileFromSettings')?.addEventListener('click', () => openPicker(false));
    document.querySelector('#createProfileFromSettings')?.addEventListener('click', () => { openPicker(false); showCreateForm(); });
    document.querySelector('#closeProfiles')?.addEventListener('click', closePicker);
    document.querySelector('#createProfileButton')?.addEventListener('click', showCreateForm);
    document.querySelector('#cancelCreateProfile')?.addEventListener('click', showPickerView);
    document.querySelector('#profileCreateView')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const color = document.querySelector('input[name="profileColor"]:checked')?.value;
      const avatar = document.querySelector('input[name="profileAvatar"]:checked')?.value;
      try { createProfile(document.querySelector('#profileName')?.value, color, avatar); }
      catch (error) { document.querySelector('#profileFormError').textContent = error.message; }
    });
    document.querySelector('#exportProfile')?.addEventListener('click', exportCurrentProfile);
    document.querySelector('#deleteProfile')?.addEventListener('click', deleteCurrentProfile);
    const importInput = document.querySelector('#importProfileFile');
    importInput?.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      const status = document.querySelector('#profileImportStatus');
      try {
        if (status) status.textContent = 'Проверяю файл…';
        await importProfile(file);
      } catch (error) {
        if (status) status.textContent = error.message || 'Не удалось восстановить профиль.';
        importInput.value = '';
      }
    });
    document.addEventListener('keydown', (event) => {
      if (!pickerOpen) return;
      if (event.key === 'Escape' && !pickerRequired) closePicker();
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector('#profileDialog');
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), label.importprofile')].filter((item) => item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== REGISTRY_KEY) return;
      const next = readRegistry();
      if (next) location.reload();
    });
    if (sessionStorage.getItem(SESSION_KEY) !== 'done') openPicker(true);
  }

  window.ProfileManager = {
    storage,
    current: currentProfile,
    open: openPicker,
    isPickerOpen: () => pickerOpen
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI, {once: true});
  else initUI();
})();
