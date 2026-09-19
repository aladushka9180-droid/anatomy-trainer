import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const redirect = readFileSync(join(root, 'redirect.js'), 'utf8');
const worker = readFileSync(join(root, 'sw.js'), 'utf8');
const provider = readFileSync(join(root, 'provider.html'), 'utf8');

assert.match(html, /redirect\.js\?v=826/);
assert.match(worker, /CACHE = `\$\{CACHE_PREFIX\}v833`/);
assert.match(worker, /'\.\/index\.html'/);
assert.match(worker, /'\.\/redirect\.js\?v=826'/);
assert.match(provider, /provider\.js\?v=833/);
assert.doesNotMatch(provider, /primetime-booking\.github\.io/);

function runRedirect({ hostname, pathname, search = '', hash = '' }) {
  let replaced = '';
  vm.runInNewContext(redirect, {
    URL,
    window:{
      location:{
        hostname,
        pathname,
        search,
        hash,
        replace(value) { replaced = value; }
      }
    }
  });
  return replaced;
}

assert.equal(runRedirect({
  hostname:'aladushka9180-droid.github.io',
  pathname:'/anatomy-trainer/minuta-online-booking/',
  search:'?org=test%20team',
  hash:'#/home'
}), 'https://primetime-booking.github.io/?org=test%20team#/home');
assert.equal(runRedirect({
  hostname:'aladushka9180-droid.github.io',
  pathname:'/anatomy-trainer/minuta-online-booking/index.html',
  hash:'#booking=abc'
}), 'https://primetime-booking.github.io/#booking=abc');
assert.equal(runRedirect({ hostname:'aladushka9180-droid.github.io', pathname:'/anatomy-trainer/' }), '');
assert.equal(runRedirect({ hostname:'aladushka9180-droid.github.io', pathname:'/anatomy-trainer/minuta-online-booking/provider.html' }), '');
assert.equal(runRedirect({ hostname:'127.0.0.1', pathname:'/anatomy-trainer/minuta-online-booking/' }), '');
assert.equal(runRedirect({ hostname:'primetime-booking.github.io', pathname:'/' }), '');

console.log('client URL redirect test: OK');
