"use strict";

/**
 * Проверенные учебные и нормативные источники.
 *
 * Записи описывают назначение источника, но не копируют его содержание.
 * Перед обновлением медицинских правил необходимо повторно проверить
 * актуальность нормативных актов и локальных клинических протоколов.
 */
const LEARNING_SOURCES = Object.freeze([
  Object.freeze({
    id: "fipat-ta2",
    category: "anatomy",
    title: "FIPAT — Terminologia Anatomica, 2nd edition (TA2)",
    organization: "Federative International Programme for Anatomical Terminology",
    url: "https://fipat.library.dal.ca/wp-content/uploads/2021/08/FIPAT-TA2-Part-1.pdf",
    purpose: "Международная эталонная анатомическая терминология: названия областей, костей, суставов, мышц, сосудов и нервов."
  }),
  Object.freeze({
    id: "openstax-ap2",
    category: "anatomy",
    title: "OpenStax — Anatomy and Physiology 2e",
    organization: "OpenStax, Rice University",
    url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/1-introduction",
    purpose: "Проверка базовых сведений по строению и функциям систем человеческого тела; открытый рецензируемый учебник."
  }),
  Object.freeze({
    id: "openstax-joints",
    category: "kinesiology",
    title: "OpenStax — Joints",
    organization: "OpenStax, Rice University",
    url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/9-introduction",
    purpose: "Классификация суставов, направления движений, взаимосвязь подвижности и стабильности."
  }),
  Object.freeze({
    id: "openstax-muscular-system",
    category: "kinesiology",
    title: "OpenStax — The Muscular System",
    organization: "OpenStax, Rice University",
    url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/11-introduction",
    purpose: "Действия мышц, начала и прикрепления, агонисты, антагонисты и совместная работа мышц при движении."
  }),
  Object.freeze({
    id: "mintrud-744n",
    category: "contraindications",
    title: "Профессиональный стандарт «Специалист по медицинскому массажу»",
    organization: "Министерство труда и социальной защиты Российской Федерации",
    url: "https://rg.ru/documents/2018/12/15/mintrud-prikaz-744n-site-dok.html",
    purpose: "Трудовые функции специалиста: обследование перед процедурой, выбор и дозирование методики, контроль состояния, документация и экстренная помощь."
  }),
  Object.freeze({
    id: "rostgmu-massage-2025",
    category: "contraindications",
    title: "Дополнительная профессиональная программа «Медицинский массаж», 144 часа",
    organization: "ФГБОУ ВО РостГМУ Минздрава России",
    url: "https://rostgmu.ru/wp-content/uploads/2025/09/%D0%94%D0%9F%D0%9F-%D0%9F%D0%9A-%D0%9C%D0%B5%D0%B4%D0%B8%D1%86%D0%B8%D0%BD%D1%81%D0%BA%D0%B8%D0%B9-%D0%BC%D0%B0%D1%81%D1%81%D0%B0%D0%B6-144-%D1%87%D0%B0%D1%81%D0%B0.pdf",
    purpose: "Учебная рамка по показаниям, специфическим противопоказаниям, нежелательным реакциям, санитарно-гигиеническому обеспечению и безопасности пациента."
  }),
  Object.freeze({
    id: "federal-law-323",
    category: "professional-boundaries",
    title: "Федеральный закон № 323-ФЗ «Об основах охраны здоровья граждан в Российской Федерации»",
    organization: "Российская Федерация; публикация Министерства здравоохранения Российской Федерации",
    url: "https://minzdrav.gov.ru/documents/7025-federalnyy-zakon-323-fz-ot-21-noyabrya-2011-g",
    purpose: "Границы профессиональной деятельности, работа в соответствии с квалификацией и должностными обязанностями, медицинская этика и конфиденциальность."
  }),
  Object.freeze({
    id: "minzdrav-first-aid-220n",
    category: "red-flags",
    title: "Порядок оказания первой помощи, приказ Минздрава России № 220н",
    organization: "Министерство здравоохранения Российской Федерации",
    url: "https://publication.pravo.gov.ru/document/0001202405310015",
    purpose: "Официальная рамка действий при состояниях, требующих первой помощи; используется для учебных правил остановки процедуры и вызова помощи."
  }),
  Object.freeze({
    id: "who-hand-hygiene",
    category: "hygiene",
    title: "WHO Guidelines on Hand Hygiene in Health Care",
    organization: "World Health Organization",
    url: "https://www.who.int/publications/i/item/9789241597906",
    purpose: "Авторитетные рекомендации по гигиене рук и снижению передачи микроорганизмов при оказании помощи."
  })
]);

const CONTENT_REVIEW = Object.freeze({
  checkedAt: "2026-08-29",
  status: "reviewed",
  scope: Object.freeze([
    "анатомия",
    "кинезиология",
    "противопоказания и красные флаги",
    "гигиена",
    "профессиональные границы"
  ]),
  safetyNotice: "Материалы тренажёра предназначены только для обучения и повторения. Они не заменяют очное профессиональное обучение, практику под руководством преподавателя, клиническое обследование или диагностику.",
  redFlagAction: "При появлении красных флагов процедуру прекращают и рекомендуют обратиться за медицинской помощью; при признаках угрозы жизни вызывают экстренную помощь по действующему алгоритму.",
  editorialRules: Object.freeze([
    "Не ставить диагноз по жалобе, изображению или результату тренировки.",
    "Не предлагать самостоятельно назначать, отменять или изменять лечение.",
    "Не представлять заболевание или состояние как безусловное абсолютное противопоказание без клинического контекста и актуального источника.",
    "Формулировать вопросы о рисках как безопасный выбор: остановить процедуру, оценить состояние и направить к медицинскому специалисту.",
    "Различать общую учебную анатомию и действия, требующие квалификации специалиста по медицинскому массажу.",
    "При расхождении учебного материала с актуальным назначением врача, локальным протоколом или нормативным актом применять актуальные официальные требования."
  ]),
  reviewNote: "Проверка подтверждает пригодность источников как опоры для учебного контента, но не является клиническим заключением или разрешением на выполнение конкретной процедуры."
});

if (typeof globalThis !== "undefined") {
  globalThis.LEARNING_SOURCES = LEARNING_SOURCES;
  globalThis.CONTENT_REVIEW = CONTENT_REVIEW;
}
