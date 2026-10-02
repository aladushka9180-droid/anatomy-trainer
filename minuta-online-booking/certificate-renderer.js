(function (scope) {
  'use strict';
  const DAY = 86400000;
  const fields = {
    procedure: { x: .5, y: .671, width: .83, size: .0315, italic: true },
    date: { x: .213, y: .755, width: .265, size: .023, italic: false },
    number: { x: .783, y: .755, width: .265, size: .023, italic: false }
  };
  function day(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('invalid_date');
    const n = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) throw new Error('invalid_date');
    return n;
  }
  function dateLabel(value) { day(value); return value.split('-').reverse().join('.'); }
  function addMonths(value, count) {
    day(value); const [y, m, d] = value.split('-').map(Number);
    const end = new Date(Date.UTC(y, m - 1 + count + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1 + count, Math.min(d, end))).toISOString().slice(0, 10);
  }
  function plural(count, one, few, many) {
    const hundred = count % 100, ten = count % 10;
    return hundred >= 11 && hundred <= 14 ? many : ten === 1 ? one : ten >= 2 && ten <= 4 ? few : many;
  }
  function procedureLabel(name, sessions, minutes) {
    if (!String(name || '').trim() || name.length > 180 || !Number.isInteger(sessions) || sessions < 1 || sessions > 1000) throw new Error('invalid_procedure');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('invalid_duration');
    const duration = minutes % 60 === 0 ? `${minutes / 60} ${plural(minutes / 60, 'час', 'часа', 'часов')}` : `${minutes} мин`;
    return `${name.trim()} (${duration}/${sessions} ${plural(sessions, 'сеанс', 'сеанса', 'сеансов')})`;
  }
  function status(record, today, lead = 7) {
    const left = (day(record.expires_on) - day(today)) / DAY;
    return { code: left < 0 ? 'expired' : left <= lead ? 'expiring' : 'active', days: left };
  }
  function normalizedField(value) {
    const f = { ...value };
    if (![f.x, f.y, f.width, f.size].every(Number.isFinite) || f.x < 0 || f.x > 1 || f.y < 0 || f.y > 1 || f.width < .05 || f.width > 1 || f.size < .005 || f.size > .1) throw new Error('invalid_layout');
    f.width = Math.min(f.width, 2 * f.x, 2 * (1 - f.x));
    if (f.width < .05) throw new Error('invalid_layout');
    return f;
  }
  async function loadImage(source) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source || '') || source.length > 12000000) throw new Error('invalid_image');
    const img = new Image(); img.src = source; await img.decode();
    if (img.width < 200 || img.height < 200 || img.width > 6000 || img.height > 6000 || img.width * img.height > 20000000) throw new Error('invalid_image_size');
    return img;
  }
  function splitLines(ctx, text, width) {
    const lines = []; let line = '';
    for (const word of text.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line); return lines;
  }
  function drawText(ctx, text, field, width, height, family) {
    const f = normalizedField(field), available = width * f.width;
    const maxSize = height * f.size, minSize = Math.max(18, maxSize * .57);
    let size = maxSize, lines = [text];
    const font = () => { ctx.font = `${f.italic ? 'italic ' : ''}${size}px "${family.replace(/["\\]/g, '')}"`; };
    font();
    while (ctx.measureText(text).width > available && size > minSize) { size -= 1; font(); }
    if (ctx.measureText(text).width > available) {
      lines = splitLines(ctx, text, available);
      while ((lines.length > 2 || lines.some(line => ctx.measureText(line).width > available)) && size > 18) { size -= 1; font(); lines = splitLines(ctx, text, available); }
    }
    if (lines.length > 2 || lines.some(line => ctx.measureText(line).width > available) || height * f.y - lines.length * size * 1.12 < 0) throw new Error('text_does_not_fit');
    ctx.fillStyle = '#111111'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    lines.forEach((line, index) => ctx.fillText(line, width * f.x, height * f.y - (lines.length - 1 - index) * size * 1.12));
    return { size, lines };
  }
  function render(canvas, image, record, layout = fields, family = 'Times New Roman') {
    day(record.issued_on); day(record.expires_on);
    if (day(record.expires_on) < day(record.issued_on) || !String(record.number || '').trim() || String(record.number).length > 40) throw new Error('invalid_certificate');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const info = {};
    for (const [key, text] of Object.entries({ procedure: record.procedure, date: dateLabel(record.issued_on), number: record.number })) {
      info[key] = drawText(ctx, text, layout[key], image.width, image.height, family);
    }
    return info;
  }
  const api = { fields, day, dateLabel, addMonths, plural, procedureLabel, status, normalizedField, loadImage, render };
  scope.MinutaCertificateRenderer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
