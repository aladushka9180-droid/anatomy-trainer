import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = read('provider.html');
const script = read('provider.js');
const styles = read('provider-schedule-minimal.css');
const worker = read('sw.js');

assert.match(html, /provider-schedule-minimal\.css\?v=\d+/);
assert.match(worker, /\.\/provider-schedule-minimal\.css\?v=\d+/);
assert.match(html, /class="date-strip-frame"[\s\S]*data-date-shift="-7"[\s\S]*id="dateStrip"[\s\S]*data-date-shift="7"/);
assert.match(styles, /\.date-navigation:has\(\[data-calendar-view="day"\]\.active\)>\.date-nav-button\s*\{[^}]*display:none!important;/s);
assert.match(styles, /\.date-strip-shift\[data-date-shift="-7"\]\s*\{[^}]*left:8px;/s);
assert.match(styles, /\.date-strip-shift\[data-date-shift="7"\]\s*\{[^}]*right:8px;/s);
assert.match(styles, /@media \(min-width:761px\)[\s\S]*\.booking-sheet\s*\{[^}]*place-items:center;[\s\S]*\.booking-sheet-panel\s*\{[^}]*margin-bottom:0;/s);
assert.match(styles, /@media \(max-width:760px\)[\s\S]*scroll-behavior:smooth;[\s\S]*overscroll-behavior-x:contain;/s);
assert.match(script, /const swipeSurface = event\.target\.closest\('#providerBookings,#dateStrip'\)/);
assert.match(script, /if \(dateShift\) shiftScheduleDate\(Number\(dateShift\.dataset\.dateShift\)\)/);
assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i, 'Новая геометрия не должна добавлять отдельную палитру');

console.log('Provider minimal schedule controls: OK');
