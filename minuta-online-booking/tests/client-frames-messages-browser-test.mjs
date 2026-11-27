import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {startFixture} from './new-booking-card-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture();const browser=await chromium.launch();
const provider=readFileSync(new URL('../provider.js',import.meta.url),'utf8');
const avatarHook=provider.match(/renderClientAvatar:(conversation => \{[\s\S]*?\n    \}),\s*canManageSettings:/)?.[1];
assert.ok(avatarHook,'Use the real provider avatar hook instead of a replacement callback');
// Existing isolated message bridge: no backend, real records or outgoing messages.
const html=readFileSync(new URL('../provider-messages-preview.html',import.meta.url),'utf8')
 .replace('<body>','<body class="provider-body">')
 .replace('</head>','<link rel="stylesheet" href="client-loyalty-frames.css"><script src="client-loyalty-frames.js"></script></head>')
 .replace('const ids=',`const organization={id:'fixture-org'};const allBookings=[{id:'44444444-4444-4444-8444-444444444444',organization_id:'fixture-org',client_phone:'test-phone',client_name:'Test'}];const clientFramedAvatarMarkup=()=>PrimeTimeLoyaltyFrames.compact({total:100,content:'А'});const ids=`)
 .replace('createMessageCenter({root,bridge,',`createMessageCenter({root,bridge,renderClientAvatar:${avatarHook},`);
try{
 for(const width of [390,760,1440]){
  const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});
  await page.route('**/*',r=>r.request().url()===url+'frame-messages.html'?r.fulfill({contentType:'text/html',body:html}):r.request().url().startsWith(url)?r.continue():r.abort());
  await page.goto(url+'frame-messages.html');
  await page.locator('.client-framed-count').waitFor();
  assert.equal(await page.locator('.client-framed-count').textContent(),'100');
  assert.equal(await page.locator('.message-center-avatar').count(),1,'Support keeps its own avatar');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('[data-message-conversation]').first().click();
  assert.equal(await page.locator('.message-center-composer').isVisible(),true);
  await page.close();
 }
 console.log('PASS: message client frames, support fallback, opening synthetic conversation; 390/760/1440, no sends.');
}finally{await browser.close();server.close();}
