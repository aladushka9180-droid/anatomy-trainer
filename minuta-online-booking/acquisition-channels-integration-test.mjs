import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('.', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const widgets = read('booking-widgets.js');
const providerHtml = read('provider.html');
const app = read('app.js');
const provider = read('provider.js');
const funnelMigration = read('supabase-migration-v107.sql');

const document = {
  documentElement:{ classList:{ toggle() {} }, dataset:{} },
  body:{ scrollHeight:0 },
  querySelectorAll:() => [],
  createElement:() => ({ style:{}, select() {}, remove() {} })
};
const location = new URL('https://example.test/minuta-online-booking/provider.html');
const window = { location, parent:null, top:null, self:null, addEventListener() {}, MinutaBookingWidgets:null };
window.parent = window; window.top = window; window.self = window;
vm.runInContext(widgets, vm.createContext({ window, document, location, URL, URLSearchParams, console, ResizeObserver:undefined }), { filename:'booking-widgets.js' });

for (const [source,label] of [['yandex','Яндекс Карты'], ['google','Google Карты']]) {
  const link = window.MinutaBookingWidgets.buildUrl('index.html', { slug:'studio-one', source });
  assert.equal(link.origin, 'https://example.test');
  assert.equal(link.pathname, '/minuta-online-booking/index.html');
  assert.equal(link.searchParams.get('org'), 'studio-one');
  assert.equal(link.searchParams.get('utm_source'), source);
  assert.equal(link.searchParams.get('utm_medium'), 'maps');
  assert.equal(link.searchParams.get('utm_campaign'), 'maps_booking_general');
  assert.equal(link.searchParams.get('utm_content'), 'general');
  assert.match(providerHtml, new RegExp(`<option value="${source}">${label}</option>`));
}
const branchId = '33333333-3333-4333-8333-333333333333';
const branchLink = window.MinutaBookingWidgets.buildUrl('index.html', { slug:'studio-one', source:'yandex', target:'branch', id:branchId });
assert.equal(branchLink.searchParams.get('location'), branchId);
assert.equal(branchLink.searchParams.get('utm_campaign'), `maps_booking_branch_${branchId}`);
assert.equal(branchLink.searchParams.get('utm_content'), `branch:${branchId}`);
assert.equal(window.MinutaBookingWidgets.buildUrl('index.html', { slug:'studio-one', source:'javascript:alert(1)' }).searchParams.get('utm_source'), 'website');

assert.match(app, /\['yandex','google'\]\.includes\(source\)/, 'map sources must be classified as search acquisition');
assert.match(app, /p_utm_source:source\.utmSource \|\| null/);
assert.match(app, /p_utm_medium:source\.utmMedium \|\| null/);
assert.match(app, /p_utm_campaign:source\.utmCampaign \|\| null/);
assert.match(funnelMigration, /get_minuta_utm_funnel_v107/);
assert.match(funnelMigration, /group by source_kind,utm_source,utm_medium,utm_campaign/);
assert.match(provider, /names = \{ telegram:'Telegram', whatsapp:'WhatsApp', vk:'ВКонтакте', yandex:'Яндекс', google:'Google', qr:'QR-код' \}/);
assert.match(provider, /rowVisitors \? Math\.round\(bookings \/ rowVisitors \* 100\) : 0/);

const renderSource = provider.slice(
  provider.indexOf('const REPORT_UTM_METRIC_KEYS'),
  provider.indexOf('async function loadReportUtmFunnel')
);
assert.ok(renderSource.startsWith('const REPORT_UTM_METRIC_KEYS') && renderSource.includes('function renderReportUtmFunnel'));
const elements = Object.fromEntries(['reportUtmFunnelCard','reportUtmFunnelState','reportUtmFunnelStages','reportUtmFunnelOutcomes','reportUtmFunnelSources'].map(id => [id, { hidden:false, textContent:'', innerHTML:'' }]));
const renderContext = vm.createContext({
  reportDataSource:'own',
  reportUtmFunnelState:{ status:'ready', data:{
    totals:{ visitors:5, service_selected:3, slots_viewed:2, details_started:1, bookings:1, completed:1, cancelled:0, no_show:0, paid:1, revenue_rub:2500 },
    rows:[
      { source_kind:'search', utm_source:'yandex', utm_medium:'maps', utm_campaign:'maps_booking_general', visitors:1, bookings:1, revenue_rub:2500 },
      { source_kind:'search', utm_source:'google', utm_medium:'maps', utm_campaign:'maps_booking_general', visitors:1, bookings:0, revenue_rub:0 },
      { source_kind:'campaign', utm_source:'primetime_external_test', utm_medium:'embed', utm_campaign:'booking_widget', visitors:3, service_selected:1, bookings:0, revenue_rub:0 }
    ]
  } },
  $:selector => elements[selector.slice(1)],
  escapeHtml:value => String(value),
  money:value => `${Number(value).toLocaleString('ru-RU')} ₽`
});
vm.runInContext(`${renderSource}\nrenderReportUtmFunnel();`, renderContext, { filename:'provider-utm-render.js' });
assert.match(elements.reportUtmFunnelStages.innerHTML, /Открыли страницу[\s\S]*>2<[\s\S]*Создали запись[\s\S]*>1</);
assert.match(elements.reportUtmFunnelSources.innerHTML, /Яндекс · maps_booking_general[\s\S]*<b>100%<\/b>/);
assert.match(elements.reportUtmFunnelSources.innerHTML, /Google · maps_booking_general[\s\S]*<b>0%<\/b>/);
assert.match(elements.reportUtmFunnelSources.innerHTML, /Виджет онлайн-записи[\s\S]*Тестовые переходы с сайта · 3 посещения · не учитываются в показателях/);
assert.doesNotMatch(elements.reportUtmFunnelSources.innerHTML, /primetime_external_test|booking_widget|>embed</);
assert.match(elements.reportUtmFunnelStages.innerHTML, /Открыли страницу[\s\S]*>2<[\s\S]*Выбрали услугу[\s\S]*>0</, 'test traffic must not affect the visible funnel totals');

console.log('D11 acquisition channel integration checks passed');
