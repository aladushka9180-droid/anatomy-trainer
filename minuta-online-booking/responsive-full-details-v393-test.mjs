import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const [css, provider, app, html] = await Promise.all([
  readFile(new URL('styles.css', directory), 'utf8'),
  readFile(new URL('provider.js', directory), 'utf8'),
  readFile(new URL('app.js', directory), 'utf8'),
  readFile(new URL('index.html', directory), 'utf8')
]);

assert.match(provider, /provider-booking-top[\s\S]*provider-booking-client-line[\s\S]*provider-booking-phone[\s\S]*provider-booking-note-full/, 'карточка должна содержать название, имя, телефон и заметку');
assert.match(css, /schedule-list \.provider-booking-top h3 \{[\s\S]*overflow:visible!important;[\s\S]*white-space:normal!important;[\s\S]*-webkit-line-clamp:unset!important;/, 'название записи всё ещё обрезается');
assert.match(css, /schedule-list :is\([\s\S]*booking-client-name-row>strong,[\s\S]*provider-booking-phone,[\s\S]*provider-booking-note-full[\s\S]*overflow:visible!important;[\s\S]*white-space:normal!important;/, 'данные клиента всё ещё обрезаются');
assert.doesNotMatch(provider, /if \(!providerSectionMobileQuery\.matches\) \{[\s\S]*restoreProviderSectionDisclosure\(nav\)/, 'ПК-версия всё ещё показывает длинные разделы целиком');
assert.match(app, /async function shareCalendarFile[\s\S]*navigator\.canShare[\s\S]*navigator\.share/, 'нет передачи ICS в системное меню приложений');
assert.match(app, /async function addAndroidCalendar[\s\S]*androidCalendarIntent/, 'нет Android fallback в родной календарь');
assert.match(app, /async function addAppleCalendar[\s\S]*openCalendarFile/, 'нет iOS fallback для ICS');
assert.match(html, /id="saveSuccessCalendar"/, 'после создания записи отсутствует кнопка календаря');

console.log('Responsive full details and native calendar v400: OK');
