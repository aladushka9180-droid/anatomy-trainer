import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const [remoteRoot, phase] = process.argv.slice(2);
assert.ok(remoteRoot && ['before', 'after'].includes(phase), 'Expected download directory and before/after');
const normalize = source => source.replace(/\r\n/g, '\n').trim();
const hash = source => createHash('sha256').update(source).digest('hex');
for (const name of ['assistant-understand', 'telegram-client-notify']) {
  const file = `supabase/functions/${name}/index.ts`;
  const current = normalize(readFileSync(resolve(root, file), 'utf8'));
  const remote = normalize(readFileSync(resolve(remoteRoot, file), 'utf8'));
  assert.equal(current.split('Eldion Pro').length - 1, 1, `${name}: expected one brand substitution`);
  assert.ok(phase === 'before'
    ? remote === current || remote === current.replace('Eldion Pro', 'PrimeTime Pro')
    : remote === current,
  `${name}: remote source differs beyond the approved brand text; stop before any unrelated deployment`);
  console.log(JSON.stringify({name, phase, status:'pass', sourceSha256:hash(remote)}));
}
