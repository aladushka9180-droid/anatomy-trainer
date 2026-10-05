import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const context = { window: {} };
vm.runInNewContext(readFileSync(join(root, 'help-data.js'), 'utf8'), context);
vm.runInNewContext(readFileSync(join(root, 'help-visuals.js'), 'utf8'), context);
const { MINUTA_HELP_ARTICLES: articles, MINUTA_HELP_VISUAL_MANIFEST: manifest } = context.window;
const previous = JSON.parse(readFileSync(join(root, 'tools', 'previous-visuals.json'), 'utf8'));
assert.equal(Object.keys(previous).length, 66, 'Original asset inventory must not lose outstanding captures');
assert.equal(new Set(articles.map(article => article.slug)).size, articles.length, 'Article slugs must be unique');
let diagramCount = 0, pending = 0;
for (const article of articles) {
  const entry = manifest[article.slug];
  assert.ok(entry, `Uninventoried article: ${article.slug}`);
  for (const image of article.visuals) {
    assert.equal(image.kind, 'diagram', 'Only source-native diagrams are currently approved');
    assert.match(image.caption, /не снимок интерфейса/);
    assert.match(image.src, /^images\/process\/[a-z0-9-]+\.svg$/);
    assert.ok(existsSync(join(root, image.src)), `Missing image: ${image.src}`);
    const svg = readFileSync(join(root, image.src), 'utf8');
    assert.match(svg, /viewBox="0 0 560 /);
    assert.match(svg, /font-size="30"/);
    assert.ok(!/<(?:script|foreignObject|image)\b/.test(svg), 'Diagrams must not embed remote or active content');
    diagramCount++;
  }
  if (entry.deferredCapture) {
    assert.equal(article.deferredCapture.status, 'pending');
    assert.ok(previous[article.slug], 'Capture backlog must retain a source reference');
    assert.equal(entry.deferredCapture.reason, 'browser_permission_unverified');
    pending++;
  }
  if (previous[article.slug]) assert.ok(article.visuals.length || entry.deferredCapture, 'Old visuals must be replaced or explicitly deferred');
  if (!article.visuals.length) assert.equal(article.visual, undefined, 'An obsolete screenshot must not survive the manifest');
}
assert.equal(diagramCount, 34);
assert.equal(pending, 63);

function luminance(hex) {
  const rgb = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
const css = readFileSync(join(root, 'help.css'), 'utf8');
const color = name => css.match(new RegExp(`--${name}:\\s*#([a-f0-9]{6})`, 'i'))[1];
const ratios = {};
for (const [label, foreground, background] of [
  ['text/background', color('text'), color('bg')],
  ['secondary/background', color('muted'), color('bg')],
  ['white/action', 'ffffff', color('accent')],
  ['accent/soft', color('accent'), color('accent-soft')]
]) {
  const luminances = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  const ratio = (luminances[0] + .05) / (luminances[1] + .05);
  assert.ok(ratio >= 4.5, `Text contrast fails: ${label}`);
  ratios[label] = Number(ratio.toFixed(2));
}
assert.ok(!/gradient\(/.test(css), 'Knowledge surfaces must remain solid');
console.log(JSON.stringify({ articles: articles.length, diagrams: diagramCount, pendingCaptures: pending, contrast: ratios }));
