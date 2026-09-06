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
assert.match(styles, /\.date-strip-frame>\.date-strip\s*\{[^}]*box-sizing:border-box;/s);
assert.match(styles, /not\(\[data-provider-layout="split"\]\)[\s\S]*\.schedule-card:has\(#dateStrip:not\(\[hidden\]\)\)[\s\S]*border-radius:0!important;/s);
assert.match(styles, /@media \(min-width:761px\)[\s\S]*\.booking-sheet\s*\{[^}]*place-items:center;[\s\S]*\.booking-sheet-panel\s*\{[^}]*margin-bottom:0;/s);
assert.match(styles, /@media \(max-width:760px\)[\s\S]*scroll-behavior:auto;[\s\S]*overscroll-behavior-x:contain;/s);
assert.match(styles, /data-provider-theme\][\s\S]*--schedule-entry-fill-weight:18%;[\s\S]*--schedule-break-surface-weight:78%;/s);
assert.match(styles, /data-provider-theme="midnight"[\s\S]*--schedule-entry-fill-weight:30%;[\s\S]*--schedule-break-surface-weight:68%;/s);
assert.match(styles, /data-provider-theme\][\s\S]*timeline-booking:not\(\.status-block\):not\(\.automatic-break\)[\s\S]*var\(--booking-tone,var\(--calendar-week-marker,var\(--theme-accent\)\)\)[\s\S]*var\(--schedule-entry-fill-weight\)[\s\S]*inset 3px 0 0/s);
assert.match(styles, /calendar-overview-booking:not\(\.status-block\)[\s\S]*calendar-week-booking:not\(\.is-block\)/s);
assert.match(styles, /#providerBookings\.calendar-overview-month \.calendar-overview-booking:not\(\.status-block\)[\s\S]*var\(--schedule-entry-fill-weight\)[\s\S]*inset 2px 0 0/s);
assert.match(styles, /data-provider-theme\][\s\S]*timeline-booking\.status-block[\s\S]*var\(--schedule-break-surface-weight\)[\s\S]*background-image:none!important;[\s\S]*color:color-mix\(in srgb,var\(--theme-muted\) 72%,var\(--theme-ink\)\)!important;/s);
assert.match(styles, /data-provider-theme\][\s\S]*timeline-booking\.status-block[\s\S]*timeline-booking-copy>strong::before[\s\S]*linear-gradient\(90deg,currentColor/s);
assert.match(styles, /#providerBookings\.calendar-overview-month \.calendar-overview-booking\.status-block[\s\S]*var\(--schedule-break-surface-weight\)[\s\S]*box-shadow:none!important;/s);
assert.match(script, /const swipeSurface = event\.target\.closest\('#providerBookings'\)/);
assert.match(script, /if \(dateShift\) shiftScheduleDate\(Number\(dateShift\.dataset\.dateShift\)\)/);
assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i, 'Новая геометрия не должна добавлять отдельную палитру');

console.log('Provider minimal schedule controls: OK');
