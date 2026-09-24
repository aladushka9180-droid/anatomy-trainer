const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const provider = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const scheduleStyles = fs.readFileSync(path.join(root, 'provider-schedule-minimal.css'), 'utf8');
const desktopStyles = fs.readFileSync(path.join(root, 'provider-schedule-desktop-reference.css'), 'utf8');
const start = provider.indexOf('function updateScheduleNowMarkers(');
const end = provider.indexOf('\nfunction ', start + 1);
assert.ok(start >= 0 && end > start, 'Current-time marker updater is missing');
const source = provider.slice(start, end);
const marker = {
  dataset:{start:'600',end:'1140',hourHeight:'76'},
  style:{top:''}, hidden:true, attrs:{}, label:{textContent:''},
  toggleAttribute(name, enabled) { this.attrs[name] = enabled; },
  setAttribute(name, value) { this.attrs[name] = value; },
  querySelector() { return this.label; }
};
let minute = 601;
const update = Function('$$', 'businessClock', `${source}; return updateScheduleNowMarkers`)(
  () => [marker], () => ({minutes:minute,label:`10:${String(minute - 600).padStart(2, '0')}`})
);
for (const [time, nearTop] of [[601,true],[607,true],[615,false]]) {
  minute = time;
  update();
  assert.equal(marker.hidden, false);
  assert.equal(marker.attrs['data-now-top'], nearTop, `Wrong top-edge state at minute ${time}`);
  assert.equal(marker.label.textContent, `10:${String(time - 600).padStart(2, '0')}`);
}

async function geometry() {
  const {chromium} = require('playwright');
  const browser = await chromium.launch({headless:true,
    ...(process.env.MINUTA_CHROME_PATH ? {executablePath:process.env.MINUTA_CHROME_PATH} : {})});
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><style>${styles}\n${scheduleStyles}\n${desktopStyles}</style>
      <style>body{margin:0}.schedule-workspace{overflow:hidden; margin-top:120px}
      .timeline-view{padding:8px 4px}.day-timeline{--timeline-height:760px}</style></head>
      <body class="provider-body" data-provider-theme="sage" data-provider-layout="soft">
      <div class="schedule-workspace"><div class="timeline-view"><div class="day-timeline">
      <div class="timeline-hours"></div><div class="timeline-stage">
      <span class="timeline-now-marker" data-now-top style="top:1px"><time>10:01</time></span>
      <button class="timeline-booking is-current-booking status-confirmed" style="top:2px;height:72px">Запись</button>
      </div></div></div></div></body></html>`);
    for (const width of [390,760,1440]) {
      await page.setViewportSize({width,height:900});
      for (const [minute,offset] of [[1,1],[7,9]]) {
      const position = await page.evaluate(({minute,offset}) => {
        document.querySelector('.timeline-now-marker').style.top=`${offset}px`;
        document.querySelector('.timeline-now-marker time').textContent=`10:0${minute}`;
        const workspace = document.querySelector('.schedule-workspace').getBoundingClientRect();
        const line = document.querySelector('.timeline-now-marker').getBoundingClientRect();
        const label = document.querySelector('.timeline-now-marker time').getBoundingClientRect();
        const card = document.querySelector('.timeline-booking');
        const cardRect = card.getBoundingClientRect();
        const dot = getComputedStyle(card,'::after');
        const dotRight = cardRect.right - parseFloat(dot.right);
        return {workspaceTop:workspace.top,lineTop:line.top,labelTop:label.top,
          labelBottom:label.bottom,labelRight:label.right,dotLeft:dotRight-parseFloat(dot.width),
          documentOverflow:document.documentElement.scrollWidth-innerWidth};
      },{minute,offset});
      assert.ok(position.documentOverflow <= 1, `${width}px: horizontal overflow`);
      assert.ok(position.labelTop >= position.workspaceTop, `${width}px: 10:0${minute} is clipped`);
      assert.ok(position.labelTop > position.lineTop, `${width}px: 10:0${minute} is not below the line`);
      if (width > 760) assert.ok(position.labelRight + 4 < position.dotLeft,
        `${width}px: desktop 10:0${minute} overlaps the booking dot`);
      if (width === 1440 && minute === 7 && process.env.MINUTA_NOW_MARKER_OUTPUT)
        await page.screenshot({path:process.env.MINUTA_NOW_MARKER_OUTPUT});
      }
    }
  } finally { await browser.close(); }
}

geometry().then(() => console.log('Current-time label edge at 390/760/1440 PASS'))
  .catch(error => {console.error(error);process.exitCode=1;});
