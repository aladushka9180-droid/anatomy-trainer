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
    {title:'Плечевой сустав',type:'Шаровидный, многоосный',bones:'Головка плечевой кости + суставная впадина лопатки',moves:'Сгибание, разгибание, отведение, приведение и вращение',stability:'Капсула, связки, суставная губа и мышцы ротаторной манжеты; движение руки связано с движением лопатки.',why:'Большая подвижность требует согласованной работы плечевой кости и лопатки.',caution:'Не тянуть руку через боль и не пытаться «вправлять» сустав.'},
    {title:'Локтевой сустав',type:'Преимущественно блоковидный, одноосный',bones:'Плечевая, локтевая и лучевая кости',moves:'Сгибание и разгибание; поворот предплечья происходит в соседних лучелоктевых суставах',stability:'Форма костей, капсула и коллатеральные связки по сторонам сустава.',why:'Помогает связать работу бицепса, трицепса, плечевой и плечелучевой мышц.',caution:'После травмы или при отёке движения не форсируют.'},
    {title:'Тазобедренный сустав',type:'Шаровидный, многоосный',bones:'Головка бедренной кости + вертлужная впадина таза',moves:'Сгибание, разгибание, отведение, приведение и вращение',stability:'Глубокая впадина, суставная губа, прочная капсула, связки и окружающие мышцы.',why:'Сочетает подвижность с опорой веса тела; положение таза меняет видимое движение бедра.',caution:'Резкая боль в паху или невозможность опереться на ногу требует медицинской оценки.'},
    {title:'Коленный сустав',type:'Модифицированный блоковидный',bones:'Бедренная, большеберцовая кости и надколенник',moves:'Сгибание и разгибание, небольшое вращение в согнутом положении',stability:'Мениски, крестообразные и коллатеральные связки, капсула и согласованная работа мышц бедра.',why:'Для понимания движения важно отдельно наблюдать положение бедра, надколенника и голени.',caution:'Не давить на подколенную ямку и не проверять связки силовыми тестами без подготовки.'},
    {title:'Голеностопный сустав',type:'Блоковидный, преимущественно одноосный',bones:'Большеберцовая и малоберцовая кости + таранная кость',moves:'Тыльное и подошвенное сгибание стопы',stability:'«Вилка» лодыжек, капсула и медиальные и латеральные связки; движения стопы также идут в соседних суставах.',why:'Помогает отличать движение в голеностопе от поворотов и наклонов всей стопы.',caution:'При свежем подворачивании, выраженном отёке или невозможности наступить нужен осмотр.'},
    {title:'Суставы шеи',type:'Комплекс суставов с разной механикой',bones:'Затылочная кость, атлант C1, осевой позвонок C2 и нижние шейные позвонки',moves:'Кивок, поворот, наклон и сгибание/разгибание',stability:'Связки, межпозвоночные диски, фасеточные суставы и глубокие мышцы шеи.',why:'Верхние и нижние сегменты участвуют в движении неодинаково: C0–C1 важен для кивка, C1–C2 — для поворота.',caution:'Не выполнять резкие вращения и манипуляции шеи без специальной квалификации.'}
  ];

  const ligaments = [
    {title:'Связки плечевого сустава',where:'Окружают капсулу и соединяют лопатку с плечевой костью.',role:'Укрепляют сустав, но большую часть динамической устойчивости создают мышцы.',limits:'Натягиваются в разных положениях руки и ограничивают крайние смещения головки плечевой кости.',practice:'Оценивают комфорт движения и реакцию тканей, а не пытаются «продавить» связку.',remember:'Связка удерживает пассивно, мышца — активно.'},
    {title:'Коллатеральные связки локтя',where:'Расположены по внутренней и наружной сторонам локтя.',role:'Не дают суставу чрезмерно отклоняться в сторону.',limits:'Сдерживают боковые нагрузки при сгибании и разгибании локтя.',practice:'После травмы опираются на медицинскую оценку, а не на самостоятельные силовые пробы.',remember:'Как боковые ремни, удерживающие шарнир.'},
    {title:'Подвздошно-бедренная связка',where:'Идёт от передней части таза к бедренной кости.',role:'Одна из самых прочных связок тела и важный пассивный стабилизатор тазобедренного сустава.',limits:'Особенно натягивается при разгибании бедра и помогает ограничивать переразгибание.',practice:'Ощущение натяжения спереди бедра не доказывает, что ограничение создаёт именно связка.',remember:'Помогает стоять прямо, не заваливая таз назад.'},
    {title:'Крестообразные связки колена',where:'Перекрещиваются внутри коленного сустава.',role:'Ограничивают взаимное смещение и направляют движение бедренной и большеберцовой костей.',limits:'Передняя и задняя связки по-разному сдерживают смещение голени вперёд и назад.',practice:'Их состояние не определяют массажным давлением; специальные тесты требуют подготовки.',remember:'Крест внутри колена направляет движение, но массажист не «лечит» его давлением.'},
    {title:'Связки голеностопа',where:'Соединяют лодыжки с костями стопы с обеих сторон.',role:'Стабилизируют стопу при опоре; наружные связки чаще страдают при подворачивании.',limits:'Ограничивают чрезмерный наклон и смещение таранной кости относительно лодыжек.',practice:'Свежая травма с выраженным отёком, болью или невозможностью опереться требует осмотра.',remember:'Связкам нужны защита и время восстановления, а не интенсивное «разминание».'},
    {title:'Выйная связка',where:'Идёт по задней поверхности шеи от затылка к шейным позвонкам.',role:'Поддерживает голову и служит местом прикрепления ряда мышц.',limits:'Помогает ограничивать чрезмерное сгибание шеи.',practice:'Плотная срединная структура не является «мышечным узлом» и не требует сильного точечного давления.',remember:'Это плотная связочная структура, а не отдельная мышца.'}
  ];

  const motions = [
    {id:'abduction',title:'Отведение плеча',simple:'Рука поднимается в сторону от туловища.',joint:'Плечевой сустав; движение преимущественно во фронтальной плоскости.',prime:'Средние пучки дельтовидной мышцы; надостная мышца начинает движение и помогает стабилизировать головку плечевой кости.',assist:'Передняя и задняя части дельтовидной помогают по положению руки. Для подъёма выше уровня плеча лопатка вращается вверх благодаря передней зубчатой и верхним и нижним пучкам трапециевидной мышцы.',opposite:'Приведение плеча: большая грудная, широчайшая мышца спины и большая круглая мышца.',control:'При медленном опускании руки отводящие мышцы работают уступающе — сохраняют напряжение, пока удлиняются.',check:'Попросите без усилия поднять руку на 20–30° в сторону и наблюдайте контур средней части дельтовидной. Не создавайте сопротивление при боли.',meaning:'Помогает отличить движение плечевой кости от подъёма плечевого пояса и увидеть вклад лопатки.',mistake:'Поднимать плечо к уху вместо свободного движения руки или отклонять туловище в сторону.',safety:'Боль, онемение, внезапная слабость или выраженное ограничение — причина остановить проверку, а не увеличивать амплитуду.'},
    {id:'elbow',title:'Сгибание локтя',simple:'Предплечье приближается к плечу.',joint:'Локтевой сустав; движение в сагиттальной плоскости.',prime:'Плечевая, двуглавая мышца плеча и плечелучевая совместно сгибают локоть.',assist:'Вклад меняется с положением предплечья: бицепс особенно эффективен при супинации, плечелучевая — в среднем положении между пронацией и супинацией.',opposite:'Разгибание локтя: трёхглавая и локтевая мышцы.',control:'При медленном разгибании сгибатели могут уступающе контролировать опускание предплечья.',check:'Согните локоть без груза ладонью вверх и мягко наблюдайте сокращение бицепса. Глубокую плечевую мышцу не нужно искать сильным давлением.',meaning:'Положение ладони помогает понять, почему один и тот же сгибательный жест выполняется разными мышцами.',mistake:'Уводить плечо вперёд, поднимать его или помогать движению всем туловищем.',safety:'После травмы, при отёке или резкой боли не проверяйте силу и не форсируйте сгибание.'},
    {id:'hip',title:'Сгибание бедра',simple:'Бедро движется вперёд и вверх.',joint:'Тазобедренный сустав; движение в сагиттальной плоскости.',prime:'Подвздошно-поясничная мышца — главный сгибатель; прямая мышца бедра, портняжная и напрягатель широкой фасции помогают.',assist:'Мышцы живота и стабилизаторы таза удерживают таз и поясницу, чтобы движение происходило в тазобедренном суставе.',opposite:'Разгибание бедра: большая ягодичная мышца и задняя группа мышц бедра.',control:'При медленном опускании бедра сгибатели могут уступающе контролировать движение.',check:'Лучше наблюдать подъём бедра сидя или лёжа и положение таза. Не используйте глубокое давление в животе или паховой области для «поиска» подвздошно-поясничной мышцы.',meaning:'Позволяет отличать истинное сгибание бедра от наклона таза и округления поясницы.',mistake:'Сильно наклонять таз назад или подтягивать всё туловище вместо движения в суставе.',safety:'Боль в паху, животе или пояснице, а также невозможность опереться на ногу требуют прекращения проверки.'},
    {id:'knee',title:'Разгибание колена',simple:'Голень выпрямляется относительно бедра.',joint:'Коленный сустав; движение преимущественно в сагиттальной плоскости.',prime:'Четырёхглавая мышца бедра: прямая, латеральная широкая, медиальная широкая и промежуточная широкая мышцы.',assist:'Положение таза и бедра удерживают ягодичные и другие стабилизаторы; надколенник направляет тягу сухожилия квадрицепса.',opposite:'Сгибание колена: задняя группа мышц бедра, а также икроножная и некоторые другие мышцы.',control:'При медленном сгибании колена квадрицепс может уступающе контролировать опускание тела или голени.',check:'Сидя медленно выпрямите колено без дополнительного веса и наблюдайте напряжение передней поверхности бедра.',meaning:'Помогает связать четыре части квадрицепса с общим движением и положением надколенника.',mistake:'Резко «запирать» колено в конце движения или поднимать бедро со стула.',safety:'Не давите на надколенник и подколенную ямку; при боли, отёке или ощущении нестабильности остановитесь.'},
    {id:'foot',title:'Подошвенное сгибание стопы',simple:'Пятка поднимается, а стопа движется вниз, как при подъёме на носки.',joint:'Голеностопный сустав; движение преимущественно в сагиттальной плоскости.',prime:'Икроножная и камбаловидная мышцы образуют главную силу подошвенного сгибания через ахиллово сухожилие.',assist:'Задняя большеберцовая, длинные сгибатели пальцев и большого пальца, длинная и короткая малоберцовые мышцы помогают движению и контролю стопы.',opposite:'Тыльное сгибание: передняя большеберцовая и разгибатели пальцев.',control:'При медленном опускании пятки икроножная и камбаловидная мышцы уступающе тормозят движение.',check:'С опорой на устойчивую поверхность медленно приподнимите пятки. При согнутом колене вклад икроножной уменьшается, и заметнее работает камбаловидная.',meaning:'Показывает, как положение колена меняет вклад двух основных мышц голени.',mistake:'Заваливать стопу наружу или внутрь и переносить вес только на один край.',safety:'Односторонний отёк, покраснение, локальное тепло или резкая боль в голени — не повод для массажа или нагрузочной проверки.'},
    {id:'head',title:'Поворот головы',simple:'Лицо поворачивается вправо или влево.',joint:'Главный вклад даёт комплекс суставов C1–C2; нижние шейные сегменты также участвуют.',prime:'Грудино-ключично-сосцевидная мышца поворачивает лицо в противоположную сторону; ременные мышцы головы и шеи — преимущественно в свою сторону.',assist:'Глубокие короткие мышцы шеи помогают направлять и стабилизировать движение.',opposite:'Для поворота в другую сторону роли правых и левых мышц меняются местами.',control:'При медленном возвращении в нейтральное положение работающие мышцы дозируют движение, а глубокие стабилизаторы удерживают сегменты.',check:'Поверните голову только в комфортной амплитуде и наблюдайте, не добавляется ли наклон. Переднюю поверхность шеи не пальпируют глубоко.',meaning:'Помогает понять, почему видимое напряжение грудино-ключично-сосцевидной мышцы находится на стороне, противоположной направлению лица.',mistake:'Добавлять наклон, запрокидывание головы или разворот всего корпуса.',safety:'Головокружение, тошнота, нарушение зрения, онемение, резкая боль или необычная слабость требуют немедленной остановки движения.'}
  ];

  let active = 'joints';
  const topicIndex = {joints:0,ligaments:0,functions:0};
  let viewed;
  try { viewed = new Set(JSON.parse(API.storage.getItem('anatomy_course_viewed_v1') || '[]')); }
  catch { viewed = new Set(); }
  let passed;
  try { passed = new Set(JSON.parse(API.storage.getItem('anatomy_course_passed_v1') || '[]')); }
  catch { passed = new Set(); }

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const save = () => { API.storage.setItem('anatomy_course_viewed_v1', JSON.stringify([...viewed])); API.storage.setItem('anatomy_course_passed_v1', JSON.stringify([...passed])); };

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
    return `<div class="anatomy-grid${rows.length===1?' single':''}">${rows.map(row => `<article class="anatomy-info-card"><h4>${esc(row.title)}</h4><dl>${type === 'joint'
      ? `<dt>Тип сустава</dt><dd>${esc(row.type)}</dd><dt>Что соединяется</dt><dd>${esc(row.bones)}</dd><dt>Движения</dt><dd>${esc(row.moves)}</dd><dt>Что обеспечивает устойчивость</dt><dd>${esc(row.stability)}</dd><dt>Зачем массажисту</dt><dd>${esc(row.why)}</dd><dt>Безопасность</dt><dd class="anatomy-note">${esc(row.caution)}</dd>`
      : `<dt>Где находится</dt><dd>${esc(row.where)}</dd><dt>Что делает</dt><dd>${esc(row.role)}</dd><dt>Какое движение ограничивает</dt><dd>${esc(row.limits)}</dd><dt>Практический смысл</dt><dd>${esc(row.practice)}</dd><dt>Как запомнить</dt><dd class="anatomy-note">${esc(row.remember)}</dd>`}</dl><button type="button" class="textbutton" data-anatomy-reference="${esc(row.title)}">Найти в справочнике →</button></article>`).join('')}</div>`;
  }

  function topicSelector(rows,label) {
    const index=Math.min(topicIndex[active]||0,rows.length-1);
    return `<div class="anatomy-topic-select"><label for="anatomyTopicSelect">${esc(label)}</label><select id="anatomyTopicSelect" data-anatomy-topic>${rows.map((item,itemIndex)=>`<option value="${itemIndex}" ${itemIndex===index?'selected':''}>${esc(item.title)}</option>`).join('')}</select><small>Материал показывается по одной области, чтобы не перегружать страницу.</small></div>`;
  }

  function renderFunctions(rows=motions) {
    const primer = `<section class="muscle-function-primer" aria-labelledby="muscleFunctionPrimerTitle"><div><span class="eyebrow">Сначала разберём роли</span><h4 id="muscleFunctionPrimerTitle">Как мышцы создают и контролируют движение</h4><p>Одна мышца редко работает изолированно. Её роль зависит от положения сустава и задачи.</p></div><div class="muscle-role-grid"><div><strong>Агонист</strong><span>Создаёт основное движение.</span></div><div><strong>Синергист</strong><span>Помогает или стабилизирует опору.</span></div><div><strong>Антагонист</strong><span>Создаёт противоположное движение и помогает его контролировать.</span></div></div><details><summary>Три режима работы мышцы</summary><div class="contraction-grid"><p><strong>Преодолевающий:</strong> мышца укорачивается и создаёт движение.</p><p><strong>Удерживающий:</strong> сохраняет длину и стабилизирует положение.</p><p><strong>Уступающий:</strong> остаётся напряжённой, но удлиняется и тормозит движение.</p></div></details></section>`;
    return `${primer}<div class="anatomy-grid single">${rows.map(row => `<article class="motion-card motion-card-detailed"><div class="motion-summary"><div class="motion-demo">${motionSvg(row.id)}</div><div><span class="eyebrow">Анимация движения</span><h4>${esc(row.title)}</h4><p>${esc(row.simple)}</p><p class="motion-joint"><strong>Где происходит:</strong> ${esc(row.joint)}</p></div></div><div class="motion-core"><div><span>Основные исполнители</span><p>${esc(row.prime)}</p></div><div><span>Помощники и стабилизаторы</span><p>${esc(row.assist)}</p></div><div><span>Противоположное движение</span><p>${esc(row.opposite)}</p></div><div><span>Контроль при возвращении</span><p>${esc(row.control)}</p></div></div><div class="motion-details"><details open><summary>Как безопасно увидеть движение</summary><p>${esc(row.check)}</p></details><details><summary>Зачем это массажисту</summary><p>${esc(row.meaning)}</p></details><details><summary>Частая компенсация</summary><p>${esc(row.mistake)}</p></details><details class="motion-warning"><summary>Когда остановиться</summary><p>${esc(row.safety)}</p></details></div><button type="button" class="textbutton" data-anatomy-reference="${esc(row.title)}">Открыть связанные материалы →</button></article>`).join('')}</div><div class="anatomy-source-note"><strong>Учебная опора:</strong> названия движений и роли мышц сверены с <a href="https://openstax.org/books/anatomy-and-physiology-2e/pages/9-5-types-of-body-movements" target="_blank" rel="noopener noreferrer">движениями суставов</a> и <a href="https://openstax.org/books/anatomy-and-physiology-2e/pages/11-1-interactions-of-skeletal-muscles-their-fascicle-arrangement-and-their-lever-systems" target="_blank" rel="noopener noreferrer">взаимодействием мышц</a> в OpenStax Anatomy &amp; Physiology 2e.</div><p class="anatomy-safety">Анимация показывает направление движения, а не полный биомеханический анализ. Скорость и амплитуда условны; учебное наблюдение не заменяет обследование и силовое тестирование специалистом.</p>`;
  }

  function attachmentsMarkup() {
    const source = (typeof ITEMS !== 'undefined' ? ITEMS : []).filter(item => item.kind !== 'bone');
    const groups = [...new Set(source.map(item => item.cat))].sort((a,b) => a.localeCompare(b,'ru'));
    return `<section class="anatomy-reading-guide"><strong>Как читать запись</strong><div><span><b>1</b> Начало</span><i>относительно более неподвижная точка</i><span><b>2</b> Прикрепление</span><i>точка, которую мышца чаще перемещает</i><span><b>3</b> Линия тяги</span><i>подсказывает возможное действие мышцы</i></div><p>Это удобная учебная модель: при сложных движениях обе точки могут перемещаться, а функция зависит от положения тела.</p></section><div class="anatomy-filter"><label class="sr-only" for="attachmentSearch">Поиск мышцы</label><input id="attachmentSearch" type="search" placeholder="Найти мышцу…"><label class="sr-only" for="attachmentRegion">Область тела</label><select id="attachmentRegion"><option value="">Все области тела</option>${groups.map(group => `<option value="${esc(group)}">${esc(group)}</option>`).join('')}</select></div><div id="attachmentResults" class="anatomy-grid"></div>`;
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
    return `<section class="anatomy-image-guide"><strong>Как работать со схемой</strong><ol><li>Сначала определите вид: спереди, сзади или сбоку.</li><li>Найдите два крупных костных ориентира.</li><li>Проследите структуру между ними и назовите её по-русски.</li></ol><span>Нажмите на изображение — откроется крупный вид и список основных русских названий.</span></section><div id="anatomyImageFocus"></div><div class="anatomy-image-grid">${Object.entries(visuals).map(([key,value]) => `<button type="button" class="anatomy-image-card" data-anatomy-image="${esc(key)}"><img src="${esc(value.src)}" alt="${esc(value.alt)}" loading="lazy" decoding="async"><span>${esc(value.caption || key)}</span></button>`).join('')}</div>`;
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
    return `<div class="anatomy-testing-tip"><strong>Новичку лучше начать с одной темы.</strong><span>Смешанный тест полезнее после прохождения остальных разделов.</span></div><div class="anatomy-grid">${tests.map(([id,title,text]) => `<article class="anatomy-test-card"><span class="eyebrow">До 10 вопросов</span><h4>${esc(title)}</h4><p>${esc(text)}</p><button type="button" class="btn ${id==='all'?'primary':'secondary'}" data-anatomy-test="${id}" data-test-title="${esc(title)}">Начать тест</button></article>`).join('')}</div>`;
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
    if (active === 'joints') body=topicSelector(joints,'Выберите сустав')+infoCards([joints[topicIndex.joints]],'joint');
    if (active === 'ligaments') body=topicSelector(ligaments,'Выберите группу связок')+infoCards([ligaments[topicIndex.ligaments]],'ligament');
    if (active === 'functions') body=topicSelector(motions,'Выберите движение')+renderFunctions([motions[topicIndex.functions]]);
    if (active === 'attachments') body = attachmentsMarkup();
    if (active === 'images') body = imagesMarkup();
    if (active === 'testing') body = testingMarkup();
    const check=active==='testing'?'':`<section class="anatomy-module-check"><div><strong>${passed.has(active)?'Раздел усвоен':'Готовы проверить себя?'}</strong><span>${passed.has(active)?'Результат теста — не ниже 80%.':'Короткий тест покажет, что уже понятно и что стоит повторить.'}</span></div><button type="button" class="btn ${passed.has(active)?'secondary':'primary'}" data-anatomy-test="${active}" data-test-title="${esc(title)}">${passed.has(active)?'Пройти ещё раз':'Проверить себя · 5 вопросов'}</button></section>`;
    target.innerHTML = `<div class="anatomy-content-head"><span class="eyebrow">Раздел ${modules.findIndex(row=>row[0]===active)+1} из 6</span><h3>${esc(title)}</h3><p>${esc(lead)}</p></div>${body}${check}`;
    if (active === 'attachments') {
      renderAttachmentsList();
      document.getElementById('attachmentSearch')?.addEventListener('input', renderAttachmentsList);
      document.getElementById('attachmentRegion')?.addEventListener('change', renderAttachmentsList);
    }
    syncTabs();
  }

  function syncTabs() {
    const progress = Math.round(passed.size / modules.length * 100);
    document.getElementById('anatomyProgressText').textContent = `${passed.size} из ${modules.length} усвоено · ${viewed.size} просмотрено`;
    document.getElementById('anatomyProgressBar').style.width = `${progress}%`;
    host.querySelectorAll('[data-anatomy-module]').forEach(button => {
      const selected = button.dataset.anatomyModule === active;
      button.classList.toggle('active', selected);
      button.classList.toggle('viewed', viewed.has(button.dataset.anatomyModule));
      button.classList.toggle('passed', passed.has(button.dataset.anatomyModule));
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
    if (test) { viewed.add(test.dataset.anatomyTest); save(); API.startTest(test.dataset.anatomyTest, `Анатомия · ${test.dataset.testTitle}`, 5); }
  });

  host.addEventListener('change',event=>{const select=event.target.closest('[data-anatomy-topic]');if(!select)return;topicIndex[active]=Number(select.value)||0;renderContent();});
  window.addEventListener('anatomy-course-test-finished',event=>{const kind=event.detail?.kind,pct=Number(event.detail?.pct)||0;if(kind&&pct>=80){passed.add(kind);viewed.add(kind);save();syncTabs();if(active===kind)renderContent();}});

  activate(active);
  window.AnatomyLearning = { open(){ syncTabs(); } };
})();
