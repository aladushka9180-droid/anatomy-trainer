import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadGlobal(file, name) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${read(file)}\n;globalThis.__smokeValue=${name};`, context, {filename: file});
  return context.__smokeValue;
}

function assertLocalFile(reference, owner) {
  const clean = reference.replace(/^\.\//, '').replace(/[?#].*$/, '');
  if (!clean || clean === '.') return;
  assert.ok(fs.existsSync(path.join(root, clean)), `${owner}: отсутствует ${reference}`);
}

const rootScripts = fs.readdirSync(root).filter(file => file.endsWith('.js'));
for (const file of rootScripts) new vm.Script(read(file), {filename: file});

const html = read('index.html');
for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (match[1].trim()) new vm.Script(match[1], {filename: 'index.html:inline'});
}

for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) assertLocalFile(match[1], 'index.html');

const sw = read('sw.js');
const assetBlock = sw.match(/const ASSETS=\[([\s\S]*?)\];/);
assert.ok(assetBlock, 'sw.js: не найден обязательный список ASSETS');
for (const match of assetBlock[1].matchAll(/'([^']+)'/g)) assertLocalFile(match[1], 'sw.js');

for (const reference of [
  './minimal-redesign.css?v=78',
  './professional-learning.css?v=53',
  './professional-foundations.js?v=2',
  './professional-learning.js?v=56'
]) {
  assert.ok(html.includes(`"${reference}"`), `index.html: нет актуальной версии ${reference}`);
  assert.ok(sw.includes(`'${reference}'`), `sw.js: нет актуальной версии ${reference}`);
}

const foundations = loadGlobal('professional-foundations.js', 'PROFESSIONAL_FOUNDATIONS');
assert.ok(Array.isArray(foundations.modules) && foundations.modules.length >= 6, 'Не загружены модули профессиональной основы');
assert.ok(Array.isArray(foundations.scenarios) && foundations.scenarios.length >= 4, 'Не загружены обязательные сценарии безопасности');

const scenarioById = new Map(foundations.scenarios.map(item => [item.id, item]));
for (const module of foundations.modules.filter(item => item.requiredScenarioId)) {
  const scenario = scenarioById.get(module.requiredScenarioId);
  assert.ok(scenario, `Для модуля «${module.title}» не найден обязательный сценарий`);
  assert.ok(Array.isArray(scenario.knowledgeChecks) && scenario.knowledgeChecks.length >= 2, `Сценарий «${scenario.title}» не имеет объективной проверки`);
  for (const check of scenario.knowledgeChecks) {
    assert.ok(check.id && check.question && check.correctId, `Неполная проверка в сценарии «${scenario.title}»`);
    assert.ok(Array.isArray(check.options) && check.options.length >= 3, `Недостаточно вариантов в проверке «${check.question}»`);
    assert.equal(check.options.filter(option => option.id === check.correctId).length, 1, `В проверке «${check.question}» должен быть ровно один правильный вариант`);
    assert.equal(new Set(check.options.map(option => option.id)).size, check.options.length, `Повторяющиеся варианты в проверке «${check.question}»`);
  }
}

const emergency = foundations.modules.find(item => item.id === 'emergency');
const firstAid = emergency?.sections?.find(section => section.title === 'Первые действия до приезда помощи');
assert.ok(firstAid, 'Краткий блок первой помощи должен называться «Первые действия до приезда помощи»');
assert.ok(firstAid.items.some(item => /не полный курс первой помощи/i.test(item)), 'Нет явной границы краткой памятки по первой помощи');

const learning = read('professional-learning.js');
assert.ok(learning.includes('scenarioKnowledgePassed'), 'Объективная проверка не подключена к завершению сценария');
assert.ok(learning.includes('data-scenario-knowledge'), 'В интерфейсе нет проверяемых вариантов ответа');
assert.ok(/\.scenario-knowledge-check label\{[^}]*min-height:44px/.test(read('professional-learning.css')), 'Варианты проверки должны иметь мобильную высоту не менее 44 px');

for (const value of ['kids', 'simple', 'study']) {
  assert.ok(html.includes(`data-onboarding-language="${value}"`), `В онбординге отсутствует способ объяснения ${value}`);
  assert.ok(html.includes(`<option value="${value}">`), `В настройках отсутствует способ объяснения ${value}`);
}

const onboardingLanguages = html.match(/<div id="onboardingLanguageChoices"[\s\S]*?<\/div>/)?.[0] || '';
assert.ok(onboardingLanguages.includes('Выберите сложность объяснения'), 'Онбординг не просит явно выбрать сложность');
assert.ok(onboardingLanguages.includes('сайт не назначает уровень автоматически'), 'Нет пояснения об обязательном самостоятельном выборе');
assert.equal((onboardingLanguages.match(/aria-checked="true"/g) || []).length, 0, 'Сложность не должна быть выбрана автоматически');
assert.equal((onboardingLanguages.match(/class="active"/g) || []).length, 0, 'Карточка сложности не должна выглядеть выбранной заранее');
assert.ok(html.includes("onboardingLanguage=''"), 'Начальное значение сложности должно быть пустым');
assert.ok(!html.includes("selectOnboardingLanguage(goal==='beginner'"), 'Цель занятия не должна автоматически назначать сложность');
assert.ok(html.includes("$('#nextOnboarding').disabled=summary?!onboardingLanguage:!onboardingGoal"), 'Начало занятия должно быть заблокировано до выбора сложности');

for (const [file, globalName] of [['massage-data.js', 'MASSAGE_QUESTIONS'], ['practice-cases.js', 'PRACTICE_CASES']]) {
  const questions = loadGlobal(file, globalName);
  for (const question of questions) {
    const prompt = String(question.simple || question.text || '');
    assert.ok(prompt.length <= 135, `${question.key}: простой вопрос будет сокращён многоточием (${prompt.length} знаков)`);
    for (const option of question.options || []) {
      assert.ok(String(option).length <= 105, `${question.key}: вариант ответа будет сокращён многоточием (${String(option).length} знаков)`);
    }
  }
}

console.log(`anatomy trainer smoke test: OK (${rootScripts.length} JS, ${foundations.modules.length} модулей, ${foundations.scenarios.length} сценария)`);
