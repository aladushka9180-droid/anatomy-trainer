import assert from "node:assert/strict";
import { ASSISTANT_SPEECH_VOICES, assistantSpeechSsml, createSpeechHandler } from "./handler.ts";

const origin = "https://aladushka9180-droid.github.io";
const audioBytes = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
const request = (body: unknown, extra: Record<string,string> = {}) => new Request("https://example.supabase.co/functions/v1/assistant-speech", {
  method:"POST",
  headers:{ origin, authorization:"Bearer test-session", "content-type":"application/json", ...extra },
  body:JSON.stringify(body),
});
const audioResponse = () => new Response(audioBytes.slice(), { status:200, headers:{ "content-type":"audio/mpeg" } });

assert.deepEqual(Object.keys(ASSISTANT_SPEECH_VOICES).sort(), ["dmitry", "svetlana"]);
assert.deepEqual(Object.values(ASSISTANT_SPEECH_VOICES).sort(), ["ru-RU-DmitryNeural", "ru-RU-SvetlanaNeural"]);
assert.equal(
  assistantSpeechSsml("Проверка <голоса> & записи", ASSISTANT_SPEECH_VOICES.svetlana),
  '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ru-RU"><voice name="ru-RU-SvetlanaNeural">Проверка &lt;голоса&gt; &amp; записи</voice></speak>',
);
assert.throws(() => assistantSpeechSsml("Текст", "ru-RU-DariyaNeural"), /unsupported_voice/);

let calls = 0;
let lastSynthesis: { text: string; voiceName: string } | null = null;
const handler = createSpeechHandler({
  authenticate:async () => ({ id:"user-1" }),
  synthesize:async ({ text, voiceName }) => {
    calls += 1;
    lastSynthesis = { text, voiceName };
    return audioResponse();
  },
});

let response = await handler(request({ text:"  Ответ\nпомощника  ", voice:"dmitry" }));
assert.equal(response.status, 200);
assert.equal(response.headers.get("content-type"), "audio/mpeg");
assert.equal(response.headers.get("cache-control"), "no-store");
assert.equal(response.headers.get("x-speech-cache"), "miss");
assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(audioBytes));
assert.deepEqual(lastSynthesis, { text:"Ответ помощника", voiceName:"ru-RU-DmitryNeural" });

response = await handler(request({ text:"Ответ помощника", voice:"dmitry" }));
assert.equal(response.status, 200);
assert.equal(response.headers.get("x-speech-cache"), "hit");
assert.equal(calls, 1, "короткая фраза одного пользователя должна браться из закрытого серверного кэша");

const secondUser = createSpeechHandler({ authenticate:async () => ({ id:"user-2" }), synthesize:async () => audioResponse() });
response = await secondUser(request({ text:"Ответ помощника", voice:"svetlana" }));
assert.equal(response.status, 200);

for (const voice of ["irina", "pavel", "dariya", "lev", "ru-RU-DariyaNeural"]) {
  response = await handler(request({ text:"Проверка", voice }));
  assert.equal(response.status, 400, `голос ${voice} не должен проходить allowlist`);
}
for (const body of [
  { text:"Проверка", voice:"svetlana", snapshot:{ hidden:true } },
  { text:"Напишите test@example.com", voice:"svetlana" },
  { text:"Клиент +7 999 111-22-33", voice:"svetlana" },
  { text:"Запись 123e4567-e89b-42d3-a456-426614174000", voice:"svetlana" },
  { text:"а".repeat(1201), voice:"svetlana" },
]) {
  response = await handler(request(body));
  assert.equal(response.status, 400, "служебные поля, идентификаторы и чрезмерный текст должны отклоняться");
}

const unauthenticated = createSpeechHandler({ authenticate:async () => null, synthesize:async () => audioResponse() });
response = await unauthenticated(request({ text:"Проверка", voice:"svetlana" }));
assert.equal(response.status, 401);

const unconfigured = createSpeechHandler({ configured:false, authenticate:async () => ({ id:"user" }), synthesize:async () => audioResponse() });
response = await unconfigured(request({ text:"Проверка", voice:"svetlana" }));
assert.equal(response.status, 503);
assert.deepEqual(await response.json(), { ok:false, error:"not_configured" });

response = await handler(new Request("https://example.supabase.co/functions/v1/assistant-speech", {
  method:"POST",
  headers:{ origin:"https://attacker.example", authorization:"Bearer test-session", "content-type":"application/json" },
  body:JSON.stringify({ text:"Проверка", voice:"svetlana" }),
}));
assert.equal(response.status, 403);
assert.equal(response.headers.get("access-control-allow-origin"), origin);

let fakeNow = 1000;
const limited = createSpeechHandler({
  now:() => fakeNow,
  authenticate:async () => ({ id:"limited-user" }),
  synthesize:async () => audioResponse(),
});
for (let index = 0; index < 10; index += 1) {
  response = await limited(request({ text:`Фраза ${index}`, voice:"dmitry" }));
  assert.equal(response.status, 200);
}
response = await limited(request({ text:"Лишняя фраза", voice:"dmitry" }));
assert.equal(response.status, 429);
fakeNow += 60_001;
response = await limited(request({ text:"После окна", voice:"dmitry" }));
assert.equal(response.status, 200);

const timed = createSpeechHandler({
  timeoutMs:50,
  authenticate:async () => ({ id:"slow-user" }),
  synthesize:async ({ signal }) => await new Promise<Response>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once:true });
  }),
});
response = await timed(request({ text:"Медленная фраза", voice:"svetlana" }));
assert.equal(response.status, 504);
assert.deepEqual(await response.json(), { ok:false, error:"upstream_timeout" });

const rejected = createSpeechHandler({
  authenticate:async () => ({ id:"user" }),
  synthesize:async () => new Response("upstream-secret-details", { status:401, headers:{ "content-type":"text/plain" } }),
});
response = await rejected(request({ text:"Проверка", voice:"svetlana" }));
assert.equal(response.status, 502);
assert.doesNotMatch(await response.text(), /secret|details/i, "ответ Azure не должен раскрываться браузеру");

console.log("Assistant speech edge handler checks passed: voice allowlist, auth, privacy, timeout, rate limit and private cache");
