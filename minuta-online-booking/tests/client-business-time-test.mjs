import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
for(const file of ['app.js','booking.js']) {
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const helpers=source.match(/const BUSINESS_TIME_ZONE[\s\S]*?(?=function localIsoDate)/)[0];
  const iso=source.match(/function localIsoDate\(date\) \{[^\n]+\}/)[0];
  const dates=source.match(/function createDates\(\) \{[\s\S]*?\n\}/)[0];
  for(const zone of ['Europe/Samara','Asia/Tokyo','America/Los_Angeles']) {
    const previous=process.env.TZ;process.env.TZ=zone;
    try {
      let now=Date.parse('2026-09-08T18:30:00Z');
      class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
      const context=vm.createContext({Date:Clock,Intl});vm.runInContext(helpers+iso+dates+';globalThis.api={businessClock,availableBusinessTimes,createDates};',context);
      assert.equal(context.api.createDates()[0].iso,'2026-09-08',file+' '+zone);
      assert.deepEqual(Array.from(context.api.availableBusinessTimes('2026-09-08',['10:00','22:30','22:35','23:00'])),['22:35','23:00']);
      assert.equal(context.api.availableBusinessTimes('2026-09-07',['23:55']).length,0);
      now=Date.parse('2026-09-08T20:01:00Z');assert.equal(context.api.createDates()[0].iso,'2026-09-09');
      now=Date.parse('2028-02-28T21:00:00Z');assert.equal(context.api.createDates()[0].iso,'2028-02-29');assert.equal(context.api.createDates()[1].iso,'2028-03-01');
    } finally { if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous; }
  }
}
console.log('PASS Samara booking/reschedule day boundary, past-slot guard and leap day across three device timezones');
