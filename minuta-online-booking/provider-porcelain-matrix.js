(function () {
  'use strict';

  // The persisted shade keys remain unchanged. A character changes the material
  // and gives each of the five positions its own named, compatible palette.
  const shadeKeys = ['pearl-white', 'porcelain-white', 'gentle-pink', 'petal-pink', 'pink-accent'];
  const characters = {
    pearl: {
      labels:['Лунный жемчуг', 'Молочный жемчуг', 'Розовый перламутр', 'Пудровый жемчуг', 'Яркий перламутр'],
      colors:[
        ['#fffdfd','#fff5fa','#9a5477','#eedbe7'],
        ['#fffafd','#ffeaf6','#a9517b','#efd3e3'],
        ['#fff6fb','#ffdef0','#ae517d','#eec9dd'],
        ['#fff0f9','#ffcde9','#a74975','#ebbad5'],
        ['#ffe9f6','#ffb9df','#9b416e','#e9a9cb']
      ],
      actions:['#f5e4ee','#f2d9e8','#edc9df','#e9b9d6','#e4a6cb'],
      shadow:'rgba(103, 67, 87, .09)'
    },
    petal: {
      labels:['Белый лепесток', 'Фарфоровый цвет', 'Нежный розовый', 'Цветущая сакура', 'Розовый акцент'],
      colors:[
        ['#fffafa','#fff0f2','#ad365f','#e9ced5'],
        ['#fff8f9','#ffe8ee','#b9396b','#eacbd5'],
        ['#fff5f8','#ffe8f0','#c43372','#e9cbd6'],
        ['#ffeaf1','#ffd7e5','#b82f67','#eebed0'],
        ['#ffdfeb','#ffc7db','#a7285b','#e6a9c1']
      ],
      actions:['#f6dce4','#f5ccd9','#f3b8ce','#f2a0bd','#ef70a0'],
      shadow:'rgba(147, 53, 88, .11)'
    },
    silk: {
      labels:['Шёлковый жемчуг', 'Сливочный шёлк', 'Пудровый шёлк', 'Розовый атлас', 'Малиновый шёлк'],
      colors:[
        ['#fffdfb','#fff3f3','#9c526d','#eedbdc'],
        ['#fffbf9','#ffe8eb','#a54f70','#efd2d8'],
        ['#fff7f7','#ffdae4','#ac4e75','#edc5d2'],
        ['#fff0f2','#ffc8d9','#a64971','#eab5c8'],
        ['#ffe8ee','#ffb8d0','#9f426b','#e7a8bf']
      ],
      actions:['#f4e2e6','#f1d5df','#edc5d3','#eab3c7','#e5a3be'],
      shadow:'rgba(113, 49, 85, .14)'
    }
  };

  function normalizeCharacter(value) {
    return Object.hasOwn(characters, value) ? value : 'petal';
  }
  function normalizeShade(value) {
    return shadeKeys.includes(value) ? value : 'gentle-pink';
  }
  function shadesFor(value) {
    const character = characters[normalizeCharacter(value)];
    return shadeKeys.map((key, index) => Object.freeze({ key, label:character.labels[index], recommended:index === 2 }));
  }
  function paletteFor(characterValue, shadeValue) {
    const character = characters[normalizeCharacter(characterValue)];
    const index = shadeKeys.indexOf(normalizeShade(shadeValue));
    const [bg, surfaceAlt, accent, line] = character.colors[index];
    return {
      bg, surface:'#ffffff', surfaceAlt, ink:'#302b31', muted:'#625c64', line,
      accent, accentSoft:surfaceAlt, contrast:'#ffffff', actionBg:character.actions[index], actionInk:'#382532', shadow:character.shadow,
      pattern:`radial-gradient(ellipse at 88% 4%, ${surfaceAlt} 0%, transparent 38%), linear-gradient(145deg, ${bg}, #ffffff 58%, ${surfaceAlt})`,
      themeColor:bg, dark:false
    };
  }

  window.MinutaProviderPorcelainMatrix = Object.freeze({ shadeKeys:Object.freeze(shadeKeys), normalizeCharacter, normalizeShade, shadesFor, paletteFor });
})();
