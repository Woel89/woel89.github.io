/**
 * Кабинет владельца NetGameForge (#9). Вход по PAT, список игр, форма, публикация.
 * Токен только в sessionStorage (через auth.js), не в URL, не в логи.
 * @module cabinet
 */

import { isAuthed, saveToken, clearToken } from './lib/auth.js';
import { authedRequest } from './lib/auth.js';
import {
  readCatalog, publishGame, upsertGame, deleteGame,
  generateSlug, findDuplicate, getViewerLogin, suggestTags,
  getPublished, getDraft, promoteGame, discardDraft,
} from './lib/games-api.js';
import { putFile } from './lib/storage.js';
import { GITHUB_API_BASE, CATALOG_REPO } from './lib/config.js';

/** Список категорий каталога (value = хранимое значение). */
const CATEGORIES = [
  'arcade', 'puzzle', 'racing', 'action', 'shooter',
  'strategy', 'casual', 'sport', 'adventure', 'board',
];

/** Мягкие/жёсткие лимиты символов по полям. */
const LIMITS = {
  title: { max: 60, soft: 50 },
  description: { max: 300, soft: 250 },
};

const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
const OBFUSCATOR_CDN = 'https://cdn.jsdelivr.net/npm/javascript-obfuscator@4.1.0/+esm';

const $ = (id) => document.getElementById(id);

const els = {
  loginView: $('login-view'),
  cabinetView: $('cabinet-view'),
  logoutBtn: $('logout-btn'),
  loginForm: $('login-form'),
  tokenInput: $('token-input'),
  loginError: $('login-error'),
  loginSubmit: $('login-submit'),
  newGameBtn: $('new-game-btn'),
  listStatus: $('list-status'),
  gamesList: $('games-list'),
  formView: $('form-view'),
  gameForm: $('game-form'),
  formStatus: $('form-status'),
  formError: $('form-error'),
  formWarnings: $('form-warnings'),
  publishBtn: $('publish-btn'),
  saveDraftBtn: $('save-draft-btn'),
  cancelBtn: $('cancel-btn'),
  fTitle: $('f-title'),
  fDescription: $('f-description'),
  fCover: $('f-cover'),
  fTags: $('f-tags'),
  fCat1: $('f-cat1'),
  fCat2: $('f-cat2'),
  fOrientation: $('f-orientation'),
  fPlatformPc: $('f-platform-pc'),
  fPlatformMobile: $('f-platform-mobile'),
  fControlsPc: $('f-controls-pc'),
  fControlsMobile: $('f-controls-mobile'),
  fControlsPcWrap: $('f-controls-pc-wrap'),
  fControlsMobileWrap: $('f-controls-mobile-wrap'),
  fIsPublished: $('f-isPublished'),
  fIcon: $('f-icon'),
  fZip: $('f-zip'),
  fZipWrap: $('f-zip-wrap'),
  fSourceHosted: $('f-source-hosted'),
  fSourceExternal: $('f-source-external'),
  fEmbedWrap: $('f-embed-wrap'),
  fEmbedUrl: $('f-embed-url'),
  fProvider: $('f-provider'),
  cTitle: $('c-title'),
  cDescription: $('c-description'),
  slugLine: $('f-slug-line'),
  dupWarn: $('f-dup-warn'),
  authorLine: $('f-author-line'),
  tagSuggestions: $('tag-suggestions'),
  iconCropper: $('icon-cropper'),
  iconCanvas: $('icon-canvas'),
  iconZoom: $('icon-zoom'),
  coverCropper: $('cover-cropper'),
  coverCanvas: $('cover-canvas'),
  coverZoom: $('cover-zoom'),
};

/** Текущий каталог игр (GameEntry[]), обновляется в loadGames. */
let catalogGames = [];
/** Состояние редактирования: id правимой игры (null = новая). */
let editingId = null;

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}
function hideError(el) {
  el.textContent = '';
  el.hidden = true;
}

/* ---------- Routing between views ---------- */

function render() {
  if (isAuthed()) {
    els.loginView.hidden = true;
    els.cabinetView.hidden = false;
    els.logoutBtn.hidden = false;
    loadGames();
  } else {
    els.loginView.hidden = false;
    els.cabinetView.hidden = true;
    els.logoutBtn.hidden = true;
  }
}

/* ---------- Login ---------- */

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(els.loginError);
  const token = els.tokenInput.value.trim();
  if (!token) {
    showError(els.loginError, 'Вставьте токен.');
    return;
  }
  els.loginSubmit.disabled = true;
  els.loginSubmit.textContent = 'Проверка…';
  // saveToken до проверки — authedRequest читает токен из sessionStorage.
  saveToken(token);
  try {
    await authedRequest('GET', `${GITHUB_API_BASE}/user`);
    els.tokenInput.value = '';
    render();
  } catch (err) {
    clearToken();
    showError(els.loginError, `Не удалось войти: ${err.message}`);
  } finally {
    els.loginSubmit.disabled = false;
    els.loginSubmit.textContent = 'Войти';
  }
});

els.logoutBtn.addEventListener('click', () => {
  clearToken();
  render();
});

/* ---------- Games list ---------- */

async function loadGames() {
  els.listStatus.textContent = 'Загрузка каталога…';
  els.gamesList.innerHTML = '';
  try {
    const { games } = await readCatalog();
    catalogGames = games; // GameEntry[]
    els.listStatus.textContent = games.length ? '' : 'Пока нет игр. Нажмите «Новая игра».';
    for (const entry of games) els.gamesList.appendChild(gameCard(entry));
  } catch (err) {
    els.listStatus.textContent = `Ошибка загрузки: ${err.message}`;
  }
}

function badge(text, cls) {
  const b = document.createElement('span');
  b.className = `cab-tag ${cls}`;
  b.textContent = text;
  return b;
}

/**
 * Построить карточку игры по GameEntry (v2). Три состояния:
 *  - draft-only: есть draft, нет published
 *  - опубликовано (нет черновика): есть published, нет draft
 *  - опубликовано + черновик: есть оба
 * @param {import('./lib/games-api.js').GameEntry} entry
 */
function gameCard(entry) {
  const pub = getPublished(entry);
  const draft = getDraft(entry);
  // Для заголовка/мета берём актуальные данные: draft > published
  const display = draft || pub || { id: entry.id, title: entry.id };

  const card = document.createElement('div');
  card.className = 'cab-game';

  const info = document.createElement('div');
  const h = document.createElement('strong');
  h.textContent = display.title || entry.id;
  info.appendChild(h);

  const meta = document.createElement('div');
  meta.className = 'cab-muted';
  const cat = (Array.isArray(display.categories) && display.categories[0]) || display.category || '—';
  const dateStr = (pub && pub.dateAdded) ? ' · ' + pub.dateAdded.slice(0, 10) : '';
  meta.textContent = `${entry.id} · ${cat}${dateStr}`;
  info.appendChild(meta);

  // Бейджи состояния (по дизайн-доке §C)
  const badgeRow = document.createElement('div');
  badgeRow.className = 'cab-tags';
  if (pub) {
    badgeRow.appendChild(badge('опубликовано', 'cab-tag--pub'));
    if (draft) badgeRow.appendChild(badge('есть правки', 'cab-tag--draft'));
  } else {
    badgeRow.appendChild(badge('черновик', 'cab-tag--draft'));
  }
  info.appendChild(badgeRow);

  card.appendChild(info);

  // Кнопка «Студия» (всегда)
  const studioBtn = document.createElement('button');
  studioBtn.type = 'button';
  studioBtn.className = 'cab-btn cab-btn--ghost';
  studioBtn.textContent = 'Студия';
  studioBtn.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('game', entry.id);
    history.pushState({}, '', url);
    window.dispatchEvent(new CustomEvent('ngf:studio-open', { detail: { slug: entry.id, title: display.title || entry.id } }));
  });
  card.appendChild(studioBtn);

  // Кнопка «Редактировать» (всегда — открывает draft или published)
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'cab-btn cab-btn--ghost';
  editBtn.textContent = 'Редактировать';
  editBtn.addEventListener('click', () => openForm(entry));
  card.appendChild(editBtn);

  // Кнопка «Удалить» (всегда)
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cab-btn cab-btn--ghost';
  delBtn.textContent = 'Удалить';
  delBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      `Удалить игру «${display.title || entry.id}»?\n\nЭто необратимо: запись из каталога, страница игры, иконка, обложка и билд будут удалены.`,
    );
    if (!confirmed) return;

    delBtn.disabled = true;
    editBtn.disabled = true;
    els.listStatus.textContent = `Удаление «${display.title || entry.id}»…`;
    try {
      await deleteGame(entry.id);
      els.listStatus.textContent = `Игра «${display.title || entry.id}» удалена.`;
      await loadGames();
    } catch (err) {
      els.listStatus.textContent = `Ошибка удаления: ${err.message}`;
      delBtn.disabled = false;
      editBtn.disabled = false;
    }
  });
  card.appendChild(delBtn);

  // Кнопка «Опубликовать» — только для draft-only (pub=null, draft есть)
  if (!pub && draft) {
    const publishDraftBtn = document.createElement('button');
    publishDraftBtn.type = 'button';
    publishDraftBtn.className = 'cab-btn cab-btn--ghost';
    publishDraftBtn.textContent = 'Опубликовать';
    publishDraftBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(
        `Опубликовать игру «${display.title || entry.id}»?\n\nЧерновик станет публичным. Это необратимо.`,
      );
      if (!confirmed) return;

      publishDraftBtn.disabled = true;
      editBtn.disabled = true;
      els.listStatus.textContent = `Публикация «${display.title || entry.id}»…`;
      try {
        await promoteGame(entry.id);
        els.listStatus.textContent = `Игра «${display.title || entry.id}» опубликована.`;
        await loadGames();
      } catch (err) {
        els.listStatus.textContent = `Ошибка публикации: ${err.message}`;
        publishDraftBtn.disabled = false;
        editBtn.disabled = false;
      }
    });
    card.appendChild(publishDraftBtn);
  }

  // Кнопки «Отменить черновик» и «Опубликовать правки» — только если есть draft поверх published
  if (pub && draft) {
    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'cab-btn cab-btn--ghost';
    discardBtn.textContent = 'Отменить черновик';
    discardBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(
        `Отменить черновик «${display.title || entry.id}»?\n\nВсе несохранённые правки (мета, ассеты, билд) будут удалены. Это необратимо.`,
      );
      if (!confirmed) return;

      discardBtn.disabled = true;
      editBtn.disabled = true;
      els.listStatus.textContent = `Отмена черновика «${display.title || entry.id}»…`;
      try {
        await discardDraft(entry.id);
        els.listStatus.textContent = `Черновик «${display.title || entry.id}» отменён.`;
        await loadGames();
      } catch (err) {
        els.listStatus.textContent = `Ошибка отмены черновика: ${err.message}`;
        discardBtn.disabled = false;
        editBtn.disabled = false;
      }
    });
    card.appendChild(discardBtn);

    const promoteBtn = document.createElement('button');
    promoteBtn.type = 'button';
    promoteBtn.className = 'cab-btn cab-btn--ghost';
    promoteBtn.textContent = 'Опубликовать правки';
    promoteBtn.addEventListener('click', async () => {
      const title = display.title || entry.id;
      const confirmed = window.confirm(
        `Заменить опубликованную «${title}» черновиком?\n\nСейвы игроков сохранятся. Это необратимо.`,
      );
      if (!confirmed) return;

      promoteBtn.disabled = true;
      discardBtn.disabled = true;
      editBtn.disabled = true;
      els.listStatus.textContent = `Публикация правок «${title}»…`;
      try {
        await promoteGame(entry.id);
        els.listStatus.textContent = `Правки к «${title}» опубликованы.`;
        await loadGames();
      } catch (err) {
        els.listStatus.textContent = `Ошибка публикации правок: ${err.message}`;
        promoteBtn.disabled = false;
        discardBtn.disabled = false;
        editBtn.disabled = false;
      }
    });
    card.appendChild(promoteBtn);
  }

  return card;
}

/* ---------- Form: categories ---------- */

function fillCategorySelects() {
  const opts1 = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
  els.fCat1.innerHTML = opts1;
  els.fCat2.innerHTML =
    '<option value="">— нет —</option>' +
    CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
}

/* ---------- Form: char counters ---------- */

function bindCounter(input, counterEl, key) {
  const { max, soft } = LIMITS[key];
  const update = () => {
    const len = input.value.length;
    if (len >= soft) {
      counterEl.hidden = false;
      counterEl.textContent = `${len} / ${max}`;
      counterEl.classList.toggle('cab-counter--warn', len >= max);
    } else {
      counterEl.hidden = true;
      counterEl.classList.remove('cab-counter--warn');
    }
  };
  input.addEventListener('input', update);
  return update;
}

const updTitleCounter = bindCounter(els.fTitle, els.cTitle, 'title');
const updDescCounter = bindCounter(els.fDescription, els.cDescription, 'description');

/* ---------- Form: slug + duplicate ---------- */

function existingIdsExcept(id) {
  return catalogGames.map((e) => e.id).filter((x) => x !== id);
}

function updateSlugLine() {
  const title = els.fTitle.value.trim();
  if (!title) {
    els.slugLine.textContent = 'Адрес игры: /games/—/';
    els.dupWarn.hidden = true;
    return;
  }
  // При редактировании slug не меняется (id readonly-контракт).
  const slug = editingId || generateSlug(title, existingIdsExcept(editingId));
  els.slugLine.textContent = `Адрес игры: /games/${slug}/`;

  if (!editingId) {
    // findDuplicate ожидает GameMeta[]; передаём published-слои (что видит каталог).
    const publishedMetas = catalogGames.map(getPublished).filter(Boolean);
    const dup = findDuplicate(title, publishedMetas);
    if (dup) {
      els.dupWarn.textContent = `Игра с похожим названием уже есть: «${dup.title || dup.id}».`;
      els.dupWarn.hidden = false;
    } else {
      els.dupWarn.hidden = true;
    }
  }
}

/* ---------- Form: tag suggestions ---------- */

function currentTags() {
  return els.fTags.value.split(',').map((t) => t.trim()).filter(Boolean);
}

function updateTagSuggestions() {
  const cands = suggestTags(els.fTitle.value, els.fDescription.value);
  const have = new Set(currentTags());
  const fresh = cands.filter((t) => !have.has(t));
  els.tagSuggestions.innerHTML = '';
  if (!fresh.length) {
    els.tagSuggestions.hidden = true;
    return;
  }
  for (const t of fresh) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cab-chip-btn';
    chip.textContent = `+ ${t}`;
    chip.addEventListener('click', () => {
      const tags = currentTags();
      if (!tags.includes(t)) tags.push(t);
      els.fTags.value = tags.join(', ');
      updateTagSuggestions();
    });
    els.tagSuggestions.appendChild(chip);
  }
  els.tagSuggestions.hidden = false;
}

els.fTitle.addEventListener('input', () => { updateSlugLine(); updateTagSuggestions(); });
els.fDescription.addEventListener('input', updateTagSuggestions);
els.fTags.addEventListener('input', updateTagSuggestions);

/* ---------- Form: icon cropper (canvas, square) ---------- */

const cropper = {
  img: null,
  size: 256,      // canvas (preview) size
  scale: 1,       // base scale to cover square
  zoom: 1,
  offX: 0,        // pan offset in canvas px
  offY: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  fromFile: false, // true только когда изображение загружено из файла пользователем (не превью из репо)
};

function cropperDraw() {
  const c = els.iconCanvas;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!cropper.img) return;
  const s = cropper.scale * cropper.zoom;
  const w = cropper.img.width * s;
  const h = cropper.img.height * s;
  const x = (c.width - w) / 2 + cropper.offX;
  const y = (c.height - h) / 2 + cropper.offY;
  ctx.drawImage(cropper.img, x, y, w, h);
}

function cropperLoad(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    cropper.img = img;
    cropper.fromFile = true;
    cropper.scale = Math.max(els.iconCanvas.width / img.width, els.iconCanvas.height / img.height);
    cropper.zoom = 1;
    cropper.offX = 0;
    cropper.offY = 0;
    els.iconZoom.value = '1';
    els.iconCropper.hidden = false;
    cropperDraw();
    updatePublishButtonState();
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

els.fIcon.addEventListener('change', () => {
  const f = els.fIcon.files[0];
  if (f) cropperLoad(f);
  else els.iconCropper.hidden = true;
});
els.iconZoom.addEventListener('input', () => {
  cropper.zoom = parseFloat(els.iconZoom.value);
  cropperDraw();
});

function cropperPointerDown(e) {
  cropper.dragging = true;
  const p = e.touches ? e.touches[0] : e;
  cropper.lastX = p.clientX;
  cropper.lastY = p.clientY;
}
function cropperPointerMove(e) {
  if (!cropper.dragging) return;
  const p = e.touches ? e.touches[0] : e;
  cropper.offX += p.clientX - cropper.lastX;
  cropper.offY += p.clientY - cropper.lastY;
  cropper.lastX = p.clientX;
  cropper.lastY = p.clientY;
  cropperDraw();
  e.preventDefault();
}
function cropperPointerUp() { cropper.dragging = false; }

els.iconCanvas.addEventListener('mousedown', cropperPointerDown);
window.addEventListener('mousemove', cropperPointerMove);
window.addEventListener('mouseup', cropperPointerUp);
els.iconCanvas.addEventListener('touchstart', cropperPointerDown, { passive: false });
els.iconCanvas.addEventListener('touchmove', cropperPointerMove, { passive: false });
els.iconCanvas.addEventListener('touchend', cropperPointerUp);

/**
 * Экспортировать кроп в 512×512 blob (webp, png-фолбэк).
 * @returns {Promise<{blob: Blob, ext: string}|null>}
 */
function cropperExport() {
  if (!cropper.img) return Promise.resolve(null);
  const OUT = 512;
  const ratio = OUT / els.iconCanvas.width;
  const out = document.createElement('canvas');
  out.width = OUT;
  out.height = OUT;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(0, 0, OUT, OUT);
  const s = cropper.scale * cropper.zoom * ratio;
  const w = cropper.img.width * s;
  const h = cropper.img.height * s;
  const x = (OUT - w) / 2 + cropper.offX * ratio;
  const y = (OUT - h) / 2 + cropper.offY * ratio;
  ctx.drawImage(cropper.img, x, y, w, h);
  return new Promise((resolve) => {
    out.toBlob(
      (b) => (b ? resolve({ blob: b, ext: 'webp' }) : out.toBlob((p) => resolve({ blob: p, ext: 'png' }), 'image/png')),
      'image/webp',
      0.9,
    );
  });
}

async function blobToBytes(blob) {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/* ---------- Form: cover cropper (canvas, 1200×630 banner) ---------- */

const coverCropper = {
  img: null,
  scale: 1,
  zoom: 1,
  offX: 0,
  offY: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  fromFile: false, // true только когда изображение загружено из файла пользователем
};

function coverCropperDraw() {
  const c = els.coverCanvas;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!coverCropper.img) return;
  const s = coverCropper.scale * coverCropper.zoom;
  const w = coverCropper.img.width * s;
  const h = coverCropper.img.height * s;
  const x = (c.width - w) / 2 + coverCropper.offX;
  const y = (c.height - h) / 2 + coverCropper.offY;
  ctx.drawImage(coverCropper.img, x, y, w, h);
}

function coverCropperLoad(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    coverCropper.img = img;
    coverCropper.fromFile = true;
    coverCropper.scale = Math.max(els.coverCanvas.width / img.width, els.coverCanvas.height / img.height);
    coverCropper.zoom = 1;
    coverCropper.offX = 0;
    coverCropper.offY = 0;
    els.coverZoom.value = '1';
    els.coverCropper.hidden = false;
    coverCropperDraw();
    updatePublishButtonState();
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

els.fCover.addEventListener('change', () => {
  const f = els.fCover.files[0];
  if (f) coverCropperLoad(f);
  else els.coverCropper.hidden = true;
});
els.coverZoom.addEventListener('input', () => {
  coverCropper.zoom = parseFloat(els.coverZoom.value);
  coverCropperDraw();
});

function coverPointerDown(e) {
  coverCropper.dragging = true;
  const p = e.touches ? e.touches[0] : e;
  coverCropper.lastX = p.clientX;
  coverCropper.lastY = p.clientY;
}
function coverPointerMove(e) {
  if (!coverCropper.dragging) return;
  const p = e.touches ? e.touches[0] : e;
  coverCropper.offX += p.clientX - coverCropper.lastX;
  coverCropper.offY += p.clientY - coverCropper.lastY;
  coverCropper.lastX = p.clientX;
  coverCropper.lastY = p.clientY;
  coverCropperDraw();
  e.preventDefault();
}
function coverPointerUp() { coverCropper.dragging = false; }

els.coverCanvas.addEventListener('mousedown', coverPointerDown);
window.addEventListener('mousemove', coverPointerMove);
window.addEventListener('mouseup', coverPointerUp);
els.coverCanvas.addEventListener('touchstart', coverPointerDown, { passive: false });
els.coverCanvas.addEventListener('touchmove', coverPointerMove, { passive: false });
els.coverCanvas.addEventListener('touchend', coverPointerUp);

/* ---------- Form: platform checkboxes ---------- */

function syncPlatformControls() {
  const pcOn = els.fPlatformPc.checked;
  const mobOn = els.fPlatformMobile.checked;
  els.fControlsPcWrap.hidden = !pcOn;
  els.fControlsMobileWrap.hidden = !mobOn;
  if (!pcOn) els.fControlsPc.value = '';
  if (!mobOn) els.fControlsMobile.value = '';
}

els.fPlatformPc.addEventListener('change', syncPlatformControls);
els.fPlatformMobile.addEventListener('change', syncPlatformControls);

/* ---------- Form: source type (hosted / external) ---------- */

function isExternalSource() {
  return els.fSourceExternal && els.fSourceExternal.checked;
}

function syncSourceType() {
  const ext = isExternalSource();
  if (els.fEmbedWrap) els.fEmbedWrap.hidden = !ext;
  if (els.fZipWrap) els.fZipWrap.hidden = ext;
  updatePublishButtonState();
}

if (els.fSourceHosted) els.fSourceHosted.addEventListener('change', syncSourceType);
if (els.fSourceExternal) els.fSourceExternal.addEventListener('change', syncSourceType);

/**
 * Экспортировать кроп обложки в 1200×630 blob (webp, png-фолбэк).
 * @returns {Promise<{blob: Blob, ext: string}|null>}
 */
function coverCropperExport() {
  if (!coverCropper.img) return Promise.resolve(null);
  const OUT_W = 1200;
  const OUT_H = 630;
  const ratio = OUT_W / els.coverCanvas.width; // 1200/400 = 630/210 = 3
  const out = document.createElement('canvas');
  out.width = OUT_W;
  out.height = OUT_H;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  const s = coverCropper.scale * coverCropper.zoom * ratio;
  const w = coverCropper.img.width * s;
  const h = coverCropper.img.height * s;
  const x = (OUT_W - w) / 2 + coverCropper.offX * ratio;
  const y = (OUT_H - h) / 2 + coverCropper.offY * ratio;
  ctx.drawImage(coverCropper.img, x, y, w, h);
  return new Promise((resolve) => {
    out.toBlob(
      (b) => (b ? resolve({ blob: b, ext: 'webp' }) : out.toBlob((p) => resolve({ blob: p, ext: 'png' }), 'image/png')),
      'image/webp',
      0.9,
    );
  });
}

/* ---------- Form: open / collect / submit ---------- */

/**
 * Открыть форму редактирования.
 * @param {import('./lib/games-api.js').GameEntry|null} entry — entry v2 или null (новая игра).
 */
function openForm(entry) {
  hideError(els.formError);
  els.formStatus.textContent = '';
  els.formWarnings.hidden = true;
  els.formWarnings.innerHTML = '';
  els.gameForm.reset();
  fillCategorySelects();

  const editing = Boolean(entry);
  editingId = editing ? entry.id : null;

  // Выбор слоя по дизайн-доке §C:
  // есть draft → грузим draft; есть только published → грузим published; новая → пусто.
  const game = editing ? (getDraft(entry) || getPublished(entry)) : null;

  if (game) {
    els.fTitle.value = game.title || '';
    els.fDescription.value = game.description || '';
    els.fTags.value = Array.isArray(game.tags) ? game.tags.join(', ') : '';
    const cats = (Array.isArray(game.categories) && game.categories) ||
      (game.category ? [game.category] : []);
    els.fCat1.value = cats[0] && CATEGORIES.includes(cats[0]) ? cats[0] : CATEGORIES[0];
    els.fCat2.value = cats[1] && CATEGORIES.includes(cats[1]) ? cats[1] : '';
    els.fOrientation.value = game.orientation || 'landscape';

    const platforms = Array.isArray(game.platforms) ? game.platforms : [];
    const controls = game.controls || {};
    els.fPlatformPc.checked = platforms.indexOf('pc') !== -1;
    els.fPlatformMobile.checked = platforms.indexOf('mobile') !== -1;
    els.fControlsPc.value = controls.pc || '';
    els.fControlsMobile.value = controls.mobile || '';
    els.fControlsPcWrap.hidden = !els.fPlatformPc.checked;
    els.fControlsMobileWrap.hidden = !els.fPlatformMobile.checked;

    const fl = game.flags || {};
    els.fIsPublished.checked = Boolean(fl.isPublished);
  } else {
    els.fOrientation.value = 'landscape';
    els.fIsPublished.checked = true;
  }

  els.fIcon.value = '';
  els.fCover.value = '';
  els.fZip.value = '';
  cropper.img = null;
  cropper.fromFile = false;
  els.iconCropper.hidden = true;
  coverCropper.img = null;
  coverCropper.fromFile = false;
  els.coverCropper.hidden = true;

  // Переключатель hosted/external + поля embed
  const isExternal = game && game.source === 'external';
  if (els.fSourceHosted) els.fSourceHosted.checked = !isExternal;
  if (els.fSourceExternal) els.fSourceExternal.checked = isExternal;
  if (els.fEmbedUrl) els.fEmbedUrl.value = (game && game.embedUrl) || '';
  if (els.fProvider) {
    const prov = (game && game.provider) || 'gamemonetize';
    els.fProvider.value = ['gamemonetize', 'gamedistribution', 'custom'].includes(prov) ? prov : 'gamemonetize';
  }
  if (els.fEmbedWrap) els.fEmbedWrap.hidden = !isExternal;
  if (els.fZipWrap) els.fZipWrap.hidden = isExternal;

  // NGF-042: показать превью текущей иконки/обложки из загруженного слоя.
  // Рисуем на canvas через Image — пользователь видит что стоит сейчас.
  if (game && game.icon) {
    const iconUrl = /^https?:\/\//i.test(game.icon)
      ? game.icon
      : `https://raw.githubusercontent.com/${CATALOG_REPO}/main/${game.icon}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      cropper.img = img;
      cropper.scale = Math.max(els.iconCanvas.width / img.width, els.iconCanvas.height / img.height);
      cropper.zoom = 1;
      cropper.offX = 0;
      cropper.offY = 0;
      els.iconZoom.value = '1';
      els.iconCropper.hidden = false;
      cropperDraw();
      updatePublishButtonState();
    };
    img.src = iconUrl;
  }
  if (game && game.coverUrl) {
    const coverUrl = /^https?:\/\//i.test(game.coverUrl)
      ? game.coverUrl
      : `https://raw.githubusercontent.com/${CATALOG_REPO}/main/${game.coverUrl}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      coverCropper.img = img;
      coverCropper.scale = Math.max(els.coverCanvas.width / img.width, els.coverCanvas.height / img.height);
      coverCropper.zoom = 1;
      coverCropper.offX = 0;
      coverCropper.offY = 0;
      els.coverZoom.value = '1';
      els.coverCropper.hidden = false;
      coverCropperDraw();
      updatePublishButtonState();
    };
    img.src = coverUrl;
  }

  els.authorLine.textContent = 'Автор: …';
  getViewerLogin().then((login) => {
    els.authorLine.textContent = `Автор: ${login || '—'}`;
  }).catch(() => { els.authorLine.textContent = 'Автор: —'; });

  updTitleCounter();
  updDescCounter();
  updateSlugLine();
  updateTagSuggestions();

  $('form-heading').textContent = editing ? `Редактирование: ${entry.id}` : 'Новая игра';

  // Кнопка «Опубликовать» — только для первой публикации (нет published-слоя).
  // Для опубликованных игр правки идут через «Сохранить черновик» → «Опубликовать правки».
  const hasPublished = Boolean(entry && getPublished(entry));
  els.publishBtn.hidden = hasPublished;

  updatePublishButtonState();
  els.formView.hidden = false;
  els.formView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

els.newGameBtn.addEventListener('click', () => openForm(null));
els.cancelBtn.addEventListener('click', () => {
  els.formView.hidden = true;
});

// Реактивное переключение кнопки «Опубликовать» по изменению полей формы.
['input', 'change'].forEach(evt => {
  els.fTitle.addEventListener(evt, updatePublishButtonState);
  els.fDescription.addEventListener(evt, updatePublishButtonState);
  els.fZip.addEventListener(evt, updatePublishButtonState);
  els.fIcon.addEventListener(evt, updatePublishButtonState);
  els.fCover.addEventListener(evt, updatePublishButtonState);
  els.fControlsPc.addEventListener(evt, updatePublishButtonState);
  els.fControlsMobile.addEventListener(evt, updatePublishButtonState);
  if (els.fEmbedUrl) els.fEmbedUrl.addEventListener(evt, updatePublishButtonState);
});
els.fCat1.addEventListener('change', updatePublishButtonState);
els.fPlatformPc.addEventListener('change', updatePublishButtonState);
els.fPlatformMobile.addEventListener('change', updatePublishButtonState);

function collectMeta(slug) {
  const tags = currentTags();
  const categories = [els.fCat1.value, els.fCat2.value].filter(Boolean);
  const platforms = [];
  if (els.fPlatformPc.checked) platforms.push('pc');
  if (els.fPlatformMobile.checked) platforms.push('mobile');
  const controls = {};
  if (els.fPlatformPc.checked) controls.pc = els.fControlsPc.value.trim();
  if (els.fPlatformMobile.checked) controls.mobile = els.fControlsMobile.value.trim();
  const ext = isExternalSource();
  return {
    id: slug,
    title: els.fTitle.value.trim(),
    description: els.fDescription.value.trim(),
    tags,
    categories,
    platforms,
    controls,
    orientation: els.fOrientation.value,
    source: ext ? 'external' : 'hosted',
    embedUrl: ext ? (els.fEmbedUrl ? els.fEmbedUrl.value.trim() : '') : '',
    provider: ext ? (els.fProvider ? els.fProvider.value : '') : '',
    flags: {
      isPublished: els.fIsPublished.checked,
    },
  };
}

/** Переключает кнопку «Опубликовать»: зелёная/активная — только когда форма валидна. */
function updatePublishButtonState() {
  const ok = validatePublish() === null;
  if (ok) {
    els.publishBtn.disabled = false;
    els.publishBtn.classList.add('cab-btn--primary');
  } else {
    els.publishBtn.disabled = true;
    els.publishBtn.classList.remove('cab-btn--primary');
  }
}

/** Валидация перед публикацией. Возвращает строку ошибки или null. */
function validatePublish() {
  const title = els.fTitle.value.trim();
  if (!title) return 'Укажите название.';
  if (!els.fPlatformPc.checked && !els.fPlatformMobile.checked)
    return 'Выберите хотя бы одну платформу.';

  const ext = isExternalSource();
  // Ищем entry по editingId, берём слой: draft > published (тот же, что грузит форма).
  const existingEntry = editingId ? catalogGames.find((e) => e.id === editingId) : null;
  const existingMeta = existingEntry ? (getDraft(existingEntry) || getPublished(existingEntry)) : null;

  if (ext) {
    // external: embedUrl обязателен
    const url = els.fEmbedUrl ? els.fEmbedUrl.value.trim() : '';
    if (!url) return 'Укажите Embed URL игры.';
    if (!/^https:\/\//i.test(url)) return 'Embed URL должен начинаться с https://.';
  } else {
    // hosted: zip или существующий buildUrl обязателен
    const zipFile = els.fZip.files[0] || null;
    if (!zipFile && !(existingMeta && existingMeta.buildUrl))
      return 'Загрузите .zip билда.';
  }

  if (!els.fDescription.value.trim()) return 'Заполните описание игры.';
  if (!els.fCat1.value) return 'Выберите основную категорию.';
  if (!cropper.img && !(existingMeta && existingMeta.icon)) return 'Загрузите иконку игры.';
  if (!coverCropper.img && !(existingMeta && existingMeta.coverUrl)) return 'Загрузите обложку игры.';

  if (els.fPlatformPc.checked && !els.fControlsPc.value.trim())
    return 'Опишите управление на ПК.';
  if (els.fPlatformMobile.checked && !els.fControlsMobile.value.trim())
    return 'Опишите управление на мобильных.';

  return null;
}

els.gameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(els.formError);
  els.formWarnings.hidden = true;
  els.formWarnings.innerHTML = '';

  // Защита: опубликованную игру нельзя менять через этот путь — только через черновик + promoteGame.
  if (editingId) {
    const existingEntryCheck = catalogGames.find((en) => en.id === editingId);
    if (existingEntryCheck && getPublished(existingEntryCheck)) {
      showError(
        els.formError,
        'Опубликованную игру нельзя менять напрямую. Сохраните черновик и нажмите «Опубликовать правки» на карточке.'
      );
      return;
    }
  }

  const validationError = validatePublish();
  if (validationError) {
    showError(els.formError, validationError);
    return;
  }
  const title = els.fTitle.value.trim();
  const slug = editingId || generateSlug(title, existingIdsExcept(editingId));
  const meta = collectMeta(slug);
  const zipFile = els.fZip.files[0] || null;

  // NGF-042: если ассет не менялся (превью из репо) — сохранить существующий путь.
  const existingEntryForSubmit = editingId ? catalogGames.find((e) => e.id === slug) : null;
  const existingMetaForSubmit = existingEntryForSubmit
    ? (getDraft(existingEntryForSubmit) || getPublished(existingEntryForSubmit))
    : null;

  els.publishBtn.disabled = true;
  try {
    // Иконка: кроп → 512×512 → коммит в каталог-репо (только при новом файле от пользователя).
    if (cropper.img && cropper.fromFile) {
      els.formStatus.textContent = 'Загрузка иконки…';
      const exported = await cropperExport();
      if (exported) {
        const bytes = await blobToBytes(exported.blob);
        const iconPath = `assets/icons/${slug}.${exported.ext}`;
        await putFile(CATALOG_REPO, iconPath, bytes, {
          message: `Upload icon for ${slug}`,
        });
        meta.icon = iconPath;
      }
    } else if (existingMetaForSubmit && existingMetaForSubmit.icon) {
      // Ассет не менялся — сохранить текущий путь чтобы upsert не затёр его пустой строкой.
      meta.icon = existingMetaForSubmit.icon;
    }

    // Обложка: кроп → 1200×630 → коммит в каталог-репо (только при новом файле от пользователя).
    if (coverCropper.img && coverCropper.fromFile) {
      els.formStatus.textContent = 'Загрузка обложки…';
      const exported = await coverCropperExport();
      if (exported) {
        const bytes = await blobToBytes(exported.blob);
        const coverPath = `assets/covers/${slug}.${exported.ext}`;
        await putFile(CATALOG_REPO, coverPath, bytes, {
          message: `Upload cover for ${slug}`,
        });
        meta.coverUrl = coverPath;
      }
    } else if (existingMetaForSubmit && existingMetaForSubmit.coverUrl) {
      meta.coverUrl = existingMetaForSubmit.coverUrl;
    }

    let result;
    const zipFile = isExternalSource() ? null : (els.fZip.files[0] || null);
    if (!isExternalSource() && zipFile) {
      els.formStatus.textContent = 'Загрузка библиотек (zip + защита)…';
      const [JSZipMod, obfMod] = await Promise.all([import(JSZIP_CDN), import(OBFUSCATOR_CDN)]);
      const JSZip = JSZipMod.default || JSZipMod;
      const obfuscator = obfMod.default || obfMod;

      els.formStatus.textContent = 'Публикация билда (распаковка → защита → коммит)…';
      result = await publishGame({ meta, zipFile, deps: { JSZip, obfuscator } });
      els.formStatus.textContent =
        `Готово. Версия ${result.version}. Билд: ${result.buildUrl}`;
      for (const w of result.warnings || []) {
        const p = document.createElement('p');
        p.textContent = `⚠ ${w} Проверьте, что игра запускается.`;
        els.formWarnings.appendChild(p);
      }
      if (result.warnings && result.warnings.length) els.formWarnings.hidden = false;
    } else {
      els.formStatus.textContent = 'Сохранение метаданных…';
      // external или hosted без нового zip: пишем в published-слой напрямую.
      const res = await upsertGame(meta, { layer: 'published' });
      els.formStatus.textContent = res.created
        ? 'Создана запись (без билда).'
        : 'Метаданные сохранены.';
    }
    editingId = slug;
    await loadGames();
  } catch (err) {
    els.formStatus.textContent = '';
    showError(els.formError, err.message);
  } finally {
    els.publishBtn.disabled = false;
  }
});

/* ---------- Save draft button ---------- */

els.saveDraftBtn.addEventListener('click', async () => {
  hideError(els.formError);
  els.formWarnings.hidden = true;
  els.formWarnings.innerHTML = '';

  const title = els.fTitle.value.trim();
  if (!title) {
    showError(els.formError, 'Укажите название — оно нужно для сохранения черновика.');
    return;
  }

  const slug = editingId || generateSlug(title, existingIdsExcept(editingId));
  const meta = collectMeta(slug);
  // Черновик всегда isPublished = false, независимо от чекбокса
  meta.flags.isPublished = false;
  const zipFile = isExternalSource() ? null : (els.fZip.files[0] || null);

  // NGF-042: сохранить существующие пути если ассет не менялся.
  const existingEntryForDraft = editingId ? catalogGames.find((e) => e.id === slug) : null;
  const existingMetaForDraft = existingEntryForDraft
    ? (getDraft(existingEntryForDraft) || getPublished(existingEntryForDraft))
    : null;

  els.saveDraftBtn.disabled = true;
  els.publishBtn.disabled = true;
  try {
    // NGF-017: если у игры уже есть published-слой — ассеты черновика кладём под -draft суффикс
    // чтобы не перезаписать опубликованные файлы.
    // Для draft-only (новой игры без published) — обычные пути (они и станут published-путями при promote).
    const existingEntryForDraftCheck = editingId ? catalogGames.find((e) => e.id === slug) : null;
    const hasDraftSuffix = Boolean(existingEntryForDraftCheck && existingEntryForDraftCheck.published);

    // Иконка: кроп → 512×512 → коммит в каталог-репо (только при новом файле от пользователя).
    if (cropper.img && cropper.fromFile) {
      els.formStatus.textContent = 'Загрузка иконки…';
      const exported = await cropperExport();
      if (exported) {
        const bytes = await blobToBytes(exported.blob);
        // NGF-017: published уже есть → суффикс -draft; иначе обычное имя.
        const iconPath = hasDraftSuffix
          ? `assets/icons/${slug}-draft.${exported.ext}`
          : `assets/icons/${slug}.${exported.ext}`;
        await putFile(CATALOG_REPO, iconPath, bytes, {
          message: `Upload draft icon for ${slug}`,
        });
        meta.icon = iconPath;
      }
    } else if (existingMetaForDraft && existingMetaForDraft.icon) {
      meta.icon = existingMetaForDraft.icon;
    }

    // Обложка: кроп → 1200×630 → коммит в каталог-репо (только при новом файле от пользователя).
    if (coverCropper.img && coverCropper.fromFile) {
      els.formStatus.textContent = 'Загрузка обложки…';
      const exported = await coverCropperExport();
      if (exported) {
        const bytes = await blobToBytes(exported.blob);
        // NGF-017: published уже есть → суффикс -draft; иначе обычное имя.
        const coverPath = hasDraftSuffix
          ? `assets/covers/${slug}-draft.${exported.ext}`
          : `assets/covers/${slug}.${exported.ext}`;
        await putFile(CATALOG_REPO, coverPath, bytes, {
          message: `Upload draft cover for ${slug}`,
        });
        meta.coverUrl = coverPath;
      }
    } else if (existingMetaForDraft && existingMetaForDraft.coverUrl) {
      meta.coverUrl = existingMetaForDraft.coverUrl;
    }

    if (!isExternalSource() && zipFile) {
      els.formStatus.textContent = 'Загрузка библиотек (zip + защита)…';
      const [JSZipMod, obfMod] = await Promise.all([import(JSZIP_CDN), import(OBFUSCATOR_CDN)]);
      const JSZip = JSZipMod.default || JSZipMod;
      const obfuscator = obfMod.default || obfMod;

      els.formStatus.textContent = 'Сохранение черновика с билдом…';
      // layer:'draft' — залить билд, но записать в draft-слой (не публиковать).
      const result = await publishGame({ meta, zipFile, deps: { JSZip, obfuscator }, layer: 'draft' });
      for (const w of result.warnings || []) {
        const p = document.createElement('p');
        p.textContent = `⚠ ${w} Проверьте, что игра запускается.`;
        els.formWarnings.appendChild(p);
      }
      if (result.warnings && result.warnings.length) els.formWarnings.hidden = false;
    } else {
      els.formStatus.textContent = 'Сохранение черновика…';
      await upsertGame(meta);
    }

    els.formStatus.textContent = 'Сохранено как черновик. Можно вернуться и доработать.';
    editingId = slug;
    await loadGames();
    // Форма не закрывается — редактирование можно продолжить
  } catch (err) {
    els.formStatus.textContent = '';
    showError(els.formError, err.message);
  } finally {
    els.saveDraftBtn.disabled = false;
    els.publishBtn.disabled = false;
  }
});

// Studio-роутинг: скрыть/показать cabinet-view при открытии/закрытии Studio.
window.addEventListener('ngf:studio-open', () => {
  els.cabinetView.hidden = true;
});
window.addEventListener('ngf:studio-close', () => {
  els.cabinetView.hidden = false;
  // Убрать ?game= из URL
  const url = new URL(location.href);
  url.searchParams.delete('game');
  history.pushState({}, '', url);
});

render();
