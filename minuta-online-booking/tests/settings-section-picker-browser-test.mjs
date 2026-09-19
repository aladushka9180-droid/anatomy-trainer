import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { startSettingsNavFixture } from './settings-nav-scroll-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fixture = await startSettingsNavFixture();
const browser = await chromium.launch({ headless:true });
const artifactDir = process.env.SETTINGS_PICKER_ARTIFACT_DIR || '';

try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.goto(fixture.url);
  await page.locator('.settings-section-picker>summary').waitFor({ state:'visible' });

  await page.evaluate(() => {
    const main = document.querySelector('[data-provider-panel="settings"]');
    main.style.margin = '0 12px';
    const nav = document.querySelector('.provider-section-nav');
    const shell = document.querySelector('.settings-nav-scroll-shell');
    const workspace = document.createElement('div');
    const layout = document.createElement('div');
    workspace.className = 'settings-workspace';
    layout.className = 'settings-layout';
    shell.before(workspace);
    workspace.append(shell, layout);
    layout.innerHTML = '<p>Проверка вкладок: без данных клиентов</p><div style="height:1200px"></div>';
    main.insertAdjacentHTML('afterbegin', '<div data-test-lead style="height:180px">Настройки кабинета</div>');
    const longButton = document.createElement('button');
    longButton.type = 'button';
    longButton.dataset.sectionTarget = 'long-section';
    longButton.textContent = 'Очень длинное название раздела с дополнительными параметрами';
    nav.append(longButton);
    nav.addEventListener('click', event => {
      const selected = event.target.closest('[data-section-target]');
      if (!selected) return;
      nav.querySelectorAll('[data-section-target]').forEach(button => {
        button.classList.toggle('active', button === selected);
        if (button === selected) button.setAttribute('aria-current', 'location');
        else button.removeAttribute('aria-current');
      });
    });
  });

  for (const theme of [
    { name:'light', surface:'#f8f5ef', alt:'#eee9df', line:'#c8c1b5', ink:'#26342d', muted:'#69746e', accent:'#bd795c', shadow:'rgba(30,38,34,.22)' },
    { name:'dark', surface:'#1d211f', alt:'#252a27', line:'#515a55', ink:'#f3f1ec', muted:'#a6aea9', accent:'#d38d6c', shadow:'rgba(0,0,0,.5)' }
  ]) {
    await page.evaluate(tokens => {
      for (const [name, value] of Object.entries(tokens)) {
        if (name !== 'name') document.body.style.setProperty(`--theme-${name}`, value);
      }
      document.body.style.background = tokens.surface;
    }, theme);

    for (const width of [390, 760, 1440]) {
      await page.setViewportSize({ width, height:844 });
      await page.evaluate(() => scrollTo(0, 0));
      const picker = page.locator('.settings-section-picker');
      const nav = page.locator('.provider-section-nav');
      if (width <= 760) {
        await assert.doesNotReject(() => picker.waitFor({ state:'visible' }));
        assert.equal(await nav.isVisible(), false, `Боковая навигация видима при ${width}px`);
        const initialHeight = await picker.evaluate(element => element.getBoundingClientRect().height);
        assert.ok(initialHeight >= 44 && initialHeight <= 64, `Высота селектора не компактна при ${width}px: ${initialHeight}`);
        await page.evaluate(() => scrollTo(0, 260));
        await page.waitForFunction(() => document.querySelector('.settings-nav-scroll-shell')?.classList.contains('is-stuck'));
        const stuck = await picker.evaluate(element => {
          const box = element.getBoundingClientRect();
          const shell = element.parentElement;
          const style = getComputedStyle(element.querySelector('summary'));
          return {
            top:shell.getBoundingClientRect().top,
            height:box.height,
            background:style.backgroundColor,
            pageWidth:document.documentElement.scrollWidth,
            viewport:innerWidth
          };
        });
        assert.ok(stuck.top >= 5 && stuck.top <= 7, `Sticky-позиция неверна при ${width}px: ${JSON.stringify(stuck)}`);
        assert.equal(stuck.height, initialHeight, `Высота меняется при закреплении на ${width}px`);
        assert.notEqual(stuck.background, 'rgba(0, 0, 0, 0)', 'Закреплённая панель должна быть непрозрачной');
        assert.ok(stuck.pageWidth <= stuck.viewport, `Горизонтальное переполнение при ${width}px: ${JSON.stringify(stuck)}`);
        if (artifactDir) {
          await mkdir(artifactDir, { recursive:true });
          await page.screenshot({ path:path.join(artifactDir, `settings-picker-${theme.name}-${width}.png`), fullPage:false });
        }
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForFunction(() => !document.querySelector('.settings-nav-scroll-shell')?.classList.contains('is-stuck'));
      } else {
        assert.equal(await picker.isVisible(), false, 'Мобильный селектор виден на десктопе');
        assert.equal(await nav.isVisible(), true, 'Десктопная навигация скрыта');
        if (artifactDir) {
          await mkdir(artifactDir, { recursive:true });
          await page.screenshot({ path:path.join(artifactDir, `settings-picker-${theme.name}-${width}.png`), fullPage:false });
        }
      }
    }
  }

  await page.setViewportSize({ width:390, height:844 });
  const summary = page.locator('.settings-section-picker>summary');
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
  await page.keyboard.press('Tab');
  const focus = await page.locator('.settings-section-picker').evaluate(element => {
    const style = getComputedStyle(element);
    return { active:document.activeElement === element.querySelector('summary'), outlineStyle:getComputedStyle(element.querySelector('summary')).outlineStyle, outlineWidth:getComputedStyle(element.querySelector('summary')).outlineWidth };
  });
  assert.equal(focus.active, true, `Клавиатурный фокус не попал в селектор: ${JSON.stringify(focus)}`);
  assert.notEqual(focus.outlineStyle, 'none', `Фокус селектора не виден: ${JSON.stringify(focus)}`);
  assert.notEqual(focus.outlineWidth, '0px', `Фокус селектора не виден: ${JSON.stringify(focus)}`);
  await page.evaluate(() => document.activeElement?.blur());
  await summary.click();
  assert.equal(await summary.evaluate(element => document.activeElement === element), true, 'Компактная строка не получает фокус по нажатию');
  assert.equal(await page.locator('.settings-section-picker').evaluate(element => element.open), true, 'Меню не открылось по явному tap');
  if (artifactDir) await page.screenshot({ path:path.join(artifactDir, 'settings-picker-dark-390-open.png'), fullPage:false });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.settings-section-picker').evaluate(element => element.open), false, 'Escape не закрыл меню');
  await summary.click();
  await page.locator('[data-settings-section-target="long-section"]').click();
  assert.equal(await page.locator('.settings-section-picker').evaluate(element => element.open), false, 'Выбор раздела не закрыл меню');
  await page.waitForFunction(() => document.querySelector('.settings-section-picker-current')?.textContent.startsWith('Очень длинное'));
  const longName = await page.locator('.settings-section-picker-current').evaluate(element => ({
    text:element.textContent,
    overflow:getComputedStyle(element).textOverflow,
    whiteSpace:getComputedStyle(element).whiteSpace,
    right:element.getBoundingClientRect().right,
    pickerRight:element.parentElement.getBoundingClientRect().right,
    pageWidth:document.documentElement.scrollWidth,
    viewport:innerWidth
  }));
  assert.equal(longName.overflow, 'ellipsis');
  assert.equal(longName.whiteSpace, 'nowrap');
  assert.ok(longName.right < longName.pickerRight, `Текст перекрывает шеврон: ${JSON.stringify(longName)}`);
  assert.ok(longName.pageWidth <= longName.viewport, `Длинное название создало переполнение: ${JSON.stringify(longName)}`);
  assert.match(longName.text, /^Очень длинное название/);
  await summary.click();
  await page.locator('[data-test-lead]').click({ position:{ x:8, y:8 } });
  assert.equal(await page.locator('.settings-section-picker').evaluate(element => element.open), false, 'Tap снаружи не закрыл меню');
  await summary.click();
  await page.evaluate(() => scrollTo(0, 120));
  assert.equal(await page.locator('.settings-section-picker').evaluate(element => element.open), false, 'Прокрутка страницы не закрыла меню');
  await summary.click();
  await page.evaluate(() => dispatchEvent(new PopStateEvent('popstate')));
  assert.equal(await page.locator('.settings-section-picker').evaluate(element => element.open), false, 'Back/popstate не закрыл меню');
  await summary.click();
  await page.evaluate(() => {
    const panel = document.querySelector('[data-provider-panel="settings"]');
    panel.hidden = true;
    panel.classList.remove('active');
  });
  await page.waitForFunction(() => !document.querySelector('.settings-section-picker').open);
  assert.equal(await page.locator('.settings-section-picker').evaluate(element => element.open), false, 'Смена экрана не закрыла меню');

  const fullContext = await browser.newContext({
    viewport:{ width:390, height:844 },
    deviceScaleFactor:1,
    isMobile:true,
    hasTouch:true,
    colorScheme:'dark',
    bypassCSP:true
  });
  const fullPage = await fullContext.newPage();
  await fullPage.route(/\.js(?:\?|$)/, route => route.abort());
  await fullPage.goto(`${fixture.url}provider.html`, { waitUntil:'domcontentloaded' });
  await fullPage.evaluate(() => {
    document.documentElement.classList.remove('provider-booting');
    document.documentElement.classList.add('top-level');
    document.querySelector('#providerBoot').hidden = true;
    document.querySelector('#authCard').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    document.body.dataset.providerTheme = 'loft';
    document.body.dataset.providerLayout = 'bento';
    document.body.dataset.providerColorMode = 'dark';
    document.body.dataset.providerResolvedColorMode = 'dark';
    document.body.dataset.providerColorVariant = 'native';
    document.body.dataset.providerTextScale = 'default';
    document.body.style.colorScheme = 'dark';

    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = true;
      view.classList.remove('active');
    });
    const settings = document.querySelector('[data-provider-panel="settings"]');
    settings.hidden = false;
    settings.classList.add('active');
    document.querySelector('#settingsQuickStart').hidden = true;
    document.querySelectorAll('.settings-layout > .settings-card').forEach(card => {
      const selected = card.id === 'bookingRulesCard';
      card.style.display = selected ? 'grid' : 'none';
      card.setAttribute('aria-hidden', String(!selected));
    });
    document.querySelector('#organizationBookingPolicyPanel').hidden = false;
    document.querySelector('#organizationBookingPolicyLoading').hidden = true;
    document.querySelector('#organizationBookingPolicyWorkspace').hidden = false;
    document.querySelector('#organizationBookingPoliciesEnabled').checked = true;
    document.querySelector('#organizationBookingPolicyRules').innerHTML = '<article class="organization-policy-rule"><div><strong>Вся организация</strong><small>Отмена 12 ч · перенос 12 ч · до 2 раз</small><small>Предоплата: не требуется · возврат до срока отмены</small></div><span><button class="secondary-button" type="button" data-policy-edit="preview">Изменить</button></span></article>';
    document.querySelector('#cancelCutoffHours').value = '12';
    document.querySelector('#rescheduleCutoffHours').value = '12';
    document.querySelector('#maxReschedules').value = '2';
    document.querySelector('#depositSettings').hidden = true;
    document.querySelectorAll('.provider-section-nav [data-section-target]').forEach(button => {
      const selected = button.dataset.sectionTarget === 'bookingRulesCard';
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
    document.querySelector('#mobileNewBookingButton').hidden = true;
    document.querySelectorAll('.provider-mobile-nav [data-provider-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.providerView === 'more');
    });
  });
  await fullPage.unroute(/\.js(?:\?|$)/);
  await fullPage.addScriptTag({ url:`${fixture.url}settings-nav-scroll.js` });
  await fullPage.locator('.settings-section-picker').waitFor({ state:'visible' });
  await fullPage.evaluate(() => scrollTo(0, document.querySelector('#bookingRulesCard').offsetTop + 360));
  await fullPage.waitForFunction(() => document.querySelector('.settings-nav-scroll-shell')?.classList.contains('is-stuck'));

  const fullEvidence = await fullPage.evaluate(() => {
    const shell = document.querySelector('.settings-nav-scroll-shell').getBoundingClientRect();
    const picker = document.querySelector('.settings-section-picker').getBoundingClientRect();
    const card = document.querySelector('#bookingRulesCard').getBoundingClientRect();
    const form = document.querySelector('#bookingPolicyForm').getBoundingClientRect();
    const mobileNav = document.querySelector('.provider-mobile-nav').getBoundingClientRect();
    return {
      viewport:{ width:innerWidth, height:innerHeight },
      theme:document.body.dataset.providerTheme,
      shell:{ top:shell.top, bottom:shell.bottom, height:shell.height },
      picker:{ top:picker.top, bottom:picker.bottom, height:picker.height },
      card:{ top:card.top, bottom:card.bottom },
      form:{ top:form.top, bottom:form.bottom },
      mobileNav:{ top:mobileNav.top, bottom:mobileNav.bottom },
      pageWidth:document.documentElement.scrollWidth
    };
  });
  assert.equal(fullEvidence.viewport.width, 390, `Полный экран открыт не на 390px: ${JSON.stringify(fullEvidence)}`);
  assert.equal(fullEvidence.theme, 'loft', `Полный экран открыт не в теме Loft: ${JSON.stringify(fullEvidence)}`);
  assert.ok(fullEvidence.shell.top >= 5 && fullEvidence.shell.top <= 7, `Панель не закрепилась на полном экране: ${JSON.stringify(fullEvidence)}`);
  assert.ok(fullEvidence.card.top < fullEvidence.picker.bottom && fullEvidence.card.bottom > fullEvidence.picker.bottom, `Не видна граница sticky-наложения с формой: ${JSON.stringify(fullEvidence)}`);
  assert.ok(fullEvidence.form.top < fullEvidence.viewport.height && fullEvidence.form.bottom > fullEvidence.picker.bottom, `Соседняя форма не видна: ${JSON.stringify(fullEvidence)}`);
  assert.ok(fullEvidence.mobileNav.top < fullEvidence.viewport.height && fullEvidence.viewport.height - fullEvidence.mobileNav.bottom <= 10, `Нижняя навигация не видна: ${JSON.stringify(fullEvidence)}`);
  assert.ok(fullEvidence.pageWidth <= fullEvidence.viewport.width, `Полный экран имеет горизонтальное переполнение: ${JSON.stringify(fullEvidence)}`);
  const fullType = await fullPage.locator('.settings-section-picker').evaluate(element => ({
    label:getComputedStyle(element.querySelector('.settings-section-picker-label')).fontSize,
    current:getComputedStyle(element.querySelector('.settings-section-picker-current')).fontSize
  }));
  assert.equal(fullType.label, '8px', `Служебная подпись стала слишком крупной: ${JSON.stringify(fullType)}`);
  assert.equal(fullType.current, '15px', `Выбранный раздел недостаточно читаем: ${JSON.stringify(fullType)}`);
  if (artifactDir) {
    await mkdir(artifactDir, { recursive:true });
    await fullPage.screenshot({ path:path.join(artifactDir, 'settings-picker-loft-390-full.png'), fullPage:false });
  }
  await fullContext.close();

  console.log('Settings section picker browser regression: OK');
} finally {
  await browser.close();
  await new Promise(resolve => fixture.server.close(resolve));
}
