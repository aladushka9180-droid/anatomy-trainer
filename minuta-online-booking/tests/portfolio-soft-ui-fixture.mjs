import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const scriptText = text => text.replace(/<\/script/gi, '<\\/script');
const source = read('provider.js');
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const html = read('provider.html');
const section = html.match(/<section class="provider-view" data-provider-panel="portfolio" hidden>[\s\S]*?\n        <\/section>/)?.[0].replace('data-provider-panel="portfolio" hidden', 'data-provider-panel="portfolio"').replaceAll('ui-icons.svg#', '#');
const actions = html.match(/<dialog[^>]+id="portfolioActionDialog"[\s\S]*?<\/dialog>/)?.[0].replaceAll('ui-icons.svg#', '#');
const sidebar = html.match(/<aside class="provider-sidebar">[\s\S]*?<\/aside>/)?.[0].replaceAll('ui-icons.svg#', '#').replaceAll('ui-icons.svg?v=1023#', '#').replace('class="active" type="button" data-provider-view="bookings"','type="button" data-provider-view="bookings"').replace('type="button" data-provider-view="portfolio"','class="active" type="button" data-provider-view="portfolio"');
if (!section || !actions || !sidebar) throw Error('Actual portfolio markup missing');
const reviewHandler = part('  if (reviewVisibility) {', '  if (toggle) {');
const productionFunctions = [part('function portfolioPhoto(item, type)', 'function portfolioActionMarkup('), part('function portfolioActionMarkup(', 'async function signedPortfolioUrl('), part('function renderProviderReviews()', 'async function loadProviderReviews()')].join('\n');
export function portfolioSoftFixture({ photos = [] } = {}) {
  const fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="600" height="450" fill="#d6ccc5"/></svg>');
  const images = [photos[0] || fallback, photos[1] || fallback];
  const sprite = read('ui-icons.svg').replace('<svg ', '<svg style="display:none" aria-hidden="true" ');
  const soft = read('portfolio-soft-ui.js').replaceAll('ui-icons.svg?v=1023#', '#');
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Портфолио — изолированная проверка</title><style>${read('styles.css')}\n${read('provider-portfolio-responsive.css')}\n${read('portfolio-soft-ui.css')}\nbody{margin:0;padding:0}.fixture-shell{max-width:1160px;width:100%;margin:auto}.fixture-tools{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}.fixture-tools button,.fixture-tools select{min-height:44px;padding:8px 12px}.fixture-notice{font-size:14px;margin:12px 0;min-height:20px}</style><body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="soft">${sprite}<main class="provider-main"><div id="dashboard" class="provider-app" data-active-view="portfolio">${sidebar}<div class="provider-workspace"><div class="fixture-shell"><div class="fixture-tools"><button type="button" id="fixtureFilled">Примеры</button><button type="button" id="fixtureEmpty">Пустой раздел</button><button type="button" id="fixtureError">Ошибка загрузки</button><button type="button" id="fixtureFailWrite">Ошибка следующей публикации</button><select aria-label="Тема примера" id="fixtureTheme"><option value="pink-porcelain">Розовый фарфор</option><option value="graphite">Графит</option><option value="sage">Шалфей</option></select></div><p class="fixture-notice" role="status" id="fixtureNotice">Изолированная проверка; рабочая база не подключена.</p>${section}</div></div><nav class="provider-mobile-nav"><button><span>Записи</span></button><button><span>Клиенты</span></button><button><span>Уведомления</span></button><button><span>Статистика</span></button><button><span>Разделы</span></button></nav></div></main>${actions}<script>${scriptText(read('theme-catalog.js'))}</script><script>${scriptText(soft)}</script><script>
window.fetch=()=>{throw Error('Network forbidden in isolated fixture')};
window.XMLHttpRequest=function(){throw Error('Network forbidden in isolated fixture')};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const applyFixtureTheme=key=>{const palette=MinutaThemeCatalog.paletteForSettings({theme_key:key});document.body.dataset.providerTheme=key;for(const [name,value] of Object.entries(palette)){if(typeof value==='string')document.body.style.setProperty('--theme-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value)}document.body.style.backgroundColor=palette.bg;document.body.style.color=palette.ink};
$('#fixtureTheme').addEventListener('change',event=>applyFixtureTheme(event.target.value));
applyFixtureTheme('pink-porcelain');
const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uiIcon=name=>'<svg class="ui-icon" aria-hidden="true"><use href="#icon-'+name+'"></use></svg>';
const notify=text=>{$('#fixtureNotice').textContent=text};
let portfolioItems=[],portfolioRemoteAvailable=true,providerReviews=[],providerReviewsState='ready',portfolioActionTrigger=null,portfolioActionReturnFocus=true,failWrite=false;
const applyWriteAvailability=()=>{};
const openPortfolioEditor=id=>notify('Открыть редактор: '+id);
const images=${JSON.stringify(images)};
const sampleWorks=()=>[
{id:'pair',procedure_name:'Пример оформления «До / После»',body_area:'Демонстрация',session_count:6,published:true,consent_confirmed_at:'2026-09-01',photos:[{photo_type:'before',signed_url:images[0]},{photo_type:'after',signed_url:images[1]}]},
{id:'single',procedure_name:'Массаж шеи и плеч',body_area:'Шея и плечи',published:false,consent_confirmed_at:null,photos:[{photo_type:'after',signed_url:images[0]}]},
{id:'before-only',procedure_name:'Очень длинное название процедуры для проверки переносов',body_area:'Спина',published:true,consent_confirmed_at:'2026-09-01',photos:[{photo_type:'before',signed_url:images[1]}]}
];
const sampleReviews=()=>[{review_id:'published',client_name:'Алина',service_name:'Массаж спины',created_at:'2026-10-02',rating:5,review_text:'Спасибо за внимательное отношение. Всё прошло спокойно и комфортно.',published:true},{review_id:'hidden',client_name:'Ольга',service_name:'Расслабляющий массаж',created_at:'2026-10-02',rating:4,review_text:'Удобная запись и приятная атмосфера. Спасибо!',published:false}];
const db={rpc:async(name,args)=>{if(failWrite){failWrite=false;throw Error('synthetic offline')};const r=providerReviews.find(r=>r.review_id===args.p_review);if(r)r.published=args.p_published;return {error:null}}};
const loadProviderReviews=async()=>renderProviderReviews();
${scriptText(productionFunctions)}
const filled=()=>{portfolioItems=sampleWorks();providerReviews=sampleReviews();providerReviewsState='ready';portfolioRemoteAvailable=true;renderPortfolio();renderProviderReviews()};
// Real provider lifecycle signal/order (handleSession, provider.js): reset is
// emitted before dashboard/portfolio state changes; existing card DOM remains.
window.portfolioFixtureSessionReset=kind=>{
 window.dispatchEvent(new CustomEvent('minuta:provider-session-reset'));
 if(kind!=='actor-switch'){
  $('#dashboard').hidden=true;
  portfolioItems=[];providerReviews=[];providerReviewsState='idle';portfolioRemoteAvailable=false;
 }
};
window.portfolioFixtureLoadActor=()=>{
 portfolioItems=sampleWorks().map(item=>({...item,id:'actor-b-'+item.id,procedure_name:'Другой исполнитель — '+item.procedure_name}));
 providerReviews=sampleReviews().map(item=>({...item,review_id:'actor-b-'+item.review_id,client_name:'Другой клиент'}));
 providerReviewsState='ready';portfolioRemoteAvailable=true;$('#dashboard').hidden=false;
 renderPortfolio();renderProviderReviews();
};
$('#fixtureFilled').addEventListener('click',filled);
$('#fixtureEmpty').addEventListener('click',()=>{portfolioItems=[];providerReviews=[];providerReviewsState='ready';renderPortfolio();renderProviderReviews()});
$('#fixtureError').addEventListener('click',()=>{portfolioRemoteAvailable=false;providerReviews=[];providerReviewsState='error';renderPortfolio();renderProviderReviews()});
$('#fixtureFailWrite').addEventListener('click',()=>{failWrite=true;notify('Следующий запрос завершится ошибкой')});
document.addEventListener('click',async event=>{
 const trigger=event.target.closest('[data-portfolio-actions]');if(trigger){event.preventDefault();openPortfolioActions(trigger);return}
 if(event.target.closest('[data-close-portfolio-actions]')){closePortfolioActions();return}
 const edit=event.target.closest('[data-edit-portfolio]');if(edit){openPortfolioEditor(edit.dataset.editPortfolio);closePortfolioActions();return}
 const retry=event.target.closest('[data-retry-provider-reviews]');if(retry){providerReviews=sampleReviews();providerReviewsState='ready';renderProviderReviews();return}
 const reviewVisibility=event.target.closest('[data-review-visibility]');
 ${scriptText(reviewHandler)}
});
document.addEventListener('keydown',event=>{if(trapPortfolioActionFocus(event))return;if(event.key==='Escape'&&$('#portfolioActionDialog').open){event.preventDefault();closePortfolioActions()}});
$('#portfolioActionDialog').addEventListener('close',finishPortfolioActionClose);
$('#portfolioActionDialog').addEventListener('cancel',event=>{event.preventDefault();closePortfolioActions()});
window.addEventListener('resize',positionPortfolioActionDialog);
filled();
</script></body></html>`;
}
