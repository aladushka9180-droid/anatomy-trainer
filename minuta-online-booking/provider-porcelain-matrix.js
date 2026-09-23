(function () {
  'use strict';

  // The persisted shade keys remain unchanged. A character changes the material
  // and gives each of the five positions its own named, compatible palette.
  const shadeKeys = ['pearl-white', 'porcelain-white', 'gentle-pink', 'petal-pink', 'pink-accent'];
  const characters = {
    pearl: {
      labels:['Лунный жемчуг', 'Молочный жемчуг', 'Розовый перламутр', 'Пудровый жемчуг', 'Яркий перламутр'],
      colors:[
        ['#faf8f9','#f2e9ee','#a2386d','#dfced8'],
        ['#fdfafa','#f8edf1','#ab3b71','#e3d2da'],
        ['#fff6f9','#fce8f0','#b63775','#e8ccd9'],
        ['#fcecf3','#f5dbe6','#a9316e','#dfbdcf'],
        ['#f9e2ec','#edc9da','#92295e','#d6acc0']
      ],
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
      shadow:'rgba(147, 53, 88, .11)'
    },
    silk: {
      labels:['Шёлковый жемчуг', 'Сливочный шёлк', 'Пудровый шёлк', 'Розовый атлас', 'Малиновый шёлк'],
      colors:[
        ['#fdf9fa','#f5e9ee','#9a3568','#dfcbd5'],
        ['#fff8f8','#f5e5ec','#a4376a','#e2c9d4'],
        ['#fff2f6','#f4dce8','#aa326d','#e5c2d2'],
        ['#fce7ef','#efcddd','#9d2b62','#dcb3c8'],
        ['#f7dce8','#e8bbd0','#862657','#d1a2ba']
      ],
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
      accent, accentSoft:surfaceAlt, contrast:'#ffffff', shadow:character.shadow,
      pattern:`radial-gradient(ellipse at 88% 4%, ${surfaceAlt} 0%, transparent 38%), linear-gradient(145deg, ${bg}, #ffffff 58%, ${surfaceAlt})`,
      themeColor:bg, dark:false
    };
  }

  window.MinutaProviderPorcelainMatrix = Object.freeze({ shadeKeys:Object.freeze(shadeKeys), normalizeCharacter, normalizeShade, shadesFor, paletteFor });
})();
