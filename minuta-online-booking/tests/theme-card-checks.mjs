// Shared by the visible manual fixture and the browser CI. No source-regex colour guesses.
export function inspectCardStates(document) {
  const view = document.defaultView;
  const style = (element, pseudo) => view.getComputedStyle(element, pseudo);
  const failures = [];
  let assertions = 0, minimumContrast = 100;
  function color(value) {
    if (value === 'transparent') return [0,0,0,0];
    const srgb = value.startsWith('color(srgb ');
    const parts = value.replace(/^rgba?\(|^color\(srgb\s*|\)$/g,'').split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) throw new Error(`Unsupported computed colour: ${value}`);
    return parts.slice(0,3).map(n => srgb ? n * 255 : n).concat(parts[3] ?? 1);
  }
  function blend(top, base) { return top.slice(0,3).map((n,i) => n*top[3]+base[i]*(1-top[3])).concat(1); }
  function luminance(rgb) { const c = rgb.slice(0,3).map(n => n/255 <= .04045 ? n/255/12.92 : ((n/255+.055)/1.055)**2.4); return c[0]*.2126+c[1]*.7152+c[2]*.0722; }
  function background(element) {
    const chain = []; for(let node=element;node;node=node.parentElement) chain.unshift(node);
    return chain.reduce((base,node) => blend(color(style(node).backgroundColor),base),[255,255,255,1]);
  }
  function checkText(element, pseudo) {
    if (!element || !element.getClientRects().length || style(element).visibility === 'hidden') return;
    const computed = style(element,pseudo), bg = background(element), fg = blend(color(computed.color),bg);
    const ratio = (Math.max(luminance(fg),luminance(bg))+.05)/(Math.min(luminance(fg),luminance(bg))+.05);
    assertions++; minimumContrast = Math.min(minimumContrast,ratio);
    if (ratio < 4.5) failures.push({card:element.closest('[data-card]')?.dataset.card || 'controls',selector:element.className || element.tagName,kind:pseudo || 'contrast',ratio:Number(ratio.toFixed(2)),color:computed.color,background:bg});
  }
  for (const card of document.querySelectorAll('[data-card]')) {
    const marked = card.matches('.client-vip,.client-favorite,.client-attention');
    if (marked) {
      assertions++;
      if (style(card).backgroundImage !== 'none') failures.push({card:card.dataset.card,kind:'legacy-gradient',value:style(card).backgroundImage});
    }
    // Normal booking colours are user-selected, outside this marked-state fix.
    if (card.classList.contains('client-list-item') || marked) {
      card.querySelectorAll('.client-list-main strong,.client-list-main small,.client-list-main i,.client-list-avatar,.client-badge,.provider-booking-top h3,.booking-client-name-row strong,.provider-booking-phone,.provider-booking-note-full,.provider-booking-note-full b,.timeline-booking-copy>strong,.timeline-client-name,.timeline-client-phone,.timeline-booking-note,.timeline-booking-note b').forEach(element => checkText(element));
    }
  }
  checkText(document.querySelector('.client-search input'),'::placeholder');
  document.querySelectorAll('[data-secondary]').forEach(element => checkText(element));
  return {assertions,minimumContrast:Number(minimumContrast.toFixed(3)),failures};
}
