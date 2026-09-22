/* A read-only export of the same active services shown in online booking. */
(function () {
  'use strict';

  const PAGE_SIZE = 18;
  const formatPrice = value => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
  const eligible = services => (services || []).filter(item => item?.active === true
    && typeof item.name === 'string' && item.name.trim()
    && item.price_rub !== null && item.price_rub !== ''
    && Number.isFinite(Number(item.price_rub)) && Number(item.price_rub) >= 0
    && Number.isFinite(Number(item.duration_minutes)) && Number(item.duration_minutes) > 0)
    .map(item => ({ ...item, name:item.name.trim().replace(/\s+/g, ' ') }));
  const duration = item => Number(item.duration_minutes) === 1
    ? `обычно ${Number(item.default_duration_minutes) || 60} мин`
    : `${Number(item.duration_minutes)} мин`;
  const price = item => Number(item.duration_minutes) === 1
    ? `${formatPrice(Number(item.price_rub))}/мин`
    : formatPrice(Number(item.price_rub));
  const textFor = (items, url) => `Прайс услуг\n\n${items.map(item => `${item.name.trim()} — ${price(item)} · ${duration(item)}`).join('\n')}\n\nОнлайн-запись: ${url}`;

  function wrap(ctx, value, width) {
    const words = String(value).split(/\s+/).flatMap(word => {
      if (ctx.measureText(word).width <= width) return [word];
      const chunks = [];
      let chunk = '';
      for (const character of word) {
        if (chunk && ctx.measureText(chunk + character).width > width) { chunks.push(chunk); chunk = ''; }
        chunk += character;
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    });
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width || !line) line = next;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }

  async function imageFiles(items, url, colors = {}) {
    const palette = {
      surface:colors.surface || '#f7f6f3', ink:colors.ink || '#1f302d',
      muted:colors.muted || '#5f6a66', line:colors.line || '#cdd5cf',
      accent:colors.accent || '#315c51'
    };
    const files = [];
    const pages = Math.ceil(items.length / PAGE_SIZE);
    for (let page = 0; page < pages; page++) {
      const subset = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      const width = 720;
      ctx.font = '600 23px system-ui, sans-serif';
      const rows = subset.map(item => ({ item, lines:wrap(ctx, item.name.trim(), 630) }));
      ctx.font = '16px system-ui, sans-serif';
      const linkLines = wrap(ctx, url, width - 88);
      const height = 181 + rows.reduce((sum, row) => sum + row.lines.length * 29 + 82, 0) + 106 + linkLines.length * 20;
      canvas.width = width * 2;
      canvas.height = height * 2;
      ctx.scale(2, 2);
      ctx.fillStyle = palette.surface; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = palette.ink; ctx.font = '700 34px system-ui, sans-serif'; ctx.fillText('Прайс услуг', 44, 76);
      ctx.font = '500 18px system-ui, sans-serif'; ctx.fillStyle = palette.muted;
      ctx.fillText(`${items.length} услуг · ${page + 1} / ${pages}`, 44, 108);
      ctx.fillStyle = palette.line; ctx.fillRect(44, 135, width - 88, 1);
      let y = 181;
      for (const row of rows) {
        ctx.font = '600 23px system-ui, sans-serif'; ctx.fillStyle = palette.ink;
        for (const line of row.lines) { ctx.fillText(line, 44, y); y += 29; }
        ctx.font = '500 19px system-ui, sans-serif'; ctx.fillStyle = palette.muted;
        ctx.fillText(`${price(row.item)} · ${duration(row.item)}`, 44, y + 8);
        ctx.fillStyle = palette.line; ctx.fillRect(44, y + 38, width - 88, 1);
        y += 82;
      }
      ctx.font = '600 19px system-ui, sans-serif'; ctx.fillStyle = palette.ink;
      ctx.fillText('Онлайн-запись', 44, height - 91);
      ctx.font = '16px system-ui, sans-serif'; ctx.fillStyle = palette.accent;
      linkLines.forEach((line, index) => ctx.fillText(line, 44, height - 65 - (linkLines.length - 1 - index) * 20));
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('image export failed');
      files.push(new File([blob], `primetime-price-list-${page + 1}.png`, { type:'image/png' }));
    }
    return files;
  }

  window.PrimeTimePriceList = { eligible, textFor, imageFiles, price, duration };
})();
