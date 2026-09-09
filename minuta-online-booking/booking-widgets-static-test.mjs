import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('.', import.meta.url);
const source = readFileSync(new URL('booking-widgets.js', root), 'utf8');
const app = readFileSync(new URL('app.js', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const providerHtml = readFileSync(new URL('provider.html', root), 'utf8');
const clientHtml = readFileSync(new URL('index.html', root), 'utf8');
const serviceWorker = readFileSync(new URL('sw.js', root), 'utf8');

const classNames = new Set();
const document = {
  documentElement:{
    classList:{ toggle(name, active) { if (active) classNames.add(name); else classNames.delete(name); } },
    dataset:{}
  },
  body:{ scrollHeight:0 },
  querySelectorAll:() => [],
  createElement:() => ({ style:{}, select() {}, remove() {} })
};
const location = new URL('https://example.test/minuta-online-booking/provider.html');
const window = { location, parent:null, top:null, self:null, addEventListener() {}, MinutaBookingWidgets:null };
window.parent = window; window.top = window; window.self = window;
const context = vm.createContext({ window, document, location, URL, URLSearchParams, console, ResizeObserver:undefined });
vm.runInContext(source, context, { filename:'booking-widgets.js' });
const api = window.MinutaBookingWidgets;
assert.ok(api);

const ids = {
  service:'11111111-1111-4111-8111-111111111111',
  provider:'22222222-2222-4222-8222-222222222222',
  branch:'33333333-3333-4333-8333-333333333333',
  group:'44444444-4444-4444-8444-444444444444'
};
assert.deepEqual({ ...api.readRequest(`?service=${ids.service}&provider=${ids.provider}&location=${ids.branch}&group=${ids.group}&embed=1`) }, {
  serviceId:ids.service, providerId:ids.provider, branchId:ids.branch, groupId:ids.group, embed:true
});
assert.equal(api.readRequest('?service=foreign').serviceId, '');

for (const [target,id,parameter] of [
  ['service',ids.service,'service'], ['provider',ids.provider,'provider'], ['branch',ids.branch,'location'], ['group',ids.group,'group']
]) {
  const link = api.buildUrl('index.html', { slug:'studio-one', target, id, mode:'link', source:'telegram' });
  assert.equal(link.searchParams.get('org'), 'studio-one');
  assert.equal(link.searchParams.get(parameter), id);
  assert.equal(link.searchParams.get('utm_medium'), 'shared_link');
  assert.equal(link.searchParams.get('utm_source'), 'telegram');
  assert.equal(link.searchParams.get('utm_campaign'), `booking_link_${target}_${id}`);
  assert.equal(link.searchParams.get('utm_content'), `${target}:${id}`);
}
const widget = api.buildUrl('index.html', { slug:'studio-one', target:'service', id:ids.service, mode:'widget' });
assert.equal(widget.searchParams.get('embed'), '1');
assert.equal(widget.searchParams.get('utm_medium'), 'embed');
assert.equal(widget.searchParams.get('utm_campaign'), `booking_widget_service_${ids.service}`);
const code = api.embedCode(widget, 'Студия "Тест"');
assert.match(code, /^<iframe /);
assert.match(code, /loading="lazy"/);
assert.match(code, /sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"/);
assert.match(code, /referrerpolicy="strict-origin-when-cross-origin"/);
assert.match(code, /<script>.*primetime:resize.*<\/script>$/);
assert.doesNotMatch(code, /javascript:/i);
api.applyEmbedPresentation(api.readRequest('?embed=1'));
assert.ok(classNames.has('booking-embed'));

assert.match(app, /requestedPerformerId/);
assert.match(app, /requestedGroupId/);
assert.match(app, /rejectRequestedBookingLink/);
assert.match(app, /persistSession:\s*false/);
assert.match(provider, /getBookingWidgetContext/);
assert.match(providerHtml, /id="bookingWidgetsDialog"/);
assert.match(providerHtml, /id="bookingWidgetSource"/);
assert.match(providerHtml, /class="booking-widget-preview-frame" id="bookingWidgetPreview"/);
assert.doesNotMatch(providerHtml, /id="bookingWidgetPreview"[^>]*sandbox=/);
assert.match(providerHtml, /data-booking-widget-mode="widget"/);
assert.match(clientHtml, /booking-widgets\.js\?v=/);
assert.match(serviceWorker, /booking-widgets\.js\?v=/);

for (const [source,label] of [['yandex','Яндекс Карты'], ['google','Google Карты']]) {
  const mapLink = api.buildUrl('index.html', { slug:'studio-one', target:'general', mode:'link', source });
  assert.equal(mapLink.searchParams.get('utm_source'), source);
  assert.equal(mapLink.searchParams.get('utm_medium'), 'maps');
  assert.equal(mapLink.searchParams.get('utm_campaign'), 'maps_booking_general');
  assert.equal(mapLink.searchParams.get('utm_content'), 'general');
  assert.match(providerHtml, new RegExp(`<option value="${source}">${label}</option>`));
}

console.log('booking widgets static checks passed');
