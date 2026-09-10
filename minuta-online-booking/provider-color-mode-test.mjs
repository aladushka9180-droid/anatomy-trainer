import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ window:{} });
vm.runInContext(readFileSync(new URL('theme-catalog.js', import.meta.url), 'utf8'), context);
vm.runInContext(readFileSync(new URL('provider-color-mode.js', import.meta.url), 'utf8'), context);

const catalog = context.window.MinutaThemeCatalog;
const colorMode = context.window.MinutaProviderColorMode;
assert.deepEqual([...colorMode.modes], ['light', 'dark', 'system']);
assert.deepEqual({...colorMode.modeThemes}, {light:'sage', dark:'midnight'});
assert.equal(colorMode.resolveMode('system', false), 'light');
assert.equal(colorMode.resolveMode('system', true), 'dark');
assert.equal(colorMode.themeKeyForMode('light'), 'sage');
assert.equal(colorMode.themeKeyForMode('dark'), 'midnight');
assert.equal(colorMode.themeKeyForMode('system', false), 'sage');
assert.equal(colorMode.themeKeyForMode('system', true), 'midnight');

for (const theme of catalog.themes) {
  const nativeMode = theme.palette.dark ? 'dark' : 'light';
  const values = new Map();
  const element = {
    dataset:{},
    style:{
      colorScheme:'',
      setProperty:(property, value, priority) => values.set(property, { value, priority }),
      removeProperty:property => values.delete(property)
    }
  };
  values.set('--theme-bg', {value:'#000000', priority:'important'});
  const applied = colorMode.apply(element, theme, nativeMode, false);
  assert.equal(applied.derived, false);
  assert.equal(applied.themeKey, theme.key);
  assert.equal(element.dataset.providerResolvedColorMode, nativeMode);
  assert.equal(element.dataset.providerColorVariant, 'native');
  assert.equal(values.size, 0, `${theme.key}: устаревшая производная палитра не очищена`);
}

console.log(`Provider color mode: Sage Studio, Midnight Navy and system pairing use native palettes; ${catalog.themes.length} themes clear legacy overrides.`);
