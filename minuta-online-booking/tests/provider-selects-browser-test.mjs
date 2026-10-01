import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProviderSelectsFixture} from './provider-selects-fixture.mjs';

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const fixture=await createProviderSelectsFixture();
const output=process.env.MINUTA_VISUAL_OUTPUT?resolve(process.env.MINUTA_VISUAL_OUTPUT):'';
if(output)await mkdir(output,{recursive:true});
const errors=[];
const proxy=select=>select.locator('xpath=following-sibling::button[1]');
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(fixture.url,{waitUntil:'domcontentloaded'});
  await page.locator('body[data-provider-selects-ready]').waitFor();
  assert.equal(await page.locator('select.pro-select-native').count(),fixture.inventoryCount+3,'All published native fields and the dynamic session renderer are covered');
  const service=page.locator('[data-session-service]');
  const trigger=proxy(service);
  assert.match(await trigger.innerText(),/углублённый/);
  await trigger.click();
  const dialog=page.locator('.pro-select-dialog');
  await dialog.waitFor({state:'visible'});
  assert.equal(await dialog.getByRole('option').count(),9);
  assert.equal(await dialog.locator('[role="option"][tabindex="0"]').count(),1,'The list has one keyboard tab stop');
  await dialog.getByRole('option',{name:/Спортивный массаж/}).click();
  assert.equal(await service.inputValue(),'service-2');
  assert.deepEqual(await page.evaluate(()=>fixtureEvents),['input','change']);
  assert.match(await trigger.innerText(),/Спортивный массаж/);
  await trigger.click();
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
  assert.equal(await service.inputValue(),'service-2','Moving focus and cancelling must not change selection');
  assert.equal(await trigger.evaluate(node=>document.activeElement===node),true);
  await trigger.press('ArrowDown');await page.keyboard.press('Home');await page.keyboard.press('Enter');
  assert.equal(await service.inputValue(),'service-0');
  await service.evaluate(node=>{node.value='service-4'});
  assert.match(await trigger.innerText(),/Комплексный массаж/);
  await service.evaluate(node=>{node.selectedIndex=5});
  assert.match(await trigger.innerText(),/Общий массаж/);
  await service.evaluate(node=>{node.options[5].textContent='Обновлённое название услуги'});
  await page.getByRole('button',{name:/Услуга из каталога: Обновлённое/}).waitFor();
  await service.selectOption('service-3');
  assert.match(await trigger.innerText(),/Массаж ног или рук/,'Native field remains compatible with existing controllers and tests');
  await page.locator('#sessionForm').evaluate(form=>form.reset());
  await page.getByRole('button',{name:/Услуга из каталога: Массаж спины \+ ШВЗ — углублённый/}).waitFor();
  await service.evaluate(node=>{node.disabled=true});
  assert.equal(await trigger.isDisabled(),true);
  await service.evaluate(node=>{node.disabled=false});
  assert.equal(await trigger.isEnabled(),true);
  await service.evaluate(node=>{node.style.display='none'});
  await trigger.waitFor({state:'hidden'});
  await service.evaluate(node=>{node.style.removeProperty('display')});
  await trigger.waitFor({state:'visible'});

  const branch=page.locator('#branch');
  await page.locator('#requiredForm button[type=submit]').click();
  assert.equal(await page.evaluate(()=>fixtureSubmits),0);
  assert.equal(await proxy(branch).getAttribute('aria-invalid'),'true');
  assert.equal(await proxy(branch).evaluate(node=>document.activeElement===node),true);
  assert.ok(await page.locator('#requiredForm .pro-select-error').innerText());
  await proxy(branch).click();await dialog.getByRole('option',{name:'Центр',exact:true}).click();
  await page.locator('#requiredForm button[type=submit]').click();
  assert.equal(await page.evaluate(()=>fixtureSubmits),1);
  assert.equal(await page.locator('#requiredForm').evaluate(form=>new FormData(form).get('branch')),'center');

  await page.evaluate(()=>{
    const fieldset=document.createElement('fieldset');fieldset.id='dynamicFields';
    fieldset.innerHTML='<label>Группа<select id="grouped"><optgroup label="Работа"><option value="a">Alpha</option><option value="b" disabled>Beta</option><option value="c">Gamma</option></optgroup><optgroup label="Недоступно" disabled><option value="d">Delta</option></optgroup></select></label><label>Загрузка<select id="loading"></select></label><select multiple id="multiple"><option>A</option></select><select size="3" id="list"><option>A</option></select>';
    document.querySelector('.fixture-controls').append(fieldset);
  });
  const grouped=page.locator('#grouped');
  await proxy(grouped).waitFor();
  assert.equal(await page.locator('#multiple.pro-select-native').count(),0);
  assert.equal(await page.locator('#list.pro-select-native').count(),0);
  await proxy(grouped).click();
  assert.equal(await dialog.getByRole('option',{name:'Beta',exact:true}).isDisabled(),true);
  assert.equal(await dialog.getByRole('option',{name:'Delta',exact:true}).isDisabled(),true);
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await grouped.inputValue(),'c','Keyboard skips disabled options and groups');
  await proxy(grouped).click();await page.keyboard.press('Home');await page.keyboard.press('g');await page.keyboard.press('Enter');
  assert.equal(await grouped.inputValue(),'c','Type-ahead moves to matching option');
  await proxy(grouped).press('Home');
  assert.equal(await dialog.locator('[role="option"][tabindex="0"]').innerText(),'Alpha','Home opens at the first enabled option');
  await page.keyboard.press('z');
  assert.equal(await dialog.locator('[role="option"][tabindex="0"]').count(),1,'An unmatched search preserves the keyboard tab stop');
  await page.keyboard.press('Escape');
  await page.locator('#dynamicFields').evaluate(node=>{node.disabled=true});
  assert.equal(await proxy(grouped).isDisabled(),true);
  await page.locator('#dynamicFields').evaluate(node=>{node.disabled=false});
  await proxy(page.locator('#loading')).click();
  assert.equal(await dialog.getByText('Нет вариантов',{exact:true}).isVisible(),true);
  await page.keyboard.press('Escape');
  await page.locator('#loading').evaluate(node=>{node.replaceChildren(new Option('Готово','ready'))});
  await page.getByRole('button',{name:'Загрузка: Готово',exact:true}).waitFor();
  await proxy(grouped).click();
  await page.locator('#dynamicFields').evaluate(node=>node.remove());
  await dialog.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:/Группа:/}).count(),0);

  // Nested dialogs are used by imports, exports, widgets and other existing forms.
  await page.evaluate(()=>{
    const parent=document.createElement('dialog');parent.id='parentDialog';
    parent.innerHTML='<label>Формат<select id="format"><option>CSV</option><option>JSON</option></select></label>';
    document.body.append(parent);parent.showModal();
  });
  await proxy(page.locator('#format')).click();
  await dialog.getByRole('option',{name:'JSON',exact:true}).click();
  assert.equal(await page.locator('#format').inputValue(),'JSON');
  assert.equal(await page.locator('#parentDialog').evaluate(node=>node.open),true);
  await page.locator('#parentDialog').evaluate(node=>{node.close();node.remove()});
  await service.evaluate(node=>{node.options[5].textContent='Общий массаж с обеих сторон · 90 мин · 4 300 ₽';node.value='service-8'});

  let screenshots=0;
  for(const theme of ['pink-porcelain','sage','warm','graphite','midnight','noir-rose']) {
    for(const width of [390,760,1440]) {
      await page.setViewportSize({width,height:940});
      await page.evaluate(theme=>applyFixtureTheme(theme),theme);
      await trigger.click();
      const geometry=await dialog.evaluate(node=>{
        const rect=node.getBoundingClientRect(),css=getComputedStyle(node);
        const row=node.querySelector('[role=option]'),rowCss=getComputedStyle(row);
        return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:document.documentElement.clientWidth,height:innerHeight,overflow:node.scrollWidth>node.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,surface:css.backgroundColor,expected:getComputedStyle(document.body).getPropertyValue('--theme-surface').trim(),ink:rowCss.color,font:parseFloat(rowCss.fontSize),gradient:css.backgroundImage,rows:[...node.querySelectorAll('[role=option]')].map(row=>({text:row.textContent,width:row.getBoundingClientRect().width,scroll:row.scrollWidth,client:row.clientWidth}))};
      });
      assert.ok(geometry.left>=0&&geometry.right<=geometry.width+1&&geometry.top>=0&&geometry.bottom<=geometry.height+1,`${theme}/${width}: popup outside viewport`);
      assert.equal(geometry.overflow,false,`${theme}/${width}: popup overflow`);
      assert.equal(geometry.pageOverflow,false,`${theme}/${width}: surrounding page overflow`);
      assert.equal(geometry.gradient,'none');
      const hex=geometry.expected.replace('#','');
      const expectedRgb=`rgb(${[0,2,4].map(offset=>parseInt(hex.slice(offset,offset+2),16)).join(', ')})`;
      assert.equal(geometry.surface,expectedRgb,`${theme}/${width}: popup follows the current theme surface`);
      assert.ok(geometry.font>=14);
      assert.ok(geometry.rows.every(row=>row.scroll<=row.client+1),`${theme}/${width}: text clipped`);
      if(output){await page.screenshot({path:resolve(output,`${theme}-${width}-open.png`)});screenshots++;}
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button',{name:'Сохранить состав',exact:true}).isVisible(),true);
      if(output&&theme==='pink-porcelain')await page.screenshot({path:resolve(output,`${theme}-${width}-closed.png`)});
    }
  }
  await page.setViewportSize({width:390,height:940});
  await page.evaluate(()=>applyFixtureTheme('pink-porcelain','large'));
  await trigger.click();
  assert.ok(await dialog.locator('[role=option]').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize))>=16,'Existing enlarged text setting is respected');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${fixture.inventoryCount} published fields, dynamic forms, keyboard, validation, reset, programmatic updates, disabled groups, nested dialogs; 18 theme/viewport combinations, ${screenshots} screenshots.`);
} finally {await browser.close();await new Promise(resolve=>fixture.server.close(resolve));}
