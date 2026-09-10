import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ window:{} });
vm.runInContext(readFileSync(new URL('theme-catalog.js', import.meta.url), 'utf8'), context);
vm.runInContext(readFileSync(new URL('provider-color-mode.js', import.meta.url), 'utf8'), context);

const catalog = context.window.MinutaThemeCatalog;
const colorMode = context.window.MinutaProviderColorMode;
assert.deepEqual([...colorMode.modes], ['light', 'dark', 'system']);
assert.equal(colorMode.resolveMode('system', false), 'light');
assert.equal(colorMode.resolveMode('system', true), 'dark');

for (const theme of catalog.themes) {
  const nativeMode = theme.palette.dark ? 'dark' : 'light';
  const oppositeMode = nativeMode === 'dark' ? 'light' : 'dark';
  const palette = colorMode.derivePalette(theme, oppositeMode);
  assert.ok(colorMode.contrast(palette.ink, palette.surface) >= 4.5, `${theme.key} ${oppositeMode}: основной текст потерял контраст`);
  assert.ok(colorMode.contrast(palette.accent, palette.surface) >= 4.5, `${theme.key} ${oppositeMode}: акцент потерял контраст`);
  assert.ok(colorMode.contrast(palette.contrast, palette.accent) >= 4.5, `${theme.key} ${oppositeMode}: текст кнопки потерял контраст`);
  assert.match(palette.themeColor, /^#[\da-f]{6}$/i, `${theme.key}: неверный цвет браузера`);

  const values = new Map();
  const element = {
    dataset:{},
    style:{
      colorScheme:'',
      setProperty:(property, value, priority) => values.set(property, { value, priority }),
      removeProperty:property => values.delete(property)
    }
  };
  const applied = colorMode.apply(element, theme, oppositeMode, false);
  assert.equal(applied.derived, true);
  assert.equal(element.dataset.providerResolvedColorMode, oppositeMode);
  assert.equal(element.dataset.providerColorVariant, 'derived');
  assert.equal(values.get('--theme-bg')?.priority, 'important');
  assert.equal(values.get('--atmosphere-background')?.value, palette.pattern);
  const restored = colorMode.apply(element, theme, nativeMode, false);
  assert.equal(restored.derived, false);
  assert.equal(element.dataset.providerColorVariant, 'native');
  assert.equal(values.size, 0, `${theme.key}: производная палитра не очищена`);
}

console.log(`Provider color mode: ${catalog.themes.length} themes keep readable native and derived light/dark palettes.`);
