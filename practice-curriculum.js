"use strict";

/**
 * Практическая программа тренажёра массажиста.
 *
 * Это учебные материалы, а не назначение процедуры и не способ диагностики.
 * Практические навыки должны отрабатываться на занятии с преподавателем или
 * подготовленным партнёром, который может остановить небезопасное действие.
 */
const PRACTICE_CURRICULUM = Object.freeze({
  reviewDate: "2026-08-29",
  version: "1.0.0",
  safetyNotice: "Программа помогает отрабатывать последовательность безопасных действий, но не заменяет очное обучение, практику под наблюдением или медицинское обследование и не отменяет требований к квалификации. Она не присваивает квалификацию и не даёт допуска к медицинской деятельности. При признаках угрозы жизни прекращают занятие, вызывают экстренную помощь по номеру 112 или 103 и оказывают первую помощь только в пределах своей подготовки.",

  competencyLevels: Object.freeze([
    Object.freeze({
      id: "competency-know",
      key: "know",
      title: "Знаю",
      description: "Узнаю анатомические ориентиры, называю цель и ограничения приёма, различаю обычную реакцию и признаки остановки.",
      evidence: Object.freeze(["Тест по теме не ниже 80%", "Нет ошибок в вопросах о красных флагах", "Правильно названы зоны осторожности"]),
      assessor: "тренажёр",
      nextLevel: "explain"
    }),
    Object.freeze({
      id: "competency-explain",
      key: "explain",
      title: "Объясняю",
      description: "Своими словами объясняю клиенту цель, ход, ощущения, границы и причину остановки без диагноза и лечебных обещаний.",
      evidence: Object.freeze(["Ответ по сценарию содержит согласие и границы", "План назван в правильной последовательности", "Объяснение понятно человеку без медицинской подготовки"]),
      assessor: "тренажёр или преподаватель",
      nextLevel: "demonstrate"
    }),
    Object.freeze({
      id: "competency-demonstrate",
      key: "demonstrate",
      title: "Показываю",
      description: "Выполняю чек-лист на партнёре в медленном учебном режиме, поддерживаю удобное положение и постоянно контролирую обратную связь.",
      evidence: Object.freeze(["Выполнены все обязательные пункты чек-листа", "Нет критических ошибок", "Партнёр подтверждает комфорт и понятную коммуникацию"]),
      assessor: "партнёр под руководством преподавателя",
      nextLevel: "verified"
    }),
    Object.freeze({
      id: "competency-verified",
      key: "verified",
      title: "Проверено",
      description: "Навык показан преподавателю очно: движения контролируемы, воздействие дозируется постепенно, безопасность и профессиональные границы соблюдены.",
      evidence: Object.freeze(["Две успешные демонстрации в разные дни", "Все критические пункты подтверждены преподавателем", "Исправлены замечания предыдущей попытки"]),
      assessor: "квалифицированный преподаватель",
      nextLevel: null
    })
  ]),

  admissionCriteria: Object.freeze([
    Object.freeze({id: "admission-foundation", title: "Условия безопасной учебной практики на партнёре", requiredLevel: "explain", criteria: Object.freeze(["Пройден модуль по красным флагам без критических ошибок", "Изучены согласие, приватность и гигиена", "Названы костные ориентиры и зоны осторожности выбранной области", "Подготовлен преподаватель или наблюдающий партнёр с правом немедленно остановить практику"]) }),
    Object.freeze({id: "admission-region", title: "Готовность к чек-листу по области тела", requiredLevel: "know", criteria: Object.freeze(["Тест по анатомии области не ниже 80%", "Правильно показано положение партнёра без давления", "Ученик умеет снизить давление и прекратить контакт по просьбе"]) }),
    Object.freeze({id: "admission-independent-plan", title: "Готовность к самостоятельному учебному плану сеанса", requiredLevel: "demonstrate", criteria: Object.freeze(["Не менее трёх региональных чек-листов выполнены без критических ошибок", "Два сценария безопасного решения разобраны с преподавателем", "Ученик не выходит за пределы своей подготовки и не формулирует диагнозы"]) }),
    Object.freeze({id: "admission-verified", title: "Очная отметка преподавателя «Проверено»", requiredLevel: "verified", criteria: Object.freeze(["Очная демонстрация преподавателю", "Повторная демонстрация в другой день", "Заполнен журнал практики и обратной связи", "Критические ошибки отсутствуют во всех очных попытках проверки"]) })
  ]),

  criticalErrors: Object.freeze([
    Object.freeze({id: "critical-no-consent", title: "Нет согласия", action: "Остановить попытку", description: "Работа начата без объяснения действий и явного согласия человека."}),
    Object.freeze({id: "critical-red-flag", title: "Игнорирование красного флага", action: "Остановить попытку и оценить срочность помощи", description: "Ученик продолжает работу при внезапной слабости, нарушении речи, боли в груди, затруднении дыхания, необычном одностороннем отёке или другом тревожном признаке. При признаках угрозы жизни вызывают 112 или 103, оказывают первую помощь в пределах подготовки и не оставляют человека одного."}),
    Object.freeze({id: "critical-nerve", title: "Продолжение при нервных симптомах", action: "Сразу убрать давление", description: "Давление сохраняется после прострела, онемения, жжения или ощущения электрического тока."}),
    Object.freeze({id: "critical-vessel", title: "Глубокое давление на пульсирующую область", action: "Сразу убрать давление", description: "Выполняется локальное глубокое воздействие там, где отчётливо ощущается пульсация или проходит крупная сосудистая зона."}),
    Object.freeze({id: "critical-acute-injury", title: "Работа по острой травме", action: "Остановить попытку", description: "Ученик разминает область с выраженным отёком, деформацией, невозможностью опоры или сильной болью после травмы."}),
    Object.freeze({id: "critical-bone-pressure", title: "Сильное давление на костный выступ", action: "Снизить давление и изменить контакт", description: "Локоть, сустав пальца или другая жёсткая опора направлены прямо на незащищённый костный ориентир."}),
    Object.freeze({id: "critical-force", title: "Давление через резкую боль", action: "Остановить попытку", description: "Боль используется как цель, а просьба уменьшить давление игнорируется."}),
    Object.freeze({id: "critical-sensitive-boundary", title: "Нарушение границ", action: "Остановить попытку", description: "Открыта или затронута чувствительная область без отдельного согласия, корректного укрытия и учебной необходимости."}),
    Object.freeze({id: "critical-hygiene", title: "Нарушение гигиены", action: "Прервать контакт и устранить нарушение", description: "Работа выполняется грязными руками, по повреждённой коже без оценки или с повторным использованием загрязнённого материала."}),
    Object.freeze({id: "critical-diagnosis-promise", title: "Диагноз или лечебное обещание", action: "Исправить коммуникацию", description: "Ученик объявляет диагноз, обещает вылечить заболевание или советует изменить назначенное лечение."}),
    Object.freeze({id: "critical-neck-manipulation", title: "Резкое движение шеи", action: "Остановить попытку", description: "Выполняется рывок, принудительное скручивание или манипуляция, не относящаяся к базовому учебному массажу."}),
    Object.freeze({id: "critical-no-monitoring", title: "Нет контроля реакции", action: "Остановить и восстановить связь", description: "Ученик продолжает серию действий, не замечая изменения дыхания, напряжения, цвета кожи или слов клиента."})
  ]),

  checklists: Object.freeze([
    Object.freeze({
      id: "checklist-neck-head",
      regionId: "neck",
      title: "Шея и основание черепа: безопасный контакт",
      level: "foundation",
      estimatedMinutes: 12,
      prerequisites: Object.freeze(["admission-foundation", "анатомические ориентиры шеи", "зоны сосудистой осторожности"]),
      steps: Object.freeze([
        Object.freeze({id: "neck-01", text: "Объяснить учебную задачу, согласовать область и получить согласие.", required: true}),
        Object.freeze({id: "neck-02", text: "Уточнить самочувствие и наличие новых тревожных симптомов до начала.", required: true}),
        Object.freeze({id: "neck-03", text: "Уложить или усадить партнёра так, чтобы голова имела опору, а шея не удерживалась усилием.", required: true}),
        Object.freeze({id: "neck-04", text: "Мягко найти затылочную кость, остистый отросток седьмого шейного позвонка (C7) и верхний край трапециевидной мышцы.", required: true}),
        Object.freeze({id: "neck-05", text: "Начать широким поверхностным контактом по задней и боковой поверхности, не давить на переднюю поверхность шеи.", required: true}),
        Object.freeze({id: "neck-06", text: "Сохранять медленный темп, нейтральные запястья и просить оценить комфорт давления.", required: true}),
        Object.freeze({id: "neck-07", text: "Прекратить действие при головокружении, тошноте, нарушении зрения, простреле или онемении. При внезапном неврологическом нарушении вызвать 112 или 103 и действовать по алгоритму первой помощи.", required: true, critical: true}),
        Object.freeze({id: "neck-08", text: "Завершить мягким контактом и спросить, как изменились ощущения и самочувствие.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-no-consent", "critical-red-flag", "critical-vessel", "critical-neck-manipulation", "critical-no-monitoring"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-shoulder-girdle",
      regionId: "shoulder",
      title: "Плечевой пояс: ориентиры и мягкая работа",
      level: "foundation",
      estimatedMinutes: 15,
      prerequisites: Object.freeze(["admission-region", "лопатка, ключица и акромион", "движения лопатки"]),
      steps: Object.freeze([
        Object.freeze({id: "shoulder-01", text: "Согласовать цель и сторону работы, спросить о недавней травме и необычной боли.", required: true}),
        Object.freeze({id: "shoulder-02", text: "Обеспечить опору предплечью, чтобы плечевой пояс не удерживал вес руки.", required: true}),
        Object.freeze({id: "shoulder-03", text: "Мягко найти акромион, ость и медиальный край лопатки.", required: true}),
        Object.freeze({id: "shoulder-04", text: "Начать широким контактом по мышцам, не направлять давление прямо на акромион и ость лопатки.", required: true}),
        Object.freeze({id: "shoulder-05", text: "Перед изменением положения руки предупредить партнёра и двигаться только в свободном комфортном диапазоне.", required: true}),
        Object.freeze({id: "shoulder-06", text: "Не выполнять глубокое давление в подмышечной области.", required: true, critical: true}),
        Object.freeze({id: "shoulder-07", text: "Контролировать появление онемения, слабости, прострела или резкой боли.", required: true}),
        Object.freeze({id: "shoulder-08", text: "Завершить работу, вернуть руку на опору и спросить партнёра об ощущениях.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-acute-injury", "critical-bone-pressure", "critical-nerve", "critical-no-monitoring"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-scapular-region",
      regionId: "shoulder",
      title: "Лопаточная область: положение и направление волокон",
      level: "intermediate",
      estimatedMinutes: 15,
      prerequisites: Object.freeze(["checklist-shoulder-girdle", "трапециевидная и ромбовидные мышцы"]),
      steps: Object.freeze([
        Object.freeze({id: "scapula-01", text: "Получить согласие на работу около лопатки и объяснить положение руки.", required: true}),
        Object.freeze({id: "scapula-02", text: "Уложить партнёра устойчиво и подложить опору так, чтобы плечо могло расслабиться.", required: true}),
        Object.freeze({id: "scapula-03", text: "Найти ость, нижний угол и медиальный край лопатки мягкой пальпацией.", required: true}),
        Object.freeze({id: "scapula-04", text: "Отличить костный край от мышечной ткани до увеличения давления.", required: true}),
        Object.freeze({id: "scapula-05", text: "Использовать широкую опору кисти и двигаться по мягким тканям, а не по кости.", required: true}),
        Object.freeze({id: "scapula-06", text: "Не заводить пальцы под лопатку силой и не добиваться движения через боль.", required: true, critical: true}),
        Object.freeze({id: "scapula-07", text: "Проверять дыхание и комфорт после каждого изменения направления.", required: true}),
        Object.freeze({id: "scapula-08", text: "Сравнить ощущение сторон без вывода о диагнозе.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-bone-pressure", "critical-force", "critical-no-monitoring"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-upper-arm-elbow",
      regionId: "arm",
      title: "Плечо и локоть: мышцы и зоны осторожности",
      level: "foundation",
      estimatedMinutes: 12,
      prerequisites: Object.freeze(["admission-region", "двуглавая и трёхглавая мышцы плеча", "локтевая ямка"]),
      steps: Object.freeze([
        Object.freeze({id: "arm-01", text: "Согласовать сторону, положение и допустимый уровень давления.", required: true}),
        Object.freeze({id: "arm-02", text: "Положить руку на устойчивую опору и оставить локоть слегка согнутым.", required: true}),
        Object.freeze({id: "arm-03", text: "Найти мышечные брюшки при лёгком активном движении, затем попросить расслабить руку.", required: true}),
        Object.freeze({id: "arm-04", text: "Работать широким контактом по мышцам, обходя медиальный надмыщелок и локтевой отросток.", required: true}),
        Object.freeze({id: "arm-05", text: "Не выполнять глубокое давление в локтевой ямке и позади медиального надмыщелка.", required: true, critical: true}),
        Object.freeze({id: "arm-06", text: "Сразу убрать давление при покалывании или ощущении тока в кисть.", required: true, critical: true}),
        Object.freeze({id: "arm-07", text: "Проверять комфорт кисти и плеча партнёра в течение работы.", required: true}),
        Object.freeze({id: "arm-08", text: "Завершить без резкого растягивания локтевого сустава.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-nerve", "critical-vessel", "critical-bone-pressure"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-forearm-hand",
      regionId: "arm",
      title: "Предплечье и кисть: экономный контакт",
      level: "foundation",
      estimatedMinutes: 12,
      prerequisites: Object.freeze(["admission-region", "кости предплечья и кисти", "нейтральное положение запястья"]),
      steps: Object.freeze([
        Object.freeze({id: "hand-01", text: "Осмотреть открытые участки кожи и уточнить наличие свежих повреждений.", required: true}),
        Object.freeze({id: "hand-02", text: "Поддержать кисть и предплечье по всей длине.", required: true}),
        Object.freeze({id: "hand-03", text: "Начать поверхностным контактом от кисти к предплечью без выжимания отёка.", required: true}),
        Object.freeze({id: "hand-04", text: "Различить лучевую и локтевую кости и не давить жёсткой опорой на их края.", required: true}),
        Object.freeze({id: "hand-05", text: "Двигать пальцы и запястье только в комфортном свободном диапазоне.", required: true}),
        Object.freeze({id: "hand-06", text: "Не продолжать при онемении, простреле или усилении отёка.", required: true, critical: true}),
        Object.freeze({id: "hand-07", text: "Сохранять собственное запястье нейтральным и менять опорную руку.", required: true}),
        Object.freeze({id: "hand-08", text: "Уточнить итоговое ощущение и вернуть кисть в удобное положение.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-acute-injury", "critical-nerve", "critical-bone-pressure"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-thoracic-back",
      regionId: "back",
      title: "Грудной отдел спины: широкая опора",
      level: "foundation",
      estimatedMinutes: 15,
      prerequisites: Object.freeze(["admission-region", "рёбра, лопатки и остистые отростки", "эргономика массажиста"]),
      steps: Object.freeze([
        Object.freeze({id: "thoracic-01", text: "Согласовать границы укрытия и получить согласие на область спины.", required: true}),
        Object.freeze({id: "thoracic-02", text: "Уложить партнёра так, чтобы дыхание было свободным, а голова имела опору.", required: true}),
        Object.freeze({id: "thoracic-03", text: "Определить положение позвоночника, рёбер и лопаток без глубокого давления.", required: true}),
        Object.freeze({id: "thoracic-04", text: "Начать двумя широкими симметричными контактами по мышцам.", required: true}),
        Object.freeze({id: "thoracic-05", text: "Не давить непосредственно на остистые отростки, рёбра и нижний угол лопатки.", required: true, critical: true}),
        Object.freeze({id: "thoracic-06", text: "Подстраивать темп под спокойное дыхание, не просить задерживать его.", required: true}),
        Object.freeze({id: "thoracic-07", text: "При новой боли в груди, одышке, потере сознания или резком ухудшении остановить занятие, вызвать 112 или 103 и действовать по алгоритму первой помощи в пределах подготовки.", required: true, critical: true}),
        Object.freeze({id: "thoracic-08", text: "Завершить постепенно и помочь партнёру спокойно изменить положение.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-red-flag", "critical-bone-pressure", "critical-no-monitoring"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-lumbar-region",
      regionId: "back",
      title: "Поясница: комфортное положение без продавливания",
      level: "foundation",
      estimatedMinutes: 12,
      prerequisites: Object.freeze(["admission-region", "таз, крестец и нижние рёбра", "красные флаги спины"]),
      steps: Object.freeze([
        Object.freeze({id: "lumbar-01", text: "Уточнить характер текущих ощущений и отсутствие новых тревожных симптомов.", required: true}),
        Object.freeze({id: "lumbar-02", text: "Подобрать валик или боковое положение, уменьшающее напряжение поясницы.", required: true}),
        Object.freeze({id: "lumbar-03", text: "Найти гребни подвздошных костей, крестец и нижние рёбра мягким контактом.", required: true}),
        Object.freeze({id: "lumbar-04", text: "Использовать широкую ладонную опору по мышцам с постепенным давлением.", required: true}),
        Object.freeze({id: "lumbar-05", text: "Не давить жёстко на позвоночник, нижние рёбра или область почек.", required: true, critical: true}),
        Object.freeze({id: "lumbar-06", text: "Не выполнять резких скручиваний или движений через боль.", required: true}),
        Object.freeze({id: "lumbar-07", text: "Остановиться при нарастающей слабости ног, онемении промежности или новом нарушении контроля мочеиспускания либо дефекации и организовать срочную медицинскую помощь; при быстром развитии симптомов вызвать 112 или 103.", required: true, critical: true}),
        Object.freeze({id: "lumbar-08", text: "Помочь медленно подняться и проверить самочувствие стоя или сидя.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-red-flag", "critical-bone-pressure", "critical-force"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-pelvis-gluteal",
      regionId: "pelvis",
      title: "Ягодичная область: ориентиры, укрытие и границы",
      level: "intermediate",
      estimatedMinutes: 15,
      prerequisites: Object.freeze(["admission-foundation", "крестец, гребень подвздошной кости и большой вертел", "приватность и отдельное согласие"]),
      steps: Object.freeze([
        Object.freeze({id: "pelvis-01", text: "Объяснить область и цель, отдельно получить согласие и согласовать способ укрытия.", required: true, critical: true}),
        Object.freeze({id: "pelvis-02", text: "Оставить закрытыми все участки, которые не нужны для текущего учебного действия.", required: true}),
        Object.freeze({id: "pelvis-03", text: "Найти крестец, гребень подвздошной кости и большой вертел через мягкий контакт.", required: true}),
        Object.freeze({id: "pelvis-04", text: "Начать широким контактом и не направлять давление на костные края.", required: true}),
        Object.freeze({id: "pelvis-05", text: "Не искать седалищный нерв глубоким продавливанием.", required: true, critical: true}),
        Object.freeze({id: "pelvis-06", text: "Сразу остановиться при простреле ниже колена, новом онемении или слабости; не продолжать массаж как способ проверки и рекомендовать медицинскую оценку.", required: true, critical: true}),
        Object.freeze({id: "pelvis-07", text: "Поддерживать словесный контакт и разрешать изменить границы в любой момент.", required: true}),
        Object.freeze({id: "pelvis-08", text: "Полностью восстановить укрытие до изменения положения партнёра.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-sensitive-boundary", "critical-nerve", "critical-force"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-anterior-thigh",
      regionId: "thigh_knee",
      title: "Передняя поверхность бедра: опора и границы",
      level: "foundation",
      estimatedMinutes: 12,
      prerequisites: Object.freeze(["admission-region", "четырёхглавая мышца и надколенник", "границы паховой области"]),
      steps: Object.freeze([
        Object.freeze({id: "ant-thigh-01", text: "Согласовать верхнюю границу области и надёжно укрыть паховую область.", required: true, critical: true}),
        Object.freeze({id: "ant-thigh-02", text: "Подложить опору под колено, если так передняя поверхность бедра расслабляется.", required: true}),
        Object.freeze({id: "ant-thigh-03", text: "Найти надколенник, переднюю верхнюю ость таза и мышечные контуры без глубокого давления.", required: true}),
        Object.freeze({id: "ant-thigh-04", text: "Начать широкими движениями по мышечной массе и постепенно проверить комфорт.", required: true}),
        Object.freeze({id: "ant-thigh-05", text: "Не выполнять глубокое давление в бедренном треугольнике и на выраженную пульсацию.", required: true, critical: true}),
        Object.freeze({id: "ant-thigh-06", text: "Не давить жёсткой опорой на надколенник и передний край таза.", required: true}),
        Object.freeze({id: "ant-thigh-07", text: "Остановиться при онемении, необычной резкой боли или ухудшении самочувствия.", required: true}),
        Object.freeze({id: "ant-thigh-08", text: "Закрыть область до изменения положения и спросить партнёра об ощущениях.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-sensitive-boundary", "critical-vessel", "critical-bone-pressure"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-posterior-thigh",
      regionId: "thigh_knee",
      title: "Задняя поверхность бедра: контролируемое давление",
      level: "foundation",
      estimatedMinutes: 12,
      prerequisites: Object.freeze(["admission-region", "седалищный бугор и задняя группа бедра", "подколенная ямка"]),
      steps: Object.freeze([
        Object.freeze({id: "post-thigh-01", text: "Согласовать границы укрытия ягодичной и подколенной областей.", required: true}),
        Object.freeze({id: "post-thigh-02", text: "Разместить валик под голенью или голеностопом для удобства колена.", required: true}),
        Object.freeze({id: "post-thigh-03", text: "Найти заднюю группу мышц при лёгком сгибании колена, затем попросить расслабиться.", required: true}),
        Object.freeze({id: "post-thigh-04", text: "Начать широким контактом по средней части мышечной массы.", required: true}),
        Object.freeze({id: "post-thigh-05", text: "Не давить локально на седалищный бугор и не заходить глубоко в подколенную ямку.", required: true, critical: true}),
        Object.freeze({id: "post-thigh-06", text: "Не увеличивать давление при простреле или онемении.", required: true, critical: true}),
        Object.freeze({id: "post-thigh-07", text: "Сохранять спокойный темп и проверять комфорт после смены контакта.", required: true}),
        Object.freeze({id: "post-thigh-08", text: "Завершить без растяжения через боль и вернуть ногу на опору.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-nerve", "critical-vessel", "critical-bone-pressure"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-knee",
      regionId: "thigh_knee",
      title: "Область колена: осмотр и мягкий контакт",
      level: "foundation",
      estimatedMinutes: 10,
      prerequisites: Object.freeze(["admission-region", "надколенник, суставная щель и головка малоберцовой кости", "признаки острой травмы"]),
      steps: Object.freeze([
        Object.freeze({id: "knee-01", text: "Сравнить внешний вид и температуру коленей без заключения о причине различий.", required: true}),
        Object.freeze({id: "knee-02", text: "Не начинать работу при выраженном тепле, сильном отёке или боли в покое; организовать срочную медицинскую оценку в тот же день. При свежей травме с деформацией или невозможностью опоры также не выполнять массаж и нагрузочные пробы.", required: true, critical: true}),
        Object.freeze({id: "knee-03", text: "Поддержать колено в удобном слегка согнутом положении.", required: true}),
        Object.freeze({id: "knee-04", text: "Мягко найти надколенник, бугристость большеберцовой кости и головку малоберцовой кости.", required: true}),
        Object.freeze({id: "knee-05", text: "Работать по окружающим мягким тканям без жёсткого давления на костные выступы.", required: true}),
        Object.freeze({id: "knee-06", text: "Не выполнять глубокое давление в подколенной ямке и у головки малоберцовой кости.", required: true, critical: true}),
        Object.freeze({id: "knee-07", text: "Не проверять движение через боль и не выполнять нагрузочный тест.", required: true}),
        Object.freeze({id: "knee-08", text: "Зафиксировать реакцию и при сомнении рекомендовать профильную оценку.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-acute-injury", "critical-vessel", "critical-nerve", "critical-bone-pressure"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-lower-leg",
      regionId: "lower_leg_foot",
      title: "Голень: мышцы, кости и сосудистая настороженность",
      level: "foundation",
      estimatedMinutes: 12,
      prerequisites: Object.freeze(["admission-foundation", "кости и мышечные группы голени", "красные флаги одностороннего отёка"]),
      steps: Object.freeze([
        Object.freeze({id: "leg-01", text: "Сравнить внешний вид голеней и спросить о недавней травме, длительной неподвижности и необычных симптомах.", required: true}),
        Object.freeze({id: "leg-02", text: "Не массировать и организовать срочную медицинскую оценку в тот же день при новом одностороннем отёке, боли и тепле; при одышке, боли в груди или потере сознания вызвать 112 или 103.", required: true, critical: true}),
        Object.freeze({id: "leg-03", text: "Уложить ногу на устойчивую мягкую опору.", required: true}),
        Object.freeze({id: "leg-04", text: "Найти край большеберцовой кости и мышечные группы без глубокого давления.", required: true}),
        Object.freeze({id: "leg-05", text: "Работать широким контактом по мышцам, не продавливать передний край большеберцовой кости.", required: true}),
        Object.freeze({id: "leg-06", text: "Не выполнять сильное локальное давление у головки малоберцовой кости.", required: true, critical: true}),
        Object.freeze({id: "leg-07", text: "Контролировать изменение боли, чувствительности и общего самочувствия.", required: true}),
        Object.freeze({id: "leg-08", text: "Завершить постепенно и проверить, удобно ли двигать стопой без нагрузки.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-red-flag", "critical-nerve", "critical-bone-pressure"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    }),
    Object.freeze({
      id: "checklist-foot",
      regionId: "lower_leg_foot",
      title: "Стопа и голеностоп: поддержка и комфортный диапазон",
      level: "foundation",
      estimatedMinutes: 10,
      prerequisites: Object.freeze(["admission-region", "лодыжки, пяточная кость и своды стопы", "признаки свежей травмы"]),
      steps: Object.freeze([
        Object.freeze({id: "foot-01", text: "Осмотреть кожу и уточнить наличие свежей травмы, невозможности опоры или выраженного отёка.", required: true}),
        Object.freeze({id: "foot-02", text: "При признаках серьёзной свежей травмы не выполнять массаж и нагрузочные пробы.", required: true, critical: true}),
        Object.freeze({id: "foot-03", text: "Поддерживать пятку и голень, не оставлять стопу на весу.", required: true}),
        Object.freeze({id: "foot-04", text: "Мягко найти лодыжки, пяточную кость и плюсневые кости.", required: true}),
        Object.freeze({id: "foot-05", text: "Начать широким контактом со сводами без сильного точечного давления.", required: true}),
        Object.freeze({id: "foot-06", text: "Выполнять пассивное движение только в свободном диапазоне и без боли.", required: true}),
        Object.freeze({id: "foot-07", text: "Не работать по повреждённой коже и соблюдать отдельную гигиену рук и материалов.", required: true}),
        Object.freeze({id: "foot-08", text: "Вытереть излишки средства, помочь безопасно встать и проверить устойчивость.", required: true})
      ]),
      criticalErrorIds: Object.freeze(["critical-acute-injury", "critical-hygiene", "critical-force"]),
      pass: Object.freeze({requiredSteps: 8, criticalErrorsAllowed: 0})
    })
  ]),

  scenarios: Object.freeze([
    Object.freeze({id: "scenario-office-neck", title: "Усталость шеи после работы", regionId: "neck", difficulty: "basic", brief: "Клиент сообщает о равномерной усталости шеи и плеч после работы за компьютером. Травмы, температуры, онемения и резкой боли нет.", task: "Составить безопасный учебный план на 20 минут и назвать границы своей компетенции.", expectedPlan: Object.freeze(["Объяснить учебную цель, согласовать область и получить согласие с возможностью остановить сеанс", "Повторно уточнить самочувствие и новые тревожные признаки до контакта", "Обеспечить опору голове и предплечьям", "Начать с широкого контакта плечевого пояса и работать только очно освоенными базовыми приёмами", "Перейти к мягкой работе по задней и боковой поверхности шеи, не давить на переднебоковую поверхность", "Постепенно менять только один параметр воздействия и спрашивать о комфорте", "Остановиться при головокружении, тошноте, нарушении зрения, резкой боли, простреле или онемении", "Сравнить ощущения до и после, записать реакцию без диагноза и лечебного обещания"]), unsafeChoices: Object.freeze(["Начать без объяснения и согласия", "Резко скрутить шею", "Сразу глубоко давить на самое чувствительное место", "Объявить причиной смещение позвонков"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-neck-manipulation", "critical-vessel", "critical-nerve", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-shoulder-load", title: "Усталость плечевого пояса", regionId: "shoulder", difficulty: "basic", brief: "Клиент сообщает о двусторонней усталости плеч после непривычной бытовой нагрузки. Движения сохранены, травмы, резкой боли, онемения и заметного отёка не было.", task: "Выбрать положение, последовательность областей, способ контроля реакции и критерии остановки.", expectedPlan: Object.freeze(["Объяснить план, согласовать плечевой пояс и получить согласие", "Уточнить новые симптомы и предложить остановить сеанс при любом ухудшении", "Поддержать руки и плечевой пояс, проверить только свободное активное движение без провокации боли", "Начать широким контактом вокруг лопатки и использовать только очно освоенные приёмы", "Только затем перейти к дельтовидной и верхней части трапециевидной мышцы, обходя акромион и подмышечную область", "После каждого изменения давления спрашивать о комфорте", "Остановиться при резкой боли, онемении, слабости или ощущении электрического тока", "Завершить повторной оценкой и записью реакции без диагноза и обещания лечения"]), unsafeChoices: Object.freeze(["Начать без согласия", "Давить на акромион", "Проверять силу через боль", "Глубоко работать в подмышечной области", "Назвать ограничение движения диагнозом"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-bone-pressure", "critical-nerve", "critical-force", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-arm-repetition", title: "Предплечья после повторяющейся работы", regionId: "arm", difficulty: "basic", brief: "Клиент сообщает об обычной двусторонней усталости предплечий после длительной работы руками. Онемения, отёка, резкой боли и свежего повреждения кожи нет.", task: "Составить короткую учебную последовательность для предплечья и кисти с критериями остановки.", expectedPlan: Object.freeze(["Объяснить план, согласовать область и получить согласие", "Осмотреть кожу, уточнить самочувствие и устойчиво поддержать руку", "Начать с широкого контакта кисти и предплечья", "Работать очно освоенными приёмами по мышечным группам, обходя костные края", "Двигать кисть только в свободном диапазоне без проверки через боль", "После изменения давления или движения получать обратную связь", "Сразу остановиться при покалывании, онемении, простреле или нарастающей боли", "Завершить повторной оценкой и записью реакции без вывода о диагнозе"]), unsafeChoices: Object.freeze(["Начать без согласия", "Разрабатывать кисть через боль", "Продолжить при ощущении тока в пальцы", "Давить суставом пальца на локтевой край", "Объявить онемение результатом защемления нерва"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-nerve", "critical-bone-pressure", "critical-force", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-thoracic-sitting", title: "Усталость между лопатками после сидения", regionId: "back", difficulty: "basic", brief: "Клиент сообщает о равномерной мышечной усталости между лопатками после сидения. Одышки, боли в груди, травмы и температуры нет.", task: "Построить безопасный учебный план для верхней части спины и назвать признаки немедленной остановки.", expectedPlan: Object.freeze(["Объяснить план, согласовать область и получить согласие", "Ещё раз уточнить дыхание, боль в груди, травму и общее самочувствие до контакта", "Выбрать удобное положение с опорой и мягко найти лопатки, рёбра и позвоночник", "Начать широкими контактами по мышцам и использовать только очно освоенные приёмы", "Согласовать постепенное давление, не давить на рёбра и остистые отростки", "Наблюдать за дыханием и регулярно спрашивать о комфорте", "При внезапной боли в груди, одышке, холодном поте или ухудшении немедленно прекратить сеанс и действовать по правилам экстренной помощи", "Завершить спокойно и записать реакцию без диагноза и лечебного обещания"]), unsafeChoices: Object.freeze(["Начать без согласия", "Сильно давить прямо на позвоночник", "Просить задерживать дыхание", "Игнорировать внезапную боль в груди", "Назвать усталость признаком смещения позвонков"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-red-flag", "critical-bone-pressure", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-lumbar-fatigue", title: "Усталость поясницы после поездки", regionId: "back", difficulty: "intermediate", brief: "Клиент сообщает об усталости поясницы после длительной поездки. Боли в покое, слабости, онемения, травмы и нарушения тазовых функций нет.", task: "Составить план с выбором положения, дозированием, критериями остановки и границей направления к медицинскому специалисту.", expectedPlan: Object.freeze(["Объяснить план, согласовать поясничную область и получить согласие", "Повторно уточнить травму, боль в покое, слабость, онемение и нарушение тазовых функций", "Выбрать боковое положение или положение с опорой под ноги", "Начать широким контактом и применять только очно освоенные приёмы", "Работать по мягким тканям, обходя позвоночник и нижние рёбра, без резких скручиваний", "Увеличивать давление постепенно и контролировать реакцию", "Остановиться при новой резкой боли, слабости, онемении или нарушении тазовых функций; при тревожном признаке массаж не продолжать и направить за медицинской помощью", "Проверить самочувствие после медленного подъёма и записать наблюдение без диагноза или обещания вправить позвонки"]), unsafeChoices: Object.freeze(["Начать без согласия", "Продавить позвоночник локтем", "Выполнить резкое скручивание", "Продолжить при новой слабости или онемении", "Обещать вправить позвонки"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-red-flag", "critical-bone-pressure", "critical-force", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-gluteal-sitting", title: "Ягодичная область после долгого сидения", regionId: "pelvis", difficulty: "intermediate", brief: "Клиент сообщает о равномерной усталости ягодичной области после долгого сидения. Прострела, онемения, слабости и свежей травмы нет.", task: "Составить план с отдельным согласием, приватностью, нервными зонами и критериями остановки.", expectedPlan: Object.freeze(["Объяснить учебную необходимость, отдельно согласовать сторону, границы контакта и возможность отказаться", "Согласовать укрытие и открывать только работающую область", "Уточнить прострел, онемение, слабость и свежую травму до контакта", "Найти костные ориентиры мягко и начать широким контактом только очно освоенными приёмами", "Не искать седалищный нерв точечным продавливанием и не давить на костные ориентиры", "Регулярно проверять комфорт и сохранять возможность немедленно прекратить контакт", "Остановиться при простреле, онемении, слабости или нарастающей боли", "Полностью восстановить укрытие до смены положения и записать реакцию без диагноза"]), unsafeChoices: Object.freeze(["Начать без отдельного согласия", "Открыть обе стороны для удобства", "Продавить точку до прострела", "Объявить болезненность подтверждением синдрома"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-sensitive-boundary", "critical-nerve", "critical-force", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-anterior-thigh-activity", title: "Передняя поверхность бедра после нагрузки", regionId: "thigh_knee", difficulty: "intermediate", brief: "Клиент сообщает о равномерной двусторонней усталости передней поверхности бёдер после непривычной прогулки. Травмы, локального жара, сильного отёка и боли в покое нет.", task: "Выбрать границы, положение, дозирование и безопасную последовательность с учётом чувствительной области.", expectedPlan: Object.freeze(["Объяснить план, отдельно согласовать верхнюю границу бедра, сторону и возможность остановить контакт", "Согласовать укрытие и уточнить травму, жар, отёк и боль в покое", "Поддержать колено и начать широким контактом по мышечной массе только очно освоенными приёмами", "Не давить на пульсирующую паховую область, надколенник и костные края таза", "Увеличивать давление постепенно, меняя один параметр за раз", "Постоянно контролировать комфорт и приватность", "Остановиться при резкой боли, онемении, необычном тепле или нарастающем отёке", "Сравнить реакцию сторон и записать наблюдение без диагноза или обещания вывести молочную кислоту"]), unsafeChoices: Object.freeze(["Начать без отдельного согласия", "Открыть чувствительную область шире согласованных границ", "Глубоко давить в паху", "Работать по надколеннику", "Обещать вывести молочную кислоту"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-sensitive-boundary", "critical-vessel", "critical-bone-pressure", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-posterior-thigh-return", title: "Задняя поверхность бедра после активности", regionId: "thigh_knee", difficulty: "advanced", brief: "Через день после обычной спортивной активности клиент сообщает о двусторонней усталости задней поверхности бёдер. Резкой локальной боли, синяка, слабости и ограничения обычной ходьбы нет.", task: "Составить учебный план и отделить допустимое наблюдение от диагностики травмы и решения о возвращении к нагрузке.", expectedPlan: Object.freeze(["Объяснить границы учебной оценки, согласовать область и получить согласие", "Уточнить характер нагрузки, текущие ощущения и появление новых признаков после активности", "Поддержать голень, согласовать укрытие и начать со средней части мышечной массы", "Использовать только очно освоенные приёмы, обходя седалищный бугор и подколенную ямку", "Не выполнять провокационные тесты и не растягивать через боль", "Постепенно дозировать контакт и постоянно получать обратную связь", "Остановиться при резкой локальной боли, слабости, синяке, онемении или ухудшении ходьбы и направить за медицинской оценкой", "Записать реакцию на мягкое воздействие, не определять разрыв и не решать готовность к спортивной нагрузке"]), unsafeChoices: Object.freeze(["Начать без согласия", "Определить разрыв по пальпации", "Разрешить возвращение к спорту без соответствующей квалификации", "Растянуть до сильной боли", "Глубоко давить в подколенной ямке"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-diagnosis-promise", "critical-force", "critical-vessel", "critical-nerve", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-hot-knee", title: "Горячее и сильно отёкшее колено", regionId: "thigh_knee", difficulty: "safety", brief: "До начала контакта клиент показывает одно колено, которое заметно горячее другого, сильно отекло и болит в покое. Причина не оценена медицинским специалистом; прежнее согласие на сеанс уже было получено.", task: "Отменить первоначальный план, объяснить решение и назвать признаки экстренного ухудшения без постановки диагноза.", expectedPlan: Object.freeze(["Не начинать массаж и объяснить, что прежнее согласие не отменяет остановку при новом стоп-сигнале", "Не прогревать, не разминать область и не выполнять нагрузочные тесты", "Описать наблюдаемые признаки без предположения о диагнозе", "Рекомендовать срочную медицинскую оценку в тот же день, не обещая определить причину самостоятельно", "При высокой температуре, выраженной слабости, спутанности сознания или резком ухудшении вызвать 112 или 103 и оказать первую помощь только в пределах подготовки", "Зафиксировать отмену сеанса, наблюдаемые признаки и данную рекомендацию без медицинского заключения"]), unsafeChoices: Object.freeze(["Считать прежнее согласие основанием продолжить", "Размять для уменьшения отёка", "Сильно согнуть колено", "Прогреть и продолжить", "Назвать конкретный диагноз"]), criticalErrorIds: Object.freeze(["critical-red-flag", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-one-sided-calf", title: "Новая односторонняя боль и отёк голени", regionId: "lower_leg_foot", difficulty: "safety", brief: "До начала контакта клиент сообщает, что после длительной неподвижности одна голень стала теплее, отекла и болит. Причина не оценена; прежнее согласие на сеанс уже было получено.", task: "Отменить план массажа, объяснить границу компетенции и назвать признаки экстренного ухудшения.", expectedPlan: Object.freeze(["Не начинать массаж ноги и объяснить, что прежнее согласие не отменяет остановку при новом стоп-сигнале", "Описать односторонние тепло, отёк и боль как наблюдения, не называя диагноз", "Организовать срочную медицинскую оценку в тот же день", "Не выжимать отёк, не предлагать ходьбу как проверку и не выполнять провокационные тесты", "При одышке, боли в груди, потере сознания или резком ухудшении вызвать 112 или 103, не оставлять человека одного и оказывать первую помощь только в пределах подготовки", "Записать отмену сеанса, наблюдаемые признаки и рекомендацию без медицинского заключения"]), unsafeChoices: Object.freeze(["Считать прежнее согласие основанием продолжить", "Глубоко размять икру", "Выжать отёк вверх", "Попросить походить и повторно оценить", "Назвать конкретный сосудистый диагноз"]), criticalErrorIds: Object.freeze(["critical-red-flag", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-foot-fatigue", title: "Усталость стоп после долгой ходьбы", regionId: "lower_leg_foot", difficulty: "basic", brief: "Клиент сообщает о двусторонней усталости стоп после долгой ходьбы. Кожа цела, травмы, сильного отёка, точечной боли над костью и невозможности опоры нет.", task: "Составить спокойную учебную последовательность для стоп с гигиеной и критериями остановки.", expectedPlan: Object.freeze(["Объяснить план, согласовать стопы и получить согласие", "Проверить кожу, устойчивость опоры и удобно поддержать ногу", "Начать широким контактом со сводами только очно освоенными приёмами", "Обходить костные выступы и двигать голеностоп только в свободном диапазоне", "Постепенно дозировать контакт и спрашивать о комфорте", "Остановиться при резкой или точечной боли над костью, нарастающем отёке, онемении или невозможности опоры", "Соблюсти гигиену, удалить скользкое средство с подошвы и помочь безопасно встать", "Записать реакцию без диагноза и обещания лечебного результата"]), unsafeChoices: Object.freeze(["Начать без согласия", "Сильно продавить болезненную кость", "Выполнять движение через боль", "Оставить скользкое средство на подошве", "Объявить точечную боль обычной усталостью без оценки"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-bone-pressure", "critical-force", "critical-hygiene", "critical-diagnosis-promise", "critical-no-monitoring"])}),
    Object.freeze({id: "scenario-full-session", title: "Безопасный общий учебный сеанс", regionId: "whole_body", difficulty: "advanced", brief: "Клиент просит спокойный общий сеанс после рабочей недели. По предварительному опросу новых симптомов и травмы нет; это учебная ситуация, а не медицинское назначение.", task: "Составить план на 45 минут с приоритетом, согласиями при смене областей, переходами, стоп-сигналами и документацией.", expectedPlan: Object.freeze(["Объяснить границы учебного сеанса, согласовать главную цель и получить исходное согласие", "Повторно проверить самочувствие, гигиену, укрытие и возможность остановить сеанс", "Выбрать не более трёх регионов, распределить время и применять только очно освоенные приёмы", "Начать с широкой области и лёгкого контакта, меняя один параметр воздействия за раз", "Перед каждой новой областью объяснять переход и подтверждать согласие и границы укрытия", "Постоянно наблюдать реакцию и уменьшать давление по первой просьбе", "При резкой боли, онемении, слабости, одышке, боли в груди или общем ухудшении немедленно остановиться и действовать по уровню срочности", "Завершить спокойно, помочь изменить положение и записать области, дозирование и реакцию без диагноза и лечебного обещания"]), unsafeChoices: Object.freeze(["Считать исходное согласие разрешением на любую область", "Успеть проработать все области максимально глубоко", "Менять план без объяснения", "Продолжить при стоп-сигнале", "Обещать лечебный результат"]), criticalErrorIds: Object.freeze(["critical-no-consent", "critical-sensitive-boundary", "critical-red-flag", "critical-force", "critical-diagnosis-promise", "critical-no-monitoring"])} )
  ]),

  tips: Object.freeze([
    Object.freeze({id: "tip-green-warm-hands", level: "green", title: "Тёплые руки", text: "Согрей руки и только затем устанавливай первый контакт: неожиданно холодное прикосновение мешает расслаблению."}),
    Object.freeze({id: "tip-green-broad-first", level: "green", title: "Сначала широкая опора", text: "Начинай ладонью или другой широкой мягкой опорой; точечный контакт добавляй только после оценки реакции."}),
    Object.freeze({id: "tip-green-landmarks", level: "green", title: "Сначала ориентиры", text: "Найди костные ориентиры мягко до увеличения давления — так легче оставаться на мышцах и обходить зоны осторожности."}),
    Object.freeze({id: "tip-green-bodyweight", level: "green", title: "Вес тела вместо силы пальцев", text: "Создавай давление небольшим переносом веса при устойчивой стойке, а не перегрузкой больших пальцев."}),
    Object.freeze({id: "tip-green-one-change", level: "green", title: "Один параметр за раз", text: "Меняй отдельно давление, скорость или площадь контакта — так понятнее, на что реагирует человек."}),
    Object.freeze({id: "tip-green-feedback", level: "green", title: "Вопрос с выбором", text: "Вместо «нормально?» спроси: «Сделать мягче, оставить так или прекратить?»"}),
    Object.freeze({id: "tip-green-transition", level: "green", title: "Не теряй контакт внезапно", text: "Предупреди о смене области и завершай контакт постепенно, чтобы переход был понятным."}),
    Object.freeze({id: "tip-green-record", level: "green", title: "Записывай реакцию", text: "Фиксируй не только выполненные действия, но и положение, давление, реакцию и что было изменено."}),
    Object.freeze({id: "tip-yellow-sensitive", level: "yellow", title: "Чувствительные области", text: "Работай только после отдельного согласия, с корректным укрытием и в пределах очно изученной техники."}),
    Object.freeze({id: "tip-yellow-deep", level: "yellow", title: "Глубокое давление", text: "Осваивай под наблюдением преподавателя: глубина не является показателем качества, а ошибка рядом с нервом, сосудом или костью может причинить вред."}),
    Object.freeze({id: "tip-yellow-passive", level: "yellow", title: "Пассивные движения", text: "Выполняй медленно, только в свободном диапазоне и после очного обучения; это не проверка прочности сустава."}),
    Object.freeze({id: "tip-yellow-special-groups", level: "yellow", title: "Особые ситуации", text: "Беременность, онкологическое или послеоперационное состояние, антикоагулянты и тяжёлые хронические болезни требуют работы строго в пределах квалификации и актуальных рекомендаций медицинской команды."}),
    Object.freeze({id: "tip-yellow-return-activity", level: "yellow", title: "После травмы или операции", text: "Не определяй готовность к нагрузке самостоятельно: ориентируйся на медицинские ограничения и план реабилитации."}),
    Object.freeze({id: "tip-red-pain", level: "red", title: "Не продавливай боль", text: "Резкая, стреляющая или нарастающая боль — не признак полезной глубины. Убери давление и оцени ситуацию."}),
    Object.freeze({id: "tip-red-pulse", level: "red", title: "Не дави на пульсацию", text: "Отчётливая пульсация указывает на сосудистую зону, где глубокое локальное давление недопустимо."}),
    Object.freeze({id: "tip-red-swelling", level: "red", title: "Не выжимай новый односторонний отёк", text: "Новый односторонний отёк с болью или теплом требует медицинской оценки, а не массажной проверки."}),
    Object.freeze({id: "tip-red-neck", level: "red", title: "Никаких рывков шеей", text: "Резкие скручивания и манипуляции шеи не относятся к базовой практике этого тренажёра."}),
    Object.freeze({id: "tip-red-diagnosis", level: "red", title: "Не ставь диагноз руками", text: "Разница плотности, болезненность или асимметрия — наблюдение, а не диагноз и не основание менять лечение."})
  ]),

  myths: Object.freeze([
    Object.freeze({id: "myth-toxins", claim: "Массаж выводит токсины.", verdict: "Неподтверждённое обобщение", explanation: "Лучше описывать наблюдаемый результат: комфорт, изменение субъективного ощущения напряжения или временное облегчение. Не обещай «детокс»."}),
    Object.freeze({id: "myth-salts", claim: "Можно разбить отложения солей руками.", verdict: "Некорректная формулировка", explanation: "Плотность и болезненность тканей не позволяют определить химические «соли» или разрушить их массажным давлением."}),
    Object.freeze({id: "myth-pain-effective", claim: "Чем больнее, тем эффективнее.", verdict: "Опасное правило", explanation: "Боль не служит мерой качества. Резкая, стреляющая и нарастающая боль требует уменьшить давление или остановиться."}),
    Object.freeze({id: "myth-vertebra", claim: "Массажист вправляет смещённые позвонки.", verdict: "За пределами базового массажа", explanation: "Тренажёр не обучает манипуляциям и не позволяет определять «смещение» по ощущению пальцами."}),
    Object.freeze({id: "myth-knot", claim: "Каждый плотный участок — узел, который нужно продавить.", verdict: "Неверное упрощение", explanation: "Ощущение плотности зависит от положения, активности мышцы и индивидуальной анатомии. Сильное точечное давление не является обязательным."}),
    Object.freeze({id: "myth-asymmetry", claim: "Любая асимметрия означает заболевание.", verdict: "Неверно", explanation: "Асимметрия встречается и без заболевания. Её можно описать, но нельзя превращать в диагноз без соответствующего обследования."}),
    Object.freeze({id: "myth-single-session", claim: "Один сеанс исправляет причину любой боли.", verdict: "Лечебное обещание", explanation: "Причины боли различны, а эффект процедуры индивидуален. Не обещай устранить причину и не откладывай медицинскую оценку при тревожных признаках."}),
    Object.freeze({id: "myth-more-techniques", claim: "Полноценный сеанс должен содержать как можно больше приёмов.", verdict: "Неверно", explanation: "Последовательный план с ясной целью, дозированием и обратной связью важнее количества приёмов."})
  ]),

  sources: Object.freeze([
    Object.freeze({id: "source-fipat-ta2", title: "FIPAT — Terminologia Anatomica, 2nd edition", organization: "Federative International Programme for Anatomical Terminology", url: "https://libraries.dal.ca/Fipat/ta2.html", usedFor: Object.freeze(["анатомические названия", "ориентиры областей"])}),
    Object.freeze({id: "source-openstax-ap2", title: "OpenStax — Anatomy and Physiology 2e", organization: "OpenStax, Rice University", url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/1-introduction", usedFor: Object.freeze(["базовая анатомия", "функции систем"])}),
    Object.freeze({id: "source-openstax-joints", title: "OpenStax — Joints", organization: "OpenStax, Rice University", url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/9-introduction", usedFor: Object.freeze(["движения суставов", "безопасный диапазон движения"])}),
    Object.freeze({id: "source-openstax-muscles", title: "OpenStax — The Muscular System", organization: "OpenStax, Rice University", url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/11-introduction", usedFor: Object.freeze(["мышечные группы", "направления действий мышц"])}),
    Object.freeze({id: "source-minzdrav-97n-2026", title: "Типовая дополнительная профессиональная программа профессиональной переподготовки по специальности «Медицинский массаж», приказ Минздрава России № 97н", organization: "Министерство здравоохранения Российской Федерации", url: "https://publication.pravo.gov.ru/document/0001202602240017", usedFor: Object.freeze(["компетенции медицинского массажа", "практическая подготовка специалистов со средним медицинским образованием", "граница между учебным тренажёром и квалификацией"])}),
    Object.freeze({id: "source-mintrud-744n", title: "Профессиональный стандарт «Специалист по медицинскому массажу», приказ Минтруда России № 744н", organization: "Министерство труда и социальной защиты Российской Федерации", url: "https://rg.ru/documents/2018/12/15/mintrud-prikaz-744n-site-dok.html", usedFor: Object.freeze(["трудовые действия", "контроль состояния", "документация", "границы квалификации"])}),
    Object.freeze({id: "source-rostgmu-144", title: "Дополнительная профессиональная программа повышения квалификации «Медицинский массаж», 144 часа", organization: "ФГБОУ ВО РостГМУ Минздрава России", url: "https://rostgmu.ru/wp-content/uploads/2025/09/%D0%94%D0%9F%D0%9F-%D0%9F%D0%9A-%D0%9C%D0%B5%D0%B4%D0%B8%D1%86%D0%B8%D0%BD%D1%81%D0%BA%D0%B8%D0%B9-%D0%BC%D0%B0%D1%81%D1%81%D0%B0%D0%B6-144-%D1%87%D0%B0%D1%81%D0%B0.pdf", usedFor: Object.freeze(["структура обучения", "безопасность", "санитарно-гигиенические требования"])}),
    Object.freeze({id: "source-law-323", title: "Федеральный закон № 323-ФЗ «Об основах охраны здоровья граждан в Российской Федерации»", organization: "Российская Федерация", url: "https://publication.pravo.gov.ru/Document/View/0001201111220007", usedFor: Object.freeze(["профессиональные границы", "этика", "конфиденциальность"])}),
    Object.freeze({id: "source-first-aid-220n", title: "Порядок оказания первой помощи, приказ Минздрава России № 220н", organization: "Министерство здравоохранения Российской Федерации", url: "https://publication.pravo.gov.ru/document/0001202405310015", usedFor: Object.freeze(["действия при угрозе жизни", "остановка процедуры", "экстренная помощь"])}),
    Object.freeze({id: "source-who-hygiene", title: "WHO Guidelines on Hand Hygiene in Health Care", organization: "World Health Organization", url: "https://www.who.int/publications/i/item/9789241597906", usedFor: Object.freeze(["гигиена рук", "снижение передачи микроорганизмов"])}),
    Object.freeze({id: "source-who-rehab-competency", title: "WHO Rehabilitation Competency Framework", organization: "World Health Organization", url: "https://www.who.int/publications/i/item/9789240008281", usedFor: Object.freeze(["компетентностная модель", "знания, навыки, коммуникация и поведение"])}),
    Object.freeze({id: "source-nccih-massage", title: "Massage Therapy: What You Need To Know", organization: "National Center for Complementary and Integrative Health", url: "https://www.nccih.nih.gov/health/massage-therapy-what-you-need-to-know", usedFor: Object.freeze(["ограниченность лечебных обещаний", "общие сведения о рисках"])} )
  ])
});

if (typeof window !== "undefined") {
  window.PRACTICE_CURRICULUM = PRACTICE_CURRICULUM;
}

if (typeof globalThis !== "undefined") {
  globalThis.PRACTICE_CURRICULUM = PRACTICE_CURRICULUM;
}
