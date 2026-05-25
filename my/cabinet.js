/**
 * Кабинет владельца NetGameForge (#9). Вход по PAT, список игр, форма, публикация.
 * Токен только в sessionStorage (через auth.js), не в URL, не в логи.
 * @module cabinet
 */

import { isAuthed, saveToken, clearToken } from './lib/auth.js';
import { authedRequest } from './lib/auth.js';
import { readCatalog, publishGame, upsertGame } from './lib/games-api.js';
import { GITHUB_API_BASE } from './lib/config.js';

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
  fId: $('f-id'),
  fTitle: $('f-title'),
  fDescription: $('f-description'),
  fCoverUrl: $('f-coverUrl'),
  fTags: $('f-tags'),
  fCategory: $('f-category'),
  fOrientation: $('f-orientation'),
  fAuthor: $('f-author'),
  fIsNew: $('f-isNew'),
  fIsPopular: $('f-isPopular'),
  fIsPublished: $('f-isPublished'),
  fZip: $('f-zip'),
};

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
  meta.textContent = `${g.id} · ${g.category || '—'}${g.dateAdded ? ' · ' + g.dateAdded.slice(0, 10) : ''}`;
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

/* ---------- Form ---------- */

function openForm(game) {
  hideError(els.formError);
  els.formStatus.textContent = '';
  els.formWarnings.hidden = true;
  els.formWarnings.innerHTML = '';
  els.gameForm.reset();

  const editing = Boolean(game);
  els.fId.readOnly = editing;
  els.fId.value = editing ? game.id : '';
  els.fTitle.value = editing ? game.title || '' : '';
  els.fDescription.value = editing ? game.description || '' : '';
  els.fCoverUrl.value = editing ? game.coverUrl || '' : '';
  els.fTags.value = editing && Array.isArray(game.tags) ? game.tags.join(', ') : '';
  els.fCategory.value = editing ? game.category || '' : '';
  els.fOrientation.value = editing ? game.orientation || 'landscape' : 'landscape';
  els.fAuthor.value = editing ? game.author || '' : '';
  const fl = (editing && game.flags) || {};
  els.fIsNew.checked = Boolean(fl.isNew);
  els.fIsPopular.checked = Boolean(fl.isPopular);
  els.fIsPublished.checked = editing ? Boolean(fl.isPublished) : true;
  els.fZip.value = '';

  $('form-heading').textContent = editing ? `Редактирование: ${game.id}` : 'Новая игра';
  els.formView.hidden = false;
  els.formView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

els.newGameBtn.addEventListener('click', () => openForm(null));
els.cancelBtn.addEventListener('click', () => {
  els.formView.hidden = true;
});

function collectMeta() {
  const tags = els.fTags.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    id: els.fId.value.trim(),
    title: els.fTitle.value.trim(),
    description: els.fDescription.value.trim(),
    coverUrl: els.fCoverUrl.value.trim(),
    tags,
    category: els.fCategory.value.trim(),
    orientation: els.fOrientation.value,
    author: els.fAuthor.value.trim(),
    flags: {
      isNew: els.fIsNew.checked,
      isPopular: els.fIsPopular.checked,
      isPublished: els.fIsPublished.checked,
    },
  };
}

els.gameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(els.formError);
  els.formWarnings.hidden = true;
  els.formWarnings.innerHTML = '';

  const meta = collectMeta();
  const zipFile = els.fZip.files[0] || null;

  els.publishBtn.disabled = true;
  try {
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
