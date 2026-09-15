import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));

const helpPage = ({ type = 'index', value = '' } = {}) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/help/help.css">
  <body class="${type === 'article' ? 'article-page' : ''}">
    <a class="skip-link" href="#main">К содержанию</a>
    <header class="help-header">Внешняя шапка помощи</header>
    <main id="main" style="min-height:900px;padding:24px">
      <h1>${type === 'article' ? `Инструкция ${value}` : type === 'category' ? `Раздел ${value}` : 'База знаний'}</h1>
      <a id="helpIndex" href="/help/index.html">Все инструкции</a>
      <a id="helpArticle" href="/help/article.html?slug=install-app">Установить приложение</a>
      <a id="helpCategory" href="/help/category.html?category=settings">Настройки</a>
      <a id="providerReturn" href="/provider.html">Открыть PrimeTime Pro</a>
      <a id="externalGuide" href="/external.html">Внешняя инструкция</a>
    </main>
    <footer class="help-footer">Внешний подвал помощи</footer>`;

async function startFixture() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/provider.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <link rel="stylesheet" href="/provider-help-workspace.css">
        <style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}.ui-icon{width:18px;height:18px}.spacer{height:620px}#dashboard{min-height:1400px;padding:24px;background:#f6faf7}</style>
        <body class="provider-body" data-provider-theme="sage">
          <section id="dashboard" ${url.searchParams.get('auth') === 'login' ? 'hidden' : ''}>
            <a class="provider-help-link" href="/help/index.html" target="_blank" rel="noopener noreferrer">База знаний</a>
            <a class="settings-help-link" href="/help/article.html?slug=install-app" target="_blank" rel="noopener noreferrer">Как установить</a>
            <label>Черновик<input id="draft" value=""></label>
            <div class="spacer"></div><a class="mobile-help-shortcut" href="/help/index.html">База знаний в разделе</a><button id="sourceAction" type="button">Исходное действие</button>
          </section>
          <section id="login">Вход в кабинет</section>
          <script>window.addEventListener('popstate', () => {
            if (window.MinutaProviderHelpWorkspace?.handlesCurrentHistory?.()) return;
            document.body.dataset.providerRenders = String(Number(document.body.dataset.providerRenders || 0) + 1);
            document.querySelector('#draft').value = '';
            window.scrollTo(0, 0);
          });</script>
          <script src="/provider-help-workspace.js"></script>
        </body>`);
      return;
    }
    if (url.pathname === '/provider-help-workspace.js' || url.pathname === '/provider-help-workspace.css' || url.pathname === '/help/help.css') {
      const relative = url.pathname.slice(1);
      response.setHeader('Content-Type', relative.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(await readFile(path.join(root, relative)));
      return;
    }
    if (url.pathname === '/help/index.html') response.end(helpPage());
    else if (url.pathname === '/help/article.html') response.end(helpPage({ type:'article', value:url.searchParams.get('slug') || '' }));
    else if (url.pathname === '/help/category.html') response.end(helpPage({ type:'category', value:url.searchParams.get('category') || '' }));
    else if (url.pathname === '/external.html') response.end('<!doctype html><title>Внешняя инструкция</title><h1>Внешняя инструкция</h1>');
    else response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url:`http://127.0.0.1:${server.address().port}` };
}

const fixture = await startFixture();
const browser = await chromium.launch({
  headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
});

try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.goto(`${fixture.url}/provider.html?section=settings&date=2026-09-15&range=day`);
  await page.locator('#draft').fill('Несохранённый текст');
  await page.evaluate(() => window.scrollTo(0, 540));
  const sourceScroll = await page.evaluate(() => window.scrollY);
  await page.locator('.mobile-help-shortcut').click();

  const workspace = page.locator('#providerHelpWorkspace');
  await workspace.waitFor({ state:'visible' });
  await page.frameLocator('#providerHelpWorkspace iframe').locator('body[data-provider-embedded="true"]').waitFor();
  assert.match(page.url(), /section=settings.*help=index/);
  assert.equal(await page.locator('#draft').inputValue(), 'Несохранённый текст', 'Несохранённое поле должно оставаться в исходном DOM');
  assert.equal(await page.locator('body').getAttribute('data-provider-renders'), null, 'Открытие базы не должно перерисовывать кабинет');
  assert.equal(await page.locator('#dashboard').getAttribute('aria-hidden'), 'true', 'Фон кабинета должен быть скрыт от скринридера');
  assert.equal(await page.frameLocator('#providerHelpWorkspace iframe').locator('.help-header').isVisible(), false, 'Встроенная база не должна дублировать шапку');
  assert.equal(await page.frameLocator('#providerHelpWorkspace iframe').locator('.help-footer').isVisible(), false, 'Встроенная база не должна дублировать подвал');

  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    const geometry = await workspace.evaluate(element => {
      const box = element.getBoundingClientRect();
      const back = element.querySelector('[data-provider-help-back]').getBoundingClientRect();
      const frame = element.querySelector('iframe').getBoundingClientRect();
      return { left:box.left, right:box.right, top:box.top, bottom:box.bottom, width:window.innerWidth, height:window.innerHeight, pageWidth:document.documentElement.scrollWidth, back:{ width:back.width, height:back.height }, frameHeight:frame.height };
    });
    assert.ok(geometry.left === 0 && geometry.right === geometry.width && geometry.top === 0 && geometry.bottom === geometry.height, `Рабочая область должна занимать экран на ${width}px: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.pageWidth <= geometry.width, `Не должно быть горизонтального скролла на ${width}px: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.back.width >= 44 && geometry.back.height >= 44 && geometry.frameHeight > 500, `Кнопка возврата и статья должны быть доступны на ${width}px: ${JSON.stringify(geometry)}`);
  }

  await page.frameLocator('#providerHelpWorkspace iframe').locator('#helpArticle').click();
  await page.waitForURL(/help=article&slug=install-app/);
  assert.match(await page.frameLocator('#providerHelpWorkspace iframe').locator('h1').innerText(), /install-app/);
  await page.evaluate(() => window.history.back());
  await page.waitForURL(/help=index/);
  assert.equal(await workspace.isVisible(), true, 'Back внутри базы должен вернуться к предыдущей странице базы');
  assert.equal(await page.locator('#draft').inputValue(), 'Несохранённый текст', 'Back внутри базы не должен сбрасывать форму кабинета');
  await page.frameLocator('#providerHelpWorkspace iframe').locator('#helpArticle').click();
  await page.waitForURL(/help=article&slug=install-app/);

  const popupPromise = page.waitForEvent('popup');
  await page.frameLocator('#providerHelpWorkspace iframe').locator('#externalGuide').click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.match(popup.url(), /\/external\.html$/);
  assert.match(page.url(), /help=article/, 'Внешняя инструкция не должна уводить вкладку кабинета');
  await popup.close();

  await page.setViewportSize({ width:390, height:844 });
  assert.equal(await page.evaluate(() => history.state.providerHelpOriginScroll), sourceScroll, 'История должна хранить исходную позицию');
  await page.locator('[data-provider-help-back]').click();
  await page.waitForURL(url => !url.searchParams.has('help'));
  assert.equal(await workspace.isHidden(), true);
  assert.equal(await page.locator('#draft').inputValue(), 'Несохранённый текст');
  assert.equal(await page.locator('body').getAttribute('data-provider-renders'), null, 'Возврат из базы не должен перерисовывать исходный раздел');
  await page.waitForFunction(expected => Math.abs(window.scrollY - expected) <= 2, sourceScroll);
  const restoredScroll = await page.evaluate(() => window.scrollY);
  assert.ok(Math.abs(restoredScroll - sourceScroll) <= 2, `Возврат должен восстановить исходную позицию: ${restoredScroll} вместо ${sourceScroll}`);
  assert.equal(new URL(page.url()).searchParams.get('section'), 'settings');
  assert.equal(new URL(page.url()).searchParams.get('date'), '2026-09-15');

  const direct = await browser.newPage({ viewport:{ width:760, height:900 } });
  await direct.goto(`${fixture.url}/provider.html?section=services&help=article&slug=install-app&access_token=secret#refresh_token=secret`);
  await direct.locator('#providerHelpWorkspace').waitFor({ state:'visible' });
  assert.equal(new URL(direct.url()).searchParams.has('access_token'), false, 'Токен нельзя переносить в адрес базы знаний');
  assert.doesNotMatch(new URL(direct.url()).hash, /token|secret/i, 'Секрет нельзя оставлять во фрагменте адреса');
  await direct.reload();
  await direct.locator('#providerHelpWorkspace').waitFor({ state:'visible' });
  await direct.evaluate(() => window.history.back());
  await direct.waitForURL(url => !url.searchParams.has('help'));
  assert.equal(new URL(direct.url()).searchParams.get('section'), 'services', 'Прямая статья должна возвращать в разрешённый раздел кабинета');

  const expired = await browser.newPage({ viewport:{ width:390, height:844 } });
  await expired.goto(`${fixture.url}/provider.html?section=settings&help=category&category=settings&auth=login`);
  assert.equal(await expired.locator('#providerHelpWorkspace').isHidden(), true, 'До действующей сессии база знаний не должна закрывать вход');
  await expired.locator('#dashboard').evaluate(element => { element.hidden = false; });
  await expired.locator('#providerHelpWorkspace').waitFor({ state:'visible' });
  assert.match(expired.url(), /help=category&category=settings/);
  assert.equal(await expired.frameLocator('#providerHelpWorkspace iframe').locator('h1').innerText(), 'Раздел settings');

  console.log('Provider help workspace browser test: OK');
} finally {
  await browser.close();
  await new Promise(resolve => fixture.server.close(resolve));
}
