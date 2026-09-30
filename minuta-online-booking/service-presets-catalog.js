(() => {
  'use strict';

  const catalog = {
    version: 2,
    locale: 'ru-RU',
    evidence: 'cross_platform_public_catalog',
    ranking: 'editorial_v2',
    professions: [
      {
        id: 'massage_therapist', label: 'Массажист', shortLabel: 'Массаж',
        services: [
          ['massage_full_body', 'Массаж всего тела', 60, 'Массаж'],
          ['massage_back_neck_shoulders', 'Массаж спины, шеи и плеч', 45, 'Массаж'],
          ['massage_relaxing', 'Расслабляющий массаж', 60, 'Массаж'],
          ['massage_sports', 'Спортивный массаж', 60, 'Массаж'],
          ['massage_lymphatic', 'Лимфодренажный массаж', 60, 'Массаж'],
          ['massage_face', 'Массаж лица', 30, 'Массаж'],
          ['massage_head', 'Массаж головы', 30, 'Массаж']
        ]
      },
      {
        id: 'nail_artist', label: 'Ногтевой мастер', shortLabel: 'Ногти',
        services: [
          ['nails_manicure_basic', 'Маникюр без покрытия', 60, 'Маникюр'],
          ['nails_manicure_gel', 'Маникюр с покрытием', 120, 'Маникюр'],
          ['nails_removal', 'Снятие покрытия', 30, 'Маникюр'],
          ['nails_strengthening', 'Укрепление ногтей', 30, 'Маникюр'],
          ['nails_extension', 'Наращивание ногтей', 180, 'Маникюр'],
          ['nails_extension_correction', 'Коррекция наращивания', 120, 'Маникюр'],
          ['nails_pedicure', 'Педикюр', 90, 'Педикюр']
        ]
      },
      {
        id: 'hair_stylist', label: 'Парикмахер / колорист', shortLabel: 'Волосы',
        services: [
          ['hair_womens_cut', 'Женская стрижка', 60, 'Стрижки'],
          ['hair_mens_cut', 'Мужская стрижка', 45, 'Стрижки'],
          ['hair_styling', 'Укладка', 60, 'Укладка'],
          ['hair_coloring', 'Окрашивание', 180, 'Окрашивание'],
          ['hair_root_coloring', 'Окрашивание корней', 120, 'Окрашивание'],
          ['hair_care', 'Уход за волосами', 60, 'Уход'],
          ['hair_consultation', 'Консультация', 30, 'Консультация']
        ]
      },
      {
        id: 'barber', label: 'Барбер', shortLabel: 'Барбер',
        services: [
          ['barber_haircut', 'Мужская стрижка', 45, 'Стрижки'],
          ['barber_beard', 'Оформление бороды', 30, 'Борода'],
          ['barber_haircut_beard', 'Стрижка + борода', 75, 'Комплекс'],
          ['barber_kids_cut', 'Детская стрижка', 45, 'Стрижки'],
          ['barber_fade', 'Фейд', 45, 'Стрижки'],
          ['barber_shave', 'Бритьё головы или лица', 45, 'Бритьё'],
          ['barber_gray_blending', 'Камуфляж седины', 45, 'Окрашивание']
        ]
      },
      {
        id: 'brow_artist', label: 'Бровист', shortLabel: 'Брови',
        services: [
          ['brows_shaping', 'Коррекция формы бровей', 30, 'Брови'],
          ['brows_tinting', 'Окрашивание бровей', 30, 'Брови'],
          ['brows_shaping_tinting', 'Коррекция + окрашивание', 45, 'Брови'],
          ['brows_lamination', 'Ламинирование бровей', 60, 'Брови'],
          ['brows_lamination_tinting', 'Ламинирование + окрашивание', 75, 'Брови'],
          ['brows_consultation', 'Консультация', 20, 'Консультация']
        ]
      },
      {
        id: 'lash_artist', label: 'Лэшмейкер', shortLabel: 'Ресницы',
        services: [
          ['lashes_classic', 'Классическое наращивание', 120, 'Наращивание'],
          ['lashes_hybrid', 'Лёгкий объём', 150, 'Наращивание'],
          ['lashes_volume', 'Объёмное наращивание', 180, 'Наращивание'],
          ['lashes_refill', 'Коррекция наращивания', 120, 'Коррекция'],
          ['lashes_removal', 'Снятие ресниц', 30, 'Снятие'],
          ['lashes_lamination', 'Ламинирование ресниц', 75, 'Ламинирование'],
          ['lashes_tinting', 'Окрашивание ресниц', 30, 'Окрашивание']
        ]
      },
      {
        id: 'esthetician', label: 'Косметолог-эстетист', shortLabel: 'Уход за лицом',
        services: [
          ['esthetician_consultation', 'Консультация по уходу', 30, 'Консультация'],
          ['esthetician_basic_facial', 'Базовый уход за лицом', 60, 'Уход'],
          ['esthetician_cleansing_facial', 'Очищающий уход', 75, 'Уход'],
          ['esthetician_surface_peel', 'Поверхностный пилинг', 45, 'Уход'],
          ['esthetician_face_massage', 'Массаж лица', 45, 'Уход'],
          ['esthetician_express_care', 'Экспресс-уход', 30, 'Уход'],
          ['esthetician_back_care', 'Уход за спиной', 60, 'Уход']
        ]
      },
      {
        id: 'makeup_artist', label: 'Визажист', shortLabel: 'Макияж',
        services: [
          ['makeup_natural', 'Естественный макияж', 60, 'Макияж'],
          ['makeup_day', 'Дневной макияж', 60, 'Макияж'],
          ['makeup_evening', 'Вечерний макияж', 90, 'Макияж'],
          ['makeup_event', 'Макияж для события', 90, 'Макияж'],
          ['makeup_bridal', 'Свадебный макияж', 120, 'Свадебный образ'],
          ['makeup_bridal_trial', 'Пробный свадебный макияж', 120, 'Свадебный образ'],
          ['makeup_consultation', 'Консультация', 30, 'Консультация']
        ]
      },
      {
        id: 'depilation_artist', label: 'Мастер депиляции', shortLabel: 'Депиляция',
        services: [
          ['depilation_underarms', 'Депиляция: подмышки', 20, 'Зоны'],
          ['depilation_lower_legs', 'Депиляция: голени', 30, 'Зоны'],
          ['depilation_full_legs', 'Депиляция: ноги полностью', 60, 'Зоны'],
          ['depilation_face_zone', 'Депиляция: зона лица', 20, 'Зоны'],
          ['depilation_bikini', 'Депиляция: бикини', 30, 'Зоны'],
          ['depilation_deep_bikini', 'Депиляция: глубокое бикини', 45, 'Зоны'],
          ['depilation_combo', 'Комплекс зон', 90, 'Комплекс']
        ]
      },
      {
        id: 'tattoo_piercing_artist', label: 'Тату / пирсинг', shortLabel: 'Тату и пирсинг',
        services: [
          ['tattoo_consultation', 'Консультация по тату', 30, 'Тату'],
          ['tattoo_session', 'Сеанс татуировки', 180, 'Тату'],
          ['tattoo_correction', 'Коррекция татуировки', 90, 'Тату'],
          ['piercing_consultation', 'Консультация по пирсингу', 20, 'Пирсинг'],
          ['piercing_ear', 'Пирсинг уха', 30, 'Пирсинг'],
          ['piercing_body', 'Пирсинг тела', 30, 'Пирсинг'],
          ['piercing_jewelry_change', 'Замена украшения', 20, 'Пирсинг']
        ]
      },
      {
        id: 'spa_body_care', label: 'SPA / уход за телом', shortLabel: 'SPA',
        services: [
          ['spa_body_care', 'Уход за телом', 60, 'Уход за телом'],
          ['spa_body_scrub', 'Скрабирование тела', 45, 'Уход за телом'],
          ['spa_body_wrap', 'Обёртывание', 60, 'Уход за телом'],
          ['spa_program', 'SPA-программа', 120, 'Программы'],
          ['spa_scrub_massage', 'Скрабирование + массаж', 90, 'Программы'],
          ['spa_foot_care', 'SPA-уход для ног', 45, 'Уход за телом'],
          ['spa_back_care', 'Уход за спиной', 60, 'Уход за телом']
        ]
      },
      {
        id: 'fitness_yoga_coach', label: 'Тренер / фитнес / йога', shortLabel: 'Фитнес и йога',
        services: [
          ['fitness_personal', 'Индивидуальная тренировка', 60, 'Фитнес'],
          ['fitness_group', 'Групповая тренировка', 60, 'Фитнес'],
          ['fitness_intro', 'Вводная тренировка', 45, 'Фитнес'],
          ['yoga_personal', 'Индивидуальная йога', 60, 'Йога'],
          ['yoga_group', 'Групповая йога', 60, 'Йога'],
          ['fitness_mobility', 'Растяжка и мобильность', 60, 'Практики'],
          ['fitness_consultation', 'Консультация', 30, 'Консультация']
        ]
      }
    ]
  };

  // Generic service names only. Durations are editable starting points; prices belong to the provider.
  const additions = {
    massage_therapist: [
      ['massage_back', 'Массаж спины', 30, 'По зонам'],
      ['massage_neck', 'Массаж шейно-воротниковой зоны', 30, 'По зонам'],
      ['massage_legs', 'Массаж ног', 30, 'По зонам'],
      ['massage_feet', 'Массаж стоп', 30, 'По зонам'],
      ['massage_hands', 'Массаж рук', 30, 'По зонам'],
      ['massage_aroma', 'Аромамассаж', 60, 'Массаж'],
      ['massage_hot_stones', 'Массаж горячими камнями', 90, 'Массаж'],
      ['massage_express', 'Экспресс-массаж', 20, 'Массаж'],
      ['massage_consultation', 'Консультация перед массажем', 20, 'Консультация']
    ],
    nail_artist: [
      ['nails_mens_manicure', 'Мужской маникюр', 45, 'Маникюр'],
      ['nails_japanese', 'Японский маникюр', 60, 'Маникюр'],
      ['nails_pedicure_gel', 'Педикюр с покрытием', 120, 'Педикюр'],
      ['nails_toes', 'Обработка пальцев ног', 45, 'Педикюр'],
      ['nails_feet', 'Обработка стоп', 45, 'Педикюр'],
      ['nails_repair', 'Ремонт одного ногтя', 15, 'Дополнительно'],
      ['nails_design', 'Дизайн ногтей', 30, 'Дополнительно'],
      ['nails_shape', 'Коррекция формы ногтей', 20, 'Дополнительно'],
      ['nails_hand_care', 'SPA-уход для рук', 30, 'Уход']
    ],
    hair_stylist: [
      ['hair_kids_cut', 'Детская стрижка', 30, 'Стрижки'],
      ['hair_bangs', 'Стрижка чёлки', 15, 'Стрижки'],
      ['hair_ends', 'Подравнивание кончиков', 30, 'Стрижки'],
      ['hair_toning', 'Тонирование волос', 90, 'Окрашивание'],
      ['hair_highlights', 'Мелирование', 180, 'Окрашивание'],
      ['hair_complex_color', 'Сложное окрашивание', 240, 'Окрашивание'],
      ['hair_lightening', 'Осветление волос', 180, 'Окрашивание'],
      ['hair_updo', 'Вечерняя причёска', 90, 'Укладка'],
      ['hair_braids', 'Плетение кос', 60, 'Укладка']
    ],
    barber: [
      ['barber_clipper', 'Стрижка машинкой', 30, 'Стрижки'],
      ['barber_outline', 'Окантовка стрижки', 20, 'Дополнительно'],
      ['barber_moustache', 'Оформление усов', 20, 'Борода'],
      ['barber_beard_toning', 'Тонирование бороды', 30, 'Окрашивание'],
      ['barber_styling', 'Мужская укладка', 20, 'Укладка']
    ],
    brow_artist: [
      ['brows_threading', 'Коррекция бровей нитью', 30, 'Брови'],
      ['brows_henna', 'Окрашивание бровей хной', 45, 'Брови'],
      ['brows_lightening', 'Осветление бровей', 30, 'Брови'],
      ['brows_makeup_lesson', 'Урок макияжа бровей', 45, 'Обучение']
    ],
    lash_artist: [
      ['lashes_partial', 'Наращивание внешних уголков', 60, 'Наращивание'],
      ['lashes_colored', 'Наращивание цветных ресниц', 150, 'Наращивание'],
      ['lashes_lower', 'Наращивание нижних ресниц', 45, 'Наращивание'],
      ['lashes_lamination_tint', 'Ламинирование и окрашивание ресниц', 90, 'Ламинирование'],
      ['lashes_consultation', 'Подбор эффекта наращивания', 20, 'Консультация']
    ],
    esthetician: [
      ['esthetician_hydration', 'Увлажняющий уход за лицом', 60, 'Уход'],
      ['esthetician_sensitive', 'Уход за чувствительной кожей', 60, 'Уход'],
      ['esthetician_mask', 'Маска для лица', 30, 'Дополнительно'],
      ['esthetician_neck', 'Уход за шеей и декольте', 45, 'Уход'],
      ['esthetician_eye', 'Уход за кожей вокруг глаз', 30, 'Уход'],
      ['esthetician_home_care', 'Подбор домашнего ухода', 30, 'Консультация']
    ],
    makeup_artist: [
      ['makeup_photo', 'Макияж для фотосессии', 90, 'Макияж'],
      ['makeup_creative', 'Креативный макияж', 120, 'Макияж'],
      ['makeup_mens', 'Мужской макияж для съёмки', 45, 'Макияж'],
      ['makeup_lesson', 'Урок макияжа для себя', 120, 'Обучение'],
      ['makeup_lashes', 'Накладные ресницы к макияжу', 15, 'Дополнительно']
    ],
    depilation_artist: [
      ['depilation_arms', 'Депиляция: руки полностью', 45, 'Зоны'],
      ['depilation_forearms', 'Депиляция: руки до локтя', 30, 'Зоны'],
      ['depilation_thighs', 'Депиляция: бёдра', 30, 'Зоны'],
      ['depilation_back', 'Депиляция: спина', 45, 'Зоны'],
      ['depilation_chest', 'Депиляция: грудь', 30, 'Зоны'],
      ['depilation_abdomen', 'Депиляция: живот', 30, 'Зоны'],
      ['depilation_upper_lip', 'Депиляция: верхняя губа', 15, 'Зоны'],
      ['depilation_consultation', 'Консультация перед депиляцией', 20, 'Консультация']
    ],
    tattoo_piercing_artist: [
      ['tattoo_sketch', 'Разработка эскиза татуировки', 60, 'Тату'],
      ['tattoo_coverup_consult', 'Консультация по перекрытию тату', 45, 'Тату'],
      ['tattoo_small', 'Небольшая татуировка', 60, 'Тату'],
      ['piercing_jewelry_fit', 'Подбор украшения для пирсинга', 20, 'Пирсинг'],
      ['piercing_downsize', 'Установка более короткого украшения', 20, 'Пирсинг']
    ],
    spa_body_care: [
      ['spa_hand_care', 'SPA-уход для рук', 30, 'Уход за телом'],
      ['spa_body_mask', 'Маска для тела', 45, 'Уход за телом'],
      ['spa_aroma', 'Арома-уход за телом', 60, 'Уход за телом'],
      ['spa_hammam', 'Уход в хаммаме', 60, 'Программы'],
      ['spa_express', 'Экспресс-SPA', 30, 'Программы']
    ],
    fitness_yoga_coach: [
      ['fitness_strength', 'Силовая тренировка', 60, 'Фитнес'],
      ['fitness_functional', 'Функциональная тренировка', 60, 'Фитнес'],
      ['fitness_pilates', 'Индивидуальный пилатес', 60, 'Практики'],
      ['fitness_pair', 'Парная тренировка', 60, 'Фитнес'],
      ['yoga_beginner', 'Йога для начинающих', 60, 'Йога'],
      ['fitness_online', 'Онлайн-тренировка', 60, 'Фитнес'],
      ['fitness_technique', 'Разбор техники упражнений', 45, 'Консультация']
    ]
  };
  for (const profession of catalog.professions) profession.services.push(...additions[profession.id]);
  catalog.professions.push(
    { id:'tire_fitter', label:'Шиномонтажник', shortLabel:'Шиномонтаж', services:[
      ['tire_seasonal', 'Сезонная смена колёс', 60, 'Комплекс'],
      ['tire_remove_fit', 'Снятие и установка колеса', 15, 'Колёса'],
      ['tire_mount', 'Монтаж шины на диск', 20, 'Шины'],
      ['tire_dismount', 'Демонтаж шины с диска', 20, 'Шины'],
      ['tire_balance', 'Балансировка колеса', 20, 'Колёса'],
      ['tire_puncture', 'Ремонт прокола шины', 30, 'Ремонт'],
      ['tire_valve', 'Замена вентиля', 20, 'Ремонт'],
      ['tire_leak_check', 'Проверка герметичности колеса', 20, 'Диагностика'],
      ['tire_rotation', 'Перестановка колёс', 30, 'Колёса'],
      ['tire_pressure', 'Проверка давления и подкачка', 15, 'Колёса'],
      ['tire_storage', 'Приём колёс на сезонное хранение', 20, 'Хранение'],
      ['tire_sensor', 'Замена датчика давления в колесе', 30, 'Ремонт']
    ]},
    { id:'auto_mechanic', label:'Автомеханик / автосервис', shortLabel:'Автосервис', services:[
      ['auto_diagnostics', 'Компьютерная диагностика автомобиля', 60, 'Диагностика'],
      ['auto_suspension', 'Диагностика подвески', 45, 'Диагностика'],
      ['auto_oil', 'Замена моторного масла и фильтра', 60, 'Обслуживание'],
      ['auto_air_filter', 'Замена воздушного фильтра', 20, 'Обслуживание'],
      ['auto_cabin_filter', 'Замена салонного фильтра', 30, 'Обслуживание'],
      ['auto_pads', 'Замена тормозных колодок', 90, 'Тормоза'],
      ['auto_discs', 'Замена тормозных дисков', 120, 'Тормоза'],
      ['auto_brake_fluid', 'Замена тормозной жидкости', 60, 'Тормоза'],
      ['auto_spark_plugs', 'Замена свечей зажигания', 60, 'Обслуживание'],
      ['auto_battery', 'Проверка и замена аккумулятора', 30, 'Электрика'],
      ['auto_lamps', 'Замена автомобильных ламп', 30, 'Электрика'],
      ['auto_coolant', 'Замена охлаждающей жидкости', 60, 'Обслуживание']
    ]},
    { id:'auto_detailer', label:'Детейлер / автомойка', shortLabel:'Детейлинг', services:[
      ['detail_body_wash', 'Мойка кузова', 45, 'Мойка'],
      ['detail_complex_wash', 'Комплексная мойка автомобиля', 90, 'Мойка'],
      ['detail_interior', 'Уборка салона', 45, 'Салон'],
      ['detail_dry_clean', 'Химчистка салона', 240, 'Салон'],
      ['detail_seats', 'Химчистка сидений', 120, 'Салон'],
      ['detail_leather', 'Очистка и уход за кожей салона', 90, 'Салон'],
      ['detail_body_polish', 'Полировка кузова', 240, 'Кузов'],
      ['detail_headlights', 'Полировка фар', 60, 'Кузов'],
      ['detail_wax', 'Защитное покрытие воском', 60, 'Защита'],
      ['detail_ceramic', 'Нанесение керамического покрытия', 240, 'Защита'],
      ['detail_glass', 'Водоотталкивающее покрытие стёкол', 45, 'Защита'],
      ['detail_wheels', 'Очистка дисков и уход за шинами', 45, 'Мойка']
    ]},
    { id:'pet_groomer', label:'Грумер', shortLabel:'Груминг', services:[
      ['groom_dog_full', 'Комплексный уход за собакой', 120, 'Комплекс'],
      ['groom_cat_full', 'Комплексный уход за кошкой', 90, 'Комплекс'],
      ['groom_dog_cut', 'Стрижка собаки', 90, 'Стрижки'],
      ['groom_hygiene', 'Гигиеническая стрижка', 45, 'Стрижки'],
      ['groom_trimming', 'Тримминг', 120, 'Шерсть'],
      ['groom_shedding', 'Экспресс-линька', 90, 'Шерсть'],
      ['groom_wash', 'Мытьё и сушка', 60, 'Шерсть'],
      ['groom_detangle', 'Разбор колтунов', 45, 'Шерсть'],
      ['groom_nails', 'Подстригание когтей', 15, 'Гигиена'],
      ['groom_ears', 'Гигиеническая чистка ушей', 15, 'Гигиена'],
      ['groom_paws', 'Уход за лапами', 20, 'Гигиена'],
      ['groom_intro', 'Знакомство щенка с грумингом', 30, 'Адаптация']
    ]},
    { id:'tutor', label:'Репетитор', shortLabel:'Обучение', services:[
      ['tutor_intro', 'Знакомство и определение уровня', 30, 'Консультация'],
      ['tutor_individual', 'Индивидуальное занятие', 60, 'Занятия'],
      ['tutor_pair', 'Парное занятие', 60, 'Занятия'],
      ['tutor_group', 'Занятие в мини-группе', 60, 'Занятия'],
      ['tutor_online', 'Онлайн-занятие', 60, 'Занятия'],
      ['tutor_homework', 'Разбор домашнего задания', 60, 'Школьная программа'],
      ['tutor_gaps', 'Разбор сложной темы', 60, 'Школьная программа'],
      ['tutor_oge', 'Подготовка к ОГЭ', 90, 'Экзамены'],
      ['tutor_ege', 'Подготовка к ЕГЭ', 90, 'Экзамены'],
      ['tutor_mock_exam', 'Пробный экзамен с разбором', 120, 'Экзамены'],
      ['tutor_conversation', 'Разговорная практика языка', 60, 'Языки'],
      ['tutor_school_ready', 'Подготовка к школе', 45, 'Школьная программа']
    ]},
    { id:'photographer', label:'Фотограф', shortLabel:'Фотография', services:[
      ['photo_portrait', 'Индивидуальная фотосессия', 60, 'Люди'],
      ['photo_family', 'Семейная фотосессия', 90, 'Люди'],
      ['photo_couple', 'Фотосессия пары', 60, 'Люди'],
      ['photo_children', 'Детская фотосессия', 60, 'Люди'],
      ['photo_business', 'Деловой портрет', 60, 'Люди'],
      ['photo_wedding', 'Свадебная съёмка', 240, 'События'],
      ['photo_event', 'Репортажная съёмка мероприятия', 120, 'События'],
      ['photo_product', 'Предметная съёмка', 120, 'Коммерческая съёмка'],
      ['photo_food', 'Фуд-фотография', 120, 'Коммерческая съёмка'],
      ['photo_interior', 'Интерьерная съёмка', 120, 'Коммерческая съёмка'],
      ['photo_content', 'Контент-съёмка для бизнеса', 120, 'Коммерческая съёмка'],
      ['photo_consultation', 'Подготовка и консультация перед съёмкой', 30, 'Консультация']
    ]},
    { id:'device_repair', label:'Мастер по ремонту техники', shortLabel:'Ремонт техники', services:[
      ['repair_diagnostics', 'Диагностика устройства', 60, 'Диагностика'],
      ['repair_phone_display', 'Замена дисплея телефона', 90, 'Телефоны'],
      ['repair_phone_battery', 'Замена аккумулятора телефона', 60, 'Телефоны'],
      ['repair_phone_port', 'Ремонт разъёма зарядки', 90, 'Телефоны'],
      ['repair_laptop_clean', 'Чистка ноутбука и замена термопасты', 90, 'Компьютеры'],
      ['repair_keyboard', 'Замена клавиатуры ноутбука', 90, 'Компьютеры'],
      ['repair_storage', 'Замена или установка накопителя', 60, 'Компьютеры'],
      ['repair_memory', 'Установка оперативной памяти', 30, 'Компьютеры'],
      ['repair_os', 'Установка операционной системы', 120, 'Настройка'],
      ['repair_software', 'Установка и настройка программ', 60, 'Настройка'],
      ['repair_data_transfer', 'Перенос данных на новое устройство', 120, 'Настройка'],
      ['repair_router', 'Настройка роутера и Wi-Fi', 60, 'Настройка']
    ]},
    { id:'cleaner', label:'Специалист по клинингу', shortLabel:'Клининг', services:[
      ['clean_regular', 'Поддерживающая уборка квартиры', 180, 'Уборка'],
      ['clean_deep', 'Генеральная уборка', 240, 'Уборка'],
      ['clean_renovation', 'Уборка после ремонта', 300, 'Уборка'],
      ['clean_move', 'Уборка при переезде', 240, 'Уборка'],
      ['clean_office', 'Уборка офиса', 180, 'Уборка'],
      ['clean_windows', 'Мытьё окон', 120, 'Дополнительно'],
      ['clean_kitchen', 'Уборка кухни', 90, 'По зонам'],
      ['clean_bathroom', 'Уборка санузла', 60, 'По зонам'],
      ['clean_oven', 'Чистка духовки', 45, 'Дополнительно'],
      ['clean_fridge', 'Мытьё холодильника', 45, 'Дополнительно'],
      ['clean_sofa', 'Химчистка дивана', 120, 'Мягкая мебель'],
      ['clean_mattress', 'Химчистка матраса', 90, 'Мягкая мебель']
    ]}
  );
  const aliases = {
    massage_therapist:'массаж массажистка', nail_artist:'маникюр педикюр ногти',
    hair_stylist:'парикмахерская стрижка колорист окрашивание', barber:'барбершоп борода мужская стрижка',
    brow_artist:'брови бровистка', lash_artist:'ресницы лешмейкер lash', esthetician:'косметология лицо эстетист',
    makeup_artist:'макияж визаж', depilation_artist:'шугаринг воск депиляция', tattoo_piercing_artist:'татуировщик тату мастер пирсер',
    spa_body_care:'спа spa тело', fitness_yoga_coach:'фитнес йога пилатес тренер инструктор',
    tire_fitter:'шиномонтаж шины колёса резина балансировка', auto_mechanic:'сто механик ремонт авто автомобиль',
    auto_detailer:'детейлинг детейлер мойщик автомойка полировка', pet_groomer:'груминг грумер собаки кошки животные',
    tutor:'учитель педагог преподаватель репетиторство обучение', photographer:'фотография фотосессия съёмка',
    device_repair:'ремонтник техника телефон смартфон ноутбук компьютер сервис', cleaner:'клинер уборщик уборщица клининг уборка'
  };
  catalog.professions = catalog.professions.map(profession => Object.freeze({
    ...profession,
    aliases: aliases[profession.id],
    services: Object.freeze(profession.services.map(([id, name, defaultDuration, category], rank) => Object.freeze({
      id, professionId: profession.id, name, defaultDuration, category, rank
    })))
  }));

  const professionsById = new Map(catalog.professions.map(item => [item.id, item]));
  const presetsById = new Map(catalog.professions.flatMap(item => item.services).map(item => [item.id, item]));
  const normalizeName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase(catalog.locale);
  const profession = id => professionsById.get(String(id || '')) || null;
  const preset = id => presetsById.get(String(id || '')) || null;
  const servicesFor = ids => [...new Set((Array.isArray(ids) ? ids : []).map(String))].flatMap(id => profession(id)?.services || []);
  const searchWords = value => normalizeName(value).replaceAll('ё', 'е').split(/\s+/).filter(Boolean);
  const matches = (text, words) => words.every(word => normalizeName(text).replaceAll('ё', 'е').includes(word));
  const searchProfessions = query => catalog.professions.filter(item => matches(`${item.label} ${item.shortLabel} ${item.aliases}`, searchWords(query)));
  const search = (query, ids) => {
    const words = searchWords(query);
    const source = ids?.length ? servicesFor(ids) : [...presetsById.values()];
    return words.length ? source.filter(item => matches(`${item.name} ${item.category}`, words)) : source;
  };

  window.MinutaServicePresetCatalog = Object.freeze({
    ...catalog,
    professions: Object.freeze(catalog.professions),
    profession,
    preset,
    servicesFor,
    search,
    searchProfessions,
    normalizeName
  });
})();
