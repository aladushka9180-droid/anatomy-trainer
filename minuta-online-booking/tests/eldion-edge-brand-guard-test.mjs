import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'eldion-edge-guard-'));
const run = phase => spawnSync(process.execPath, [join(root, 'scripts/eldion-edge-brand-guard.mjs'), scratch, phase], {encoding:'utf8'});
try {
  for (const name of ['assistant-understand', 'telegram-client-notify']) {
    const relative = `supabase/functions/${name}/index.ts`;
    mkdirSync(join(scratch, 'supabase/functions', name), {recursive:true});
    writeFileSync(join(scratch, relative), readFileSync(join(root, relative), 'utf8').replace('Eldion Pro', 'PrimeTime Pro'));
  }
  assert.equal(run('before').status, 0, 'Old production with brand-only difference must pass');
  assert.notEqual(run('after').status, 0, 'Old brand is not published proof');
  for (const name of ['assistant-understand', 'telegram-client-notify']) {
    const relative = `supabase/functions/${name}/index.ts`;
    writeFileSync(join(scratch, relative), readFileSync(join(root, relative)));
  }
  assert.equal(run('before').status, 0, 'Idempotent already-released source must pass');
  assert.equal(run('after').status, 0);
  const file = join(scratch, 'supabase/functions/telegram-client-notify/index.ts');
  writeFileSync(file, readFileSync(file, 'utf8').replace('32 * 1024', '64 * 1024'));
  assert.notEqual(run('before').status, 0, 'Unrelated remote behavior must block deployment');
  assert.notEqual(run('after').status, 0);
  console.log('Eldion Edge source guard: PASS (brand-only, idempotent, stale and unrelated source)');
} finally {
  // Unique test-owned temporary directory only.
  rmSync(scratch, {recursive:true, force:true});
}
