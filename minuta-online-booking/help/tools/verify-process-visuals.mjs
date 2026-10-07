import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const context = { window: {} };
vm.runInNewContext(readFileSync(join(root, 'help-data.js'), 'utf8'), context);
vm.runInNewContext(readFileSync(join(root, 'help-visuals.js'), 'utf8'), context);
const { MINUTA_HELP_ARTICLES: articles, MINUTA_HELP_VISUAL_MANIFEST: manifest } = context.window;
const previous = JSON.parse(readFileSync(join(root, 'tools', 'previous-visuals.json'), 'utf8'));
assert.equal(Object.keys(previous).length, 66, 'Original asset inventory must not lose outstanding captures');
assert.equal(new Set(articles.map(article => article.slug)).size, articles.length, 'Article slugs must be unique');
const approvedPath = join(root, 'tools', 'native-article-visuals.json');
const approved = existsSync(approvedPath) ? JSON.parse(readFileSync(approvedPath, 'utf8')) : {};
const processOnly = new Set(['first-booking', 'settings-quick-start', 'voice-assistant-actions']);
const processSlugs = readdirSync(join(root, 'images', 'process')).filter(name => name.endsWith('.svg')).map(name => name.slice(0, -4));
assert.equal(processSlugs.length, 34, 'The original process inventory remains available');
let diagramCount = 0, pending = 0, screenshotCount = 0, replacedArticles = 0;
function rasterDimensions(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { width:bytes.readUInt32BE(16), height:bytes.readUInt32BE(20) };
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width:bytes.readUIntLE(24, 3) + 1, height:bytes.readUIntLE(27, 3) + 1 };
  if (kind === 'VP8L') {
    assert.equal(bytes[20], 47);
    const value = bytes.readUInt32LE(21);
    return { width:(value & 16383) + 1, height:((value >>> 14) & 16383) + 1 };
  }
  assert.equal(kind, 'VP8 ');
  return { width:bytes.readUInt16LE(26) & 16383, height:bytes.readUInt16LE(28) & 16383 };
}
function verifyDetail(image, evidence) {
  assert.equal(JSON.stringify(image.detail), JSON.stringify(evidence.detail), 'Detail must match the approved source region');
  if (!image.detail) return;
  const {x,y,width,height} = image.detail;
  assert.ok([x,y,width,height].every(Number.isInteger) && x >= 0 && y >= 0 && width >= 40 && height >= 40
    && x + width <= image.width && y + height <= image.height, 'Detail must stay inside the original screenshot');
}
for (const article of articles) {
  const entry = manifest[article.slug];
  assert.ok(entry, `Uninventoried article: ${article.slug}`);
  if (article.visuals.some(image => image.kind === 'screenshot')) assert.ok(!article.visuals.some(image => image.kind === 'diagram'), 'A native screenshot replaces its temporary diagram');
  for (const image of article.visuals) {
    if (image.kind === 'screenshot') {
      assert.match(image.src, /^images\/native-(?:local|client)\/[a-z0-9-]+\.(?:webp|png)$/);
      const capture = approved[article.slug]?.find(capture => capture.src === image.src && capture.step === image.step);
      assert.ok(capture?.coverageExact && capture.domModified === false && capture.rendererModified === false && capture.liveVerified === false, 'Screenshots need native local capture evidence');
      assert.match(image.caption, /учебные данные/i);
      const bytes = readFileSync(join(root, image.src));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), capture.sha256, 'Screenshot must match reviewed bytes');
      assert.deepEqual(rasterDimensions(bytes), { width:image.width, height:image.height }, 'Raster dimensions must match its displayed aspect ratio');
      verifyDetail(image, capture);
      for (const variant of image.variants || []) {
        const evidence = capture.variants?.find(value => value.src === variant.src);
        assert.ok(evidence, 'Responsive image needs reviewed capture evidence');
        const variantBytes = readFileSync(join(root, variant.src));
        assert.equal(createHash('sha256').update(variantBytes).digest('hex'), evidence.sha256);
        assert.deepEqual(rasterDimensions(variantBytes), { width:variant.width, height:variant.height });
        verifyDetail(variant, evidence);
      }
      assert.equal(entry.capture?.status, 'captured-local-native');
      assert.equal(entry.capture?.liveVerified, false);
      screenshotCount++;
      continue;
    }
    assert.equal(image.kind, 'diagram', 'Unknown visual type');
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
    assert.equal(entry.deferredCapture.reason, 'local_capture_pending');
    pending++;
  }
  if (previous[article.slug] && !processOnly.has(article.slug) && article.visuals.some(image => image.kind === 'screenshot')) {
    assert.equal(entry.deferredCapture, undefined, 'A reviewed replacement clears its capture backlog');
    replacedArticles++;
  }
  if (previous[article.slug]) assert.ok(article.visuals.length || entry.deferredCapture, 'Old visuals must be replaced or explicitly deferred');
  if (!article.visuals.length) assert.equal(article.visual, undefined, 'An obsolete screenshot must not survive the manifest');
}
const expectedDiagrams = processSlugs.filter(slug => !articles.find(article => article.slug === slug)?.visuals.some(image => image.kind === 'screenshot'));
assert.equal(diagramCount, expectedDiagrams.length);
for (const slug of processOnly) assert.ok(manifest[slug].images.some(image => image.kind === 'diagram'), 'Introductory process guides retain their diagram');
assert.equal(pending + replacedArticles, 63, 'Every original screenshot need stays replaced or explicitly pending');

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
console.log(JSON.stringify({ articles: articles.length, diagrams: diagramCount, screenshots: screenshotCount, replacedArticles, pendingCaptures: pending, contrast: ratios }));
