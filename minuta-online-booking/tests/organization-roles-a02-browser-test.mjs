import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --project-root=<integrated checkout> reads its real files without patching.
// Reads the committed runtime directly; synthetic data only.
// Only synthetic membership data reaches the browser. Every network request is blocked.
const here = dirname(fileURLToPath(import.meta.url));
const projectArg = process.argv.find(arg => arg.startsWith('--project-root='));
const project = projectArg ? resolve(projectArg.slice('--project-root='.length)) : resolve(here, '../..');
const output = resolve(project, 'outputs/a02-roles');
mkdirSync(output, { recursive:true });
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const require = createRequire(import.meta.url);
const { chromium } = modulePath ? await import(pathToFileURL(modulePath).href) : require('playwright');
const sourceRoot = project;
const paths = [
  'minuta-online-booking/provider.html',
  'minuta-online-booking/organization.js',
  'minuta-online-booking/contextual-help.js',
  'minuta-online-booking/help/help-data.js'
];
let browser;
try {
  const html = readFileSync(join(sourceRoot, paths[0]), 'utf8');
  const source = readFileSync(join(sourceRoot, paths[1]), 'utf8');
  const contextual = readFileSync(join(sourceRoot, paths[2]), 'utf8');
  const help = readFileSync(join(sourceRoot, paths[3]), 'utf8');
  const cssLayers = [...html.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '').matchAll(/<link\s+rel="stylesheet"[^>]*href="([^"?]+)(?:\?[^"]*)?"[^>]*>/g)].map(match => ({ name:match[1], media:match[0].match(/media="([^"]+)"/)?.[1] || '' }));
  const css = cssLayers.map(layer => ({ ...layer, content:readFileSync(join(project, 'minuta-online-booking', layer.name), 'utf8') }));
  const worker = readFileSync(join(project, 'minuta-online-booking/sw.js'), 'utf8');
  const assetBlock = worker.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1] || '';
  const assets = [...assetBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(assets.length > 0, 'real service-worker asset list must load');
  const precacheBytes = assets.reduce((total, asset) => {
    const relative = `minuta-online-booking/${asset.split('?')[0].replace(/^\.\//, '')}`;
    const absolute = join(project, relative);
    return total + (/\.(?:css|html|js|json|svg|webmanifest)$/i.test(relative)
      ? Buffer.byteLength(readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n'))
      : statSync(absolute).size);
  }, 0);
  // Keep the approved 512-byte manual client-history reserve aligned with the startup budget.
  // Exact v1048 total: closed-day rendering adds 825 bytes; no spare allowance.
  // Keep this measured offline-shell cap aligned with the startup test.
  // v1049 adds 417 measured CSS bytes for visible desktop closed-day labels; no reserve.
  // Same measured cap as the startup test: the optional add-on form adds no assets
  // to this shell; its entry/loader adds 1,419 bytes (3,798,946 -> 3,800,365), no reserve.
  assert.ok(precacheBytes <= 3_800_365, `Core precache is too large: ${precacheBytes} bytes`);
  const roleArticle = help.split("makeArticle('roles-access-safety'")[1]?.split("makeArticle('service-resources'")[0] || '';
  assert.ok(roleArticle.includes('Доступа к организации') && roleArticle.includes('аккаунт сохраняется'), 'linked article must explain this organization and account preservation');
  assert.ok(!roleArticle.includes('«Доступ активен»'), 'stale A02 toggle label must be gone');
  browser = await chromium.launch({ headless:true,
    ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  const errors = [], attemptedRequests = [];
  for (const width of [390, 760, 1440]) {
    for (const role of ['owner', 'admin', 'specialist']) {
      const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
      page.on('pageerror', error => errors.push(`${width}/${role}: ${error.message}`));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://a02-synthetic.test/') {
          return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><meta charset="utf-8"><body></body></html>' });
        }
        attemptedRequests.push(route.request().url());
        return route.abort();
      });
      await page.goto('https://a02-synthetic.test/');
      await page.evaluate(markup => {
        const parsed = new DOMParser().parseFromString(markup, 'text/html');
        const panel = parsed.querySelector('[data-provider-panel="organization"]');
        if (!panel) throw new Error('Real organization panel missing');
        document.body.className = 'provider-body';
        document.body.dataset.providerTheme = 'pink-porcelain';
        document.body.dataset.providerPorcelainCharacter = 'pearl';
        document.body.dataset.providerLayout = 'soft';
        document.body.dataset.providerTextScale = 'default';
        document.body.style.margin = '0';
        const main = document.createElement('main');
        main.style.cssText = 'max-width:1100px;margin:auto;padding:12px;box-sizing:border-box';
        const copy = document.importNode(panel, true);
        copy.hidden = false;
        main.append(copy);
        document.body.append(main);
      }, html);
      for (const layer of css) { const style = await page.addStyleTag({ content:layer.content }); if (layer.media) await style.evaluate((node,media) => { node.media = media; }, layer.media); }
      await page.addScriptTag({ content:help });
      await page.addScriptTag({ content:contextual });
      await page.addScriptTag({ content:source });
      await page.evaluate(async selectedRole => {
        const members = [
          { user_id:'synthetic-owner', display_name:'Тест владелец', email:'owner@example.invalid', role:'owner', active:true, is_bookable:true, is_current_user:selectedRole==='owner' },
          { user_id:'synthetic-admin', display_name:'Тест администратор', email:'admin@example.invalid', role:'admin', active:true, is_bookable:false, is_current_user:selectedRole==='admin' },
          { user_id:'synthetic-active-bookable', display_name:'Тест специалист А', email:'one@example.invalid', role:'specialist', active:true, is_bookable:true, is_current_user:selectedRole==='specialist' },
          { user_id:'synthetic-inactive-bookable', display_name:'Тест специалист Б', email:'two@example.invalid', role:'specialist', active:false, is_bookable:true, is_current_user:false },
          { user_id:'synthetic-inactive-unbookable', display_name:'Тест специалист В', email:'three@example.invalid', role:'specialist', active:false, is_bookable:false, is_current_user:false }
        ];
        window.a02RpcCalls = [];
        const currentMembers = selectedRole === 'specialist' ? [members[2]] : members;
        const organization = {
          id:'synthetic-org', name:'Тестовая организация', public_slug:'a02-synthetic',
          public_booking_enabled:true, current_role:selectedRole,
          can_manage:selectedRole !== 'specialist',
          locations:[], members:currentMembers, invitations:[], audit:[]
        };
        const controller = MinutaOrganization.createController({
          db:{ rpc:async name => {
            a02RpcCalls.push(name);
            if (name !== 'get_minuta_workspace') throw new Error(`Unexpected RPC: ${name}`);
            return { data:{ organizations:[organization], pending_invitations:[] }, error:null };
          } },
          $:selector => document.querySelector(selector),
          $$:selector => [...document.querySelectorAll(selector)],
          escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
          notify:message => { throw new Error(`Unexpected notification: ${message}`); },
          requireWrites:() => false,
          getCurrentUser:() => ({ id:'synthetic-user' }),
          getSessionGeneration:() => 1,
          sessionIsCurrent:() => true,
          applyWriteAvailability:() => {},
          onActiveOrganizationChange:() => {}
        });
        window.a02Controller = controller;
        await controller.load();
      }, role);
      await page.locator('[data-help-slug="roles-access-safety"] .contextual-help__trigger').click();
      const result = await page.evaluate(selectedRole => {
        const rolePanel = document.querySelector('[data-help-slug="roles-access-safety"] .contextual-help__panel');
        const rows = [...rolePanel.querySelectorAll('table tbody tr')];
        const cards = [...document.querySelectorAll('#membersList .organization-row')];
        const text = document.querySelector('#membersList').innerText;
        const inactiveCards = cards.filter(card => card.textContent.includes('Тест специалист Б') || card.textContent.includes('Тест специалист В'));
        const editor = document.querySelector('[data-member-card="synthetic-active-bookable"]');
        if (editor) editor.open = true;
        return {
          roleRows:rows.map(row => row.innerText),
          articleLabel:rolePanel.querySelector('a.contextual-help__action')?.textContent || '',
          otherArticleLabel:document.querySelector('[data-help-slug="branches-and-employees"] a.contextual-help__action')?.textContent || '',
          tableFontSize:parseFloat(getComputedStyle(rolePanel.querySelector('table')).fontSize),
          helperSizes:[...document.querySelectorAll('.member-bookable-check small,.organization-checks small')].map(el => parseFloat(getComputedStyle(el).fontSize)),
          toggleLabelSizes:[...document.querySelectorAll('.member-bookable-check strong,.organization-checks label')].map(el => parseFloat(getComputedStyle(el).fontSize)),
          inviteHelp:document.querySelector('#memberBookable + span small')?.textContent || '',
          creatorHidden:document.querySelector('#memberCreator').hidden,
          ownerInviteDisabled:document.querySelector('#memberRole option[value="owner"]').disabled,
          adminInviteDisabled:document.querySelector('#memberRole option[value="admin"]').disabled,
          ownerEditor:Boolean(document.querySelector('[data-member-card="synthetic-owner"]')),
          adminEditor:Boolean(document.querySelector('[data-member-card="synthetic-admin"]')),
          activeBookable:text.includes('one@example.invalid · принимает клиентов'),
          activeUnbookable:text.includes('admin@example.invalid · не принимает клиентов'),
          inactiveDescriptions:inactiveCards.map(card => card.querySelector('.organization-row-main small')?.textContent || ''),
          memberStates:Object.fromEntries(['synthetic-admin', 'synthetic-active-bookable', 'synthetic-inactive-bookable', 'synthetic-inactive-unbookable'].map(id => {
            const card = document.querySelector(`[data-member-card="${id}"]`);
            return [id, card ? [card.querySelector('[name="bookable"]').checked, card.querySelector('[name="active"]').checked] : null];
          })),
          bookableHelp:editor?.querySelector('[name="bookable"] + span small')?.textContent || '',
          activeHelp:editor?.querySelector('[name="active"] + span small')?.textContent || '',
          rpcCalls:a02RpcCalls,
          documentOverflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
          tableOverflow:rolePanel.querySelector('table').scrollWidth - rolePanel.querySelector('table').clientWidth,
          roleCellOverflow:[...rolePanel.querySelectorAll('table tbody th')].some(cell => cell.scrollWidth > cell.clientWidth + 1),
          width:innerWidth,
          role:selectedRole
        };
      }, role);
      assert.deepEqual(result.rpcCalls, ['get_minuta_workspace']);
      assert.deepEqual(result.roleRows.length, 3);
      assert.ok(result.roleRows[0].includes('Владелец') && result.roleRows[1].includes('Администратор') && result.roleRows[2].includes('Специалист'));
      assert.equal(result.articleLabel, 'Права ролей');
      assert.equal(result.otherArticleLabel, 'Подробнее');
      assert.ok(result.tableFontSize >= 13, `role table text too small at ${width}/${role}: ${result.tableFontSize}px`);
      assert.ok(result.helperSizes.length && result.helperSizes.every(size => size >= 12), 'Organization switch helpers must be readable: ' + JSON.stringify(result.helperSizes));
      assert.ok(result.toggleLabelSizes.length && result.toggleLabelSizes.every(size => size >= 12), 'Organization switch labels must be readable: ' + JSON.stringify(result.toggleLabelSizes));
      assert.equal(result.inviteHelp, 'Нужны доступ к организации, активная услуга и включённая онлайн-запись команды.');
      assert.equal(result.creatorHidden, role === 'specialist');
      assert.equal(result.ownerInviteDisabled, role !== 'owner');
      assert.equal(result.adminInviteDisabled, role !== 'owner');
      assert.equal(result.ownerEditor, role === 'owner');
      assert.equal(result.adminEditor, role === 'owner');
      assert.ok(result.activeBookable || role === 'specialist');
      assert.ok(result.activeUnbookable || role === 'specialist');
      if (role !== 'specialist') {
        assert.equal(result.inactiveDescriptions.length, 2);
        assert.ok(result.inactiveDescriptions.every(value => value.includes('доступ отключён') && !value.includes('принимает клиентов')));
        assert.deepEqual(result.memberStates, {
          'synthetic-admin':role === 'owner' ? [false, true] : null,
          'synthetic-active-bookable':[true, true],
          'synthetic-inactive-bookable':[true, false],
          'synthetic-inactive-unbookable':[false, false]
        });
        assert.equal(result.bookableHelp, 'Нужны доступ к организации, активная услуга и включённая онлайн-запись команды.');
        assert.equal(result.activeHelp, 'Выключение закроет сотруднику эту организацию и онлайн-запись; аккаунт сохранится.');
      }
      assert.ok(result.documentOverflow <= 1, `page overflow at ${width}/${role}: ${result.documentOverflow}`);
      assert.ok(result.tableOverflow <= 1, `table overflow at ${width}/${role}: ${result.tableOverflow}`);
      assert.equal(result.roleCellOverflow, false, `role name overflow at ${width}/${role}`);
      if (role === 'owner') {
        await page.locator('#memberCreator summary').click();
        const invitation = await page.locator('#memberInviteForm').evaluate(form => ({
          emptyEmail:form.querySelector('#memberEmail').value === '',
          overflow:form.scrollWidth - form.clientWidth,
          helperFont:parseFloat(getComputedStyle(form.querySelector('.member-bookable-check small')).fontSize)
        }));
        assert.ok(invitation.emptyEmail && invitation.overflow <= 1 && invitation.helperFont >= 12, 'Expanded invitation must remain readable without sending data');
        if (width === 390) {
          for (const [scale, expected] of [['default',12], ['comfortable',13], ['large',14]]) {
            const font = await page.evaluate(value => {
              document.body.dataset.providerTextScale = value;
              return parseFloat(getComputedStyle(document.querySelector('.organization-checks label')).fontSize);
            }, scale);
            assert.equal(font, expected, `Organization switch label must preserve the ${scale} text setting`);
          }
          await page.evaluate(() => { document.body.dataset.providerTextScale = 'default'; });
        }
        await page.waitForTimeout(220);
        await page.locator('#organizationPeopleSection').screenshot({ path:join(output, `a02-${width}.png`) });
      }
      console.log(`${width}/${role}: table, guards, labels, states, overflow PASS`);
      await page.close();
    }
  }
  assert.deepEqual(errors, [], 'browser page errors');
  console.log(`Core precache ${precacheBytes} bytes; all external requests blocked (${attemptedRequests.length} attempted).`);
} finally {
  if (browser) await browser.close();
}
