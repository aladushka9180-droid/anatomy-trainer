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
assert.doesNotMatch(html, /provider\.html|supabase|app\.js/);
assert.match(worker, /CACHE = `\$\{CACHE_PREFIX\}v826`/);
assert.match(worker, /'\.\/index\.html'/);
assert.match(worker, /'\.\/redirect\.js\?v=826'/);
assert.match(provider, /provider\.js\?v=825/);
assert.doesNotMatch(provider, /primetime-booking\.github\.io/);

function runRedirect(search, hash) {
  let replaced = '';
  let link = '';
  vm.runInNewContext(redirect, {
    URL,
    window:{
      location:{
        search,
        hash,
        replace(value) { replaced = value; }
      }
    },
    document:{
      querySelector(selector) {
        assert.equal(selector, '#continueLink');
        return { setAttribute(name, value) { assert.equal(name, 'href'); link = value; } };
      }
    }
  });
  return { replaced, link };
}

assert.deepEqual(runRedirect('?org=test%20team', '#/home'), {
  replaced:'https://primetime-booking.github.io/?org=test%20team#/home',
  link:'https://primetime-booking.github.io/?org=test%20team#/home'
});
assert.deepEqual(runRedirect('', '#booking=abc'), {
  replaced:'https://primetime-booking.github.io/#booking=abc',
  link:'https://primetime-booking.github.io/#booking=abc'
});

console.log('client URL redirect test: OK');
