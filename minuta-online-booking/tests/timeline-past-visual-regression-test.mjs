import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const provider = readFileSync(join(root, 'provider.js'), 'utf8');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');

assert.match(provider, /\? ' is-past-booking'/, 'Past-time state must remain available to the schedule');
assert.doesNotMatch(styles, /\.timeline-booking\.is-past-booking[^\{]*\{[^}]*\b(?:opacity|filter)\s*:/s, 'Past-time state must not dim or desaturate a booking');
assert.match(styles, /\.timeline-booking\.is-current-booking/, 'The current-time indicator must remain styled separately');

console.log('Timeline past visual regression: cards retain their full appearance.');
