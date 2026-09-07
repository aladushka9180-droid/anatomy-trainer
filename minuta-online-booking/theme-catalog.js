(function initializeMinutaThemeCatalog() {
  'use strict';

  const defineTheme = (key, label, description, groups, palette, recommended = false) => Object.freeze({
    key, label, description, groups:Object.freeze(groups), recommended, palette:Object.freeze(palette)
  });
  const themes = Object.freeze([
    defineTheme('sage', 'Sage Studio', 'Спокойная зелёная', ['featured','light','natural'], { bg:'#f5f8f5', surface:'#ffffff', surfaceAlt:'#f1f7f3', ink:'#183427', muted:'#62766c', line:'#dce7df', accent:'#347258', accentSoft:'#e7f3eb', contrast:'#ffffff', shadow:'rgba(33,74,54,.10)', pattern:'radial-gradient(circle at 8% 2%,rgba(87,144,111,.12),transparent 32%),linear-gradient(145deg,#f3f8f4,#ffffff 60%,#eef5f0)', themeColor:'#153c2c', dark:false }, true),
    defineTheme('nordic', 'Nordic Light', 'Холодный свет и воздух', ['light'], { bg:'#edf3f6', surface:'#ffffff', surfaceAlt:'#f2f7fa', ink:'#20303a', muted:'#647681', line:'#cfdce3', accent:'#3568a8', accentSoft:'#e4eef9', contrast:'#ffffff', shadow:'rgba(37,74,126,.10)', pattern:'radial-gradient(circle at 90% 4%,rgba(104,155,218,.14),transparent 30%),linear-gradient(145deg,#edf3f6,#ffffff 58%,#eef4fa)', themeColor:'#3568e8', dark:false }),
    defineTheme('warm', 'Warm Beige', 'Тёплая бежевая', ['featured','light','natural'], { bg:'#faf5ef', surface:'#fffdfb', surfaceAlt:'#f6ece4', ink:'#392c25', muted:'#74645a', line:'#dfcfc2', accent:'#985b43', accentSoft:'#f1dfd3', contrast:'#ffffff', shadow:'rgba(99,61,43,.10)', pattern:'radial-gradient(circle at 8% 2%,rgba(206,143,105,.14),transparent 31%),linear-gradient(145deg,#faf3ec,#fffdfb 60%,#f6ede5)', themeColor:'#a9664c', dark:false }, true),
    defineTheme('graphite', 'Graphite Night', 'Графит и ночное свечение', ['dark'], { bg:'#14171d', surface:'#1b1f27', surfaceAlt:'#20242d', ink:'#f0f2f5', muted:'#aab2bd', line:'#3a424d', accent:'#8cb7d8', accentSoft:'#263b4b', contrast:'#101419', shadow:'rgba(0,0,0,.32)', pattern:'radial-gradient(circle at 82% 0,rgba(85,140,180,.18),transparent 34%),linear-gradient(145deg,#11151b,#1a2029 58%,#12171e)', themeColor:'#11171b', dark:true }),
    defineTheme('lavender', 'Soft Lavender', 'Светлая лавандовая дымка', ['light'], { bg:'#f3f0f8', surface:'#ffffff', surfaceAlt:'#f8f5fb', ink:'#332e40', muted:'#736c82', line:'#ddd5e8', accent:'#7660a8', accentSoft:'#ebe5f4', contrast:'#ffffff', shadow:'rgba(78,62,112,.10)', pattern:'radial-gradient(circle at 12% 0,rgba(177,151,214,.18),transparent 34%),linear-gradient(145deg,#f4f0f8,#fff 60%,#f0ebf6)', themeColor:'#7660cc', dark:false }),
    defineTheme('luxury', 'Люкс / Премиум', 'Мрамор и золото', ['dark'], { bg:'#0b0c0e', surface:'#151619', surfaceAlt:'#1d1b17', ink:'#f2eadc', muted:'#b9ad98', line:'#514326', accent:'#d6a64d', accentSoft:'#352b19', contrast:'#1c1207', shadow:'rgba(0,0,0,.38)', pattern:'radial-gradient(circle at 88% 2%,rgba(214,166,77,.18),transparent 30%),linear-gradient(145deg,#090a0c,#171719 62%,#0d0d0f)', themeColor:'#0b0c0e', dark:true }),
    defineTheme('loft', 'Лофт / Индастриал', 'Графит, камень и приглушённая медь', ['dark'], { bg:'#242622', surface:'#2d2f2b', surfaceAlt:'#343632', ink:'#f1efea', muted:'#b7b2a8', line:'#565a51', accent:'#b8815d', accentSoft:'#44362d', contrast:'#171510', shadow:'rgba(0,0,0,.28)', pattern:'linear-gradient(135deg,rgba(255,255,255,.025) 25%,transparent 25%) 0 0/18px 18px,linear-gradient(145deg,#222420,#30322e)', themeColor:'#292a28', dark:true }),
    defineTheme('eco', 'Эко / Натуральный', 'Травертин, бумага и шалфей', ['light','natural'], { bg:'#f2ede3', surface:'#fffdf8', surfaceAlt:'#f7f3eb', ink:'#354035', muted:'#74766c', line:'#d9d1c2', accent:'#657b5d', accentSoft:'#e5eadf', contrast:'#ffffff', shadow:'rgba(69,74,58,.10)', pattern:'radial-gradient(circle at 15% 4%,rgba(137,151,113,.14),transparent 32%),linear-gradient(145deg,#f1eadf,#fffdf8 62%,#eee9df)', themeColor:'#f1ece2', dark:false }),
    defineTheme('hitech', 'Хай-тек / Футуризм', 'Холодное стекло и мягкий свет', ['light'], { bg:'#eaf2f7', surface:'#fcfeff', surfaceAlt:'#eef6fa', ink:'#213747', muted:'#637887', line:'#c9dbe5', accent:'#4f7388', accentSoft:'#dceaf1', contrast:'#ffffff', shadow:'rgba(56,92,112,.12)', pattern:'radial-gradient(circle at 88% 2%,rgba(91,155,188,.18),transparent 32%),linear-gradient(145deg,#e9f2f7,#ffffff 58%,#e8f1f6)', themeColor:'#eef4fa', dark:false }),
    defineTheme('japandi', 'Japandi / Wabi-Sabi', 'Бумага, дерево и спокойный ритм', ['featured','light','natural'], { bg:'#f3efe7', surface:'#fffdf9', surfaceAlt:'#eee8de', ink:'#37322c', muted:'#746c62', line:'#d9d0c3', accent:'#8a6b4e', accentSoft:'#ede2d5', contrast:'#ffffff', shadow:'rgba(72,57,43,.09)', pattern:'linear-gradient(90deg,rgba(121,91,61,.035) 1px,transparent 1px) 0 0/22px 22px,linear-gradient(145deg,#f1ece3,#fffdf9)', themeColor:'#f3efe7', dark:false }),
    defineTheme('midnight', 'Midnight Navy', 'Глубокий синий и холодный свет', ['featured','dark'], { bg:'#08111f', surface:'#101d2d', surfaceAlt:'#14263a', ink:'#eef5fb', muted:'#9fb0c2', line:'#2b435b', accent:'#7ab0d5', accentSoft:'#18364d', contrast:'#07111c', shadow:'rgba(0,0,0,.36)', pattern:'radial-gradient(circle at 82% 0,rgba(86,158,207,.20),transparent 34%),linear-gradient(145deg,#07101d,#102137 62%,#091421)', themeColor:'#08111f', dark:true }),
    defineTheme('mono', 'Editorial Mono', 'Контрастная журнальная сетка', ['featured','light'], { bg:'#f3f3f0', surface:'#ffffff', surfaceAlt:'#ecece8', ink:'#191919', muted:'#666661', line:'#ccccca', accent:'#292929', accentSoft:'#e5e5e1', contrast:'#ffffff', shadow:'rgba(0,0,0,.09)', pattern:'linear-gradient(90deg,rgba(0,0,0,.035) 1px,transparent 1px) 0 0/32px 32px,linear-gradient(#f5f5f2,#eeeeeb)', themeColor:'#f3f3f0', dark:false }),
    defineTheme('desert', 'Desert Clay', 'Песок, глина и терракота', ['featured','light','natural'], { bg:'#f5e9db', surface:'#fffaf4', surfaceAlt:'#f1dfcf', ink:'#422f24', muted:'#7f6656', line:'#dec5b2', accent:'#a65f40', accentSoft:'#eed4c2', contrast:'#ffffff', shadow:'rgba(102,62,40,.10)', pattern:'radial-gradient(circle at 12% 2%,rgba(181,103,67,.15),transparent 31%),linear-gradient(145deg,#f3e4d5,#fffaf4 58%,#f1dfcf)', themeColor:'#f5e9db', dark:false }),
    defineTheme('rose', 'Rose Smoke', 'Дымчатая роза и мягкий сливовый', ['light'], { bg:'#f2eaed', surface:'#fffafb', surfaceAlt:'#eee1e6', ink:'#422f37', muted:'#7c6670', line:'#ddcbd2', accent:'#946477', accentSoft:'#ead8df', contrast:'#ffffff', shadow:'rgba(95,60,75,.10)', pattern:'radial-gradient(circle at 86% 2%,rgba(178,118,143,.15),transparent 31%),linear-gradient(145deg,#f3e9ed,#fffafb 60%,#efe3e8)', themeColor:'#f2eaed', dark:false }),
    defineTheme('botanical', 'Botanical Night', 'Хвойная ночь, мох и кремовый свет', ['dark','natural'], { bg:'#202623', surface:'#29312d', surfaceAlt:'#303a35', ink:'#f2efe5', muted:'#b7b8a9', line:'#4b5a51', accent:'#a8bd89', accentSoft:'#384735', contrast:'#172018', shadow:'rgba(0,0,0,.30)', pattern:'radial-gradient(circle at 88% 4%,rgba(143,174,109,.16),transparent 33%),linear-gradient(145deg,#1d2420,#2c352f 62%,#202723)', themeColor:'#202623', dark:true }),
    defineTheme('burgundy', 'Burgundy Atelier', 'Глубокое вино и тёплый сливочный', ['dark'], { bg:'#282326', surface:'#352b30', surfaceAlt:'#402f36', ink:'#f5ede8', muted:'#c1adaf', line:'#644b54', accent:'#d29a88', accentSoft:'#543940', contrast:'#2a171b', shadow:'rgba(0,0,0,.31)', pattern:'radial-gradient(circle at 84% 0,rgba(181,99,110,.16),transparent 34%),linear-gradient(145deg,#251f23,#382c32 62%,#2a2227)', themeColor:'#282326', dark:true }),
    defineTheme('coastal', 'Coastal Porcelain', 'Фарфор, морской синий и песок', ['light'], { bg:'#f1f6f7', surface:'#ffffff', surfaceAlt:'#eaf1f2', ink:'#243841', muted:'#667a82', line:'#ccdcdf', accent:'#477b8a', accentSoft:'#dcebed', contrast:'#ffffff', shadow:'rgba(46,83,94,.10)', pattern:'radial-gradient(circle at 88% 2%,rgba(104,169,184,.15),transparent 31%),linear-gradient(145deg,#eff5f6,#fff 60%,#edf3f2)', themeColor:'#f1f6f7', dark:false }),
    defineTheme('pearl', 'Pearl Atelier', 'Жемчуг, мягкий графит и сатиновый свет', ['featured','light'], { bg:'#f4f4f5', surface:'#ffffff', surfaceAlt:'#efeff2', ink:'#30323b', muted:'#646772', line:'#d6d7dd', accent:'#505463', accentSoft:'#e8e8ee', contrast:'#ffffff', shadow:'rgba(57,60,77,.10)', pattern:'radial-gradient(ellipse at 85% 0,rgba(224,220,233,.38),transparent 44%),linear-gradient(145deg,#f0f0f3,#fdfcfa 55%,#f1f2f5)', themeColor:'#f4f4f5', dark:false }),
    defineTheme('butter', 'Butter Studio', 'Светлая ваниль и солнечные акценты', ['featured','light'], { bg:'#faf9f3', surface:'#fffef9', surfaceAlt:'#f6f1df', ink:'#3b3526', muted:'#77705f', line:'#e2d9bd', accent:'#a77b2f', accentSoft:'#f2e8c8', contrast:'#ffffff', shadow:'rgba(106,82,31,.09)', pattern:'radial-gradient(circle at 88% 0,rgba(225,189,92,.18),transparent 32%),linear-gradient(145deg,#faf8ef,#fffef9 60%,#f7f0db)', themeColor:'#faf9f3', dark:false }),
    defineTheme('celadon', 'Celadon', 'Белая керамика и прохладная мята', ['featured','light','natural'], { bg:'#f0f6f3', surface:'#fcfefd', surfaceAlt:'#e8f0ed', ink:'#253b37', muted:'#596e67', line:'#cbdcd5', accent:'#326b5e', accentSoft:'#dceee6', contrast:'#ffffff', shadow:'rgba(40,87,72,.10)', pattern:'radial-gradient(ellipse at 88% 5%,rgba(162,207,191,.22),transparent 42%),linear-gradient(145deg,#edf5f0,#fcfdfa 60%,#edf5f2)', themeColor:'#f0f6f3', dark:false }),
    defineTheme('snow-leopard', 'Snow Leopard', 'Серебристо-белый леопард и тёмный графит', ['featured','light'], { bg:'#f4f5f6', surface:'#ffffff', surfaceAlt:'#eceef0', ink:'#272c31', muted:'#606970', line:'#cfd4d8', accent:'#343b42', accentSoft:'#e2e6e9', contrast:'#ffffff', shadow:'rgba(38,47,56,.10)', pattern:'radial-gradient(ellipse 9px 6px at 12% 18%,rgba(52,59,66,.14) 0 65%,transparent 72%) 0 0/92px 78px,radial-gradient(ellipse 6px 9px at 64% 68%,rgba(52,59,66,.09) 0 65%,transparent 72%) 0 0/92px 78px,linear-gradient(#f7f8f9,#eef0f2)', themeColor:'#f4f5f6', dark:false }),
    defineTheme('apricot-tiger', 'Apricot Tiger', 'Приглушённый абрикос, тигриный шёлк и кофе', ['featured','light','natural'], { bg:'#fff3e7', surface:'#fffdfb', surfaceAlt:'#f5e9de', ink:'#342a24', muted:'#746357', line:'#d8c4b4', accent:'#805238', accentSoft:'#efe0d3', contrast:'#ffffff', shadow:'rgba(88,56,34,.09)', pattern:'repeating-linear-gradient(112deg,transparent 0 44px,rgba(86,54,34,.07) 46px 53px,transparent 56px 88px),linear-gradient(145deg,#fff3e7,#fffaf5)', themeColor:'#fff3e7', dark:false }),
    defineTheme('golden-cheetah', 'Golden Cheetah', 'Слоновая кость, песочное золото и какао', ['featured','light','natural'], { bg:'#fff7ec', surface:'#fffdf8', surfaceAlt:'#f8ecdc', ink:'#34271f', muted:'#796452', line:'#d7c1ad', accent:'#805033', accentSoft:'#f0dfca', contrast:'#ffffff', shadow:'rgba(88,56,34,.09)', pattern:'radial-gradient(ellipse 5px 4px at 8% 12%,rgba(92,70,54,.16) 0 68%,transparent 76%) 0 0/94px 94px,radial-gradient(ellipse 4px 6px at 68% 62%,rgba(60,46,37,.12) 0 70%,transparent 78%) 0 0/94px 94px,linear-gradient(#fff7ec,#f8e5ca)', themeColor:'#fff7ec', dark:false }),
    defineTheme('velvet-leopard', 'Velvet Leopard', 'Кремовый фон, чёрные пятна и какао', ['featured','light','natural'], { bg:'#f2dfc7', surface:'#fffaf3', surfaceAlt:'#f4e5d3', ink:'#2e2520', muted:'#705c4e', line:'#c5a991', accent:'#6e442d', accentSoft:'#ead6c0', contrast:'#ffffff', shadow:'rgba(74,45,28,.10)', pattern:'linear-gradient(#f2dfc7,#ead2b7)', themeColor:'#f2dfc7', dark:false }),
    defineTheme('pearl-zebra', 'Pearl Zebra', 'Жемчужная зебра: молочный фон и дымчатые полосы', ['featured','light','natural'], { bg:'#f5f2ee', surface:'#fffdfb', surfaceAlt:'#eeeae5', ink:'#302e2b', muted:'#716a64', line:'#d1cac3', accent:'#4f4944', accentSoft:'#e7e2dc', contrast:'#ffffff', shadow:'rgba(60,50,40,.09)', pattern:'repeating-radial-gradient(ellipse at -12% 16%,transparent 0 24px,rgba(79,73,68,.09) 25px 35px,transparent 37px 67px),linear-gradient(#f5f2ee,#eeeae5)', themeColor:'#f5f2ee', dark:false }),
    defineTheme('noir-safari', 'Noir Safari', 'Тёмная замша, коньячный акцент и леопардовый рисунок', ['featured','dark','natural'], { bg:'#080705', surface:'#15110d', surfaceAlt:'#211913', ink:'#f4eadc', muted:'#bba993', line:'#4a392b', accent:'#b87748', accentSoft:'#39261a', contrast:'#120b06', shadow:'rgba(0,0,0,.42)', pattern:'radial-gradient(ellipse 7px 5px at 14% 18%,rgba(184,119,72,.15) 0 67%,transparent 75%) 0 0/88px 84px,radial-gradient(ellipse 5px 8px at 66% 70%,rgba(184,119,72,.10) 0 68%,transparent 76%) 0 0/88px 84px,linear-gradient(145deg,#070604,#17100c)', themeColor:'#080705', dark:true })
  ]);
  const headlines = Object.freeze([
    Object.freeze({ key:'massage-time', label:'Массаж в удобное время.', description:'Прямо и понятно' }),
    Object.freeze({ key:'care', label:'Лёгкость начинается с заботы о себе.', description:'Мягко и заботливо' }),
    Object.freeze({ key:'beauty', label:'Красота начинается со свободного времени.', description:'Элегантно и эмоционально' }),
    Object.freeze({ key:'booking', label:'Выберите время для себя.', description:'Коротко и универсально' })
  ]);
  const themeKeys = Object.freeze(themes.map(item => item.key));
  const headlineKeys = Object.freeze(headlines.map(item => item.key));
  const normalizeTheme = value => themeKeys.includes(String(value || '')) ? String(value) : 'sage';
  const normalizeHeadline = value => headlineKeys.includes(String(value || '')) ? String(value) : 'massage-time';
  const theme = key => themes.find(item => item.key === normalizeTheme(key));
  const headline = key => headlines.find(item => item.key === normalizeHeadline(key));
  const normalizeSettings = value => Object.freeze({ theme_key:normalizeTheme(value?.theme_key), headline_key:normalizeHeadline(value?.headline_key) });
  const legacyClientStorageKey = slug => `minuta-client-theme-v1:${String(slug || 'default').toLowerCase()}`;
  const clientStorageKey = organizationId => `minuta-client-theme-v2:organization:${String(organizationId || 'unknown').toLowerCase()}`;
  const validOverride = value => value === 'follow' || themeKeys.includes(value) ? value : '';
  const migrateClientOverride = (organizationId, slug) => {
    if (!organizationId || !slug) return '';
    try {
      const current = validOverride(localStorage.getItem(clientStorageKey(organizationId)));
      if (current) return current;
      const legacy = validOverride(localStorage.getItem(legacyClientStorageKey(slug)));
      if (legacy) localStorage.setItem(clientStorageKey(organizationId), legacy);
      return legacy;
    } catch { return ''; }
  };
  const readClientOverride = (organizationId, fallbackSlug = '') => {
    try {
      if (organizationId) return validOverride(localStorage.getItem(clientStorageKey(organizationId))) || migrateClientOverride(organizationId, fallbackSlug) || 'follow';
      return validOverride(localStorage.getItem(legacyClientStorageKey(fallbackSlug))) || 'follow';
    } catch { return 'follow'; }
  };
  const writeClientOverride = (organizationId, value, fallbackSlug = '') => {
    const normalized = value === 'follow' ? 'follow' : normalizeTheme(value);
    try { localStorage.setItem(organizationId ? clientStorageKey(organizationId) : legacyClientStorageKey(fallbackSlug), normalized); } catch {}
    return normalized;
  };
  const settingsFromSearch = search => {
    const params = new URLSearchParams(String(search || ''));
    return normalizeSettings({ theme_key:params.get('theme'), headline_key:params.get('headline') });
  };
  const applyClientTheme = (element, key) => {
    const selected = theme(key);
    if (!element || !selected) return selected;
    element.dataset.clientTheme = selected.key;
    const palette = selected.palette;
    Object.entries({ bg:palette.bg, surface:palette.surface, 'surface-alt':palette.surfaceAlt, ink:palette.ink, muted:palette.muted, line:palette.line, accent:palette.accent, 'accent-soft':palette.accentSoft, contrast:palette.contrast, shadow:palette.shadow, pattern:palette.pattern }).forEach(([name, value]) => element.style.setProperty(`--client-${name}`, value));
    element.style.colorScheme = palette.dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.themeColor);
    return selected;
  };

  window.MinutaThemeCatalog = Object.freeze({ themes, headlines, themeKeys, headlineKeys, normalizeTheme, normalizeHeadline, normalizeSettings, theme, headline, clientStorageKey, legacyClientStorageKey, migrateClientOverride, readClientOverride, writeClientOverride, settingsFromSearch, applyClientTheme });
})();
