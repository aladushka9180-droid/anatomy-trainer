(function initMinutaClientImport(global) {
  'use strict';

  const SOURCE_LABELS = Object.freeze({ yclients:'YCLIENTS', dikidi:'DIKIDI', masters:'Masters', other:'Другая система' });
  const FIELD_ALIASES = Object.freeze({
    name:['имя','фио','клиент','имя клиента','client','client name','name','full name'],
    phone:['телефон','номер телефона','мобильный телефон','phone','phone number','mobile','client phone'],
    email:['email','e-mail','электронная почта','почта'],
    note:['комментарий','заметка','примечание','комментарий о клиенте','comment','note','notes'],
    birthday:['дата рождения','день рождения','birthday','birth date','date of birth'],
    visit_count:['визиты','количество визитов','число визитов','посещения','visits','visit count'],
    total_spent_rub:['потратил','оплатил','сумма оплат','всего оплачено','выручка','total spent','paid'],
    last_visit_on:['последний визит','дата последнего визита','last visit','last visit date'],
    external_id:['id клиента','client id','ид клиента','идентификатор клиента','id'],
    marketing_consent:['согласен на получение рассылок','согласие на рассылку','marketing consent','newsletter consent'],
    personal_data_consent:['согласен на обработку персональных данных','согласие на обработку персональных данных','personal data consent']
  });

  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    const bytes = global.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function normalizedHeader(value) {
    return String(value || '').replace(/^\ufeff/, '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[_.\-]+/g, ' ').replace(/\s+/g, ' ');
  }

  function delimiterFor(text) {
    const first = String(text || '').split(/\r?\n/, 1)[0] || '';
    const counts = { ';':0, ',':0, '\t':0 };
    let quoted = false;
    for (let index = 0; index < first.length; index += 1) {
      if (first[index] === '"') quoted = !quoted;
      else if (!quoted && Object.hasOwn(counts, first[index])) counts[first[index]] += 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parseDelimited(text) {
    const delimiter = delimiterFor(text);
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    const source = String(text || '').replace(/^\ufeff/, '');
    for (let index = 0; index <= source.length; index += 1) {
      const character = source[index] ?? '\n';
      if (character === '"') {
        if (quoted && source[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = !quoted;
      } else if (!quoted && character === delimiter) {
        row.push(value.trim()); value = '';
      } else if (!quoted && (character === '\n' || character === '\r')) {
        if (character === '\r' && source[index + 1] === '\n') index += 1;
        row.push(value.trim()); value = '';
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
      } else value += character;
    }
    return rows;
  }

  function isoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw);
    if (match) return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
    match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(raw);
    return match ? `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}` : '';
  }

  function integer(value) {
    const parsed = Number(String(value || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }

  function consent(value) {
    const normalized = normalizedHeader(value);
    if (['да','yes','true','1','согласен','согласна'].includes(normalized)) return true;
    if (['нет','no','false','0','не согласен','не согласна'].includes(normalized)) return false;
    return null;
  }

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 10) digits = `7${digits}`;
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    return /^7\d{10}$/.test(digits) ? digits : '';
  }

  function mapRows(table) {
    if (table.length < 2) throw new Error('В файле нет строк клиентов.');
    const headers = table[0].map(normalizedHeader);
    const indexes = Object.fromEntries(Object.entries(FIELD_ALIASES).map(([field, aliases]) => [field, headers.findIndex(header => aliases.includes(header))]));
    if (indexes.name < 0 || indexes.phone < 0) throw new Error('Не найдены обязательные столбцы «Имя» и «Телефон».');
    const invalid = [];
    const clients = new Map();
    table.slice(1).forEach((row, offset) => {
      const get = field => indexes[field] >= 0 ? String(row[indexes[field]] || '').trim() : '';
      const phone = normalizePhone(get('phone'));
      const name = get('name').slice(0, 80);
      if (!phone || !name) { invalid.push(offset + 2); return; }
      clients.set(phone, {
        phone, display_phone:get('phone').slice(0,24), name,
        email:get('email').slice(0,254), note:get('note').slice(0,1000),
        birthday:isoDate(get('birthday')), visit_count:integer(get('visit_count')),
        total_spent_rub:integer(get('total_spent_rub')), last_visit_on:isoDate(get('last_visit_on')),
        external_id:get('external_id').slice(0,120), marketing_consent:consent(get('marketing_consent')),
        personal_data_consent:consent(get('personal_data_consent'))
      });
    });
    const rows = [...clients.values()];
    if (!rows.length) throw new Error('Не найдено ни одного клиента с корректным именем и телефоном.');
    if (rows.length > 500) throw new Error('За один раз можно импортировать не больше 500 уникальных клиентов.');
    return { rows, invalid, duplicateCount:Math.max(0, table.length - 1 - invalid.length - rows.length), headers };
  }

  async function decodeFile(file) {
    if (!file || file.size < 1) throw new Error('Выберите непустой CSV-файл.');
    if (file.size > 12 * 1024 * 1024) throw new Error('Файл должен быть не больше 12 МБ.');
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) throw new Error('Поддерживаются CSV, TSV и TXT. Для Excel сохраните таблицу как CSV UTF-8.');
    const bytes = await file.arrayBuffer();
    let text = new TextDecoder('utf-8', { fatal:false }).decode(bytes);
    if (text.includes('\ufffd')) text = new TextDecoder('windows-1251').decode(bytes);
    return text;
  }

  function createController(options = {}) {
    const { db, $, escapeHtml, notify, requireWrites, onLoaded } = options;
    let organization = null;
    let workspace = null;
    let preview = null;
    let bound = false;
    let revision = 0;

    function supported() { return Boolean(workspace && workspace.can_import); }
    function render() {
      const panel = $('#clientImportPanel');
      if (!panel) return;
      panel.hidden = !supported();
      const history = $('#clientImportHistory');
      if (history && supported()) {
        const batches = Array.isArray(workspace.recent_batches) ? workspace.recent_batches : [];
        history.textContent = batches.length ? `Последний импорт: ${new Date(batches[0].created_at).toLocaleString('ru-RU')} · ${batches[0].input_count} клиентов` : 'Импортов пока не было';
      }
    }

    async function load() {
      const currentRevision = ++revision;
      preview = null;
      $('#clientImportPreview')?.setAttribute('hidden','');
      if (!organization?.id || !navigator.onLine) { workspace = null; onLoaded?.([]); render(); return { ok:true,optional:true,skipped:true }; }
      const clients = [];
      const pageSize = 1000;
      const maxClients = 100000;
      let payload = null;
      let error = null;
      for (let offset = 0; offset <= maxClients; offset += pageSize) {
        let response = await db.rpc('get_minuta_imported_clients', { p_organization:organization.id, p_limit:pageSize, p_offset:offset });
        if (offset === 0 && response.error && (response.error.code === 'PGRST202' || /could not find.*get_minuta_imported_clients|function .* does not exist/i.test(response.error.message || ''))) {
          response = await db.rpc('get_minuta_imported_clients', { p_organization:organization.id });
        }
        ({ data:payload, error } = response);
        if (currentRevision !== revision) return { ok:false,optional:true,stale:true };
        if (error) break;
        clients.push(...(Array.isArray(payload?.clients) ? payload.clients : []));
        if (!payload?.has_more) break;
        if (clients.length >= maxClients) { error = new Error('Слишком большой объём клиентской базы'); break; }
      }
      if (error) { workspace = null; onLoaded?.([]); render(); return { ok:false,optional:true }; }
      workspace = { ...(payload || {}), clients };
      onLoaded?.(clients);
      render();
      return { ok:true,optional:true };
    }

    async function chooseFile(file) {
      try {
        preview = mapRows(parseDelimited(await decodeFile(file)));
        const sample = preview.rows.slice(0, 5);
        $('#clientImportPreviewList').innerHTML = sample.map(item => `<li><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.display_phone)}</span></li>`).join('');
        $('#clientImportPreviewSummary').textContent = `${preview.rows.length} клиентов готово${preview.duplicateCount ? ` · дублей в файле: ${preview.duplicateCount}` : ''}${preview.invalid.length ? ` · пропущено строк: ${preview.invalid.length}` : ''}`;
        $('#clientImportPreview').hidden = false;
      } catch (error) {
        preview = null;
        $('#clientImportPreview').hidden = true;
        notify(error?.message || 'Не удалось прочитать файл');
      }
    }

    async function submit(event) {
      event.preventDefault();
      if (!preview?.rows?.length || !organization?.id || !requireWrites()) return;
      const button = $('#clientImportSubmit');
      button.disabled = true;
      try {
        const { data, error } = await db.rpc('import_minuta_clients', {
          p_organization:organization.id,p_source_system:$('#clientImportSource').value,
          p_rows:preview.rows,p_request_id:uuid()
        });
        if (error) throw error;
        notify(`Импортировано: ${Number(data?.created_count || 0)} новых, ${Number(data?.updated_count || 0)} обновлено`);
        $('#clientImportForm').reset();
        preview = null;
        $('#clientImportPreview').hidden = true;
        await load();
      } catch (error) { notify(error?.message || 'Импорт не выполнен'); }
      finally { button.disabled = false; }
    }

    function bind() {
      if (bound) return;
      bound = true;
      $('#clientImportFile')?.addEventListener('change', event => chooseFile(event.target.files?.[0]));
      $('#clientImportForm')?.addEventListener('submit', submit);
    }

    return {
      bind, load,
      setOrganization(next) { organization = next || null; workspace = null; onLoaded?.([]); render(); void load(); }
    };
  }

  global.MinutaClientImport = Object.freeze({ createController, parseDelimited, mapRows, normalizePhone });
})(window);
