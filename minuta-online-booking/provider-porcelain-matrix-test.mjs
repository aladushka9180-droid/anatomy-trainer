import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./provider-porcelain-matrix.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(source, { window });
const matrix = window.MinutaProviderPorcelainMatrix;
assert.ok(matrix);

const channels = color => color.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const luminance = color => channels(color).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

const pairs = new Set();
for (const character of ['pearl', 'petal', 'silk']) {
  const shades = matrix.shadesFor(character);
  assert.equal(shades.length, 5);
  assert.deepEqual(Array.from(shades, item => item.key), Array.from(matrix.shadeKeys));
  for (const shade of shades) {
    const palette = matrix.paletteFor(character, shade.key);
    assert.ok(contrast(palette.accent, palette.contrast) >= 4.5, `${character}/${shade.key}: accent contrast`);
    assert.ok(contrast(palette.ink, palette.surface) >= 7, `${character}/${shade.key}: text contrast`);
    assert.ok(contrast(palette.ink, palette.bg) >= 7, `${character}/${shade.key}: background contrast`);
    assert.ok(!pairs.has(`${palette.bg}/${palette.accent}`), `${character}/${shade.key}: distinct pair`);
    pairs.add(`${palette.bg}/${palette.accent}`);
  }
}
assert.equal(pairs.size, 15);
assert.equal(matrix.normalizeCharacter('legacy'), 'petal');
assert.equal(matrix.normalizeShade('legacy'), 'gentle-pink');
console.log('provider porcelain matrix: 15 compatible palettes and contrast OK');
