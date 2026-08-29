const LEARNING_PATHS=[
  {
    id:"neck",
    title:"Шея и голова",
    icon:"🧠",
    description:"Костные ориентиры шеи, поверхностные мышцы, движения головы, безопасная пальпация и зоны осторожности.",
    categoryMatchers:["Позвонки","Кости черепа","Шея / голова","Пальпаторная анатомия · Шея","Кинезиология · Шея","Топография и зоны осторожности · Шея","Безопасность · Опасные зоны"],
    estimatedMinutes:35,
    stages:[
      {id:"bones",title:"1. Кости и ориентиры",subject:"bone",categoryMatchers:["Позвонки","Кости черепа"],questionMatchers:["шейн","атлант","осев","C1","C2","C7","затыл","нижн","челюст"]},
      {id:"muscles",title:"2. Мышцы",subject:"muscle",categoryMatchers:["Шея / голова"],questionMatchers:["грудино-ключично-сосцевид","лестнич","ременн","полуостист","длинная мышца шеи","платизм","двубрюш"]},
      {id:"movement",title:"3. Движение",subject:"massage",categoryMatchers:["Кинезиология · Шея"],questionKeys:["massage::mk_scm_rotation"]},
      {id:"palpation",title:"4. Пальпация",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Шея"],questionKeys:["massage::mp_scm"]},
      {id:"safety",title:"5. Безопасность",subject:"massage",categoryMatchers:["Топография и зоны осторожности · Шея","Безопасность · Опасные зоны"],questionKeys:["massage::mt_carotid_triangle","massage::safe-14"]},
      {id:"practice",title:"6. Практика",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Шея","Кинезиология · Шея","Топография и зоны осторожности · Шея","Безопасность · Опасные зоны"],questionKeys:["massage::mp_scm","massage::mk_scm_rotation","massage::mt_carotid_triangle","massage::safe-14"]}
    ]
  },
  {
    id:"shoulder",
    title:"Плечевой пояс",
    icon:"🤲",
    description:"Лопатка и ключица, мышцы плечевого пояса, движение лопатки, пальпаторные ориентиры и безопасность подмышечной области.",
    categoryMatchers:["Кости верхней конечности","Руки / плечевой пояс","Пальпаторная анатомия · Плечевой пояс","Пальпаторная анатомия · Плечо","Кинезиология · Движения плеча","Кинезиология · Плечевой пояс","Области тела · Плечевой сустав","Области тела · Лопаточная область","Топография и зоны осторожности · Подмышечная область","Безопасность · Опасные зоны"],
    estimatedMinutes:45,
    stages:[
      {id:"bones",title:"1. Кости и ориентиры",subject:"bone",categoryMatchers:["Кости верхней конечности"],questionMatchers:["лопатк","ключиц","акромион","ость лопатки","суставная впадина"]},
      {id:"muscles",title:"2. Мышцы",subject:"muscle",categoryMatchers:["Руки / плечевой пояс"],questionMatchers:["дельтовид","надостн","подостн","подлопаточ","кругл","трапец","ромбовид","передняя зубчат","поднимающая лопатку"]},
      {id:"movement",title:"3. Движение",subject:"massage",categoryMatchers:["Кинезиология · Движения плеча","Кинезиология · Плечевой пояс"],questionKeys:["massage::mk_shoulder_start","massage::mk_scapular_rotation"]},
      {id:"palpation",title:"4. Пальпация",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Плечевой пояс","Пальпаторная анатомия · Плечо"],questionKeys:["massage::mp_trapezius_upper","massage::mp_deltoid_middle"]},
      {id:"safety",title:"5. Безопасность",subject:"massage",categoryMatchers:["Топография и зоны осторожности · Подмышечная область","Безопасность · Опасные зоны"],questionKeys:["massage::mt_axilla","massage::safe-15"]},
      {id:"practice",title:"6. Практика",subject:"massage",categoryMatchers:["Области тела · Плечевой сустав","Области тела · Лопаточная область","Кинезиология · Движения плеча","Кинезиология · Плечевой пояс"],questionKeys:["massage::mr_rotator_cuff","massage::mr_scapular_spine","massage::mk_shoulder_start","massage::mk_scapular_rotation","massage::safe-15"]}
    ]
  },
  {
    id:"arm",
    title:"Рука и локоть",
    icon:"💪",
    description:"Кости верхней конечности, мышцы плеча, сгибание и разгибание локтя, пальпация бицепса и поверхностные нервы.",
    categoryMatchers:["Кости верхней конечности","Руки / плечевой пояс","Пальпаторная анатомия · Плечо","Кинезиология · Локоть","Топография и зоны осторожности · Локоть","Безопасность · Нервы"],
    estimatedMinutes:35,
    stages:[
      {id:"bones",title:"1. Кости и ориентиры",subject:"bone",categoryMatchers:["Кости верхней конечности"],questionMatchers:["плечевая кость","лучевая кость","локтевая кость","кости запястья","пястные кости","надмыщел","локтевой отросток"]},
      {id:"muscles",title:"2. Мышцы",subject:"muscle",categoryMatchers:["Руки / плечевой пояс"],questionMatchers:["двуглавая мышца плеча","трёхглавая мышца плеча","плечелучевая","клювовидно-плечевая"]},
      {id:"movement",title:"3. Движение",subject:"massage",categoryMatchers:["Кинезиология · Локоть"],questionKeys:["massage::mk_agonist_antagonist"]},
      {id:"palpation",title:"4. Пальпация",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Плечо"],questionKeys:["massage::mp_biceps"]},
      {id:"safety",title:"5. Безопасность",subject:"massage",categoryMatchers:["Топография и зоны осторожности · Локоть","Безопасность · Нервы"],questionKeys:["massage::mt_cubital_fossa","massage::mt_ulnar_nerve","massage::safe-08"]},
      {id:"practice",title:"6. Практика",subject:"massage",categoryMatchers:["Кинезиология · Локоть","Топография и зоны осторожности · Локоть","Безопасность · Нервы"],questionKeys:["massage::mk_agonist_antagonist","massage::mp_biceps","massage::mt_cubital_fossa","massage::mt_ulnar_nerve","massage::safe-08"]}
    ]
  },
  {
    id:"back",
    title:"Спина и поясница",
    icon:"🧍",
    description:"Позвоночник и рёбра, мышцы спины, контроль движения, пальпация паравертебральных мышц и защита костных ориентиров.",
    categoryMatchers:["Позвоночник / грудная клетка","Позвонки","Спина / туловище","Пальпаторная анатомия · Спина","Области тела · Поясница","Безопасность · Костные ориентиры","Безопасность · Эргономика"],
    estimatedMinutes:40,
    stages:[
      {id:"bones",title:"1. Кости и ориентиры",subject:"bone",categoryMatchers:["Позвоночник / грудная клетка","Позвонки"],questionMatchers:["грудн","пояснич","ребр","грудин","остист","крестец","копчик"]},
      {id:"muscles",title:"2. Мышцы",subject:"muscle",categoryMatchers:["Спина / туловище"],questionMatchers:["выпрямляющая позвоночник","квадратная мышца поясницы","широчайшая","задняя зубчатая"]},
      {id:"movement",title:"3. Движение",subject:"massage",categoryMatchers:["Кинезиология · Типы сокращения"],questionKeys:["massage::mk_eccentric"]},
      {id:"palpation",title:"4. Пальпация",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Спина","Области тела · Поясница"],questionKeys:["massage::mp_erector_spinae","massage::mr_ql"]},
      {id:"safety",title:"5. Безопасность",subject:"massage",categoryMatchers:["Безопасность · Костные ориентиры","Безопасность · Эргономика"],questionKeys:["massage::safe-19","massage::safe-25"]},
      {id:"practice",title:"6. Практика",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Спина","Области тела · Поясница","Безопасность · Костные ориентиры","Безопасность · Эргономика"],questionKeys:["massage::mp_erector_spinae","massage::mr_ql","massage::safe-19","massage::safe-25"]}
    ]
  },
  {
    id:"pelvis",
    title:"Таз и ягодичная область",
    icon:"🦴",
    description:"Кости таза, ягодичные и глубокие мышцы, устойчивость таза при ходьбе, пальпация и расположение седалищного нерва.",
    categoryMatchers:["Кости таза / нижней конечности","Таз / ягодичные","Спина / туловище","Пальпаторная анатомия · Таз и ягодичная область","Кинезиология · Таз и ходьба","Области тела · Ягодичная область","Топография и зоны осторожности · Ягодичная область и бедро","Безопасность · Нервы","Безопасность · Приватность"],
    estimatedMinutes:40,
    stages:[
      {id:"bones",title:"1. Кости и ориентиры",subject:"bone",categoryMatchers:["Кости таза / нижней конечности","Позвоночник / грудная клетка"],questionMatchers:["тазовая кость","крестец","копчик","бедренная кость","вертел","седалищ"]},
      {id:"muscles",title:"2. Мышцы",subject:"muscle",categoryMatchers:["Таз / ягодичные","Спина / туловище"],questionMatchers:["ягодич","грушевид","близнецов","запирательн","квадратная мышца бедра","напрягатель широкой фасции","подвздошно-пояснич"]},
      {id:"movement",title:"3. Движение",subject:"massage",categoryMatchers:["Кинезиология · Таз и ходьба"],questionKeys:["massage::mk_pelvic_stability"]},
      {id:"palpation",title:"4. Пальпация",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Таз и ягодичная область","Области тела · Ягодичная область"],questionKeys:["massage::mp_gluteus_medius","massage::mr_gluteal_layers"]},
      {id:"safety",title:"5. Безопасность",subject:"massage",categoryMatchers:["Топография и зоны осторожности · Ягодичная область и бедро","Безопасность · Нервы","Безопасность · Приватность"],questionKeys:["massage::mt_sciatic","massage::safe-08","massage::safe-29"]},
      {id:"practice",title:"6. Практика",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Таз и ягодичная область","Кинезиология · Таз и ходьба","Области тела · Ягодичная область","Топография и зоны осторожности · Ягодичная область и бедро"],questionKeys:["massage::mp_gluteus_medius","massage::mk_pelvic_stability","massage::mr_gluteal_layers","massage::mt_sciatic","massage::safe-29"]}
    ]
  },
  {
    id:"thigh_knee",
    title:"Бедро и колено",
    icon:"🦵",
    description:"Бедренная кость и надколенник, передняя, задняя и приводящая группы мышц, движение колена и опасные зоны вокруг него.",
    categoryMatchers:["Кости таза / нижней конечности","Ноги","Приводящие бедра","Кинезиология · Бедро и колено","Области тела · Передняя поверхность бедра","Области тела · Задняя поверхность бедра","Топография и зоны осторожности · Колено","Топография и зоны осторожности · Наружная поверхность колена","Топография и зоны осторожности · Пах и бедро","Безопасность · Опасные зоны","Безопасность · Травмы"],
    estimatedMinutes:45,
    stages:[
      {id:"bones",title:"1. Кости и ориентиры",subject:"bone",categoryMatchers:["Кости таза / нижней конечности"],questionMatchers:["бедренная кость","надколенник","большеберцовая кость","малоберцовая кость","мыщел","бугристость"]},
      {id:"muscles",title:"2. Мышцы",subject:"muscle",categoryMatchers:["Ноги","Приводящие бедра"],questionMatchers:["прямая бедренная","широкая мышца бедра","портняжная","двуглавая мышца бедра","полусухожильная","полуперепончатая","приводящая","тонкая мышца","гребенчатая"]},
      {id:"movement",title:"3. Движение",subject:"massage",categoryMatchers:["Кинезиология · Бедро и колено"],questionKeys:["massage::mk_knee_flexion"]},
      {id:"palpation",title:"4. Пальпация и слои",subject:"massage",categoryMatchers:["Области тела · Передняя поверхность бедра","Области тела · Задняя поверхность бедра"],questionKeys:["massage::mr_anterior_thigh","massage::mr_posterior_thigh"]},
      {id:"safety",title:"5. Безопасность",subject:"massage",categoryMatchers:["Топография и зоны осторожности · Колено","Топография и зоны осторожности · Наружная поверхность колена","Топография и зоны осторожности · Пах и бедро","Безопасность · Опасные зоны","Безопасность · Травмы"],questionKeys:["massage::mt_popliteal","massage::mt_fibular_nerve","massage::mt_femoral_triangle","massage::safe-16","massage::safe-17","massage::safe-05"]},
      {id:"practice",title:"6. Практика",subject:"massage",categoryMatchers:["Кинезиология · Бедро и колено","Области тела · Передняя поверхность бедра","Области тела · Задняя поверхность бедра","Топография и зоны осторожности · Колено","Топография и зоны осторожности · Пах и бедро"],questionKeys:["massage::mk_knee_flexion","massage::mr_anterior_thigh","massage::mr_posterior_thigh","massage::mt_popliteal","massage::mt_femoral_triangle","massage::safe-05"]}
    ]
  },
  {
    id:"lower_leg_foot",
    title:"Голень и стопа",
    icon:"🦶",
    description:"Кости голени и стопы, передняя, задняя и латеральная группы мышц, движения стопы, пальпация и сосудистые красные флаги.",
    categoryMatchers:["Кости таза / нижней конечности","Ноги","Пальпаторная анатомия · Голень","Кинезиология · Голень и стопа","Области тела · Передняя поверхность голени","Области тела · Задняя поверхность голени","Топография и зоны осторожности · Наружная поверхность колена","Безопасность · Красные флаги","Безопасность · Сосуды","Безопасность · Травмы"],
    estimatedMinutes:45,
    stages:[
      {id:"bones",title:"1. Кости и ориентиры",subject:"bone",categoryMatchers:["Кости таза / нижней конечности"],questionMatchers:["большеберцовая кость","малоберцовая кость","таранная кость","пяточная кость","кости предплюсны","плюсневые кости","лодыж"]},
      {id:"muscles",title:"2. Мышцы",subject:"muscle",categoryMatchers:["Ноги"],questionMatchers:["икроножная","камбаловидная","передняя большеберцовая","разгибатель пальцев","малоберцовая мышца"]},
      {id:"movement",title:"3. Движение",subject:"massage",categoryMatchers:["Кинезиология · Голень и стопа","Области тела · Передняя поверхность голени","Области тела · Задняя поверхность голени"],questionKeys:["massage::mk_bent_knee_plantarflexion","massage::mr_anterior_leg","massage::mr_posterior_leg"]},
      {id:"palpation",title:"4. Пальпация",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Голень"],questionKeys:["massage::mp_tibialis_anterior","massage::mp_soleus"]},
      {id:"safety",title:"5. Безопасность",subject:"massage",categoryMatchers:["Топография и зоны осторожности · Наружная поверхность колена","Безопасность · Красные флаги","Безопасность · Сосуды","Безопасность · Травмы"],questionKeys:["massage::mt_fibular_nerve","massage::safe-02","massage::safe-13","massage::safe-05"]},
      {id:"practice",title:"6. Практика",subject:"massage",categoryMatchers:["Пальпаторная анатомия · Голень","Кинезиология · Голень и стопа","Области тела · Передняя поверхность голени","Области тела · Задняя поверхность голени","Безопасность · Красные флаги","Безопасность · Сосуды"],questionKeys:["massage::mp_tibialis_anterior","massage::mp_soleus","massage::mk_bent_knee_plantarflexion","massage::mr_anterior_leg","massage::mr_posterior_leg","massage::safe-02","massage::safe-13"]}
    ]
  }
];
