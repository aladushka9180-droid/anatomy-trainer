import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../provider.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('portfolio offers explicit camera and gallery or files choices for both photos', () => {
  for (const side of ['Before', 'After']) {
    assert.match(html, new RegExp(`id="portfolio${side}File"[^>]+accept="image/jpeg,image/png,image/webp"`));
    assert.match(html, new RegExp(`id="portfolio${side}Camera"[^>]+accept="image/\\*"[^>]+capture="environment"`));
  }
  assert.match(html, /data-portfolio-photo-pick="camera"[^>]*>[\s\S]*Снять на камеру/);
  assert.match(html, /data-portfolio-photo-pick="files"[^>]*>[\s\S]*Из галереи или файлов устройства/);
});

function pickerHarness() {
  const from = js.indexOf('function portfolioPhotoInput(');
  const to = js.indexOf('function updatePortfolioPublishControl(', from);
  assert.ok(from >= 0 && to > from, 'picker functions are present in provider.js');
  const nodes = {
    '#portfolioPhotoSourceTitle':{ textContent:'' },
    '#portfolioPhotoSourceDialog':{
      open:false,
      showModal() { this.open = true; },
      close() { this.open = false; },
      removeAttribute() { this.open = false; },
      querySelector() { return { focus() {} }; }
    }
  };
  for (const side of ['Before', 'After']) for (const source of ['File', 'Camera']) {
    nodes[`#portfolio${side}${source}`] = { value:'old', clicks:0, click() { this.clicks += 1; } };
  }
  const context = { $:selector => nodes[selector], setTimeout:callback => callback() };
  vm.createContext(context);
  vm.runInContext("let portfolioPhotoSourceType = '';\n" + js.slice(from, to), context);
  return { context, nodes };
}

test('camera choice targets the rear-camera input and preserves the selected side', () => {
  const { context, nodes } = pickerHarness();
  context.openPortfolioPhotoSource('after');
  assert.equal(nodes['#portfolioPhotoSourceTitle'].textContent, 'Добавить фото «После»');
  assert.equal(nodes['#portfolioPhotoSourceDialog'].open, true);
  context.choosePortfolioPhotoSource('camera');
  assert.equal(nodes['#portfolioAfterCamera'].clicks, 1);
  assert.equal(nodes['#portfolioAfterCamera'].value, '');
  assert.equal(nodes['#portfolioBeforeCamera'].clicks, 0);
  assert.equal(nodes['#portfolioPhotoSourceDialog'].open, false);
});

test('ready-photo choice opens the regular picker without capture', () => {
  const { context, nodes } = pickerHarness();
  context.openPortfolioPhotoSource('before');
  context.choosePortfolioPhotoSource('files');
  assert.equal(nodes['#portfolioBeforeFile'].clicks, 1);
  assert.equal(nodes['#portfolioBeforeCamera'].clicks, 0);
});
