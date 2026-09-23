(function () {
  'use strict';

  // The persisted shade keys remain unchanged. A character changes the material
  // and gives each of the five positions its own named, compatible palette.
  const shadeKeys = ['pearl-white', 'porcelain-white', 'gentle-pink', 'petal-pink', 'pink-accent'];
  const characters = {
    pearl: {
      labels:['Лунный жемчуг', 'Молочный жемчуг', 'Розовый перламутр', 'Пудровый жемчуг', 'Яркий перламутр'],
      colors:[
        ['#f7f8fc','#eaeef7','#733c7b','#cdd3e4'],
        ['#f7f5fa','#ece5f4','#884079','#d8c9df'],
        ['#f5eef8','#e9d9f1','#96427d','#d9c2e1'],
        ['#f0e3f2','#dcc7e8','#82346e','#caaed7'],
        ['#e4cee6','#d3aed6','#713064','#bd94c4']
      ],
      actions:['#e8dbe8','#e6d2e4','#e3c6df','#d8b1d2','#c993bf'],
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
        ['#fcf9f3','#f3e8e3','#8b4464','#dfcfcf'],
        ['#faf3ef','#efdce0','#994363','#dfc4cf'],
        ['#f8edec','#eacfd8','#a73a65','#dcb7c8'],
        ['#f3dfe5','#dfbdcc','#97315d','#d4a6bb'],
        ['#eccbd8','#d4aac0','#852b54','#c790a8']
      ],
      actions:['#ead7db','#e5c8d1','#deb6c6','#d5a0b7','#c989a8'],
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
