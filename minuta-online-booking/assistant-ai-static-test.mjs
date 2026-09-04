import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile(new URL('./supabase/functions/assistant-understand/index.ts', import.meta.url), 'utf8');
const provider = await readFile(new URL('./provider.js', import.meta.url), 'utf8');
const assistant = await readFile(new URL('./voice-assistant.js', import.meta.url), 'utf8');
const config = await readFile(new URL('./supabase/config.toml', import.meta.url), 'utf8');

assert.match(config, /\[functions\.assistant-understand\][\s\S]*verify_jwt = true/, 'Edge Function должна требовать JWT');
assert.match(edge, /auth\.auth\.getUser\(\)/, 'JWT должен повторно проверяться через Supabase Auth');
assert.match(edge, /MAX_JSON_BYTES = 24 \* 1024/, 'Размер команды и контекста не ограничен');
assert.match(edge, /MAX_REQUESTS_PER_MINUTE = 12/, 'Нет защиты от частых ИИ-запросов');
assert.match(edge, /OPENAI_API_KEY/, 'Сервер не читает ключ OpenAI из Secrets');
assert.match(edge, /OPENAI_MODEL/, 'Модель должна задаваться серверным секретом');
assert.match(edge, /https:\/\/api\.openai\.com\/v1\/responses/, 'Используется не Responses API');
assert.match(edge, /store:false/, 'Ответы могут сохраняться внешним API');
assert.match(edge, /type:"json_schema"[\s\S]*strict:true/, 'Responses API не использует строгий Structured Output');
assert.match(edge, /const RESPONSE_SCHEMA = \{[\s\S]*additionalProperties: false/, 'JSON-схема разрешает неожиданные поля');
assert.match(edge, /редакт|redactSensitiveText/, 'Телефоны и email не маскируются');
assert.doesNotMatch(edge, /console\.(?:info|log)\([^\n]*(?:command|history|context)/, 'Команда или рабочий контекст попадают в журнал Edge Function');
assert.match(provider, /db\.functions\.invoke\('assistant-understand'/, 'Кабинет не вызывает защищённую Edge Function');
assert.match(provider, /sessionIsCurrent\(userId, generation\)/, 'Поздний ИИ-ответ не защищён поколением сессии');
assert.match(assistant, /function buildAssistantContext[\s\S]*clientName:[\s\S]*serviceName:/, 'Не сформирован минимальный динамический контекст');
assert.doesNotMatch(assistant.match(/function buildAssistantContext[\s\S]*?function shouldUseRemoteUnderstanding/)?.[0] || '', /clientKey|paymentMethod|amountRub/, 'Во внешний контекст попали телефонные ключи или платёжные поля');
assert.match(assistant, /assistantAnalysisModel[\s\S]*interpretCommand\(canonicalCommand/, 'Ответ модели не проходит повторную локальную интерпретацию');
assert.doesNotMatch(assistant, /\bfetch\(/, 'Интерфейс помощника не должен обращаться к OpenAI напрямую');

console.log('Assistant AI security static tests passed');
