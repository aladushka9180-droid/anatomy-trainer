import fs from 'node:fs';

const read = name => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const css = read('styles.css');
const js = read('provider.js');
const html = read('provider.html');

const checks = [
  [css.includes('.provider-body[data-provider-theme][data-provider-layout] .day-timeline { grid-template-columns:44px minmax(0,1fr); }'), 'единая мобильная шкала 44 px'],
  [css.includes('.clients-layout:not(.is-detail) .client-profile'), 'общий mobile master-detail клиентов'],
  [css.includes('.mobile-more-grid button[hidden] { display:none!important; }'), 'скрытие дублей в разделе «Все разделы»'],
  [css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'), 'сетка периодов 3×2'],
  [css.includes('.report-smart-actions .report-smart-action { display:none;'), 'свёрнутые мобильные рекомендации'],
  [css.includes('.notification-filters button.active { color:var(--theme-accent-contrast,#fff)!important; }'), 'контраст фильтров уведомлений'],
  [js.includes("button.hidden = selected.includes(button.dataset.providerView);"), 'синхронизация меню с нижней навигацией'],
  [js.includes('Рекомендации · ${visibleActions.length}'), 'понятный счётчик рекомендаций'],
  [html.includes('Откроются контакты, история и заметки.'), 'нейтральная мобильная подсказка клиента']
];

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) {
  console.error(`Mobile minimalism v313 failed: ${failed.join(', ')}`);
  process.exit(1);
}

console.log('Mobile minimalism v313: OK');
