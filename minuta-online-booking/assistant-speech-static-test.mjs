import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const assistant = read('./voice-assistant.js');
const provider = read('./provider.js');
const config = read('./config.js');
const html = read('./provider.html');
const edgeIndex = read('./supabase/functions/assistant-speech/index.ts');
const edgeHandler = read('./supabase/functions/assistant-speech/handler.ts');
const supabaseConfig = read('./supabase/config.toml');

assert.match(config, /assistantCloudSpeechEnabled:\s*false/, 'облачный голос нельзя включать до настройки и проверки Azure');
assert.match(provider, /cloudSpeechEnabled:Boolean\(window\.MINUTA_CONFIG\.assistantCloudSpeechEnabled\)/);
assert.match(provider, /functions\/v1\/assistant-speech/);
assert.match(provider, /const body = \{ text, voice \}/, 'в синтез должны уходить только показанный текст и выбранный голос');
assert.match(provider, /\['dmitry', 'svetlana'\]\.includes\(voice\)/);
assert.doesNotMatch(provider, /AZURE_SPEECH_KEY|ocp-apim-subscription-key/i, 'браузерный код не должен знать ключ Azure');
assert.doesNotMatch(assistant, /AZURE_SPEECH_KEY|ocp-apim-subscription-key/i, 'модуль помощника не должен знать ключ Azure');

assert.match(assistant, /assistantSpeechText\(lastModel\)/, 'озвучка ответа должна строиться тем же безопасным форматтером');
assert.match(assistant, /bridge\.synthesizeSpeech\(\{ text:speechText, voice:voice\.id \}/, 'скрытый снимок нельзя передавать в синтез');
assert.match(assistant, /Object\.freeze\(\{ id:'dmitry', label:'Дмитрий', azureName:'ru-RU-DmitryNeural' \}\)/);
assert.match(assistant, /Object\.freeze\(\{ id:'svetlana', label:'Светлана', azureName:'ru-RU-SvetlanaNeural' \}\)/);
assert.match(assistant, /catalog\.some\(voice => voice\.id === currentKey\) \? currentKey : \(catalog\[0\]\?\.id \|\| ''\)/, 'Недоступный каталог не должен выглядеть пустым: выбранный Дмитрий или Светлана остаётся виден');
assert.doesNotMatch(assistant.match(/const ASSISTANT_VOICE_CATALOG[\s\S]*?\]\);/)?.[0] || '', /Ирина|Павел|Дарья|Dariya|Лев|Lev/);

assert.match(html, /В каталоге только Дмитрий и Светлана/);
assert.match(html, /другой голос не подставляется/);
assert.doesNotMatch(html.match(/id="voiceAssistantSpeechHint"[\s\S]*?<\/p>/)?.[0] || '', /Google|Ирина|Павел|Дарья|Лев/);

assert.match(edgeIndex, /Deno\.env\.get\("AZURE_SPEECH_KEY"\)/);
assert.match(edgeIndex, /Deno\.env\.get\("AZURE_SPEECH_REGION"\)/);
assert.match(edgeIndex, /https:\/\/\$\{region\}\.tts\.speech\.microsoft\.com\/cognitiveservices\/v1/);
assert.match(edgeIndex, /"ocp-apim-subscription-key":key/);
assert.match(edgeHandler, /REQUESTS_PER_MINUTE = 10/);
assert.match(edgeHandler, /MAX_TEXT_CHARACTERS = 1200/);
assert.match(edgeHandler, /CACHE_TTL_MS = 5 \* 60 \* 1000/);
assert.match(edgeHandler, /user\.id}\\n\$\{body\.voice}\\n\$\{body\.text}/, 'кэш должен быть изолирован по пользователю');
assert.match(supabaseConfig, /\[functions\.assistant-speech\][\s\S]*?verify_jwt = true/);

console.log('Assistant speech static security checks passed: disabled release gate, two-voice catalog and server-only Azure key');
