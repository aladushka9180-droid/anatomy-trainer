import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const screenshotRoot = process.env.HELP_ROSE_SCREENSHOT_DIR;
const providerHead = (await readFile(path.join(root, 'provider.html'), 'utf8')).split('</head>')[0].replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '');
const providerStyles = [...providerHead.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]).join('\n');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/minuta-online-booking/__help-host.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        ${providerStyles}
        <style>body{margin:0;font:16px Arial,sans-serif}.ui-icon{width:18px;height:18px}</style>
        <body class="provider-body" data-provider-theme="sage"><main id="dashboard">
          <a class="provider-help-link" href="help/index.html">База знаний</a>
          <input id="draft" value="Локальный черновик"></main>
        <script src="provider-help-workspace.js"></script></body>`);
      return;
    }
    const relative = decodeURIComponent(url.pathname.replace(/^\/minuta-online-booking\//, ''));
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`);
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}/minuta-online-booking/help/`;
const errors = [];
let browser;
let assertions = 0;
const verify = (condition, message) => { assert.ok(condition, message); assertions += 1; };
try {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(edge) ? edge : undefined);
  browser = await chromium.launch({ headless:true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ serviceWorkers:'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (screenshotRoot) await mkdir(screenshotRoot, { recursive:true });
  const capturePage = async name => {
    // Full-page capture starts at the top after loading lazy article images.
    await page.evaluate(() => { window.scrollTo({ top:0, left:0, behavior:'instant' }); });
    await page.waitForFunction(() => window.scrollY === 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path:path.join(screenshotRoot, name), fullPage:true });
  };
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    await page.goto(`${base}index.html?audience=specialist`);
    await page.locator('.quick-start-card').first().waitFor();
    verify(await page.locator('.help-topic-group').count() === 5, `${width}: все пять групп тем`);
    verify(await page.locator('.section-card').count() === 14, `${width}: все разделы специалиста`);
    verify(await page.locator('.quick-start-card').count() === 4, `${width}: быстрый старт`);
    verify(await page.evaluate(() => {
      const quick = new Set([...document.querySelectorAll('#quickStartGuides a')].map(link => new URL(link.href).searchParams.get('slug')));
      return [...document.querySelectorAll('#popularGuides a')].every(link => !quick.has(new URL(link.href).searchParams.get('slug')));
    }), `${width}: полезные действия не повторяют быстрый старт`);
    verify(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: главная без горизонтального переполнения`);
    if (screenshotRoot) await capturePage(`home-${width}.png`);

    const input = page.getByRole('searchbox', { name:'Поиск по базе знаний' });
    const titleResults = await page.evaluate(() => {
      const input = document.querySelector('#helpSearchInput');
      return window.MINUTA_HELP_ARTICLES.map(article => {
        document.querySelector(`button[data-audience="${article.audience}"]`).click();
        input.value = article.title;
        input.dispatchEvent(new Event('input', { bubbles:true }));
        return { slug:article.slug, found:new URL(document.querySelector('#searchResults a')?.href || location.href).searchParams.get('slug') };
      });
    });
    titleResults.forEach(result => verify(result.found === result.slug, `${width}/${result.slug}: поиск по полному заголовку`));
    await page.getByRole('button', { name:'Для специалиста', exact:true }).click();
    await input.fill('как изменить услугу');
    verify(await page.locator('#searchResults a').count() > 0, `${width}: поиск по словам и формам`);
    verify(await page.locator('#searchResults a').first().innerText().then(text => /услуг/i.test(text)), `${width}: релевантная услуга вверху`);
    await input.press('ArrowDown');
    verify(await page.evaluate(() => document.activeElement.closest('#searchResults') !== null), `${width}: переход с клавиатуры к ответам`);
    await page.locator('#searchResults a').first().press('Escape');
    verify(await input.evaluate(element => document.activeElement === element), `${width}: Escape возвращает фокус поиску`);
    await input.fill('лояльность награда');
    verify(await page.locator('#searchResults a').count() > 0, `${width}: поиск новой программы лояльности`);
    for (const [query, expected] of [
      ['как посчитать прибыль', ['statistics-overview', 'statistics-sections']],
      ['как сделать возврат', ['refund-sale-accounting', 'yookassa-refund']],
      ['как отправить напоминание', ['notification-queue', 'telegram']],
      ['как поменять цвет', ['cabinet-layout-theme', 'client-page-appearance']]
    ]) {
      await input.fill(query);
      const firstSlug = await page.locator('#searchResults a').first().getAttribute('href');
      verify(expected.includes(new URL(firstSlug, base).searchParams.get('slug')), `${width}: понятный запрос «${query}» находит нужную инструкцию`);
    }
    await page.getByRole('button', { name:'Для клиента', exact:true }).click();
    verify(await page.locator('.section-card').count() === 2, `${width}: отдельные клиентские разделы`);
    verify(await page.locator('.section-card').allTextContents().then(texts => texts.every(text => !/зарплат|склад/i.test(text))), `${width}: Pro не смешан с клиентской помощью`);
    verify(await page.evaluate(() => {
      const quick = new Set([...document.querySelectorAll('#quickStartGuides a')].map(link => new URL(link.href).searchParams.get('slug')));
      return [...document.querySelectorAll('#popularGuides a')].every(link => !quick.has(new URL(link.href).searchParams.get('slug')));
    }), `${width}: клиентские полезные действия не повторяют быстрый старт`);
    if (screenshotRoot) await capturePage(`client-home-${width}.png`);
    for (const [query, expected] of [
      ['как получить напоминание', 'connect-telegram'],
      ['что делать если нет времени', 'join-booking-waitlist']]
    ) {
      await input.fill(query);
      const firstSlug = await page.locator('#searchResults a').first().getAttribute('href');
      verify(new URL(firstSlug, base).searchParams.get('slug') === expected, `${width}: клиентский запрос «${query}» находит нужную инструкцию`);
    }
    for (const query of ['расписание', 'график', 'свободные окна']) {
      await input.fill(query);
      const resultSlugs = await page.locator('#searchResults a').evaluateAll(links => links.map(link => new URL(link.href).searchParams.get('slug')));
      verify(resultSlugs[0] === 'book-online', `${width}: клиент находит выбор времени по запросу «${query}»`);
      verify(await page.evaluate(slugs => slugs.every(slug => window.MINUTA_HELP_ARTICLES.find(article => article.slug === slug)?.audience === 'client'), resultSlugs), `${width}: поиск «${query}» показывает только клиентские инструкции`);
    }
    if (screenshotRoot) {
      await input.fill('расписание');
      await capturePage(`client-search-schedule-${width}.png`);
    }
    await input.fill('неопределённый результат');
    verify(await page.locator('#searchResults a').count() > 0, `${width}: помощь при неопределённой записи`);
    await input.fill('zzzzzzzzzzz');
    verify(await page.locator('.search-empty').isVisible(), `${width}: понятный пустой поиск`);

    await page.goto(`${base}article.html?slug=employee-rights`);
    await page.locator('#articleSteps .article-step').first().waitFor();
    verify(await page.locator('#articlePrerequisites').isVisible(), `${width}: условия перед началом`);
    verify(await page.locator('#articleOutcome').isVisible(), `${width}: проверка результата`);
    verify(await page.locator('#articleTroubleshooting').isVisible(), `${width}: решение проблем`);
    verify(await page.locator('#articleSteps .article-step').count() === await page.locator('#articleToc nav a').count(), `${width}: все шаги в содержании`);
    verify(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: статья без горизонтального переполнения`);
    if (screenshotRoot) await capturePage(`article-${width}.png`);
    await page.locator('#articleToc summary').click();
    await page.locator('#articleToc nav a').first().click();
    verify(await page.url().includes('#step-1'), `${width}: переход к выбранному шагу`);
    const zoom = page.locator('.article-visual button').first();
    verify(await zoom.count() > 0, `${width}: иллюстрация инструкции присутствует`);
    await zoom.locator('img').evaluate(image => image.decode());
    verify(await zoom.locator('img').evaluate(image => image.getBoundingClientRect().width <= image.naturalWidth + 1), `${width}: снимок в статье не растягивается сверх исходного размера`);
    await zoom.click();
    verify(await page.locator('#articleVisualDialog').evaluate(element => element.open), `${width}: увеличение изображения`);
    await page.waitForFunction(() => { const image = document.querySelector('#articleVisualFull'); return image.complete && image.naturalWidth > 0; });
    verify(await page.locator('#articleVisualFull').evaluate(image => image.getBoundingClientRect().width <= image.naturalWidth + 1), `${width}: увеличение не растягивает снимок сверх исходного размера`);
    if (screenshotRoot) await capturePage(`zoom-${width}.png`);
    await page.keyboard.press('Escape');
    verify(!await page.locator('#articleVisualDialog').evaluate(element => element.open), `${width}: закрытие увеличения клавишей Escape`);
    await page.locator('#articleTroubleshooting details summary').first().click();
    verify(await page.locator('#articleTroubleshooting details').first().evaluate(element => element.open), `${width}: раскрытие помощи`);
    await page.locator('#articleBackLink').click();
    verify(new URL(page.url()).searchParams.get('audience') === 'specialist', `${width}: возврат сохраняет аудиторию`);
  }

  const provider = '00000000-0000-4000-8000-000000000001';
  await page.goto(`${base}index.html?audience=client&org=rose-demo&provider=${provider}&access_token=synthetic-private-marker`);
  await page.locator('.quick-start-card').first().waitFor();
  const first = page.locator('.quick-start-card').first();
  const link = new URL(await first.getAttribute('href'), page.url());
  verify(link.searchParams.get('org') === 'rose-demo' && link.searchParams.get('provider') === provider, 'Публичный контекст записи сохранён');
  verify(!link.searchParams.has('access_token'), 'Секретный параметр не переносится в помощь');
  await first.click();
  await page.locator('#articlePrerequisites').waitFor({ state:'visible' });
  const returnUrl = new URL(await page.locator('#productLink').getAttribute('href'), page.url());
  verify(returnUrl.searchParams.get('org') === 'rose-demo' && returnUrl.searchParams.get('provider') === provider, `Возврат к записи сохраняет организацию и специалиста: ${returnUrl.pathname}${returnUrl.search}`);
  verify(!returnUrl.searchParams.has('access_token'), 'Секретный параметр не переносится в запись');
  await page.goto(`${base}index.html?audience=client&org=invalid%20organization`);
  await page.locator('.quick-start-card').first().waitFor();
  const freshLink = new URL(await page.locator('.quick-start-card').first().getAttribute('href'), page.url());
  verify(!freshLink.searchParams.has('org') && !freshLink.searchParams.has('provider'), 'Повреждённый новый контекст не подставляет прежнюю организацию');

  await page.goto(`${base}index.html?audience=specialist`);
  const articles = await page.evaluate(() => window.MINUTA_HELP_ARTICLES.map(article => ({ slug:article.slug, title:article.title, steps:article.steps.length, audience:article.audience, updatedAt:article.updatedAt })));
  const categories = await page.evaluate(() => window.MINUTA_HELP_CATEGORIES.map(category => ({ slug:category.slug, title:category.title })));
  const rosePage = () => page.evaluate(() => ({ background:getComputedStyle(document.body).backgroundColor, overflow:document.documentElement.scrollWidth > innerWidth }));
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    for (const category of categories) {
      await page.goto(`${base}category.html?category=${encodeURIComponent(category.slug)}`);
      await page.locator('#categoryList a').first().waitFor();
      const appearance = await rosePage();
      verify(appearance.background === 'rgb(255, 247, 250)', `${width}/${category.slug}: нежно-розовое оформление раздела`);
      verify(!appearance.overflow, `${width}/${category.slug}: раздел без переполнения`);
      const shown = await page.locator('#categoryList a').evaluateAll(links => links.map(link => new URL(link.href).searchParams.get('slug')));
      const expected = await page.evaluate(slug => window.MINUTA_HELP_ARTICLES.filter(article => article.categorySlug === slug).map(article => article.slug), category.slug);
      verify(shown.length === expected.length && new Set(shown).size === expected.length && expected.every(slug => shown.includes(slug)), `${width}/${category.slug}: все статьи доступны ровно один раз`);
      if (screenshotRoot && category.slug === 'services') await capturePage(`category-services-${width}.png`);
    }
    for (const article of articles) {
      await page.goto(`${base}article.html?slug=${encodeURIComponent(article.slug)}`);
      await page.locator('#articleSteps .article-step').first().waitFor();
      verify(await page.locator('#articleTitle').innerText() === article.title, `${width}/${article.slug}: статья открывается`);
      verify(await page.locator('#articleSteps .article-step').count() === article.steps, `${width}/${article.slug}: шаги не обрезаны`);
      verify(await page.locator('#articlePrerequisites').isVisible() && await page.locator('#articleOutcome').isVisible() && await page.locator('#articleTroubleshooting').isVisible(), `${width}/${article.slug}: полная структура`);
      verify(await page.locator('#articleMeta').innerText().then(text => text.includes('Обновлено') && !text.includes('Проверено')), `${width}/${article.slug}: честная дата редакции`);
      for (const image of await page.locator('.article-visual img[loading="lazy"]').all()) await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll('.article-visual img')].every(image => image.complete && image.naturalWidth > 0), undefined, { timeout:5000 });
      verify(await page.locator('.article-visual img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), `${width}/${article.slug}: изображения загружены`);
      const appearance = await rosePage();
      verify(appearance.background === 'rgb(255, 247, 250)', `${width}/${article.slug}: нежно-розовое оформление статьи`);
      verify(!appearance.overflow, `${width}/${article.slug}: статья без переполнения`);
      const visualFooters = await page.locator('.article-visual > button').evaluateAll(buttons => buttons.every(button => {
        const image = button.querySelector('img');
        const caption = button.querySelector(':scope > span');
        return !image || (caption && caption.getBoundingClientRect().top >= image.getBoundingClientRect().bottom - 1);
      }));
      verify(visualFooters, `${width}/${article.slug}: увеличение не перекрывает изображение`);
      if (screenshotRoot && article.slug === 'view-team-calendar') await capturePage(`schedule-${width}.png`);
      if (screenshotRoot && article.slug === 'find-and-filter-bookings') await capturePage(`bookings-${width}.png`);
      if (screenshotRoot && ['book-online', 'reschedule'].includes(article.slug)) await capturePage(`client-article-${article.slug}-${width}.png`);
      if (screenshotRoot && article.updatedAt === '6 октября 2026') await capturePage(`revised-${article.slug}-${width}.png`);
    }
    await page.goto(`${base}article.html?slug=book-online`);
    const nativePhoto = page.locator('.article-visual[data-kind="screenshot"] img').first();
    await nativePhoto.waitFor();
    await nativePhoto.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.article-visual[data-kind="screenshot"] img')?.complete);
    const displayedPhoto = await nativePhoto.evaluate(image => image.currentSrc);
    verify(displayedPhoto.endsWith(`client-service-picker-${width}.webp`), `${width}: снимок показывает соответствующий размер интерфейса`);
    await page.locator('.article-visual[data-kind="screenshot"] button').first().click();
    verify(await page.locator('#articleVisualFull').getAttribute('src') === displayedPhoto, `${width}: увеличение открывает показанный снимок`);
    await page.keyboard.press('Escape');
    await page.goto(`${base}article.html?slug=view-team-calendar`);
    const providerPhoto = page.locator('.article-visual[data-kind="screenshot"] img').first();
    await providerPhoto.waitFor();
    await providerPhoto.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.article-visual[data-kind="screenshot"] img')?.complete);
    const displayedProviderPhoto = await providerPhoto.evaluate(image => image.currentSrc);
    verify(displayedProviderPhoto.endsWith(`personal-calendar-${width}.webp`), `${width}: основной снимок показывает личное расписание в соответствующем размере`);
    await page.locator('.article-visual[data-kind="screenshot"] button').first().click();
    verify(await page.locator('#articleVisualFull').getAttribute('src') === displayedProviderPhoto, `${width}: увеличение снимка кабинета сохраняет выбранную версию`);
    await page.keyboard.press('Escape');
    const teamPhoto = page.locator('.article-visual[data-kind="screenshot"] img[src*="team-calendar-"]');
    await teamPhoto.scrollIntoViewIfNeeded();
    await teamPhoto.evaluate(image => image.decode());
    const displayedTeamPhoto = await teamPhoto.evaluate(image => image.currentSrc);
    verify(displayedTeamPhoto.endsWith(`team-calendar-${width}.webp`), `${width}: фильтры команды показаны отдельным адаптивным снимком`);
    const teamImageBox = await teamPhoto.boundingBox();
    const teamZoomBox = await page.locator('.article-visual:has(img[src*="team-calendar-"]) button > span').boundingBox();
    verify(teamZoomBox.y >= teamImageBox.y + teamImageBox.height - 1, `${width}: кнопка увеличения не перекрывает фильтры на узком снимке`);
    await page.locator('.article-visual[data-kind="screenshot"]:has(img[src*="team-calendar-"]) button').click();
    verify(await page.locator('#articleVisualFull').getAttribute('src') === displayedTeamPhoto, `${width}: увеличение фильтров команды открывает их показанную версию`);
    await page.keyboard.press('Escape');
    await page.goto(`${origin}/minuta-online-booking/__help-host.html?section=organization`);
    await page.getByRole('link', { name:'База знаний', exact:true }).click();
    const frame = page.frameLocator('#providerHelpWorkspace iframe');
    await frame.locator('.quick-start-card').first().waitFor();
    await frame.getByRole('button', { name:'Для специалиста', exact:true }).click();
    verify(await page.locator('.provider-help-workspace-bar').evaluate(element => getComputedStyle(element).backgroundColor) === 'rgb(255, 247, 250)', `${width}: розовая оболочка кабинета`);
    verify(await frame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor) === 'rgb(255, 247, 250)', `${width}: розовая база внутри кабинета`);
    await page.locator('body').evaluate(element => { element.dataset.providerTheme = 'oled-mono'; });
    verify(await page.locator('.provider-help-workspace-bar').evaluate(element => getComputedStyle(element).backgroundColor) === 'rgb(255, 247, 250)', `${width}: розовая оболочка при тёмной теме кабинета`);
    verify(await frame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor) === 'rgb(255, 247, 250)', `${width}: розовая база при тёмной теме кабинета`);
    await page.locator('body').evaluate(element => { element.dataset.providerTheme = 'sage'; });
    if (screenshotRoot) await capturePage(`embedded-${width}.png`);
    await page.getByRole('button', { name:'Назад в Eldion Pro', exact:true }).click();
    verify(await page.locator('#draft').inputValue() === 'Локальный черновик', `${width}: возврат сохраняет состояние кабинета`);
  }
  await page.goto(`${base}category.html?category=services`);
  verify(await page.locator('#categoryList a').count() >= 5, 'Услуги: создание, изменение, скрытие/удаление, прайс и виджет');
  await page.goto(`${base}article.html?slug=does-not-exist`);
  verify(await page.locator('#articleTitle').innerText() === 'Инструкция не найдена', 'Повреждённая ссылка объяснена');
  verify(await page.locator('#articleToc').isHidden(), 'Не существует пустого содержания неизвестной статьи');
  verify(errors.length === 0, `Нет ошибок JavaScript: ${errors.join('; ')}`);
  console.log(`Help knowledge rose: PASS (${articles.length} articles, ${assertions} assertions; local isolated fixture, no production access)`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
