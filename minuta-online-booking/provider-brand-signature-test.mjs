import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./provider-theme-families.css', import.meta.url), 'utf8');
const baseCss = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const organization = fs.readFileSync(new URL('./organization.js', import.meta.url), 'utf8');

assert.match(html, /class="provider-brand-copy"><a class="provider-product-signature-link" href="index\.html" aria-label="PrimeTime Pro — к онлайн-записи"><small class="provider-product-signature" aria-hidden="true"><span class="provider-product-name">PrimeTime<\/span><span class="provider-product-tier">Pro<\/span><\/small><\/a><button class="provider-business-name-action"/, 'PrimeTime Pro должен стоять над названием организации');
assert.doesNotMatch(html, /class="brand provider-brand"[^\n]*<small>PrimeTime Pro<\/small>/, 'Старая одноцветная подпись осталась в карточке бизнеса');
assert.match(html, /class="brand provider-brand"[^\n]*class="provider-brand-copy"/, 'Название и подпись не объединены в свободную колонку');
assert.doesNotMatch(html, /class="brand provider-brand"[^\n]*class="brand-mark"/, 'PT всё ещё занимает место в карточке бизнеса');
assert.doesNotMatch(html, /class="provider-brand-edit"|icon-edit/, 'Большая кнопка или карандаш редактирования остались в карточке бизнеса');
assert.match(html, /class="provider-business-name-action" id="editProviderBusinessName"[^>]*data-provider-view="organization"[^>]*data-edit-provider-business[^>]*><strong id="providerBusinessName">/, 'Название бизнеса не открывает редактирование в «Организации»');
assert.match(html, /id="organizationForm"[^\n]*id="organizationName"/, 'После удаления карандаша название нельзя изменить в разделе «Организация»');

const nameAction = baseCss.match(/\.provider-business-name-action\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(nameAction, /background:transparent;/, 'Название выглядит постоянной отдельной кнопкой');
assert.match(nameAction, /width:100%;/, 'Название не использует освобождённую ширину карточки');
assert.match(nameAction, /max-width:100%;/, 'Длинное название может выйти из карточки');
assert.match(baseCss, /\.provider-business-name-action:not\(:disabled\):hover strong,\.provider-business-name-action:not\(:disabled\):focus-visible strong\s*\{[^}]*text-decoration-color:currentColor;/, 'Подсказка редактирования не появляется при наведении и фокусе');
assert.match(organization, /const canEdit = Boolean\(organization\?\.id && organization\.can_manage\);[\s\S]*edit\.disabled = !canEdit;/, 'Переход к редактированию не ограничен правами управления');
assert.match(provider, /view\.matches\('\[data-edit-provider-business\]'\)[\s\S]*organizationOverviewSection[\s\S]*input\.focus\(\{ preventScroll:true \}\);[\s\S]*input\.select\(\);/, 'Нажатие на название не открывает и не фокусирует редактирование в «Организации»');

const signature = css.match(/\.provider-product-signature\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(signature, /font-size:14px;/, 'Фирменная строка не получила компактный читаемый размер');
assert.match(signature, /letter-spacing:-\.015em!important;/, 'У подписи осталось разреженное написание');
assert.match(signature, /text-transform:none!important;/, 'Подпись всё ещё принудительно набрана капсом');
assert.match(signature, /white-space:nowrap;/, 'PrimeTime Pro может разорваться на две строки');

const productName = css.match(/\.provider-product-name\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const productTier = css.match(/\.provider-product-tier\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(productName, /--theme-ink/, 'PrimeTime не связан с основным цветом текста темы');
assert.match(productName, /--theme-muted/, 'PrimeTime конкурирует с названием бизнеса');
assert.match(productTier, /--theme-accent/, 'Pro не получает акцент текущей темы');
assert.match(productTier, /--theme-ink/, 'Акцент Pro не получает страховку контраста');
assert.match(productTier, /font-weight:900;/, 'Pro недостаточно отделён начертанием');

console.log('Provider brand signature: PASS');
