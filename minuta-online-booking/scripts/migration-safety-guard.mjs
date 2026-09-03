import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bookingRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(bookingRoot, '..');
const timestampDirectory = join(bookingRoot, 'supabase', 'migrations');
const releaseWorkflow = join(repositoryRoot, '.github', 'workflows', 'minuta-safe-release.yml');

const PINNED_PROVIDER_DELETE_VERSION = 64;
const PINNED_PROVIDER_DELETE_FILE = `supabase-migration-v${PINNED_PROVIDER_DELETE_VERSION}.sql`;
const PROVIDER_DELETE_DEFINITION = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\s*\.\s*)?"?provider_delete_booking"?\s*\(/i;
const REQUIRED_RELEASE_TAIL = [84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96];

// Эти пары исторически хранят одну миграцию в двух системах имён.
// Новую пару можно разрешить только явным изменением этого списка.
const EXACT_DUPLICATE_ALLOWLIST = new Set([
  duplicateKey('supabase-migration-v58.sql', 'supabase/migrations/20260902110000_waitlist_and_client_confirmation.sql'),
  duplicateKey('supabase-migration-v61.sql', 'supabase/migrations/20260902140000_booking_reviews_and_repeat_booking.sql')
]);

// Любое новое определение provider_delete_booking должно сопровождаться
// осознанным обновлением guard, а не незаметно переопределять защищённую RPC.
const ALLOWED_PROVIDER_DELETE_DEFINITIONS = new Set([
  'supabase-migration-v60.sql',
  'supabase-migration-v61.sql',
  'supabase-migration-v62.sql',
  'supabase-migration-v63.sql',
  PINNED_PROVIDER_DELETE_FILE,
  'supabase/migrations/20260902140000_booking_reviews_and_repeat_booking.sql'
]);

const errors = [];
const legacyMigrations = listFiles(bookingRoot, name => /^supabase-migration-v\d+\.sql$/i.test(name));
const timestampMigrations = listFiles(timestampDirectory, name => /^\d{14}_.+\.sql$/i.test(name));
const allMigrations = [...legacyMigrations, ...timestampMigrations];
const contents = new Map(allMigrations.map(path => [path, readFileSync(path)]));

checkExactDuplicates();
checkProviderDeleteDefinitions();
checkHistoricalIdempotencyContracts();
checkReleaseOrder();

if (errors.length) {
  console.error('Проверка безопасности миграций не пройдена:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Проверка миграций: OK. Дубли ограничены allowlist, ${PINNED_PROVIDER_DELETE_FILE} — последнее определение provider_delete_booking в release workflow.`);
}

function checkExactDuplicates() {
  for (const legacyPath of legacyMigrations) {
    const legacyHash = sha256(contents.get(legacyPath));
    for (const timestampPath of timestampMigrations) {
      if (legacyHash !== sha256(contents.get(timestampPath))) continue;
      const legacyName = relativePath(legacyPath);
      const timestampName = relativePath(timestampPath);
      const key = duplicateKey(legacyName, timestampName);
      if (!EXACT_DUPLICATE_ALLOWLIST.has(key)) {
        errors.push(`Найден новый точный дубль: ${legacyName} = ${timestampName}. Удалите дубль или явно добавьте историческую пару в EXACT_DUPLICATE_ALLOWLIST.`);
      }
    }
  }
}

function checkProviderDeleteDefinitions() {
  const pinnedPath = join(bookingRoot, PINNED_PROVIDER_DELETE_FILE);
  if (!existsSync(pinnedPath)) {
    errors.push(`Обязательная миграция ${PINNED_PROVIDER_DELETE_FILE} не найдена.`);
  } else if (!PROVIDER_DELETE_DEFINITION.test(readFileSync(pinnedPath, 'utf8'))) {
    errors.push(`${PINNED_PROVIDER_DELETE_FILE} не содержит определение public.provider_delete_booking.`);
  }

  for (const migrationPath of allMigrations) {
    const migrationText = contents.get(migrationPath).toString('utf8');
    if (!PROVIDER_DELETE_DEFINITION.test(migrationText)) continue;
    const name = relativePath(migrationPath);
    if (!ALLOWED_PROVIDER_DELETE_DEFINITIONS.has(name)) {
      errors.push(`Миграция ${name} снова определяет provider_delete_booking. После ${PINNED_PROVIDER_DELETE_FILE} это запрещено без явного обновления migration-safety-guard.mjs.`);
    }
  }

  for (const migrationPath of legacyMigrations) {
    const match = /^supabase-migration-v(\d+)\.sql$/i.exec(relativePath(migrationPath));
    const version = Number(match?.[1]);
    if (version > PINNED_PROVIDER_DELETE_VERSION && PROVIDER_DELETE_DEFINITION.test(contents.get(migrationPath).toString('utf8'))) {
      errors.push(`Миграция v${version} переопределяет provider_delete_booking после v${PINNED_PROVIDER_DELETE_VERSION}. Сначала пересмотрите и обновите guard.`);
    }
  }
}

function checkHistoricalIdempotencyContracts() {
  const v49Path = join(bookingRoot, 'supabase-migration-v49.sql');
  const v80Path = join(bookingRoot, 'supabase-migration-v80.sql');

  if (!existsSync(v49Path)) {
    errors.push('Обязательная миграция supabase-migration-v49.sql не найдена.');
  } else {
    const v49 = readFileSync(v49Path, 'utf8');
    if (/drop\s+constraint\s+if\s+exists\s+bookings_provider_note_length_check/i.test(v49)) {
      errors.push('v49 не должна пересоздавать bookings_provider_note_length_check при каждом повторном применении.');
    }
    if (!/v49_provider_note_constraint_mismatch/i.test(v49)) {
      errors.push('v49 должна блокировать несовместимое определение bookings_provider_note_length_check.');
    }
    if (!/revoke\s+all\s+on\s+function\s+public\.set_booking_note\s*\(\s*uuid\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i.test(v49)) {
      errors.push('v49 должна очищать ACL set_booking_note перед выдачей доступа authenticated.');
    }
  }

  if (!existsSync(v80Path)) {
    errors.push('Обязательная миграция supabase-migration-v80.sql не найдена.');
  } else {
    const v80 = readFileSync(v80Path, 'utf8');
    if (!/zz_bookings_group_event_overlap_v86/i.test(v80)
      || !/if\s+v86_trigger\s+is\s+null\s+then/i.test(v80)
      || !/v80_detected_invalid_v86_trigger/i.test(v80)) {
      errors.push('v80 должна сохранять валидный триггер v86 и блокировать его повреждённое состояние.');
    }
  }
}

function checkReleaseOrder() {
  if (!existsSync(releaseWorkflow)) {
    errors.push(`Не найден release workflow: ${relative(repositoryRoot, releaseWorkflow)}.`);
    return;
  }

  const workflowText = readFileSync(releaseWorkflow, 'utf8');
  const jobNames = ['test-migration', 'production-migration'];
  jobNames.forEach(jobName => {
    const blockMatch = new RegExp(`^  ${jobName}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9-]*:|(?![\\s\\S]))`, 'm').exec(workflowText);
    if (!blockMatch) {
      errors.push(`В release workflow не найден job ${jobName}.`);
      return;
    }
    const chain = [...blockMatch[0].matchAll(/-f\s+minuta-online-booking\/(supabase-migration-v(\d+)\.sql)\b/g)]
      .map(match => ({ file: match[1], version: Number(match[2]) }));
    const pinnedReferences = chain.filter(reference => reference.file === PINNED_PROVIDER_DELETE_FILE);
    if (pinnedReferences.length !== 1) {
      errors.push(`Job ${jobName} должен применять ${PINNED_PROVIDER_DELETE_FILE} ровно один раз, найдено: ${pinnedReferences.length}.`);
    }
    const definingReferences = chain.filter(reference => {
      const path = join(bookingRoot, reference.file);
      return existsSync(path) && PROVIDER_DELETE_DEFINITION.test(readFileSync(path, 'utf8'));
    });
    const lastDefinition = definingReferences.at(-1);
    if (lastDefinition?.file !== PINNED_PROVIDER_DELETE_FILE) {
      errors.push(`В job ${jobName} последнее определение provider_delete_booking приходит из ${lastDefinition?.file || 'ниоткуда'}, а должно из ${PINNED_PROVIDER_DELETE_FILE}.`);
    }

    const expectedCounts = jobName === 'test-migration'
      ? new Map([[49, 1], [87, 2], [88, 2], [89, 2], [90, 2], [91, 2], [92, 2], [93, 2], [94, 2], [95, 2], [96, 2]])
      : new Map([[49, 1], [87, 1], [88, 1], [89, 1], [90, 1], [91, 1], [92, 1], [93, 1], [94, 1], [95, 1], [96, 1]]);
    for (const [version, expectedCount] of expectedCounts) {
      const actualCount = chain.filter(reference => reference.version === version).length;
      if (actualCount !== expectedCount) {
        errors.push(`Job ${jobName} должен применять v${version} ${expectedCount} раз, найдено: ${actualCount}.`);
      }
    }

    for (const [left, right] of REQUIRED_RELEASE_TAIL.slice(0, -1).map((version, index) => [version, REQUIRED_RELEASE_TAIL[index + 1]])) {
      const lastLeft = chain.findLastIndex(reference => reference.version === left);
      const firstRight = chain.findIndex(reference => reference.version === right);
      if (lastLeft < 0 || firstRight < 0 || lastLeft >= firstRight) {
        errors.push(`Job ${jobName} должен применять последний v${left} раньше первого v${right}.`);
      }
    }

    const lastV80 = chain.findLastIndex(reference => reference.version === 80);
    const firstV86 = chain.findIndex(reference => reference.version === 86);
    if (lastV80 < 0 || firstV86 < 0 || lastV80 >= firstV86) {
      errors.push(`Job ${jobName} не должен повторно применять v80 после v86.`);
    }
  });
}

function listFiles(directory, predicate) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && predicate(entry.name))
    .map(entry => join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function relativePath(path) {
  return relative(bookingRoot, path).split(sep).join('/');
}

function duplicateKey(legacyName, timestampName) {
  return `${legacyName}|${timestampName}`;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}
