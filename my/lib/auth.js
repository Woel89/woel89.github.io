/**
 * Аутентификация кабинета (Фаза 1): fine-grained PAT владельца в sessionStorage.
 * Абстракция getAuth/authedRequest (дизайн §7): в Фазе 2 реализация меняется
 * на cookie-session, сигнатуры остаются те же.
 *
 * ВАЖНО: токен НИКОГДА не логируется, не печатается и не коммитится.
 * @module auth
 */

import { GITHUB_API_VERSION } from './config.js';

const STORAGE_KEY = 'ngf_pat';

/**
 * Сохранить PAT в sessionStorage (живёт до закрытия вкладки).
 * @param {string} token fine-grained Personal Access Token владельца.
 * @returns {void}
 */
export function saveToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Пустой токен.');
  }
  sessionStorage.setItem(STORAGE_KEY, token.trim());
}

/**
 * Получить сохранённый токен.
 * @returns {string|null} токен или null, если не авторизован.
 */
export function getToken() {
  return sessionStorage.getItem(STORAGE_KEY);
}

/**
 * Стереть токен (логаут).
 * @returns {void}
 */
export function clearToken() {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Авторизован ли пользователь (есть ли токен).
 * @returns {boolean}
 */
export function isAuthed() {
  return Boolean(getToken());
}

/**
 * Обёртка fetch к GitHub API с заголовками авторизации.
 * Бросает понятную ошибку при 401 (невалидный/протухший токен) и других не-2xx.
 *
 * @param {string} method HTTP-метод (GET/POST/PATCH/PUT/DELETE).
 * @param {string} url полный URL запроса (api.github.com/...).
 * @param {object|null} [body] тело запроса (будет сериализовано в JSON).
 * @returns {Promise<any>} разобранный JSON-ответ (или null для 204).
 * @throws {Error} при отсутствии токена, 401 или прочих не-2xx статусах.
 */
export async function authedRequest(method, url, body = null) {
  const token = getToken();
  if (!token) {
    throw new Error('Не авторизован: вставьте PAT в кабинете.');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    throw new Error('GitHub отклонил токен (401): токен невалиден или просрочен. Введите свежий PAT.');
  }
  if (res.status === 204) {
    return null;
  }

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const msg = payload && payload.message ? payload.message : res.statusText;
    // НЕ логируем токен/заголовки — только статус и сообщение GitHub.
    throw new Error(`GitHub API ${res.status}: ${msg}`);
  }

  return payload;
}
