import assert from 'node:assert/strict';
import fs from 'node:fs';

const provider = fs.readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(provider, /const PER_MINUTE_BOOKING_MIN = 1;/, 'exact duration starts at one minute');
assert.match(provider, /const PER_MINUTE_BOOKING_MAX = 480;/, 'exact duration is capped by the booking schema limit');
assert.match(provider, /id="newBookingDuration"[^>]+type="number"[^>]+step="1"/, 'manual booking exposes an integer duration input');
assert.match(provider, /\[15,30,45,60\]\.map\(value => `<button type="button" data-new-booking-duration="\$\{value\}"/, '15, 30, 45 and 60 minute presets are generated');
assert.match(provider, /duration \* Number\(service\.price_rub \|\| 0\)/, 'total price is recalculated from the minute rate');
assert.match(provider, /duration_minutes:duration,[\s\S]*original_price_rub:Number\(service\.price_rub \|\| 0\),[\s\S]*total_price_rub:totalPrice/, 'exact duration and calculated price are persisted');
assert.match(provider, /bookingPlacementIssue\(\{ id:'new-booking-candidate', duration_minutes:duration \}/, 'available start times are filtered using the selected duration');
assert.match(provider, /durationMinutes:item\.duration_minutes/, 'repeat booking preserves the exact duration');
assert.match(provider, /durationMinutes:\$\('#newBookingDuration'\)\?\.value/, 'unfinished form drafts preserve the exact duration');
assert.match(styles, /\.new-booking-minute-duration \{/, 'duration controls have a responsive visual container');
assert.match(styles, /\.provider-body\[data-provider-theme\] \.new-booking-minute-duration/, 'duration controls inherit every provider theme');

console.log('per-minute booking duration test passed');
