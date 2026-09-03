import assert from 'node:assert/strict';
import fs from 'node:fs';

const provider = fs.readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(provider, /<button class="provider-empty provider-empty-action" type="button" data-open-service-creator/, 'the complete empty state opens the service creator');
assert.match(provider, /aria-label="Добавить первую услугу"/, 'the empty-state action has an accessible name');
assert.match(provider, /Нажмите здесь, чтобы добавить первую/, 'the empty state explains that it is clickable');
assert.match(styles, /\.provider-empty-action \{[^}]*width:100%[^}]*cursor:pointer/, 'the clickable empty state fills the panel and signals interaction');
assert.match(styles, /\.provider-empty-action:focus-visible/, 'keyboard focus remains visible');

console.log('service empty-state action test passed');
