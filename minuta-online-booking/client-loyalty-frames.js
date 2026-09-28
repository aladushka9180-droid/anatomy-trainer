(function () {
  'use strict';
  const thresholds = Object.freeze([0, 3, 6, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  const integer = value => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
  const seen = new Map();
  let current = null;
  // Atlas apertures are aligned to the same photo, independently of ornament size.
  const geometry = [
    [156,.48,.83],[156,.48,.83],[156,.48,.83],[156,.48,.83],
    [160,.48,.82],[160,.48,.82],[160,.48,.82],[160,.48,.82],
    [172,.45,.77],[172,.45,.77],[172,.45,.77],[172,.45,.77],
    [176,.40,.73],[184,.49,.81]
  ];
  // Circular photo bleeds under the opaque rim. Apertures differ across the atlas;
  // these orbit-space centres/radii fill them without painting outside the frame.
  const apertures = [[94,90,54],[92,88,55],[91,89,54],[90,89,54],
    [92,84,54],[92,83,54],[91,82,54],[89,81,54],
    [93,80,54],[93,80,54],[90,80,54],[89,81,53],[93,82,52],[91,84,59]];
  function photoStyle(index) {
    const [x,y,radius] = apertures[index];
    return `--frame-photo-left:${x-radius}px;--frame-photo-top:${y-radius}px;--frame-photo-size:${radius*2}px;`;
  }
  function level(value) {
    const total = integer(value);
    const index = thresholds.findLastIndex(value => value <= total);
    const threshold = thresholds[index];
    const next = thresholds[index + 1] ?? null;
    return { total, index, threshold, next, remaining:next === null ? 0 : next - total };
  }
  function count(client, outcome) {
    const visits = new Map();
    for (const item of client?.bookings || []) {
      if (!item?.id) continue;
      visits.set(String(item.id), item);
    }
    let native = 0, imported = 0, pending = false;
    for (const item of visits.values()) {
      const result = outcome(item);
      pending ||= Boolean(result?._sync_pending);
      if (item.status === 'cancelled' || item.automatic_break || item.booking_source === 'schedule_block'
          || result?.visit_status !== 'completed') continue;
      if (item.is_imported_history) imported++; else native++;
    }
    // An imported aggregate and its detailed rows describe the same old history.
    const history = Math.max(imported, integer(client?.imported?.visit_count));
    return { total:native + history, native, imported:history, pending };
  }
  function sprite(index, total, className = '') {
    const [size, center, plaque] = geometry[index];
    const top = 88 - size * center;
    const row = Math.floor(index / 4), cell = 313.5;
    const [start, height] = [[0,300],[306,302],[610,300],[909,322]][row];
    const offset = (row * cell - start) / cell * size;
    const styles = index === 13 ? `--frame-height:${size}px;--frame-top:${top}px;`
      : `--frame-height:${height / cell * size}px;--frame-top:${top-offset}px;--frame-sheet:${size*4}px;--frame-x:${-(index%4)*size}px;--frame-y:${-start/cell*size}px;`;
    return `<span class="loyalty-frame-art ${index === 13 ? 'loyalty-frame-crown' : ''} ${className}" aria-hidden="true" style="--frame-size:${size}px;${styles}"></span><span class="loyalty-frame-count" aria-hidden="true" style="top:${top + size * plaque - 10}px">${integer(total)}</span>`;
  }
  // Content is already escaped by the provider's shared avatar renderer.
  function compact({ total = 0, content = '', size = 76 } = {}) {
    const rank = level(total), extent = Math.max(64, Math.min(112, integer(size)));
    const [frameSize, center, plaque] = geometry[rank.index];
    const countTop = (88 - frameSize * center + frameSize * plaque) * extent / 184 - 5;
    return `<span class="client-framed-avatar" role="img" aria-label="Завершённых сеансов: ${rank.total}" data-session-tier="${rank.threshold}" style="--compact-size:${extent}px;--compact-scale:${extent / 184};${photoStyle(rank.index)}"><span class="client-framed-stage"><span class="client-framed-photo">${content}</span>${sprite(rank.index, rank.total)}</span><span class="client-framed-count" style="top:${countTop}px">${rank.total}</span></span>`;
  }
  function ensureUI(orbit) {
    if (orbit.querySelector('.client-profile-photo-open')) return;
    orbit.removeAttribute('role');
    orbit.removeAttribute('aria-label');
    orbit.insertAdjacentHTML('beforeend', '<span class="loyalty-frame-decoration"></span><button type="button" class="client-profile-photo-open" aria-label="Добавить или сменить фото клиента"></button>');
    orbit.querySelector('.client-profile-photo-open').addEventListener('click', () => {
      const input = orbit.querySelector('[data-client-avatar-input]');
      if (input && !input.disabled && !input.closest('.client-avatar-picker')?.hidden) input.click();
    });
    const row = document.createElement('button');
    row.id = 'clientLoyaltyLevel'; row.type = 'button'; row.className = 'loyalty-level-row';
    row.setAttribute('aria-haspopup', 'dialog');
    row.addEventListener('click', open);
    document.querySelector('.client-profile-head')?.after(row);
  }
  function dialog() {
    let element = document.getElementById('clientLoyaltyLevelsDialog');
    if (element) return element;
    element = document.createElement('dialog');
    element.id = 'clientLoyaltyLevelsDialog'; element.className = 'loyalty-level-dialog';
    element.setAttribute('aria-labelledby', 'clientLoyaltyLevelsTitle');
    element.innerHTML = '<header><h3 id="clientLoyaltyLevelsTitle">Сеансы и уровень</h3><button type="button" aria-label="Закрыть">×</button></header><div class="loyalty-level-content"></div>';
    element.querySelector('button').addEventListener('click', () => element.close());
    element.addEventListener('click', event => { if (event.target === element) { const r=element.getBoundingClientRect(); if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) element.close(); } });
    document.body.append(element);
    return element;
  }
  function fillDialog() {
    const element = document.getElementById('clientLoyaltyLevelsDialog');
    if (!element || !current) return;
    const { facts, rank, incomplete } = current;
    const next = rank.next === null ? rank : level(rank.next);
    const preview = sprite(next.index, next.total);
    element.querySelector('.loyalty-level-content').innerHTML = `<p class="loyalty-level-total">${facts.total} сеансов</p>
      <p>${incomplete ? 'По доступной истории. Итог уточнится после загрузки и синхронизации.' : 'Завершённые сеансы за всё время.'}</p>
      <div class="loyalty-next-preview" style="${photoStyle(next.index)}"><span class="loyalty-preview-initial" aria-hidden="true">${rank.next === null ? '✓' : '+'}</span>${preview}</div>
      <strong>${rank.next === null ? 'Максимальный ободок — 100 сеансов' : `Следующий ободок — на ${rank.next} сеансах`}</strong>
      <p>${rank.next === null ? 'Счётчик продолжает расти после 100.' : `Осталось ${rank.remaining}. Счётчик растёт после каждого завершённого сеанса.`}</p>
      <ol class="loyalty-thresholds" aria-label="Пороги изменения ободка">${thresholds.map(value => `<li${value === rank.threshold ? ' aria-current="step"' : ''}>${value}</li>`).join('')}</ol>
      <p class="loyalty-level-rules">Один завершённый визит — один сеанс, независимо от числа услуг. Отмены и неявки не учитываются. Исправление результата пересчитывает уровень.</p>
      ${facts.imported ? `<p class="loyalty-level-rules">Из импортированной истории: ${facts.imported}. Сводное число и строки этой истории не складываются повторно.</p>` : ''}
      <p class="loyalty-level-rules">Награды настраиваются отдельно. Использование награды не сбрасывает ободок и общее число сеансов.</p>`;
  }
  function open() {
    if (!current) return;
    const element = dialog(); fillDialog();
    if (!element.open) element.showModal();
  }
  function render({ client, outcome, scope, complete = true }) {
    const orbit = document.getElementById('clientProfileOrbit');
    if (!orbit || !client) return;
    ensureUI(orbit);
    orbit.removeAttribute('aria-label');
    const facts = count(client, outcome), rank = level(facts.total);
    const incomplete = !complete || facts.pending;
    const key = `${scope}:${client.phone}`;
    const previous = seen.get(key);
    current = { facts, rank, incomplete };
    orbit.classList.add('has-session-frame');
    orbit.dataset.sessionTier = String(rank.threshold);
    const [photoX,photoY,photoRadius] = apertures[rank.index];
    orbit.style.setProperty('--frame-photo-left', `${photoX-photoRadius}px`);
    orbit.style.setProperty('--frame-photo-top', `${photoY-photoRadius}px`);
    orbit.style.setProperty('--frame-photo-size', `${photoRadius*2}px`);
    orbit.querySelector('.loyalty-frame-decoration').innerHTML = sprite(rank.index, rank.total);
    const avatarInput = orbit.querySelector('[data-client-avatar-input]');
    orbit.querySelector('.client-profile-photo-open').disabled = !avatarInput || avatarInput.disabled || Boolean(avatarInput.closest('.client-avatar-picker')?.hidden);
    const row = document.getElementById('clientLoyaltyLevel');
    if (row) row.innerHTML = `<span><strong>${facts.total} сеансов</strong><small>${incomplete ? 'По доступной истории · ожидает сверки' : rank.next === null ? 'Максимальный ободок' : `Ещё ${rank.remaining} до следующего ободка`}</small></span><span aria-hidden="true">›</span>`;
    if (complete && !facts.pending) {
      seen.set(key, Math.max(previous ?? rank.threshold, rank.threshold));
      if (previous !== undefined && rank.threshold > previous) {
        orbit.classList.remove('loyalty-level-up');
        void orbit.offsetWidth;
        orbit.classList.add('loyalty-level-up');
        orbit.addEventListener('animationend', () => orbit.classList.remove('loyalty-level-up'), { once:true });
      }
    }
    fillDialog();
  }
  function reset() { seen.clear(); current = null; document.getElementById('clientLoyaltyLevelsDialog')?.close(); }
  window.addEventListener('minuta:provider-session-reset', reset);
  window.PrimeTimeLoyaltyFrames = Object.freeze({ thresholds, level, count, compact, render, reset });
})();
