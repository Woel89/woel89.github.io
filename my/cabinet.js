/**
 * Кабинет владельца NetGameForge (#9). Вход по PAT, список игр, форма, публикация.
 * Токен только в sessionStorage (через auth.js), не в URL, не в логи.
 * @module cabinet
 */

import { isAuthed, saveToken, clearToken } from './lib/auth.js';
import { authedRequest } from './lib/auth.js';
import {
  readCatalog, publishGame, upsertGame,
  generateSlug, findDuplicate, getViewerLogin, suggestTags,
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
  howToPlay: { max: 400, soft: 340 },
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
  cancelBtn: $('cancel-btn'),
  fTitle: $('f-title'),
  fDescription: $('f-description'),
  fHowToPlay: $('f-howToPlay'),
  fCover: $('f-cover'),
  fTags: $('f-tags'),
  fCat1: $('f-cat1'),
  fCat2: $('f-cat2'),
  fOrientation: $('f-orientation'),
  fIsPublished: $('f-isPublished'),
  fIcon: $('f-icon'),
  fZip: $('f-zip'),
  cTitle: $('c-title'),
  cDescription: $('c-description'),
  cHowToPlay: $('c-howToPlay'),
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

/** Текущий каталог игр (для slug/дублей), обновляется в loadGames. */
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
    catalogGames = games;
    els.listStatus.textContent = games.length ? '' : 'Пока нет игр. Нажмите «Новая игра».';
    for (const g of games) els.gamesList.appendChild(gameCard(g));
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

function gameCard(g) {
  const card = document.createElement('div');
  card.className = 'cab-game';

  const info = document.createElement('div');
  const h = document.createElement('strong');
  h.textContent = g.title || g.id;
  info.appendChild(h);

  const meta = document.createElement('div');
  meta.className = 'cab-muted';
  const cat = (Array.isArray(g.categories) && g.categories[0]) || g.category || '—';
  meta.textContent = `${g.id} · ${cat}${g.dateAdded ? ' · ' + g.dateAdded.slice(0, 10) : ''}`;
  info.appendChild(meta);

  const flags = document.createElement('div');
  flags.className = 'cab-tags';
  const f = g.flags || {};
  if (f.isNew) flags.appendChild(badge('новинка', 'cab-tag--new'));
  if (f.isPopular) flags.appendChild(badge('популярное', 'cab-tag--pop'));
  flags.appendChild(badge(f.isPublished ? 'опубликовано' : 'черновик', f.isPublished ? 'cab-tag--pub' : 'cab-tag--draft'));
  info.appendChild(flags);

  card.appendChild(info);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'cab-btn cab-btn--ghost';
  editBtn.textContent = 'Редактировать';
  editBtn.addEventListener('click', () => openForm(g));
  card.appendChild(editBtn);

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
const updHowCounter = bindCounter(els.fHowToPlay, els.cHowToPlay, 'howToPlay');

/* ---------- Form: slug + duplicate ---------- */

function existingIdsExcept(id) {
  return catalogGames.map((g) => g.id).filter((x) => x !== id);
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
    const dup = findDuplicate(title, catalogGames);
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
    cropper.scale = Math.max(els.iconCanvas.width / img.width, els.iconCanvas.height / img.height);
    cropper.zoom = 1;
    cropper.offX = 0;
    cropper.offY = 0;
    els.iconZoom.value = '1';
    els.iconCropper.hidden = false;
    cropperDraw();
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
    coverCropper.scale = Math.max(els.coverCanvas.width / img.width, els.coverCanvas.height / img.height);
    coverCropper.zoom = 1;
    coverCropper.offX = 0;
    coverCropper.offY = 0;
    els.coverZoom.value = '1';
    els.coverCropper.hidden = false;
    coverCropperDraw();
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

function openForm(game) {
  hideError(els.formError);
  els.formStatus.textContent = '';
  els.formWarnings.hidden = true;
  els.formWarnings.innerHTML = '';
  els.gameForm.reset();
  fillCategorySelects();

  const editing = Boolean(game);
  editingId = editing ? game.id : null;
  els.fTitle.value = editing ? game.title || '' : '';
  els.fDescription.value = editing ? game.description || '' : '';
  els.fHowToPlay.value = editing ? game.howToPlay || '' : '';
  els.fTags.value = editing && Array.isArray(game.tags) ? game.tags.join(', ') : '';
  const cats = (editing && Array.isArray(game.categories) && game.categories) ||
    (editing && game.category ? [game.category] : []);
  els.fCat1.value = cats[0] && CATEGORIES.includes(cats[0]) ? cats[0] : CATEGORIES[0];
  els.fCat2.value = cats[1] && CATEGORIES.includes(cats[1]) ? cats[1] : '';
  els.fOrientation.value = editing ? game.orientation || 'landscape' : 'landscape';
  const fl = (editing && game.flags) || {};
  els.fIsPublished.checked = editing ? Boolean(fl.isPublished) : true;
  els.fIcon.value = '';
  els.fCover.value = '';
  els.fZip.value = '';
  cropper.img = null;
  els.iconCropper.hidden = true;
  coverCropper.img = null;
  els.coverCropper.hidden = true;

  els.authorLine.textContent = 'Автор: …';
  getViewerLogin().then((login) => {
    els.authorLine.textContent = `Автор: ${login || '—'}`;
  }).catch(() => { els.authorLine.textContent = 'Автор: —'; });

  updTitleCounter();
  updDescCounter();
  updHowCounter();
  updateSlugLine();
  updateTagSuggestions();

  $('form-heading').textContent = editing ? `Редактирование: ${game.id}` : 'Новая игра';
  els.formView.hidden = false;
  els.formView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

els.newGameBtn.addEventListener('click', () => openForm(null));
els.cancelBtn.addEventListener('click', () => {
  els.formView.hidden = true;
});

function collectMeta(slug) {
  const tags = currentTags();
  const categories = [els.fCat1.value, els.fCat2.value].filter(Boolean);
  return {
    id: slug,
    title: els.fTitle.value.trim(),
    description: els.fDescription.value.trim(),
    howToPlay: els.fHowToPlay.value.trim(),
    tags,
    categories,
    orientation: els.fOrientation.value,
    flags: {
      isPublished: els.fIsPublished.checked,
    },
  };
}

els.gameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(els.formError);
  els.formWarnings.hidden = true;
  els.formWarnings.innerHTML = '';

  const title = els.fTitle.value.trim();
  if (!title) {
    showError(els.formError, 'Укажите название.');
    return;
  }
  const slug = editingId || generateSlug(title, existingIdsExcept(editingId));
  const meta = collectMeta(slug);
  const zipFile = els.fZip.files[0] || null;

  els.publishBtn.disabled = true;
  try {
    // Иконка: кроп → 512×512 → коммит в каталог-репо.
    if (cropper.img) {
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
    }

    // Обложка: кроп → 1200×630 → коммит в каталог-репо.
    if (coverCropper.img) {
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
    }

    let result;
    if (zipFile) {
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
      const res = await upsertGame(meta);
      els.formStatus.textContent = res.created
        ? 'Создана запись (без билда).'
        : 'Метаданные сохранены.';
    }
    await loadGames();
  } catch (err) {
    els.formStatus.textContent = '';
    showError(els.formError, err.message);
  } finally {
    els.publishBtn.disabled = false;
  }
});

render();
