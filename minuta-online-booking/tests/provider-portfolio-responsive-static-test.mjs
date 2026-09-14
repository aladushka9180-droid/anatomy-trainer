import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('provider.html', root), 'utf8');
const source = readFileSync(new URL('provider.js', root), 'utf8');
const styles = readFileSync(new URL('provider-portfolio-responsive.css', root), 'utf8');

assert.match(html, /id="portfolioActionDialog"[^>]+aria-labelledby="portfolioActionTitle"/);
assert.match(html, /provider-portfolio-responsive\.css\?v=\d+/);
assert.match(source, /aria-haspopup="dialog" aria-controls="portfolioActionDialog" aria-expanded="false"/);
assert.doesNotMatch(source, /<details class="portfolio-more"/);
assert.doesNotMatch(source, /class="portfolio-card-actions"/);
assert.match(source, /function positionPortfolioActionDialog\(\)[\s\S]*viewportBottom[\s\S]*Math\.min\(above, viewportBottom - dialogRect\.height\)/);
assert.match(source, /function trapPortfolioActionFocus\(event\)/);
assert.match(source, /portfolioActionDialog'\)\.addEventListener\('cancel'/);
assert.match(source, /event\.target === event\.currentTarget\) closePortfolioActions\(\)/);
assert.match(source, /addEventListener\('pointerdown'[\s\S]*!dialog\.contains\(event\.target\)/);
assert.match(source, /trigger\?\.setAttribute\('aria-expanded', 'false'\)/);
assert.match(source, /requestAnimationFrame\(\(\) => trigger\.focus\(\)\)/);
assert.match(source, /db\.rpc\('save_provider_portfolio_item',[\s\S]*p_expected_updated_at:item\.updated_at[\s\S]*p_photos:\[\]/);
assert.match(source, /published && !item\.consent_confirmed_at[\s\S]*openPortfolioEditor\(id\)/);
assert.match(source, /portfolioPublicationPending\.has\(id\)/);
assert.match(source, /function focusAfterPortfolioDelete\(previousIndex\)/);
assert.match(styles, /@media \(max-width:600px\)[\s\S]*bottom:0!important[\s\S]*portfolio-actions-open \.provider-mobile-nav/);
assert.match(styles, /@media \(max-width:760px\)[\s\S]*padding-bottom:calc\(104px \+ env\(safe-area-inset-bottom\)\)/);
assert.match(styles, /\.portfolio-action-list button[\s\S]*min-height:44px/);
assert.match(styles, /\.portfolio-card \.portfolio-photo[\s\S]*aspect-ratio:4\/3/);
assert.match(styles, /-webkit-line-clamp:3/);

const start = source.indexOf('function portfolioActionMarkup(');
const end = source.indexOf('function positionPortfolioActionDialog(', start);
assert.ok(start > 0 && end > start);
const context = {
  portfolioItems:[],
  escapeHtml:value => String(value),
  uiIcon:name => `<svg data-icon="${name}"></svg>`
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context.portfolioItems = [
  { id:'first', procedure_name:'Первая', published:true, consent_confirmed_at:'2026-09-01' },
  { id:'middle', procedure_name:'Средняя', published:false, consent_confirmed_at:'2026-09-01' },
  { id:'last', procedure_name:'Последняя', published:false, consent_confirmed_at:null }
];
const first = context.portfolioActionMarkup(context.portfolioItems[0]);
const middle = context.portfolioActionMarkup(context.portfolioItems[1]);
const last = context.portfolioActionMarkup(context.portfolioItems[2]);
assert.doesNotMatch(first, /data-portfolio-move="up"/);
assert.match(first, /data-portfolio-move="down"/);
assert.match(first, /Снять с публикации/);
assert.match(middle, /data-portfolio-move="up"/);
assert.match(middle, /data-portfolio-move="down"/);
assert.match(middle, /Опубликовать/);
assert.match(last, /data-portfolio-move="up"/);
assert.doesNotMatch(last, /data-portfolio-move="down"/);
assert.match(last, /Сначала подтвердите согласие клиента/);

context.portfolioItems = [context.portfolioItems[0]];
const only = context.portfolioActionMarkup(context.portfolioItems[0]);
assert.doesNotMatch(only, /data-portfolio-move=/);

console.log('Provider portfolio responsive static contract: PASS');
