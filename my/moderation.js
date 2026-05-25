/**
 * Модерация отзывов в кабинете (FE-15). Отдельный вход по МОДЕРАТОРСКОМУ токену
 * (Worker Secret MODERATOR_TOKEN), хранится в sessionStorage — НЕ путать с GitHub PAT.
 * Очередь pending: GET /admin/reviews; одобрить/отклонить: POST /admin/review/:id.
 * @module moderation
 */

const API_BASE = 'https://ngf-api.kovalevde.workers.dev';
const TOKEN_KEY = 'ngf_mod_token';

const $ = (id) => document.getElementById(id);

const els = {
  form: $('mod-login-form'),
  input: $('mod-token-input'),
  submit: $('mod-login-submit'),
  logout: $('mod-logout-btn'),
  error: $('mod-error'),
  status: $('mod-status'),
  queue: $('mod-queue'),
};

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}
function setToken(t) {
  sessionStorage.setItem(TOKEN_KEY, t);
}
function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
}
function hideError() {
  els.error.textContent = '';
  els.error.hidden = true;
}

async function adminFetch(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function fmtDate(ts) {
  if (!ts) return '';
  const dt = new Date(ts * 1000);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleString('ru-RU');
}

function reviewCard(r) {
  const card = document.createElement('div');
  card.className = 'cab-game';

  const info = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'cab-muted';
  meta.textContent = `${r.game_id} · ${fmtDate(r.created_at)}${r.name ? ' · ' + r.name : ''}`;
  info.appendChild(meta);
  const text = document.createElement('p');
  text.style.margin = '0.4rem 0 0';
  text.style.whiteSpace = 'pre-wrap';
  text.textContent = r.text;
  info.appendChild(text);
  card.appendChild(info);

  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'cab-btn cab-btn--primary';
  approve.textContent = 'Одобрить';

  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'cab-btn cab-btn--ghost';
  reject.textContent = 'Отклонить';

  async function act(action) {
    approve.disabled = reject.disabled = true;
    try {
      await adminFetch(`/admin/review/${r.id}`, {
        method: 'POST',
        body: JSON.stringify(action === 'reject' ? { action, reject_reason: 'manual' } : { action }),
      });
      card.remove();
      if (!els.queue.children.length) els.status.textContent = 'Очередь пуста.';
    } catch (err) {
      approve.disabled = reject.disabled = false;
      els.status.textContent = `Ошибка: ${err.message}`;
    }
  }
  approve.addEventListener('click', () => act('approve'));
  reject.addEventListener('click', () => act('reject'));

  card.appendChild(approve);
  card.appendChild(reject);
  return card;
}

async function loadQueue() {
  els.status.textContent = 'Загрузка очереди…';
  els.queue.innerHTML = '';
  try {
    const { reviews } = await adminFetch('/admin/reviews?status=pending');
    els.status.textContent = (reviews && reviews.length) ? '' : 'Очередь пуста.';
    (reviews || []).forEach((r) => els.queue.appendChild(reviewCard(r)));
  } catch (err) {
    if (err.status === 401) {
      clearToken();
      renderLoggedOut();
      showError('Неверный модераторский токен.');
    } else {
      els.status.textContent = `Ошибка загрузки: ${err.message}`;
    }
  }
}

function renderLoggedIn() {
  els.input.value = '';
  els.input.hidden = true;
  els.input.parentElement.hidden = true;
  els.submit.hidden = true;
  els.logout.hidden = false;
  loadQueue();
}

function renderLoggedOut() {
  els.input.hidden = false;
  els.input.parentElement.hidden = false;
  els.submit.hidden = false;
  els.logout.hidden = true;
  els.status.textContent = '';
  els.queue.innerHTML = '';
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  hideError();
  const token = els.input.value.trim();
  if (!token) {
    showError('Вставьте модераторский токен.');
    return;
  }
  setToken(token);
  renderLoggedIn();
});

els.logout.addEventListener('click', () => {
  clearToken();
  renderLoggedOut();
});

if (getToken()) renderLoggedIn();
else renderLoggedOut();
