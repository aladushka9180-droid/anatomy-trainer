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
  function customText(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 260) throw new Error('invalid_custom_text');
    return value.trim();
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
    for (const paragraph of text.split(/\r?\n/)) {
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line); line = '';
    } return lines;
  }
  function drawText(ctx, text, field, width, height, family) {
    const f = normalizedField(field), available = width * f.width;
    const maxSize = height * f.size, minSize = Math.max(18, maxSize * .57);
    let size = maxSize, lines = [text];
    const font = () => { ctx.font = `${f.italic ? 'italic ' : ''}${size}px "${family.replace(/["\\]/g, '')}"`; };
    font();
    while (ctx.measureText(text).width > available && size > minSize) { size -= 1; font(); }
    if (ctx.measureText(text).width > available || /\r?\n/.test(text)) {
      lines = splitLines(ctx, text, available);
      if (lines.length > 1) { size = Math.min(size,maxSize*.65); font(); lines = splitLines(ctx,text,available); }
      while ((lines.length > 2 || lines.some(line => ctx.measureText(line).width > available)) && size > 18) { size -= 1; font(); lines = splitLines(ctx, text, available); }
    }
    if (lines.length > 2 || lines.some(line => ctx.measureText(line).width > available) || height * f.y - lines.length * size * 1.12 < 0) throw new Error('text_does_not_fit');
    ctx.fillStyle = '#111111'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    lines.forEach((line, index) => ctx.fillText(line, width * f.x, height * f.y - (lines.length - 1 - index) * size * 1.12));
    return { size, lines };
  }
  function render(canvas, image, record, layout = fields, family = 'Times New Roman') {
    day(record.issued_on); day(record.expires_on);
    customText(record.procedure);
    if (day(record.expires_on) < day(record.issued_on) || !String(record.number || '').trim() || String(record.number).length > 40) throw new Error('invalid_certificate');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const info = {};
    for (const [key, text] of Object.entries({ procedure: record.procedure, date: dateLabel(record.issued_on), number: record.number })) {
      info[key] = drawText(ctx, text, layout[key], image.width, image.height, family);
    }
    return info;
  }
  const exportFormats = Object.freeze({png:'image/png',jpg:'image/jpeg',webp:'image/webp',pdf:'application/pdf'});
  const paperSizes = Object.freeze({a5:{width:148,height:210},a4:{width:210,height:297}});
  function printSize(canvas, paper = 'a5') {
    const selected = paperSizes[paper]; if (!selected) throw new Error('unsupported_export_format');
    const landscape = canvas.width > canvas.height, width = landscape ? selected.height : selected.width, height = landscape ? selected.width : selected.height;
    const scale = Math.min(width/canvas.width,height/canvas.height);
    return {width,height,imageWidth:canvas.width*scale,imageHeight:canvas.height*scale,dpi:Math.round(25.4/scale)};
  }
  async function exportBlob(canvas, format = 'png', paper = 'a5') {
    const type = exportFormats[format];
    if (!type) throw new Error('unsupported_export_format');
    let source = canvas;
    if (format === 'jpg' || format === 'pdf') {
      source = document.createElement('canvas'); source.width = canvas.width; source.height = canvas.height;
      const ctx = source.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,source.width,source.height); ctx.drawImage(canvas,0,0);
    }
    const imageType = format === 'pdf' ? 'image/jpeg' : type;
    const blob = await new Promise((resolve,reject) => source.toBlob(value => value && value.type === imageType ? resolve(value) : reject(new Error('unsupported_export_format')),imageType,format==='pdf'?1:.95));
    if (format !== 'pdf') return blob;
    // A single image page preserves the uploaded template and the rendered font on every device.
    const jpeg = new Uint8Array(await blob.arrayBuffer()), encode = text => new TextEncoder().encode(text);
    const size = printSize(canvas,paper), points = mm => (mm*72/25.4).toFixed(2), w = points(size.width), h = points(size.height);
    const contents = `q ${points(size.imageWidth)} 0 0 ${points(size.imageHeight)} ${points((size.width-size.imageWidth)/2)} ${points((size.height-size.imageHeight)/2)} cm /Im0 Do Q\n`;
    const chunks = [encode('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')], offsets = [0]; let length = chunks[0].length;
    function object(id, body, stream) {
      offsets[id] = length;
      const head = encode(`${id} 0 obj\n${body}${stream ? '\nstream\n' : '\nendobj\n'}`); chunks.push(head); length += head.length;
      if (stream) { chunks.push(stream); length += stream.length; const tail = encode('\nendstream\nendobj\n'); chunks.push(tail); length += tail.length; }
    }
    object(1,'<< /Type /Catalog /Pages 2 0 R >>');
    object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
    object(4,`<< /Length ${encode(contents).length} >>`,encode(contents));
    object(5,`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,jpeg);
    const xref = length;
    chunks.push(encode(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    return new Blob(chunks,{type});
  }
  const api = { fields, day, dateLabel, addMonths, plural, procedureLabel, customText, status, normalizedField, loadImage, render, exportFormats, exportBlob, paperSizes, printSize };
  scope.MinutaCertificateRenderer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
