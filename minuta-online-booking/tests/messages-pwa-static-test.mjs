import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const html=fs.readFileSync(path.join(dir,'messages.html'),'utf8');const sw=fs.readFileSync(path.join(dir,'sw.js'),'utf8');
for(const asset of ['messages.html','messages-center.css','messages-core.js','provider-messages-center.js','client-messages.js']){assert.ok(fs.existsSync(path.join(dir,asset)),asset);if(asset!=='messages.html')assert.match(html,new RegExp(`${asset.replaceAll('.','\\.')}\\?v=\\d+`),asset)}
for(const asset of ['./messages.html','./messages-center.css?v=886','./messages-core.js?v=811','./provider-messages-center.js?v=886','./client-messages.js?v=885'])assert.ok(sw.includes(asset),`${asset} is not cached by sw.js`);
console.log('messages-pwa-static-test: ok');
