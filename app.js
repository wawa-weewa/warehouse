'use strict';

const STORAGE_KEY = 'warehouse.v1';
const SORT_KEY = 'warehouse.sort';
const UNITS = ['шт', 'уп', 'амп', 'шприц', 'фл', 'мл'];
const SOON_DAYS = 30;
const SORTS = {
  manual: 'Свой порядок',
  name: 'По алфавиту',
  quantity: 'По количеству',
};

const $ = (sel) => document.querySelector(sel);

let items = load();
let filter = null; // null | 'low'
let sortMode = loadSort();
let query = '';
let editingId = null;
let adjustingId = null;

/* ---------- Хранение ---------- */

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(data) ? data.map(normalize).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function loadSort() {
  try {
    const mode = localStorage.getItem(SORT_KEY);
    return mode in SORTS ? mode : 'manual';
  } catch {
    return 'manual';
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    toast('Не удалось сохранить данные');
  }
}

function normalize(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    id: String(raw.id || uid()),
    name: raw.name.trim(),
    quantity: Math.max(0, toNumber(raw.quantity) ?? 0),
    unit: typeof raw.unit === 'string' && raw.unit.trim() ? raw.unit.trim() : UNITS[0],
    minQuantity: toNumber(raw.minQuantity),
    expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.expiryDate) ? raw.expiryDate : null,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? round(n) : null;
}

function inputNum(n) {
  return String(n).replace('.', ',');
}

function isBadNumber(input) {
  return input.value.trim() !== '' && toNumber(input.value.trim()) === null;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/* ---------- Статусы ---------- */

function isLow(item) {
  if (item.quantity === 0) return true;
  return item.minQuantity !== null && item.quantity <= item.minQuantity;
}

function daysLeft(item) {
  if (!item.expiryDate) return null;
  const [y, m, d] = item.expiryDate.split('-').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

function expiryStatus(item) {
  const days = daysLeft(item);
  if (days === null) return null;
  if (days < 0) return 'expired';
  if (days <= SOON_DAYS) return 'soon';
  return 'ok';
}

/* ---------- Форматирование ---------- */

const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

function fmtNum(n) {
  return numberFmt.format(n);
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return dateFmt.format(new Date(y, m - 1, d)).replace(' г.', '');
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Отрисовка ---------- */

function badgesHtml(item) {
  const out = [];
  if (item.quantity === 0) {
    out.push('<span class="badge badge-red">Закончился</span>');
  } else if (isLow(item)) {
    out.push(`<span class="badge badge-red">Мало · мин. ${fmtNum(item.minQuantity)}</span>`);
  }
  const status = expiryStatus(item);
  if (status) {
    const days = daysLeft(item);
    let text = `до ${fmtDate(item.expiryDate)}`;
    let cls = 'badge';
    if (status === 'expired') {
      text = `Просрочен · ${fmtDate(item.expiryDate)}`;
      cls += ' badge-red';
    } else if (status === 'soon') {
      text = days === 0 ? 'Истекает сегодня' : `Истекает через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
      cls += ' badge-orange';
    }
    out.push(`<span class="${cls}">${text}</span>`);
  }
  return out.join('');
}

function cardElement(item) {
  const li = document.createElement('li');
  const status = expiryStatus(item);
  li.className = 'card';
  li.classList.toggle('is-low', isLow(item));
  li.classList.toggle('is-soon', status === 'soon');
  li.classList.toggle('is-expired', status === 'expired');
  li.dataset.id = item.id;
  const name = escapeHtml(item.name);
  li.innerHTML = `
    <div class="handle" aria-label="Перетащить">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16v2H4zm0 4h16v2H4zm0 4h16v2H4z"/></svg>
    </div>
    <div class="card-main" data-action="edit">
      <p class="card-name">${name}</p>
      <div class="badges">${badgesHtml(item)}</div>
    </div>
    <div class="stepper">
      <button class="step" data-action="dec" aria-label="Уменьшить" ${item.quantity <= 0 ? 'disabled' : ''}>−</button>
      <button class="qty" data-action="adjust" aria-label="Изменить остаток">
        <span class="qty-num">${fmtNum(item.quantity)}</span>
        <span class="qty-unit">${item.unit}</span>
      </button>
      <button class="step" data-action="inc" aria-label="Увеличить">+</button>
    </div>`;
  return li;
}

const byName = (a, b) => a.name.localeCompare(b.name, 'ru');

const comparators = {
  manual: () => 0, // порядок массива items и есть свой порядок
  name: byName,
  quantity: (a, b) => a.quantity - b.quantity || byName(a, b),
};

/** Перетаскивать можно только в своём порядке и когда видны все позиции. */
function canDrag() {
  return sortMode === 'manual' && !filter && !query.trim();
}

function render() {
  const list = $('#list');
  const q = query.trim().toLocaleLowerCase('ru');

  const visible = items
    .filter((it) => !q || it.name.toLocaleLowerCase('ru').includes(q))
    .filter((it) => filter !== 'low' || isLow(it))
    .sort(comparators[sortMode]);

  list.replaceChildren(...visible.map(cardElement));
  list.classList.toggle('can-drag', canDrag() && visible.length > 1);

  $('#empty').hidden = items.length > 0;
  $('#noResults').hidden = items.length === 0 || visible.length > 0;
  renderSummary();
}

function renderSummary() {
  const low = items.filter(isLow).length;
  $('#lowCount').textContent = low;
  $('.chip-low').classList.toggle('zero', low === 0);
  $('.chip-low').classList.toggle('active', filter === 'low');
  $('#sortValue').textContent = SORTS[sortMode];

  const n = items.length;
  $('#subtitle').textContent = n ? `${n} ${plural(n, 'позиция', 'позиции', 'позиций')}` : 'Учёт препаратов';
}

/** Обновляет одну карточку на месте, без пересортировки, чтобы она не «убегала» из-под пальца. */
function refreshCard(item, bump) {
  const old = document.querySelector(`.card[data-id="${CSS.escape(item.id)}"]`);
  if (old) {
    const fresh = cardElement(item);
    old.replaceWith(fresh);
    if (bump) fresh.querySelector('.qty-num').classList.add('bump');
  }
  renderSummary();
}

/* ---------- Действия ---------- */

function find(id) {
  return items.find((it) => it.id === id);
}

function changeQuantity(item, delta) {
  const next = round(Math.max(0, item.quantity + delta));
  if (next === item.quantity) return false;
  item.quantity = next;
  item.updatedAt = new Date().toISOString();
  save();
  if (navigator.vibrate) navigator.vibrate(8);
  return true;
}

$('#list').addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const item = find(target.closest('.card').dataset.id);
  if (!item) return;

  switch (target.dataset.action) {
    case 'inc':
      if (changeQuantity(item, 1)) refreshCard(item, true);
      break;
    case 'dec':
      if (changeQuantity(item, -1)) refreshCard(item, true);
      break;
    case 'adjust':
      openAdjust(item);
      break;
    case 'edit':
      openItem(item);
      break;
  }
});

$('#search').addEventListener('input', (e) => {
  query = e.target.value;
  render();
});

$('.chip-low').addEventListener('click', () => {
  filter = filter === 'low' ? null : 'low';
  render();
});

/* ---------- Сортировка ---------- */

const sortMenu = $('#sortMenu');
sortMenu.innerHTML = Object.entries(SORTS)
  .map(([mode, label]) => `<button type="button" class="menu-item" data-sort="${mode}">${label}<span class="check">✓</span></button>`)
  .join('');

$('#sortBtn').addEventListener('click', () => {
  sortMenu.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('selected', b.dataset.sort === sortMode));
  openSheet($('#sortSheet'));
});

sortMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sort]');
  if (!btn) return;
  sortMode = btn.dataset.sort;
  try {
    localStorage.setItem(SORT_KEY, sortMode);
  } catch {}
  render();
  closeSheet($('#sortSheet'));
});

/* ---------- Перетаскивание ---------- */

const list = $('#list');
let drag = null;

list.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle || !list.classList.contains('can-drag')) return;
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  const card = handle.closest('.card');
  card.classList.add('dragging');
  drag = { card, startY: e.clientY, lastY: e.clientY, raf: requestAnimationFrame(autoScroll) };
  if (navigator.vibrate) navigator.vibrate(10);
});

list.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.lastY = e.clientY;
  moveDrag();
});

list.addEventListener('pointerup', endDrag);
list.addEventListener('pointercancel', endDrag);

function moveDrag() {
  const { card } = drag;
  card.style.transform = `translateY(${drag.lastY - drag.startY}px)`;

  const rect = card.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  const prev = card.previousElementSibling;
  const next = card.nextElementSibling;
  const midOf = (el) => {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  };

  let before;
  if (prev && mid < midOf(prev)) before = prev;
  else if (next && mid > midOf(next)) before = next.nextElementSibling;
  else return;

  // Карточка переезжает в DOM; сдвигаем точку отсчёта, чтобы она осталась под пальцем
  const top = card.offsetTop;
  list.insertBefore(card, before);
  drag.startY += card.offsetTop - top;
  card.style.transform = `translateY(${drag.lastY - drag.startY}px)`;
}

/** Прокручивает страницу, если палец держат у верхнего или нижнего края. */
function autoScroll() {
  if (!drag) return;
  const topEdge = $('.top').getBoundingClientRect().bottom + 60;
  const bottomEdge = window.innerHeight - 80;
  let speed = 0;
  if (drag.lastY < topEdge) speed = -Math.min(16, (topEdge - drag.lastY) / 4);
  else if (drag.lastY > bottomEdge) speed = Math.min(16, (drag.lastY - bottomEdge) / 4);
  if (speed) {
    const before = window.scrollY;
    window.scrollBy(0, speed);
    drag.startY -= window.scrollY - before;
    moveDrag();
  }
  drag.raf = requestAnimationFrame(autoScroll);
}

function endDrag() {
  if (!drag) return;
  cancelAnimationFrame(drag.raf);
  drag.card.classList.remove('dragging');
  drag.card.style.transform = '';
  drag = null;

  const order = [...list.children].map((li) => li.dataset.id);
  const changed = order.some((id, i) => items[i].id !== id);
  if (changed) {
    items = order.map(find);
    save();
  }
}

$('#addBtn').addEventListener('click', () => openItem(null));
$('#emptyAdd').addEventListener('click', () => openItem(null));
$('#settingsBtn').addEventListener('click', () => openSheet($('#settingsSheet')));

/* ---------- Нижние листы ---------- */

function openSheet(el) {
  el.hidden = false;
  el.classList.remove('closing');
}

function closeSheet(el) {
  if (el.hidden || el.classList.contains('closing')) return;
  document.activeElement?.blur();
  el.classList.add('closing');
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove('closing');
  }, 190);
}

document.querySelectorAll('.sheet-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) closeSheet(backdrop);
  });
});

/* Добавление / редактирование */

const itemForm = $('#itemForm');
itemForm.unit.innerHTML = UNITS.map((u) => `<option value="${u}">${u}</option>`).join('');

function openItem(item) {
  editingId = item ? item.id : null;
  $('#itemTitle').textContent = item ? 'Препарат' : 'Новый препарат';
  $('#deleteBtn').hidden = !item;
  itemForm.name.value = item ? item.name : '';
  itemForm.quantity.value = item ? inputNum(item.quantity) : '';
  const unit = item ? item.unit : UNITS[0];
  if (![...itemForm.unit.options].some((o) => o.value === unit)) itemForm.unit.add(new Option(unit, unit));
  itemForm.unit.value = unit;
  itemForm.minQuantity.value = item && item.minQuantity !== null ? inputNum(item.minQuantity) : '';
  itemForm.expiryDate.value = item && item.expiryDate ? item.expiryDate : '';
  openSheet($('#itemSheet'));
  if (!item) setTimeout(() => itemForm.name.focus(), 50);
}

itemForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = itemForm.name.value.trim();
  if (!name) {
    toast('Введите название препарата');
    itemForm.name.focus();
    return;
  }
  const bad = [itemForm.quantity, itemForm.minQuantity].find(isBadNumber);
  if (bad) {
    toast('Введите число, например 10 или 2,5');
    bad.focus();
    return;
  }
  const duplicate = items.find(
    (it) => it.id !== editingId && it.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'),
  );
  if (duplicate && !confirm(`«${duplicate.name}» уже есть на складе. Всё равно сохранить?`)) return;

  const data = {
    name,
    quantity: toNumber(itemForm.quantity.value) ?? 0,
    unit: itemForm.unit.value,
    minQuantity: toNumber(itemForm.minQuantity.value),
    expiryDate: itemForm.expiryDate.value || null,
    updatedAt: new Date().toISOString(),
  };

  const existing = editingId && find(editingId);
  if (existing) {
    Object.assign(existing, data);
    toast('Сохранено');
  } else {
    items.push({ id: uid(), createdAt: data.updatedAt, ...data });
    toast('Препарат добавлен');
  }
  save();
  render();
  closeSheet($('#itemSheet'));
});

$('#deleteBtn').addEventListener('click', () => {
  const item = find(editingId);
  if (!item || !confirm(`Удалить «${item.name}»?`)) return;
  items = items.filter((it) => it.id !== item.id);
  save();
  render();
  closeSheet($('#itemSheet'));
  toast('Препарат удалён');
});

/* Приход / расход */

const adjustForm = $('#adjustForm');

function openAdjust(item) {
  adjustingId = item.id;
  $('#adjustName').textContent = item.name;
  $('#adjustCurrent').textContent = `Сейчас: ${fmtNum(item.quantity)} ${item.unit}`;
  adjustForm.amount.value = '';
  openSheet($('#adjustSheet'));
  setTimeout(() => adjustForm.amount.focus(), 50);
}

adjustForm.addEventListener('submit', (e) => e.preventDefault());

adjustForm.querySelectorAll('[data-dir]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const item = find(adjustingId);
    const amount = toNumber(adjustForm.amount.value);
    if (!item) return;
    if (!amount) {
      toast(isBadNumber(adjustForm.amount) ? 'Введите число, например 10 или 2,5' : 'Введите количество');
      adjustForm.amount.focus();
      return;
    }
    const dir = Number(btn.dataset.dir);
    if (dir < 0 && amount > item.quantity) {
      toast(`На складе только ${fmtNum(item.quantity)} ${item.unit}`);
      return;
    }
    changeQuantity(item, dir * amount);
    refreshCard(item, true);
    closeSheet($('#adjustSheet'));
    toast(`${dir > 0 ? 'Приход' : 'Расход'}: ${fmtNum(amount)} ${item.unit}`);
  });
});

/* ---------- Резервная копия ---------- */

$('#exportBtn').addEventListener('click', async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `sklad-${stamp}.json`;
  const json = JSON.stringify({ app: 'warehouse', version: 1, exportedAt: new Date().toISOString(), items }, null, 2);
  const file = new File([json], fileName, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(list)) throw new Error('bad format');
    const imported = list.map(normalize).filter(Boolean);
    const n = imported.length;
    if (!confirm(`В копии ${n} ${plural(n, 'позиция', 'позиции', 'позиций')}. Заменить текущие данные?`)) return;
    items = imported;
    save();
    render();
    closeSheet($('#settingsSheet'));
    toast('Данные восстановлены');
  } catch {
    toast('Не удалось прочитать файл');
  }
});

/* ---------- Уведомление ---------- */

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---------- Запуск ---------- */

render();

// Сроки годности считаются от сегодняшней даты, поэтому пересчитываем при возвращении в приложение
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
