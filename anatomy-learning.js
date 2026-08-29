(() => {
  'use strict';

  const API = window.AnatomyTrainerAPI;
  const host = document.getElementById('anatomyApp');
  if (!API || !host) return;

  const modules = [
    ['joints', '1', 'Суставы', 'Какие кости соединяются и какие движения возможны'],
    ['ligaments', '2', 'Связки', 'Что стабилизирует сустав и ограничивает лишнее движение'],
    ['functions', '3', 'Функции мышц', 'Движение показано в зацикленной анимации'],
    ['attachments', '4', 'Места прикрепления', 'Откуда начинается мышца и куда прикрепляется'],
    ['images', '5', 'Изображения', 'Русские подписи и разные анатомические виды'],
    ['testing', '6', 'Тестирование', 'Короткая проверка по выбранной теме']
  ];

  const joints = [
    {title:'Плечевой сустав',bones:'Головка плечевой кости + суставная впадина лопатки',moves:'Сгибание, разгибание, отведение, приведение и вращение',why:'Очень подвижный, поэтому мышцы ротаторной манжеты особенно важны для устойчивости.',caution:'Не тянуть руку через боль и не пытаться «вправлять» сустав.'},
    {title:'Локтевой сустав',bones:'Плечевая, локтевая и лучевая кости',moves:'Сгибание и разгибание; рядом происходит поворот предплечья',why:'Помогает связать работу бицепса, трицепса, плечевой и плечелучевой мышц.',caution:'После травмы или при отёке движения не форсируют.'},
    {title:'Тазобедренный сустав',bones:'Головка бедренной кости + вертлужная впадина таза',moves:'Сгибание, разгибание, отведение, приведение и вращение',why:'Глубокий и устойчивый сустав, окружён мощными ягодичными и глубокими мышцами.',caution:'Резкая боль в паху или невозможность опереться на ногу требует медицинской оценки.'},
    {title:'Коленный сустав',bones:'Бедренная, большеберцовая кости и надколенник',moves:'Сгибание и разгибание, небольшое вращение в согнутом положении',why:'Стабильность зависит от связок, менисков и согласованной работы мышц бедра.',caution:'Не давить на подколенную ямку и не проверять связки силовыми тестами без подготовки.'},
    {title:'Голеностопный сустав',bones:'Большеберцовая и малоберцовая кости + таранная кость',moves:'Тыльное и подошвенное сгибание стопы',why:'Движение связано с икроножной, камбаловидной и передней большеберцовой мышцами.',caution:'При свежем подворачивании, выраженном отёке или невозможности наступить нужен осмотр.'},
    {title:'Суставы шеи',bones:'Затылочная кость, атлант C1, осевой позвонок C2 и нижние шейные позвонки',moves:'Кивок, поворот, наклон и сгибание/разгибание',why:'C1 больше участвует в кивке, а C1–C2 — в повороте головы.',caution:'Не выполнять резкие вращения и манипуляции шеи без специальной квалификации.'}
  ];

  const ligaments = [
    {title:'Связки плечевого сустава',where:'Окружают капсулу и соединяют лопатку с плечевой костью.',role:'Укрепляют сустав, но большую часть динамической устойчивости создают мышцы.',remember:'Связка удерживает пассивно, мышца — активно.'},
    {title:'Коллатеральные связки локтя',where:'Расположены по внутренней и наружной сторонам локтя.',role:'Не дают суставу чрезмерно отклоняться в сторону.',remember:'Как боковые ремни, удерживающие шарнир.'},
    {title:'Подвздошно-бедренная связка',where:'Идёт от передней части таза к бедренной кости.',role:'Одна из самых прочных связок тела; ограничивает чрезмерное разгибание бедра.',remember:'Помогает стоять прямо, не заваливая таз назад.'},
    {title:'Крестообразные связки колена',where:'Перекрещиваются внутри коленного сустава.',role:'Ограничивают смещение большеберцовой кости вперёд и назад.',remember:'Крест внутри колена направляет движение, но массажист не «лечит» его давлением.'},
    {title:'Связки голеностопа',where:'Соединяют лодыжки с костями стопы с обеих сторон.',role:'Стабилизируют стопу при опоре; наружные связки чаще страдают при подворачивании.',remember:'Свежая травма со значимым отёком — не место для интенсивного массажа.'},
    {title:'Выйная связка',where:'Идёт по задней поверхности шеи от затылка к шейным позвонкам.',role:'Поддерживает голову и ограничивает чрезмерное сгибание шеи.',remember:'Это плотная связочная структура, а не отдельная мышца.'}
  ];

  const motions = [
    {id:'abduction',title:'Отведение плеча',muscles:'Средние пучки дельтовидной и надостная мышцы',simple:'Рука поднимается в сторону от туловища.'},
    {id:'elbow',title:'Сгибание локтя',muscles:'Плечевая, двуглавая и плечелучевая мышцы',simple:'Предплечье приближается к плечу.'},
    {id:'hip',title:'Сгибание бедра',muscles:'Подвздошно-поясничная и прямая мышца бедра',simple:'Бедро движется вперёд и вверх.'},
    {id:'knee',title:'Разгибание колена',muscles:'Четырёхглавая мышца бедра',simple:'Голень выпрямляется относительно бедра.'},
    {id:'foot',title:'Подошвенное сгибание',muscles:'Икроножная и камбаловидная мышцы',simple:'Стопа движется вниз, как при подъёме на носки.'},
    {id:'head',title:'Поворот головы',muscles:'Грудино-ключично-сосцевидная и глубокие мышцы шеи',simple:'Лицо поворачивается вправо или влево.'}
  ];

  let active = 'joints';
  let viewed;
  try { viewed = new Set(JSON.parse(API.storage.getItem('anatomy_course_viewed_v1') || '[]')); }
  catch { viewed = new Set(); }

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const save = () => API.storage.setItem('anatomy_course_viewed_v1', JSON.stringify([...viewed]));

  function motionSvg(id) {
    const base = '<circle class="bodyline" cx="70" cy="25" r="14"/><path class="bodyline" d="M70 40 L70 87 M70 55 L44 78 M70 87 L51 125"/><circle class="joint" cx="70" cy="55" r="4"/><circle class="joint" cx="70" cy="87" r="4"/>';
    const variants = {
      abduction:`${base}<path class="guide" d="M72 55 A48 48 0 0 1 119 102"/><g class="move-abduction"><path class="bodyline" d="M70 55 L96 78 L116 103"/><circle class="joint" cx="96" cy="78" r="4"/></g><path class="bodyline" d="M70 87 L89 125"/>`,
      elbow:`${base}<path class="bodyline" d="M70 55 L96 79"/><g class="move-elbow"><path class="bodyline" d="M96 79 L118 108"/><circle class="joint" cx="96" cy="79" r="4"/></g><path class="bodyline" d="M70 87 L89 125"/>`,
      hip:`${base}<path class="bodyline" d="M70 55 L96 78"/><g class="move-hip"><path class="bodyline" d="M70 87 L91 121"/><circle class="joint" cx="70" cy="87" r="4"/></g><path class="bodyline" d="M70 87 L51 125"/>`,
      knee:`${base}<path class="bodyline" d="M70 55 L96 78 M70 87 L51 125"/><path class="bodyline" d="M70 87 L84 104"/><g class="move-knee"><path class="bodyline" d="M84 104 L112 124"/><circle class="joint" cx="84" cy="104" r="4"/></g>`,
      foot:`${base}<path class="bodyline" d="M70 55 L96 78 M70 87 L51 125 M70 87 L83 119"/><g class="move-foot"><path class="bodyline" d="M83 119 L111 120"/><circle class="joint" cx="83" cy="119" r="4"/></g>`,
      head:`<path class="bodyline" d="M70 44 L70 90 M70 56 L43 78 M70 56 L97 78 M70 90 L50 126 M70 90 L90 126"/><g class="move-head"><ellipse class="bodyline" cx="70" cy="26" rx="16" ry="14"/><path class="bodyline" d="M70 22 L76 22"/></g><circle class="joint" cx="70" cy="45" r="4"/>`
    };
    return `<svg viewBox="0 0 140 140" aria-hidden="true" focusable="false">${variants[id]}</svg>`;
  }

  function infoCards(rows, type) {
    return `<div class="anatomy-grid">${rows.map(row => `<article class="anatomy-info-card"><h4>${esc(row.title)}</h4><dl>${type === 'joint'
      ? `<dt>Что соединяется</dt><dd>${esc(row.bones)}</dd><dt>Движения</dt><dd>${esc(row.moves)}</dd><dt>Зачем массажисту</dt><dd>${esc(row.why)}</dd><dt>Безопасность</dt><dd class="anatomy-note">${esc(row.caution)}</dd>`
      : `<dt>Где находится</dt><dd>${esc(row.where)}</dd><dt>Что делает</dt><dd>${esc(row.role)}</dd><dt>Как запомнить</dt><dd class="anatomy-note">${esc(row.remember)}</dd>`}</dl><button type="button" class="textbutton" data-anatomy-reference="${esc(row.title)}">Найти в справочнике →</button></article>`).join('')}</div>`;
  }

  function renderFunctions() {
    return `<div class="anatomy-grid">${motions.map(row => `<article class="motion-card"><div class="motion-demo">${motionSvg(row.id)}</div><div><span class="eyebrow">Анимация движения</span><h4>${esc(row.title)}</h4><p>${esc(row.simple)}</p><p><strong>Основные мышцы:</strong> ${esc(row.muscles)}</p></div></article>`).join('')}</div><p class="anatomy-safety">Анимация показывает направление движения, а не полный биомеханический анализ. Скорость и амплитуда условны.</p>`;
  }

  function attachmentsMarkup() {
    const source = (typeof ITEMS !== 'undefined' ? ITEMS : []).filter(item => item.kind !== 'bone');
    const groups = [...new Set(source.map(item => item.cat))].sort((a,b) => a.localeCompare(b,'ru'));
    return `<div class="anatomy-filter"><label class="sr-only" for="attachmentSearch">Поиск мышцы</label><input id="attachmentSearch" type="search" placeholder="Найти мышцу…"><label class="sr-only" for="attachmentRegion">Область тела</label><select id="attachmentRegion"><option value="">Все области тела</option>${groups.map(group => `<option value="${esc(group)}">${esc(group)}</option>`).join('')}</select></div><div id="attachmentResults" class="anatomy-grid"></div>`;
  }

  function renderAttachmentsList() {
    const target = document.getElementById('attachmentResults');
    if (!target) return;
    const query = (document.getElementById('attachmentSearch')?.value || '').trim().toLowerCase();
    const region = document.getElementById('attachmentRegion')?.value || '';
    const source = (typeof ITEMS !== 'undefined' ? ITEMS : []).filter(item => item.kind !== 'bone' && (!region || item.cat === region) && (!query || (item.name+' '+item.attach).toLowerCase().includes(query))).slice(0, 30);
    target.innerHTML = source.map(item => `<article class="attachment-card"><small>${esc(item.cat)}</small><h4>${esc(item.name)}</h4><p>${esc(item.attach)}</p><button type="button" class="textbutton" data-anatomy-reference="${esc(item.name)}">Открыть подробное объяснение →</button></article>`).join('') || '<div class="statsnote">Ничего не найдено. Попробуйте более короткое название.</div>';
  }

  function imagesMarkup() {
    const visuals = typeof VISUALS !== 'undefined' ? VISUALS : {};
    return `<div id="anatomyImageFocus"></div><div class="anatomy-image-grid">${Object.entries(visuals).map(([key,value]) => `<button type="button" class="anatomy-image-card" data-anatomy-image="${esc(key)}"><img src="${esc(value.src)}" alt="${esc(value.alt)}" loading="lazy" decoding="async"><span>${esc(value.caption || key)}</span></button>`).join('')}</div>`;
  }

  function focusImage(key) {
    const visuals = typeof VISUALS !== 'undefined' ? VISUALS : {}, visual = visuals[key], target = document.getElementById('anatomyImageFocus');
    if (!visual || !target) return;
    const labels = typeof VISUAL_LABELS !== 'undefined' ? (VISUAL_LABELS[key] || []) : [];
    target.innerHTML = `<figure class="anatomy-image-focus"><img src="${esc(visual.src)}" alt="${esc(visual.alt)}"><figcaption><strong>${esc(visual.caption || key)}</strong><button type="button" class="textbutton" data-close-anatomy-image>Свернуть изображение</button></figcaption><div class="anatomy-labels" aria-label="Основные русские названия">${labels.map(label => `<span>${esc(label)}</span>`).join('')}</div></figure>`;
    target.scrollIntoView({behavior:'smooth', block:'start'});
  }

  function testingMarkup() {
    const tests = [
      ['joints','Суставы','Кости, расположение и движения'],['ligaments','Связки и стабильность','Связки, суставы и безопасные решения'],['functions','Функции мышц','Какая мышца выполняет движение'],['attachments','Места прикрепления','Откуда начинается и куда прикрепляется мышца'],['images','Узнавание структур','Кости и мышцы по описанию'],['all','Смешанный тест','Все темы анатомии вместе']
    ];
    return `<div class="anatomy-grid">${tests.map(([id,title,text]) => `<article class="anatomy-test-card"><span class="eyebrow">До 10 вопросов</span><h4>${esc(title)}</h4><p>${esc(text)}</p><button type="button" class="btn ${id==='all'?'primary':'secondary'}" data-anatomy-test="${id}" data-test-title="${esc(title)}">Начать тест</button></article>`).join('')}</div>`;
  }

  const descriptions = {
    joints:['Суставы','Сначала разберитесь, какие кости соединяются и какие движения создаёт сустав.'],
    ligaments:['Связки','Связки соединяют кости и пассивно ограничивают лишнее движение. Это не мышцы, и «размять» связку невозможно.'],
    functions:['Функции мышц','Смотрите на движение и связывайте его с мышцами, которые создают или контролируют это движение.'],
    attachments:['Места прикрепления','Путь мышцы между костными ориентирами помогает понять направление тяги и функцию.'],
    images:['Анатомические изображения','Сравнивайте разные виды и закрепляйте русские названия основных структур.'],
    testing:['Тестирование','Выберите одну тему или смешанную проверку. После ответа тренажёр покажет понятное объяснение.']
  };

  function renderContent() {
    const [title,lead] = descriptions[active];
    const target = document.getElementById('anatomyContent');
    let body = '';
    if (active === 'joints') body = infoCards(joints,'joint');
    if (active === 'ligaments') body = infoCards(ligaments,'ligament');
    if (active === 'functions') body = renderFunctions();
    if (active === 'attachments') body = attachmentsMarkup();
    if (active === 'images') body = imagesMarkup();
    if (active === 'testing') body = testingMarkup();
    target.innerHTML = `<div class="anatomy-content-head"><span class="eyebrow">Раздел ${modules.findIndex(row=>row[0]===active)+1} из 6</span><h3>${esc(title)}</h3><p>${esc(lead)}</p></div>${body}`;
    if (active === 'attachments') {
      renderAttachmentsList();
      document.getElementById('attachmentSearch')?.addEventListener('input', renderAttachmentsList);
      document.getElementById('attachmentRegion')?.addEventListener('change', renderAttachmentsList);
    }
    syncTabs();
  }

  function syncTabs() {
    const progress = Math.round(viewed.size / modules.length * 100);
    document.getElementById('anatomyProgressText').textContent = `${viewed.size} из ${modules.length} разделов просмотрено`;
    document.getElementById('anatomyProgressBar').style.width = `${progress}%`;
    host.querySelectorAll('[data-anatomy-module]').forEach(button => {
      const selected = button.dataset.anatomyModule === active;
      button.classList.toggle('active', selected);
      button.classList.toggle('viewed', viewed.has(button.dataset.anatomyModule));
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function activate(id) {
    if (!modules.some(row => row[0] === id)) return;
    active = id; viewed.add(id); save(); renderContent();
    requestAnimationFrame(() => document.getElementById('anatomyContent')?.focus({preventScroll:true}));
  }

  host.innerHTML = `<div class="anatomy-head"><div><span class="eyebrow">Учебная программа</span><h2 id="anatomyTitle">Анатомия: от строения к движению</h2><p>Шесть понятных шагов: изучите суставы и связки, посмотрите движение мышц, закрепите места прикрепления и проверьте себя.</p></div><button type="button" class="btn secondary" data-anatomy-home>На главную</button></div><div class="anatomy-progress"><div class="bar" aria-hidden="true"><i id="anatomyProgressBar"></i></div><strong id="anatomyProgressText"></strong></div><nav class="anatomy-course-tabs" role="tablist" aria-label="Разделы анатомии">${modules.map(([id,number,title,lead],index) => `<button type="button" class="anatomy-course-tab" data-anatomy-module="${id}" role="tab" aria-selected="${index===0}"><span>Шаг ${number}</span><b>${esc(title)}</b></button>`).join('')}</nav><div id="anatomyContent" role="tabpanel" tabindex="-1"></div>`;

  host.addEventListener('click', event => {
    const moduleButton = event.target.closest('[data-anatomy-module]');
    if (moduleButton) { activate(moduleButton.dataset.anatomyModule); return; }
    if (event.target.closest('[data-anatomy-home]')) { API.show('menu'); return; }
    const reference = event.target.closest('[data-anatomy-reference]');
    if (reference) { API.openReference(reference.dataset.anatomyReference); return; }
    const image = event.target.closest('[data-anatomy-image]');
    if (image) { focusImage(image.dataset.anatomyImage); return; }
    if (event.target.closest('[data-close-anatomy-image]')) { document.getElementById('anatomyImageFocus').replaceChildren(); return; }
    const test = event.target.closest('[data-anatomy-test]');
    if (test) { viewed.add('testing'); save(); API.startTest(test.dataset.anatomyTest, `Анатомия · ${test.dataset.testTitle}`); }
  });

  activate(active);
  window.AnatomyLearning = { open(){ syncTabs(); } };
})();
