import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { serveNativeClientCaptureFixture, appRoot, ids, fixtureDate } from './native-client-capture-fixture.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.MINUTA_PLAYWRIGHT_PACKAGE||'playwright');
const sharp=require(process.env.NATIVE_CLIENT_SHARP_PACKAGE||'sharp');
const output=resolve(process.env.NATIVE_CLIENT_CAPTURE_OUTPUT||resolve(appRoot,'help/images/native-client'));
const rawOutput=resolve(appRoot,'../outputs/native-client/png');
const widths=(process.env.NATIVE_CLIENT_WIDTHS||'1440,390,760').split(',').map(Number);
mkdirSync(output,{recursive:true});
mkdirSync(rawOutput,{recursive:true});
const sdkUrl='https://telegram.org/js/telegram-widget.js?22';
const sdkCache=resolve(appRoot,'../outputs/native-client/sdk');
mkdirSync(sdkCache,{recursive:true});
const sdkFile=resolve(sdkCache,'telegram-widget-22.js'),sdkProofFile=resolve(sdkCache,'telegram-widget-22-provenance.json');
let sdkBytes,sdkProvenance;
if(existsSync(sdkFile)&&existsSync(sdkProofFile)) {
 sdkBytes=readFileSync(sdkFile);sdkProvenance=JSON.parse(readFileSync(sdkProofFile,'utf8'));
 assert.equal(sdkProvenance.url,sdkUrl);assert.equal(sdkProvenance.status,200);
 assert.match(sdkProvenance.contentType,/javascript/i);
 assert.equal(createHash('sha256').update(sdkBytes).digest('hex'),sdkProvenance.sha256);
 sdkProvenance={...sdkProvenance,requestsThisRun:0,localOriginalSdkCacheReused:true};
} else {
 const sdkResponse=await fetch(sdkUrl,{method:'GET',redirect:'error'});
 assert.equal(sdkResponse.ok,true,'Official static Telegram SDK response');
 assert.match(sdkResponse.headers.get('content-type')||'',/javascript/i,'Official SDK JavaScript MIME');
 sdkBytes=Buffer.from(await sdkResponse.arrayBuffer());
 sdkProvenance={url:sdkUrl,method:'GET',status:sdkResponse.status,contentType:sdkResponse.headers.get('content-type'),sha256:createHash('sha256').update(sdkBytes).digest('hex'),bytes:sdkBytes.length,fetchedAt:new Date().toISOString(),requestsThisRun:1,authorizationInvoked:false,unchangedBytesReusedAcrossContexts:true};
 writeFileSync(sdkFile,sdkBytes);writeFileSync(sdkProofFile,JSON.stringify(sdkProvenance,null,2)+'\n');
}
assert.ok(sdkBytes.length>1000,'Original SDK body');
const fixture=await serveNativeClientCaptureFixture();
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
const manifest={kind:'local-native-public-client-ui-fixture',liveVerified:false,domModified:false,cssModified:false,rendererModified:false,originalSupabaseSdk:true,productionRequests:0,allowedPublicStaticSdk:sdkProvenance,date:fixtureDate,fixtureClock:'2026-10-05T07:00:00Z',theme:'pink-porcelain',configOnlyTransport:true,fixtureCatalog:'Valid minimal catalog without optional public service detail cards',captures:[],limitations:[],sources:{},discardedTelemetry:[],blockedExternalRequests:[]};
for(const f of ['index.html','app.js','booking.html','booking.js','my-bookings.html','my-bookings.js','telegram-auth.js','vendor/supabase-2.112.4.min.js'])manifest.sources[f]=createHash('sha256').update(readFileSync(resolve(appRoot,f))).digest('hex');
async function capture(page,key,selector,articles,step,width,coverageExact=true,note='') {
 const element=page.locator(selector);await element.waitFor({state:'visible'});await element.scrollIntoViewIfNeeded();await page.waitForTimeout(180);
 assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth+1),true,'Document overflow '+key+' '+width);
 const rawImage=key+'-'+width+'.png',image=key+'-'+width+'.webp';
 const png=await element.screenshot({path:resolve(rawOutput,rawImage),animations:'disabled'});
 const webp=await sharp(png).webp({lossless:true,effort:6}).toBuffer();
 const before=await sharp(png).ensureAlpha().raw().toBuffer(),after=await sharp(webp).ensureAlpha().raw().toBuffer();
 assert.deepEqual(before,after,'Lossless WebP pixels '+key);
 writeFileSync(resolve(output,image),webp);
 const dimensions=await sharp(webp).metadata();manifest.captures.push({screenKey:key,src:'images/native-client/'+image,width:dimensions.width,height:dimensions.height,viewportWidth:width,sha256:createHash('sha256').update(webp).digest('hex'),articleSlugs:articles,articleSteps:Object.fromEntries(articles.map(slug=>[slug,[step]])),step,coverageExact,pixelPreserving:true,rawPng:'outputs/native-client/png/'+rawImage,kind:'screenshot',caption:'Настоящий клиентский интерфейс на изолированных учебных данных; не рабочая запись.',note});
}
try {
 for(const width of widths) {
  const context=await browser.newContext({viewport:{width,height:1050},timezoneId:'Europe/Samara',serviceWorkers:'block'});
  const page=await context.newPage(),pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===fixture.origin)return route.continue();if(route.request().method()==='GET'&&u.href===sdkUrl)return route.fulfill({status:200,contentType:sdkProvenance.contentType,body:sdkBytes});manifest.blockedExternalRequests.push({origin:u.origin,path:u.pathname});return route.abort();});
  await page.clock.install({time:new Date(manifest.fixtureClock)});
  await page.goto(fixture.origin+'/minuta-online-booking/index.html?org=local-client-fixture');
  await page.locator('[data-service]').first().waitFor({state:'visible'});
  await capture(page,'client-service-picker','.booking-card',['book-online'],1,width);
  await page.locator('[data-service]').first().click();
  await page.locator('#timeHours [data-time]').first().waitFor({state:'visible'});
  await page.locator('#openWaitlist').click();
  await page.locator('#waitlistName').fill('Клиент · пример');
  await capture(page,'client-waitlist-form','#waitlistDialog',['join-booking-waitlist'],2,width);
  await page.locator('[data-close-waitlist]').click();
  await page.locator('#timeHours [data-time]').first().click();
  await page.locator('#bookingForm').waitFor({state:'visible'});
  await page.locator('#clientName').fill('Клиент · пример');
  await capture(page,'client-contact-form','.booking-card',['book-online'],3,width);
  await page.goto(fixture.origin+'/minuta-online-booking/booking.html?theme=pink-porcelain#token='+ids.token);
  await page.locator('#manageContent').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#manageTelegramConnect')?.dataset.telegramAuthState==='ready');
  await capture(page,'client-management','#manageContent',['reschedule','connect-telegram'],1,width,true,'Telegram button is ready inside its actual booking-management context. Original official static SDK loaded; authorization is not invoked.');
  await page.locator('#openReschedule').click();
  await page.locator('#manageTimes [data-manage-time]').first().waitFor({state:'visible'});
  await capture(page,'client-reschedule-form','#reschedulePanel',['reschedule'],3,width);
  await page.goto(fixture.origin+'/minuta-online-booking/my-bookings.html');
  await page.locator('#clientSmsButton').filter({hasText:'Получить код'}).waitFor({state:'visible'});
  await page.locator('#openPersonalTheme').click();
  await page.locator('#personalThemeOptions label.theme-pink-porcelain').click();
  assert.equal(await page.locator('#personalThemeOptions input[value="pink-porcelain"]').isChecked(),true);
  await page.keyboard.press('Escape');
  await page.locator('#legacyClientLogin summary').click();
  await capture(page,'client-login','#clientLoginCard',['find-booking'],4,width);
  assert.deepEqual(pageErrors,[],'Native client page errors');
  await context.close();
 }
 manifest.transportRequests=Object.values(fixture.requests.reduce((acc,r)=>{const key=[r.method,r.path,r.rpc||''].join(' ');acc[key]??={method:r.method,path:r.path,...(r.rpc?{rpc:r.rpc}:{}),count:0};acc[key].count++;return acc;},{}));
 assert.equal(fixture.requests.some(r=>/\/(?:authorize|otp|token)(?:\/|$)/.test(r.path)),false,'No auth or SMS execution');
 manifest.limitations.push('SMS, booking creation, payment, Telegram authorization and delivery were not executed. Original official Telegram static SDK is the only authorized public dependency fetch.');
 assert.deepEqual(fixture.blockedMutations,[],'Unexpected business writes');
 assert.deepEqual(fixture.unsupported,[],'Unsupported client fixture reads');
} finally {
 manifest.sources={...manifest.sources,...fixture.servedSourceHashes};manifest.discardedTelemetry=[...new Set(fixture.discardedTelemetry)];manifest.unsupportedFixtureReads=[...new Set(fixture.unsupported)];manifest.blockedMutations=fixture.blockedMutations;
 manifest.harnessSources=Object.fromEntries(['help/tools/capture-native-client.mjs','help/tools/native-client-capture-fixture.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(resolve(appRoot,f))).digest('hex')]));
 manifest.coveredArticles=[...new Set(manifest.captures.filter(x=>x.coverageExact).flatMap(x=>x.articleSlugs))];
 manifest.captureCount=manifest.captures.length;manifest.coverageExact=manifest.captures.every(x=>x.coverageExact);
 writeFileSync(resolve(output,'native-client-capture-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await browser.close();await new Promise(resolve=>fixture.server.close(resolve));
}
console.log(JSON.stringify({captureCount:manifest.captureCount,coveredArticles:manifest.coveredArticles,output,liveVerified:false}));
