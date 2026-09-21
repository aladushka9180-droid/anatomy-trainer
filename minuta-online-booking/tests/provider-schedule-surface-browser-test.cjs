const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'provider.html'), 'utf8');
const themes = [...html.matchAll(/name="providerTheme" value="([^"]+)"/g)].map(match => match[1]);
assert.equal(themes.length, 40, 'theme inventory changed');
const output = process.env.MINUTA_SCHEDULE_SURFACE_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });

const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  const type = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' }[path.extname(file)];
  response.setHeader('Content-Type', type || 'application/octet-stream');
  const content = fs.readFileSync(file);
  response.end(file.endsWith('.html') ? content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') : content);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#authCard').hidden = true;
      const dashboard = document.querySelector('#dashboard');
      dashboard.hidden = false;
      dashboard.dataset.activeView = 'bookings';
      document.body.dataset.providerLayout = 'soft';
      document.querySelector('#dateStrip').hidden = true;
      document.querySelector('#providerBookings').className = 'provider-bookings timeline-view';
      document.querySelector('#providerBookings').innerHTML = '<div class="day-timeline" style="--timeline-height:400px"><div class="timeline-hours"><span class="timeline-hour" style="top:0">10:00</span></div><div class="timeline-stage" style="--timeline-height:400px"><i class="timeline-grid-line" style="top:0"></i></div></div>';
    });

    const surfaces = new Map();
    for (const width of [1440, 390, 760]) {
      await page.setViewportSize({ width, height:900 });
      for (const theme of themes) {
        await page.evaluate(value => { document.body.dataset.providerTheme = value; }, theme);
        const result = await page.evaluate(() => {
          const timeline = document.querySelector('.timeline-view');
          const panel = getComputedStyle(timeline);
          const probe = document.createElement('i');
          probe.style.background = 'var(--theme-surface)';
          document.body.append(probe);
          const themeSurface = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            background:panel.backgroundColor,
            expected:themeSurface,
            shadow:panel.boxShadow,
            image:panel.backgroundImage,
            radius:panel.borderRadius,
            overflow:document.documentElement.scrollWidth > innerWidth + 2
          };
        });
        assert.equal(result.background, result.expected, `${theme}/${width}: panel uses another theme's color`);
        assert.equal(result.image, 'none', `${theme}/${width}: gradient or texture on panel`);
        assert.equal(result.overflow, false, `${theme}/${width}: horizontal overflow`);
        if (width === 1440) {
          assert.match(result.shadow, /inset/, `${theme}: missing desktop outline`);
          assert.equal(result.radius, '18px', `${theme}: missing desktop corners`);
          surfaces.set(theme, result.background);
        }
        if (output && ((width === 1440 && ['warm', 'carbon-crimson'].includes(theme)) || (width === 390 && theme === 'warm'))) {
          await page.screenshot({ path:path.join(output, `${theme}-${width}.png`) });
        }
      }
    }
    await page.setViewportSize({ width:1440, height:900 });
    await page.evaluate(() => { document.querySelector('#dateStrip').hidden = false; });
    for (const theme of themes) {
      await page.evaluate(value => { document.body.dataset.providerTheme = value; }, theme);
      const result = await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('.timeline-view'));
        return { shadow:style.boxShadow, radius:style.borderRadius };
      });
      assert.match(result.shadow, /inset/, `${theme}: date strip removed panel outline`);
      assert.equal(result.radius, '18px', `${theme}: date strip removed panel corners`);
    }
    assert.notEqual(surfaces.get('warm'), surfaces.get('carbon-crimson'), 'theme surfaces collapsed to one color');
    console.log('Provider schedule surface: 40 themes x 390/760/1440 OK');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
